import { useCallback, useEffect, useRef, useState } from 'react'
import { api, chatStream, tailStream } from './api.js'
import { applyTurnEvent, finishTurn } from './ToolActivity.jsx'

// One chat turn, wherever a chat is rendered.
//
// The Chat page and the Workspace's ChatBox panel are two very different
// surfaces over ONE conversation API, and the machinery between them had been
// copied rather than shared: the same event folding, the same open-and-resume
// block, the same stop call, and the same three-armed 409 handler — comment
// included — in both files. A fix to one was a fix to one.
//
// What is genuinely per-surface stays out: the transcript's chrome, the
// composer, the project/agent/temporary flags that go into the request body,
// and what a `start` event means (the page adopts the id unless the chat is
// temporary; the panel adopts it and refreshes its thread list). Those arrive
// as the `onEvent` wrapper and the request body.
export function useChatTurn() {
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  // draft parked on a peak-pricing 409 until the operator answers in-page.
  // This must NOT be window.confirm: the iOS home-screen app suppresses
  // blocking dialogs, so confirm() returns false without ever showing and
  // every send silently bounced back into the bar.
  const [peakAsk, setPeakAsk] = useState(null)
  const tailAbort = useRef(null)   // cancels a resume-tail on switch/unmount

  useEffect(() => () => tailAbort.current?.abort(), [])
  const abortTail = useCallback(() => tailAbort.current?.abort(), [])

  // token/tool/tool_result fold into the streaming message's parts; final
  // swaps in the reply with the activity collapsed above it.
  const handleTurnEvent = useCallback((ev) => {
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
  }, [])

  // Load a thread's transcript and, if a turn is still executing server-side,
  // re-attach to it and watch it finish — seeding the placeholder with the tool
  // calls it already made so the activity list isn't missing its first half.
  //
  // `onEvent` replaces handleTurnEvent for callers that need to see `start`
  // during a tail as well as during a send. `onTailDone` runs only when the
  // tail completed rather than being aborted (the page refreshes its list).
  const openThread = useCallback(async (id, { onEvent, onTailDone } = {}) => {
    tailAbort.current?.abort()
    setPeakAsk(null)
    if (id == null) { setMessages([]); return }
    const emit = onEvent || handleTurnEvent
    const r = await api(`/api/conversations/${id}/messages`)
    setMessages(r.messages)
    if (!r.running) return
    setBusy(true)
    const seed = (r.pending_activity || []).map((a) => ({ kind: 'tool', ...a }))
    setMessages((m) => [...m, { role: 'assistant', content: '', streaming: true, parts: seed }])
    const ctl = new AbortController()
    tailAbort.current = ctl
    try {
      await tailStream(`/api/chat/${id}/stream`, (ev) => {
        if (ev.type === 'idle') {
          // turn ended between the messages fetch and the tail — reload
          api(`/api/conversations/${id}/messages`).then((r2) => setMessages(r2.messages))
          return
        }
        emit(ev)
      }, ctl.signal)
      onTailDone?.()
    } catch { /* tail aborted or dropped; messages reload on next open */ }
    setBusy(false)
  }, [handleTurnEvent])

  // Ends the turn server-side; every tail gets a final "[Request interrupted]"
  // event, so the normal finish path settles the UI.
  const stopTurn = useCallback(async (id) => {
    if (!id) return
    try { await api(`/api/chat/${id}/stop`, { method: 'POST' }) } catch { /* already done */ }
  }, [])

  // Send `text`, streaming the reply into the transcript.
  //
  // The optimistic pair (the user's line + the assistant placeholder) goes in
  // before the request and comes back out on any failure; `onRestoreDraft` puts
  // the text back in the composer, which every failure but the peak gate wants.
  const runTurn = useCallback(async ({
    text, body, url, onEvent, onDone, onRestoreDraft,
  }) => {
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', content: text },
                        { role: 'assistant', content: '', streaming: true, parts: [] }])
    try {
      await chatStream(body, onEvent || handleTurnEvent, url)
      onDone?.()
    } catch (err) {
      // drop the two optimistic messages; a peak-retry re-adds them
      setMessages((m) => m.slice(0, -2))
      if (err.status === 409 && err.detail === 'peak_confirmation_required') {
        // a new conversation doesn't exist yet on this 409 (the backend
        // gates before creating it), so the confirmed retry re-sends the
        // parked draft from scratch
        setPeakAsk(text)
      } else if (err.status === 409 && err.detail === 'turn_in_progress') {
        onRestoreDraft?.(text)
        setMessages((m) => [...m, { role: 'error',
          content: 'a turn is still running in this chat — wait for it to finish' }])
      } else {
        onRestoreDraft?.(text)
        setMessages((m) => [...m, { role: 'error', content: err.detail || String(err) }])
      }
    }
    setBusy(false)
  }, [handleTurnEvent])

  return {
    messages, setMessages, busy, setBusy, peakAsk, setPeakAsk,
    handleTurnEvent, openThread, abortTail, stopTurn, runTurn,
  }
}
