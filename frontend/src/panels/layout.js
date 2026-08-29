// The workspace board's geometry: snapping, magnetic edges, tiling and the
// auto-arrange packer. Pure functions over {x, y, w, h} — no React, no API, no
// knowledge of what a panel contains. It was 120 lines in the middle of the
// page component, between the panel registry and the page's own state.

// board grid: drags are smooth, drops snap (matches the dot background)
export const GRID = 26
export const snap = (v) => Math.round(v / GRID) * GRID
export const GAP = 12        // breathing room between tiled panels
const SNAP_T = 16            // px within which an edge becomes magnetic
export const MIN_W = 280
export const MIN_H = 200

// magnetic drop: prefer lining up with other panels' edges, else the grid
export function smartPos(me, x, y, others) {
  let bestX = snap(x), bdx = SNAP_T
  let bestY = snap(y), bdy = SNAP_T
  for (const o of others) {
    for (const c of [o.x, o.x + o.w + GAP, o.x + o.w - me.w, o.x - me.w - GAP]) {
      if (Math.abs(x - c) < bdx) { bdx = Math.abs(x - c); bestX = c }
    }
    for (const c of [o.y, o.y + o.h + GAP, o.y + o.h - me.h, o.y - me.h - GAP]) {
      if (Math.abs(y - c) < bdy) { bdy = Math.abs(y - c); bestY = c }
    }
  }
  return { x: Math.max(0, bestX), y: Math.max(0, bestY) }
}

export function smartW(me, w, others) {
  let best = snap(w), bd = SNAP_T
  for (const o of others) {
    for (const c of [o.x - GAP - me.x, o.x + o.w - me.x]) {
      if (c >= MIN_W && Math.abs(w - c) < bd) { bd = Math.abs(w - c); best = c }
    }
  }
  return Math.max(MIN_W, best)
}

export function smartH(me, h, others) {
  let best = snap(h), bd = SNAP_T
  for (const o of others) {
    for (const c of [o.y - GAP - me.y, o.y + o.h - me.y]) {
      if (c >= MIN_H && Math.abs(h - c) < bd) { bd = Math.abs(h - c); best = c }
    }
  }
  return Math.max(MIN_H, best)
}

const overlapV = (a, b) => a.y < b.y + b.h && a.y + a.h > b.y
const overlapH = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x

// tiling behaviour: growing into a neighbour shrinks it (keeping its far
// edge fixed). Computed from the gesture-start snapshot every frame, so
// dragging back mid-gesture restores neighbours to their original size.
export function shrinkAway(p, me0, me) {
  let out = { ...p }
  if (p.x >= me0.x + me0.w - 2 && overlapV(p, me) && me.x + me.w + GAP > p.x) {
    const right = p.x + p.w
    const nx = me.x + me.w + GAP
    out = { ...out, x: nx, w: Math.max(MIN_W, right - nx) }
  }
  if (p.y >= me0.y + me0.h - 2 && overlapH(p, me) && me.y + me.h + GAP > p.y) {
    const bottom = p.y + p.h
    const ny = me.y + me.h + GAP
    out = { ...out, y: ny, h: Math.max(MIN_H, bottom - ny) }
  }
  return out
}

// ---- auto-arrange: shelf-pack the open panels into a tight block ------------
// Panels are taken in reading order and packed into rows. To let rows meet
// flush, each panel may grow up to 2 grid units and shrink up to 1 per axis;
// anything the budget can't close stays as a small hole rather than a
// distorted panel. Several row widths are tried and scored on hole area +
// how far the block's shape drifts from the viewport's.
const GROW = 2 * GRID
export const SHRINK = GRID
export const ARR_PAD = 16   // block origin — matches the default board inset

const toward = (want, cur, floor) =>
  Math.max(Math.max(floor, cur - SHRINK), Math.min(cur + GROW, want))

export function arrangeRows(items, targetW) {
  const rows = []
  let row = [], x = 0
  for (const it of items) {
    const minW = Math.max(MIN_W, it.w0 - SHRINK)
    if (row.length && x + minW > targetW) { rows.push(row); row = []; x = 0 }
    // squeeze (within budget) so the row closes flush on the right edge
    const w = Math.min(it.w0, Math.max(minW, targetW - x))
    row.push({ ...it, w })
    x += w + GAP
  }
  if (row.length) rows.push(row)

  let y = 0, usedW = 0, filled = 0
  const placed = []
  for (const r of rows) {
    // row height: the tallest panel's, or one unit shorter when that leaves
    // strictly less hole under the short neighbours
    const maxH = Math.max(...r.map((o) => o.h0))
    const hole = (rh) => r.reduce((s, o) => s + (rh - toward(rh, o.h0, MIN_H)) * o.w, 0)
    const low = maxH - SHRINK
    const rowH = low >= MIN_H && hole(low) < hole(maxH) ? low : maxH
    // hand leftover row width out a grid step at a time, round-robin
    let leftover = targetW - r.reduce((s, o) => s + o.w, 0) - GAP * (r.length - 1)
    let moved = true
    while (leftover >= GRID && moved) {
      moved = false
      for (const o of r) {
        if (leftover >= GRID && o.w + GRID <= o.w0 + GROW) {
          o.w += GRID; leftover -= GRID; moved = true
        }
      }
    }
    let rx = 0
    for (const o of r) {
      o.x = rx
      o.y = y
      o.h = toward(rowH, o.h0, MIN_H)
      rx += o.w + GAP
      filled += o.w * o.h
      placed.push(o)
    }
    usedW = Math.max(usedW, rx - GAP)
    y += rowH + GAP
  }
  return { placed, w: usedW, h: y - GAP, filled }
}
