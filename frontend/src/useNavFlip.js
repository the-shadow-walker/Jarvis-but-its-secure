import { useCallback, useLayoutEffect, useRef } from 'react'

// FLIP: the nav icons visibly travel between the rail and the bar rather than
// vanishing from one and appearing in the other.
//
// Returns the ref-callback factory the nav items must be given:
//
//   const iconRef = useNavFlip(railed)
//   <NavItem item={item} iconRef={iconRef(item.to)} />
//
// That wiring IS the animation. Nothing throws and no test fails if it is
// dropped — the icons just stop flying, silently — so the hook hands back one
// value with one job rather than exposing the ref map and hoping.
//
// The capture runs after EVERY render, not just when the placement changes.
// Keyed on [railed] it also fired during App's pre-auth render, where there
// is no nav at all — that cached an empty map, and the first bar -> rail move
// had nothing to fly from (only rail -> bar animated). Re-measuring each pass
// also keeps the rects honest when the Review count resizes the bar.
//
// Detached rects are ignored, and an empty pass never overwrites a good one.
// Navigating off Chat leaves one commit where the portal still targets the
// slot node the unmounting page just took with it: the icons measure (0,0)
// there, and caching that made the return flight start from the top-left
// corner instead of the rail — the icons snapped to the corner and flew in
// from there, which is what read as jumpy. Only that direction was affected,
// which is why toggling the sidebar always looked fine.
export function useNavFlip(railed) {
  const icoRefs = useRef(new Map())     // route -> icon element
  const lastRects = useRef(null)
  const prevRailed = useRef(railed)

  useLayoutEffect(() => {
    const now = new Map()
    icoRefs.current.forEach((el, key) => {
      if (!el || !el.isConnected) return
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) return
      now.set(key, r)
    })
    const before = lastRects.current
    const moved = prevRailed.current !== railed
    prevRailed.current = railed
    if (now.size) lastRects.current = now
    if (!moved || !before || !before.size || !now.size) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    now.forEach((to, key) => {
      const from = before.get(key)
      const el = icoRefs.current.get(key)
      if (!from || !el) return
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        // matches the bar's fold: an ease-in-out, not the front-loaded curve
        // that made both read as a snap followed by a crawl
        { duration: 420, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      )
    })
  })

  // A fresh closure per render, as the inline callback it replaces was: React
  // therefore detaches and re-attaches each icon on every pass, and the map is
  // repopulated before the layout effect above measures it.
  return useCallback((key) => (el) => {
    if (el) icoRefs.current.set(key, el)
    else icoRefs.current.delete(key)
  }, [])
}
