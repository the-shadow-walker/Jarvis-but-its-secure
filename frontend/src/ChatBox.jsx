import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { MessageBody } from './ToolActivity.jsx'
import { useChatTurn } from './useChatTurn.js'
import { useAsk } from './ask.jsx'
import EmptyState from './components/EmptyState.jsx'

// Compact chat, embeddable anywhere (board panel). When projectSlug is set,
// conversations are filtered to that project and new ones are linked to it.
//
// `agent` is the thread's IDENTITY — '' is central Jarvis, a slug runs the
// thread as that agent (its AGENT.md prompt, its exclusions). Everything else
// is unchanged, which is the point: an agent thread is a chat with a name, so
// it keeps multi-turn history, compaction, detach/re-attach and stop for free.
// Several panels on one board, each on a different agent, work the same project
// at the same time — the picker is what makes that expressible.
//
// The streaming machinery — event folding, open-and-resume, stop, the peak-
// pricing gate — is useChatTurn, shared with the Chat page. It used to be a
// near-verbatim copy of it.
export default function ChatBox({ projectSlug, agent = '', onAgentChange }) {
  // the picker is owned by the panel (so it survives a remount and a reload);
  // fall back to local state for any caller that doesn't hold it
  const [localAgent, setLocalAgent] = useState('')
  const who = onAgentChange ? agent : localAgent
  const setWho = onAgentChange || setLocalAgent
  const [agents, setAgents] = useState([])
  const [convos, setConvos] = useState([])
  const [cid, setCid] = useState(null)
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const bottomRef = useRef(null)
  const turn = useChatTurn()
  const { messages, busy, peakAsk, setPeakAsk } = turn
  const ask = useAsk()

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
    turn.setMessages([])
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
    setCid(id)
    await turn.openThread(id)
  }

  async function send(confirmPeak = false, resend = null) {
    const text = (resend ?? input).trim()
    if (!text || busy) return
    // clear the bar NOW — the message visibly left; it comes back on failure
    if (!resend) setInput('')
    const wasNew = cid === null
    await turn.runTurn({
      text,
      // a NEW conversation is created pre-pinned to this board's project, so
      // even its first turn runs in the right context (the old post-hoc PATCH
      // raced the turn's project resolution)
      // identity, like the project pin, binds at creation only — the backend
      // ignores it on an existing conversation
      body: { message: text, conversation_id: cid, confirm_peak: confirmPeak,
              project: wasNew && projectSlug ? projectSlug : undefined,
              agent: wasNew && who ? who : undefined },
      onEvent: (ev) => {
        if (ev.type === 'start') {
          setCid(ev.conversation_id)
          if (wasNew) refresh()   // the new thread joins its picker's list
        }
        turn.handleTurnEvent(ev)
      },
      onDone: () => { if (!projectSlug) refresh() },
      onRestoreDraft: setInput,
    })
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
          {threads.length === 0 && <EmptyState as="li">no past threads yet</EmptyState>}
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
          <EmptyState pad>
            {projectSlug ? `chat with ${whoName} about this project` : 'say hi'}
          </EmptyState>
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
                    onClick={() => turn.stopTurn(cid)}>⏹</button>
          : <button type="submit">↑</button>}
      </form>
    </div>
  )
}
