import { useState } from 'react'
import { PANELS } from './registry.jsx'

// The window chrome every panel wears: title bar, drag, resize, expand, close.
// It knows nothing about what is inside it beyond the registry label.
export default function Window({ panel, expanded, expandRect, dimmed, noAnim, closing,
                                 onPatch, onDragEnd, onResizeStart, onResize, onFront,
                                 onClose, onHover, onToggleExpand, children }) {
  const [interacting, setInteracting] = useState(false)

  function track(e, apply, settle) {
    e.preventDefault()
    onFront()
    setInteracting(true)
    const sx = e.clientX, sy = e.clientY
    let dx = 0, dy = 0
    const move = (ev) => { dx = ev.clientX - sx; dy = ev.clientY - sy; apply(dx, dy) }
    const up = () => {
      setInteracting(false)   // anim class returns, so the snap glides in
      settle(dx, dy)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startDrag = (e) => {
    if (expanded || e.target.closest('button')) return
    const { x, y } = panel
    track(e,
      (dx, dy) => onPatch({ x: Math.max(0, x + dx), y: Math.max(0, y + dy) }),
      (dx, dy) => onDragEnd(Math.max(0, x + dx), Math.max(0, y + dy)))
  }
  const startResize = (e) => {
    if (expanded) return
    onResizeStart()
    track(e,
      (dx, dy) => onResize(dx, dy, false),
      (dx, dy) => onResize(dx, dy, true))
  }

  const style = expanded && expandRect
    ? { left: expandRect.x, top: expandRect.y, width: expandRect.w,
        height: expandRect.h, zIndex: 999 }
    : { left: panel.x, top: panel.y, width: panel.w, height: panel.h,
        zIndex: panel.z || 1 }

  return (
    <section className={`window ${interacting || noAnim ? '' : 'anim'} ${expanded ? 'expanded' : ''} ${dimmed ? 'dimmed' : ''} ${closing ? 'closing' : ''}`}
             style={style} onPointerDown={onFront}
             onPointerEnter={() => onHover(true)}
             onPointerLeave={() => onHover(false)}>
      <header className="window-head" onPointerDown={startDrag}
              onDoubleClick={onToggleExpand}>
        <span className="window-title">{PANELS[panel.type]?.label || panel.type}</span>
        <button className="win-btn" title={expanded ? 'collapse (esc)' : 'expand'}
                onClick={onToggleExpand}>{expanded ? '⤡' : '⤢'}</button>
        <button className="win-btn" title="close" onClick={onClose}>×</button>
      </header>
      <div className="window-body">{children}</div>
      {!expanded && <div className="resize-handle" onPointerDown={startResize} />}
    </section>
  )
}
