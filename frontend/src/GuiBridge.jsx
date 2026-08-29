import { useEffect, useState } from 'react'
import { streamUrl } from './tab.js'

// Jarvis -> browser bridge: one SSE subscription per tab (/api/gui/stream).
// Tools push actions here: open a URL (popup-blocked -> clickable toast),
// play media in a floating dock, or nudge an open Workspace to reload its
// layout. Fire-and-forget — a missed event only matters on-screen.
export default function GuiBridge() {
  const [toasts, setToasts] = useState([])
  const [player, setPlayer] = useState(null)   // {kind, src, title}

  useEffect(() => {
    // the subscription carries this tab's id and name (src/tab.js), which is
    // how a tool addresses ONE machine instead of every open tab
    const es = new EventSource(streamUrl())
    const toast = (t) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((ts) => [...ts, { id, ...t }])
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 15000)
    }
    es.onmessage = (m) => {
      let ev
      try { ev = JSON.parse(m.data) } catch { return }
      if (ev.type === 'open_url') {
        const w = window.open(ev.url, '_blank', 'noopener,noreferrer')
        if (!w) toast({ text: 'Jarvis wants to open', url: ev.url })
      } else if (ev.type === 'play_media') {
        setPlayer(ev)
      } else if (ev.type === 'player') {
        // the music player owns its own state machine — hand it the event
        // rather than threading a queue through here
        window.dispatchEvent(new CustomEvent('jarvis-player', { detail: ev }))
      } else if (ev.type === 'layout_changed') {
        window.dispatchEvent(new CustomEvent('jarvis-layout-changed', { detail: ev }))
      }
    }
    return () => es.close()
  }, [])

  return (
    <>
      {player && (
        <div className="media-dock">
          <div className="row">
            <span className="grow ellipsis" title={player.title}>{player.title}</span>
            <button className="ghost" onClick={() => setPlayer(null)}>✕</button>
          </div>
          {player.kind === 'video'
            ? <video key={player.src} src={player.src} controls autoPlay />
            : <audio key={player.src} src={player.src} controls autoPlay />}
        </div>
      )}
      {toasts.length > 0 && (
        <div className={player ? 'gui-toasts raised' : 'gui-toasts'}>
          {toasts.map((t) => (
            <div key={t.id} className="gui-toast">
              {t.text}{' '}
              {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer">{t.url}</a>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
