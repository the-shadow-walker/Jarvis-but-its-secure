import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api.js'
import { PANELS, PanelBody } from '../panels/registry.jsx'
import Window from '../panels/Window.jsx'
import AddMenu from '../panels/AddMenu.jsx'
import {
  ARR_PAD, GAP, GRID, MIN_H, MIN_W, SHRINK, arrangeRows, shrinkAway,
  smartH, smartPos, smartW, snap,
} from '../panels/layout.js'

// The project board. What is left in this file is the board itself: the panels'
// positions, the gestures that move them, persistence, and the header. What a
// panel *is* lives in ../panels — one file each, with the registry
// (panels/registry.jsx) carrying the label, the default size and the component
// together, so those three can no longer drift apart.

// Default board: chat + the session spine (board = goal/plan/runs), with git as
// the review/undo surface (writes are live now — no staging panel) and network
// for approving the hosts the agent asks to reach.
const DEFAULT_PANELS = [
  { id: 'p1', type: 'chat', x: 16, y: 16, w: 460, h: 560, z: 1, state: {} },
  { id: 'p2', type: 'board', x: 492, y: 16, w: 400, h: 560, z: 2, state: {} },
  { id: 'p3', type: 'git', x: 908, y: 16, w: 540, h: 300, z: 3, state: {} },
  { id: 'p4', type: 'network', x: 908, y: 332, w: 540, h: 244, z: 4, state: {} },
]

