import { useState } from 'react'
import { PANELS } from './registry.jsx'

// The right-click add menu (blender-nodes style, keyboard friendly). Its whole
// contents are the registry, so a new panel appears here for free.
export default function AddMenu({ pos, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const items = Object.entries(PANELS)
    .filter(([k, v]) => (k + ' ' + v.label).toLowerCase().includes(q.toLowerCase()))

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && items[sel]) onPick(items[sel][0])
    else if (e.key === 'Escape') onClose()
  }

  return (
    <>
      <div className="menu-overlay" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="rc-menu" style={{ left: pos.x, top: pos.y }}>
        <input autoFocus placeholder="add panel — type to search…" value={q}
               onChange={(e) => { setQ(e.target.value); setSel(0) }} onKeyDown={onKey} />
        <ul>
          {items.map(([key, v], i) => (
            <li key={key} className={i === sel ? 'sel' : ''}
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => { e.preventDefault(); onPick(key) }}>
              {v.label}
              {i === sel && <span className="enter-hint">↵</span>}
            </li>
          ))}
          {items.length === 0 && <li className="dim">no match</li>}
        </ul>
      </div>
    </>
  )
}
