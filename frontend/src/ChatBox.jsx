import { useEffect, useRef, useState } from 'react'
import { api, chatStream, tailStream } from './api.js'
import { applyTurnEvent, finishTurn, MessageBody } from './ToolActivity.jsx'
import { useAsk } from './ask.jsx'

// Compact chat, embeddable anywhere (board panel). When projectSlug is set,
// conversations are filtered to that project and new ones are linked to it.
//
// `agent` is the thread's IDENTITY — '' is central Jarvis, a slug runs the
// thread as that agent (its AGENT.md prompt, its exclusions). Everything else
// is unchanged, which is the point: an agent thread is a chat with a name, so
// it keeps multi-turn history, compaction, detach/re-attach and stop for free.
// Several panels on one board, each on a different agent, work the same project
// at the same time — the picker is what makes that expressible.
export default function ChatBox({ projectSlug, agent = '', onAgentChange }) {
  // the picker is owned by the panel (so it survives a remount and a reload);
  // fall back to local state for any caller that doesn't hold it
  const [localAgent, setLocalAgent] = useState('')
  const who = onAgentChange ? agent : localAgent
  const setWho = onAgentChange || setLocalAgent
  const [agents, setAgents] = useState([])
  const [convos, setConvos] = useState([])
  const [cid, setCid] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // draft parked on a peak-pricing 409 — in-page, never window.confirm (the
  // iOS home-screen app suppresses blocking dialogs; see Chat.jsx)
  const [peakAsk, setPeakAsk] = useState(null)
  const bottomRef = useRef(null)
  const tailAbort = useRef(null)   // cancels a resume-tail on switch/unmount
  const ask = useAsk()

  useEffect(() => () => tailAbort.current?.abort(), [])

  // shared by the live POST stream and a resumed background-turn tail
  function handleTurnEvent(ev) {
    if (['token', 'tool', 'tool_result', 'job'].includes(ev.type))
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = applyTurnEvent(copy[copy.length - 1], ev)
        return copy
      })
    if (ev.type === 'final')
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = finishTurn(copy[copy.length - 1], ev.content)
        return copy
      })
    if (ev.type === 'error')
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = { role: 'error', content: ev.message }
        return copy
      })
  }

  const refresh = () =>
    api(`/api/conversations${projectSlug ? `?project=${encodeURIComponent(projectSlug)}` : ''}`)
      .then((r) => { setConvos(r.conversations); return r.conversations })
  // the roster for the picker; failure just leaves it as Jarvis-only
  useEffect(() => {
    api('/api/agents').then((r) => setAgents(r.agents)).catch(() => {})
  }, [])
  useEffect(() => {
    // a board panel remounts on every open, and switching identity is a
    // switch of thread: resume where the operator left off for THIS agent —
    // a running turn wins, else that agent's latest thread — instead of
    // amnesia into "new chat" while work continues server-side
    refresh().then((list) => {
      const mine = list.filter((c) => (c.agent_slug || '') === who)
      const running = mine.find((c) => c.running)
      const target = running || (projectSlug ? mine[0] : null)
      open(target ? target.id : null)
    }).catch(() => {})
  }, [projectSlug, who]) // eslint-disable-line

  async function pick(id) {
    setShowHistory(false)
    // the list is already filtered to `who`, but a thread carries its own
    // identity — follow it rather than letting the picker lie about the
    // transcript on screen
    const row = convos.find((c) => c.id === id)
    if (row && (row.agent_slug || '') !== who) setWho(row.agent_slug || '')
    await open(id)
  }

  function newChat() {
    setShowHistory(false)
    setCid(null)
    setMessages([])
    setPeakAsk(null)
  }

  async function del(id, e) {
    e.stopPropagation()
    if (!await ask.confirm(`Delete chat #${id}?`,
                           { confirmLabel: 'Delete', danger: true })) return
    await api(`/api/conversations/${id}`, { method: 'DELETE' })
    if (id === cid) newChat()
    refresh()
  }

  useEffect(() => {
    // scroll ONLY the message list — scrollIntoView walks every scrollable
    // ancestor and yanked the whole workspace board to the bottom on stream
    const box = bottomRef.current?.parentElement
    if (box) box.scrollTop = box.scrollHeight
  }, [messages])

  async function open(id) {
    tailAbort.current?.abort()
    setPeakAsk(null)
    setCid(id)
    if (!id) { setMessages([]); return }
    const r = await api(`/api/conversations/${id}/messages`)
    setMessages(r.messages)
    if (!r.running) return
    // a turn is still executing server-side — re-attach and watch it finish,
    // seeding the placeholder with the tool calls it already made
    setBusy(true)
    const seed = (r.pending_activity || []).map((a) => ({ kind: 'tool', ...a }))
    setMessages((m) => [...m, { role: 'assistant', content: '', streaming: true, parts: seed }])
    const ctl = new AbortController()
    tailAbort.current = ctl
    try {
      await tailStream(`/api/chat/${id}/stream`, (ev) => {
        if (ev.type === 'idle') {
          api(`/api/conversations/${id}/messages`).then((r2) => setMessages(r2.messages))
          return
        }
        handleTurnEvent(ev)
      }, ctl.signal)
    } catch { /* tail aborted; messages reload on next open */ }
    setBusy(false)
  }

  async function stop() {
    // ends the turn server-side; the tail's final "[Request interrupted]"
    // event settles the UI through the normal finish path
    if (!cid) return
    try { await api(`/api/chat/${cid}/stop`, { method: 'POST' }) } catch { /* already done */ }
  }

  async function send(confirmPeak = false, resend = null) {
    const text = (resend ?? input).trim()
    if (!text || busy) return
    setBusy(true)
    // clear the bar NOW — the message visibly left; it comes back on failure
    if (!resend) setInput('')
    const wasNew = cid === null
    setMessages((m) => [...m, { role: 'user', content: text },
                        { role: 'assistant', content: '', streaming: true, parts: [] }])
    try {
      await chatStream(
        // a NEW conversation is created pre-pinned to this board's project, so
        // even its first turn runs in the right context (the old post-hoc PATCH
        // raced the turn's project resolution)
        // identity, like the project pin, binds at creation only — the backend
        // ignores it on an existing conversation
        { message: text, conversation_id: cid, confirm_peak: confirmPeak,
          project: wasNew && projectSlug ? projectSlug : undefined,
          agent: wasNew && who ? who : undefined },
        (ev) => {
          if (ev.type === 'start') {
            setCid(ev.conversation_id)
            if (wasNew) refresh()   // the new thread joins its picker's list
          }
          handleTurnEvent(ev)
        },
      )
      if (!projectSlug) refresh()
    } catch (err) {
      setMessages((m) => m.slice(0, -2))
      if (err.status === 409 && err.detail === 'peak_confirmation_required') {
        // a new conversation doesn't exist yet on this 409 (the backend
        // gates before creating it), so the confirmed retry re-sends the
        // parked draft from scratch
        setPeakAsk(text)
      } else if (err.status === 409 && err.detail === 'turn_in_progress') {
        setInput(text)
        setMessages((m) => [...m, { role: 'error',
          content: 'a turn is still running in this chat — wait for it to finish' }])
      } else {
        setInput(text)
        setMessages((m) => [...m, { role: 'error', content: err.detail || String(err) }])
      }
    }
    setBusy(false)
  }

  const current = convos.find((c) => c.id === cid)
  // one panel = one identity; its history is that identity's threads
  const threads = convos.filter((c) => (c.agent_slug || '') === who)
  const whoName = who
    ? (agents.find((a) => a.slug === who)?.name || who) : 'Jarvis'
  return (
    <div className="chatbox">
      <div className="row cb-head">
        <button className="ghost" title="past threads"
                onClick={() => setShowHistory((s) => !s)}>☰ {threads.length}</button>
        <select className="cb-agent" value={who}
                title="who this thread runs as — switching opens that agent's threads"
                onChange={(e) => { setShowHistory(false); setWho(e.target.value) }}>
          <option value="">Jarvis</option>
          {agents.map((a) => (
            <option key={a.slug} value={a.slug}>{a.name}</option>
          ))}
        </select>
        <span className="grow ellipsis dim">
          {current ? (current.summary || `#${current.id}`) : 'new thread'}</span>
        <button className="ghost" title="new thread" onClick={newChat}>+ new</button>
      </div>
      {showHistory && (
        <ul className="cb-history">
          {threads.length === 0 && <li className="dim">no past threads yet</li>}
          {threads.map((c) => (
            <li key={c.id} className={c.id === cid ? 'active' : ''}
                onClick={() => pick(c.id)}>
              <span className="grow ellipsis">
                {c.summary || `#${c.id} · ${c.started_at?.slice(5, 16) || ''}`}</span>
              <button className="win-btn" title="delete" onClick={(e) => del(c.id, e)}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="messages compact">
        {messages.length === 0 && (
          <div className="dim center-pad">
            {projectSlug ? `chat with ${whoName} about this project` : 'say hi'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'assistant'
              ? <MessageBody m={m} />
              : <pre>{m.content || (m.streaming ? '…' : '')}</pre>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {peakAsk && (
        <div className="peak-ask compact" role="alertdialog"
             aria-label="peak pricing confirmation">
          <span className="grow">Peak pricing — this reply costs 2×.</span>
          <button type="button" className="ghost"
                  onClick={() => { setInput(peakAsk); setPeakAsk(null) }}>
            Cancel</button>
          <button type="button"
                  onClick={() => { const t = peakAsk; setPeakAsk(null); send(true, t) }}>
            Send anyway</button>
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea className="grow" rows={2} value={input}
                  placeholder={`message ${whoName}…`}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }} />
        {busy
          ? <button type="button" className="ghost danger" title="stop this turn"
                    onClick={stop}>⏹</button>
          : <button type="submit">↑</button>}
      </form>
    </div>
  )
}