export default function Workspace() {
  const { slug } = useParams()
  const [project, setProject] = useState(null)
  const [panels, setPanels] = useState(null)
  const [expanded, setExpanded] = useState(null)   // panel id
  const [expandRect, setExpandRect] = useState(null)
  const [menu, setMenu] = useState(null)           // {x, y, bx, by}
  const [hovered, setHovered] = useState(null)     // panel id under the mouse
  const [resizing, setResizing] = useState(false)  // gesture live: no transitions
  const [closingIds, setClosingIds] = useState([]) // panels playing their exit
  const boardRef = useRef(null)
  const zRef = useRef(10)
  const saveTimer = useRef(null)
  const mouseRef = useRef({ x: 200, y: 160 })
  const undoRef = useRef([])                       // ctrl+z stack: closes + pre-tidy layouts
  const gestureRef = useRef(null)                  // layout snapshot during a resize

  const refreshProject = useCallback(
    () => api(`/api/projects/${slug}`).then(setProject), [slug])

  const loadLayout = useCallback(() =>
    api(`/api/projects/${slug}/layout`).then((r) => {
      const saved = r.layout?.panels?.length ? r.layout.panels : DEFAULT_PANELS
      // drop panel types that no longer exist (e.g. the removed 'staging'
      // panel on an old saved board) so they don't render "unknown panel"
      const p = saved.filter((x) => PANELS[x.type])
      const clean = p.length ? p : DEFAULT_PANELS
      zRef.current = Math.max(10, ...clean.map((x) => x.z || 0))
      setPanels(clean)
    }), [slug])

  useEffect(() => {
    // reset before loading: a stale panels array must never be debounce-saved
    // into the NEW slug's layout (cross-project board bleed)
    setPanels(null)
    // opening a project's board loads it into Jarvis's context — this tab is
    // where you live, so what you're looking at is what Jarvis is thinking about
    api(`/api/projects/${slug}/load`, { method: 'POST' }).then(refreshProject)
    loadLayout()
  }, [slug, refreshProject, loadLayout])

  // Jarvis rearranged the board server-side (workspace_panel tool) — refetch
  useEffect(() => {
    const h = (e) => { if (!e.detail?.slug || e.detail.slug === slug) loadLayout() }
    window.addEventListener('jarvis-layout-changed', h)
    return () => window.removeEventListener('jarvis-layout-changed', h)
  }, [slug, loadLayout])

  // debounced layout persistence
  useEffect(() => {
    if (!panels) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api(`/api/projects/${slug}/layout`, {
        method: 'PUT', body: JSON.stringify({ panels }) })
    }, 800)
    return () => clearTimeout(saveTimer.current)
  }, [panels, slug])

  const patchPanel = (id, patch) =>
    setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const patchState = (id, patch) =>
    setPanels((ps) => ps.map((p) =>
      p.id === id ? { ...p, state: { ...p.state, ...patch } } : p))
  const front = (id) => patchPanel(id, { z: ++zRef.current })

  const dragEnd = (id, x, y) =>
    setPanels((ps) => {
      const me = ps.find((p) => p.id === id)
      const pos = smartPos(me, x, y, ps.filter((p) => p.id !== id))
      return ps.map((p) => (p.id === id ? { ...p, ...pos } : p))
    })

  const resizeStart = (id) => {
    gestureRef.current = { id, snap: panels.map((p) => ({ ...p })) }
    setResizing(true)
  }

  const resizeMove = (id, dx, dy, final) => {
    const snap0 = gestureRef.current?.snap
    if (!snap0) return
    const me0 = snap0.find((p) => p.id === id)
    const others0 = snap0.filter((p) => p.id !== id)
    let w = Math.max(MIN_W, me0.w + dx)
    let h = Math.max(MIN_H, me0.h + dy)
    if (final) {
      w = smartW(me0, w, others0)
      h = smartH(me0, h, others0)
    }
    const me = { ...me0, w, h }
    const resolved = others0.map((p) => shrinkAway(p, me0, me))
    setPanels((ps) => ps.map((cur) => {
      if (cur.id === id) return { ...cur, w, h }
      const r = resolved.find((p) => p.id === cur.id)
      return r ? { ...cur, x: r.x, y: r.y, w: r.w, h: r.h } : cur
    }))
    if (final) {
      gestureRef.current = null
      setResizing(false)
    }
  }

  const close = (id) => {
    if (closingIds.includes(id)) return
    setExpanded((ex) => (ex === id ? null : ex))
    setHovered((h) => (h === id ? null : h))
    setClosingIds((c) => [...c, id])   // play the exit animation first
    setTimeout(() => {
      setClosingIds((c) => c.filter((x) => x !== id))
      setPanels((ps) => {
        const p = ps.find((x) => x.id === id)
        if (p) undoRef.current.push({ kind: 'close', panel: p })
        return ps.filter((x) => x.id !== id)
      })
    }, 170)
  }

  const undo = () => {
    const e = undoRef.current.pop()
    if (!e) return
    if (e.kind === 'close') {
      setPanels((ps) => [...ps, { ...e.panel, z: ++zRef.current }])
    } else {
      // pre-tidy snapshot: restore geometry for panels that still exist;
      // panels opened/closed since keep their own fate (closes are their
      // own undo entries)
      setPanels((ps) => ps.map((p) => {
        const o = e.panels.find((q) => q.id === p.id)
        return o ? { ...p, x: o.x, y: o.y, w: o.w, h: o.h } : p
      }))
    }
  }

  // hover-targeted hotkeys: f expand, q close (ctrl+z restores), n add menu
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (menu) setMenu(null)
        else if (expanded) setExpanded(null)
        return
      }
      const t = e.target
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' || t.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'f' && hovered) { e.preventDefault(); toggleExpand(hovered) }
      else if (k === 'q' && hovered) { e.preventDefault(); close(hovered) }
      else if (k === 'n' && !menu) {
        e.preventDefault()
        openMenuAt(mouseRef.current.x, mouseRef.current.y)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function toggleExpand(id) {
    if (expanded === id) { setExpanded(null); return }
    const b = boardRef.current
    setExpandRect({
      x: b.scrollLeft + 10, y: b.scrollTop + 10,
      w: b.clientWidth - 20, h: b.clientHeight - 20,
    })
    front(id)
    setExpanded(id)
  }

  // spawn placement: use the requested spot if it's genuinely free, else the
  // first grid position in view where the panel fits with breathing room
  function findSpot(w, h, want) {
    const b = boardRef.current
    const x1 = b.scrollLeft + b.clientWidth
    const y1 = b.scrollTop + b.clientHeight
    const free = (x, y) =>
      x >= 0 && y >= 0 && x + w <= x1 - GAP && y + h <= y1 - GAP &&
      !panels.some((r) =>
        x < r.x + r.w + GAP && x + w + GAP > r.x &&
        y < r.y + r.h + GAP && y + h + GAP > r.y)
    if (want && free(want.x, want.y)) return want
    const gx0 = Math.ceil((b.scrollLeft + GAP) / GRID) * GRID
    const gy0 = Math.ceil((b.scrollTop + GAP) / GRID) * GRID
    for (let y = gy0; y + h <= y1; y += GRID)
      for (let x = gx0; x + w <= x1; x += GRID)
        if (free(x, y)) return { x, y }
    return want || { x: gx0 + 2 * GRID, y: gy0 + 2 * GRID }  // board's full: cascade
  }

  function addPanel(type, bx, by) {
    const spec = PANELS[type]
    const w = snap(spec.w), h = snap(spec.h)
    const want = bx != null ? { x: snap(Math.max(0, bx)), y: snap(Math.max(0, by)) } : null
    const { x, y } = findSpot(w, h, want)
    setPanels((ps) => [...ps, {
      id: `p${Date.now()}`, type, x, y, w, h, z: ++zRef.current, state: {},
    }])
    setMenu(null)
  }

  function openMenuAt(cx, cy) {
    const r = boardRef.current.getBoundingClientRect()
    setMenu({
      x: Math.min(cx, window.innerWidth - 280),
      y: Math.min(cy, window.innerHeight - 340),
      bx: cx - r.left + boardRef.current.scrollLeft,
      by: cy - r.top + boardRef.current.scrollTop,
    })
  }

  function openMenu(e) {
    e.preventDefault()
    openMenuAt(e.clientX, e.clientY)
  }

  function autoArrange() {
    const b = boardRef.current
    if (!panels?.length || !b) return
    const items = [...panels]
      .sort((a, c) => (a.y - c.y) || (a.x - c.x))
      .map((p) => ({ id: p.id,
                     w0: Math.max(MIN_W, snap(p.w)), h0: Math.max(MIN_H, snap(p.h)) }))
    const floorW = Math.max(...items.map((i) => Math.max(MIN_W, i.w0 - SHRINK)))
    const sumW = items.reduce((s, i) => s + i.w0 + GAP, 0) - GAP
    const maxW = Math.max(floorW, Math.min(b.clientWidth - 2 * ARR_PAD, sumW))
    const aspect = b.clientWidth / Math.max(1, b.clientHeight)
    let best = null
    for (let k = 0; k <= 8; k++) {
      const tw = Math.round(floorW + ((maxW - floorW) * k) / 8)
      const r = arrangeRows(items, tw)
      const box = Math.max(1, r.w * r.h)
      const score = (box - r.filled) / box +
        0.35 * Math.abs(Math.log((r.w / Math.max(1, r.h)) / aspect))
      if (!best || score < best.score) best = { ...r, score }
    }
    undoRef.current.push({ kind: 'layout', panels: panels.map((p) => ({ ...p })) })
    setExpanded(null)
    setPanels((ps) => ps.map((p) => {
      const o = best.placed.find((q) => q.id === p.id)
      return o ? { ...p, x: ARR_PAD + o.x, y: ARR_PAD + o.y, w: o.w, h: o.h } : p
    }))
    b.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }

  if (!project || !panels) return <div className="center">…</div>

  return (
    <div className="workspace">
      <header className="ws-head">
        <h1>{project.name}</h1>
        {project.loaded
          ? <button className="ghost" onClick={async () => {
              await api('/api/projects/unload', { method: 'POST' }); refreshProject() }}>
              in context ✓ (unload)</button>
          : <button className="ghost" onClick={async () => {
              await api(`/api/projects/${slug}/load`, { method: 'POST' }); refreshProject() }}>
              load into context</button>}
        <label className="dim small" title="which tools Jarvis is offered here — enforced server-side per turn">
          autonomy
          <select className="autonomy-dial" value={project.autonomy || 'full'}
                  onChange={async (e) => {
                    await api(`/api/projects/${slug}/autonomy`, {
                      method: 'PUT', body: JSON.stringify({ level: e.target.value }) })
                    refreshProject()
                  }}>
            <option value="read_only">read-only — observe</option>
            <option value="stage">stage — + file writes</option>
            <option value="gated">gated — + agents & research</option>
            <option value="full">full — + commit proposals</option>
          </select>
        </label>
        <span className="dim hint">hover + <kbd>f</kbd> expand · <kbd>q</kbd> close ·
          <kbd> ctrl+z</kbd> restore · <kbd>n</kbd> / right-click add ·
          <kbd> esc</kbd> collapse</span>
        <button className="ghost" onClick={autoArrange}
                title="auto-arrange the open panels into a tight block (grows ≤2 grid units, shrinks ≤1)">
          ⌗ tidy</button>
        <button className="ghost" onClick={(e) => openMenuAt(e.clientX - 120, e.clientY + 14)}>
          + panel</button>
      </header>
      <div className="board" ref={boardRef} onContextMenu={openMenu}
           onPointerMove={(e) => { mouseRef.current = { x: e.clientX, y: e.clientY } }}>
        {panels.map((p) => (
          <Window key={p.id} panel={p}
                  expanded={expanded === p.id} expandRect={expandRect}
                  dimmed={expanded !== null && expanded !== p.id}
                  noAnim={resizing}
                  closing={closingIds.includes(p.id)}
                  onPatch={(patch) => patchPanel(p.id, patch)}
                  onDragEnd={(x, y) => dragEnd(p.id, x, y)}
                  onResizeStart={() => resizeStart(p.id)}
                  onResize={(dx, dy, final) => resizeMove(p.id, dx, dy, final)}
                  onFront={() => front(p.id)}
                  onClose={() => close(p.id)}
                  onHover={(over) => setHovered((h) =>
                    over ? p.id : (h === p.id ? null : h))}
                  onToggleExpand={() => toggleExpand(p.id)}>
            <PanelBody type={p.type} slug={slug} project={project}
                       refreshProject={refreshProject}
                       state={p.state || {}}
                       setState={(patch) => patchState(p.id, patch)}
                       onToggleExpand={() => toggleExpand(p.id)} />
          </Window>
        ))}
        {menu && <AddMenu pos={menu} onClose={() => setMenu(null)}
                          onPick={(type) => addPanel(type, menu.bx, menu.by)} />}
      </div>
    </div>
  )
}
