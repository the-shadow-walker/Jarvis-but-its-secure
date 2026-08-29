import { createContext, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Navigate, useLocation } from 'react-router-dom'
import { api } from './api.js'
import { useDismiss } from './useDismiss.js'
import { setMediaHosts } from './mediaHosts.js'
import Player from './Player.jsx'
import AppRoutes from './routes.jsx'
import {
  MoreIcon, NavGroupList, NavItem, PRIMARY_ITEMS, drawerGroups, overflowGroups,
} from './nav.jsx'
import { useNavFlip } from './useNavFlip.js'
import { recentGroup, useRecentProjects } from './recentProjects.js'
import Notices, { useNotices } from './Notices.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { AskProvider } from './ask.jsx'
import { ThemeToggle, useTheme } from './theme.jsx'
import VmStatus from './VmStatus.jsx'
import GuiBridge from './GuiBridge.jsx'

// What is left here is the shell: who is logged in, where the nav is rendered,
// and what surrounds the routes. The pieces this file used to also be —
// the theme hook and its toggle (theme.jsx), the guest-VM chip (VmStatus.jsx),
// the Jarvis -> browser SSE bridge (GuiBridge.jsx) and the icon FLIP
// (useNavFlip.js) — are modules now. The destinations, their icons and their
// grouping live in nav.jsx, which is the ONE source the bar, the rail, the
// overflow menu and the phone drawer are all rendered from; the routing table
// is routes.jsx.

// The nav's two homes exchange it through this: the Chat page hands up the DOM
// node inside its collapsed sidebar, and App portals the links into it. A slot
// means "render as a rail" — no second source of truth to keep in sync.
export const NavSlotContext = createContext(() => {})

// The hands-free corner button: rides beside the theme toggle (top bar, or
// the rail's foot when the nav is collapsed) and drops you straight onto the
// voice screen. Rendered only when the backend reports voice mode enabled.
function VoiceCorner() {
  return (
    <NavLink to="/voice" className="nav-chip voice-corner"
             aria-label="voice mode" title="Voice">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
      </svg>
    </NavLink>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = checking
  const [, setCfgReady] = useState(false) // bump once the media allowlist lands
  const [voiceEnabled, setVoiceEnabled] = useState(false) // /voice link gate
  const [menuOpen, setMenuOpen] = useState(false) // mobile nav drawer
  const [moreOpen, setMoreOpen] = useState(false) // desktop overflow menu
  const [theme, toggleTheme] = useTheme()
  const location = useLocation()
  // the Chat page publishes a mount point when its sidebar is collapsed; while
  // one exists the nav renders into it as a rail instead of onto the top bar
  const [navSlot, setNavSlot] = useState(null)
  const railed = !!navSlot
  // hands back the ref-callback factory the nav items need; without it wired
  // onto NavItem below the icons stop flying between the bar and the rail
  const iconRef = useNavFlip(railed)

  // toasts + the pending count that lives on the Review nav link
  const notices = useNotices(!!user)
  // remembers which project workspaces you have opened, so the nav can offer
  // them — App watches the route rather than Workspace reporting in, so the
  // page stays unaware the nav exists
  const recents = useRecentProjects(location.pathname)

  // close both menus whenever the route changes
  useEffect(() => { setMenuOpen(false); setMoreOpen(false) }, [location.pathname])

  const closeMore = useCallback(() => setMoreOpen(false), [])
  const moreRef = useDismiss(moreOpen, closeMore)

  // the drawer is a fixed overlay; stop the page behind it from scrolling,
  // and let Escape dismiss it like every other popover in the bar
  useEffect(() => {
    document.body.classList.toggle('nav-locked', menuOpen)
    if (!menuOpen) return () => document.body.classList.remove('nav-locked')
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('nav-locked')
    }
  }, [menuOpen])

  useEffect(() => {
    api('/api/auth/me').then(setUser).catch(() => setUser(null))
    api('/api/config')
      .then((c) => {
        setMediaHosts(c.media_hosts)
        setVoiceEnabled(!!c.voice_enabled)
        setCfgReady(true)
      })
      .catch(() => {})
  }, [])

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }

  if (user === undefined) return <div className="center">…</div>
  if (user === null && location.pathname !== '/login')
    return <Navigate to="/login" replace />

  // Voice is a destination only when the backend says the mode is on (flag off
  // = the sidecar isn't deployed; a dead link would just confuse). nav.jsx
  // filters on this rather than App splicing an extra entry into one of the
  // three copies, which is how the drawer used to end up with a different set
  // from the bar.
  const gates = { voice: voiceEnabled }
  // Recently-opened workspaces, newest first. /projects/:slug is the app's most
  // important surface and had no way in from the nav at all; this is it.
  const recent = recentGroup(recents)
  const counts = { review: notices.count }

  // The bar and the rail render the SAME markup — only the container's class
  // and the label's visibility differ, which is what lets the icons fly between
  // the two placements.
  const navLinks = (
    <>
      {PRIMARY_ITEMS.map((item) => (
        <NavItem key={item.to} item={item} count={counts[item.count] || 0}
                 iconRef={iconRef(item.to)} />
      ))}
      <div className="notif-wrap more-wrap" ref={moreRef}>
        <button className="nav-more" aria-expanded={moreOpen} aria-haspopup="menu"
                title="More" onClick={() => setMoreOpen((o) => !o)}>
          <MoreIcon />
          <span className="nav-label">More</span>
          <span className={moreOpen ? 'chev open' : 'chev'} aria-hidden="true">›</span>
        </button>
        {moreOpen && (
          <div className="notif-drop more-drop" role="menu">
            <NavGroupList groups={[...recent, ...overflowGroups(gates)]}
                          itemClassName="notif-item more-item" itemRole="menuitem"
                          counts={counts} onNavigate={closeMore} />
            <button className="notif-item more-item more-logout"
                    role="menuitem" onClick={logout}>Log out</button>
          </div>
        )}
      </div>
    </>
  )

  return (
    <AskProvider>
    <div className={railed ? 'app railed' : 'app'}>
      {user && (
        <>
          {/* Railed: the bar is gone and the links live in the chat sidebar,
              portaled into the slot it published. Otherwise the usual top bar.
              Review wears the pending count — the bell's old job. */}
          {/* the bar always exists and folds to zero height instead of being
              torn out — otherwise the page below jumped 56px the instant the
              rail handed the nav back, which read as a jolt under the icons'
              flight. Empty while folded; the links are in the rail. */}
          <nav className={railed ? 'nav folded' : 'nav'} aria-hidden={railed}>
            {!railed && <>
              <span className="brand">Jarvis</span>
              <div className="nav-links">{navLinks}</div>
              <div className="nav-status">
                <VmStatus />
                {voiceEnabled && <VoiceCorner />}
                <ThemeToggle theme={theme} onToggle={toggleTheme} />
              </div>
              <button className="nav-toggle"
                      aria-label={menuOpen ? 'close menu' : 'menu'}
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((o) => !o)}>
                {menuOpen ? '✕' : '☰'}
              </button>
            </>}
          </nav>
          {railed && createPortal(
            <>
              <div className="rail-links">{navLinks}</div>
              <span className="grow" />
              <VmStatus />
              {voiceEnabled && <VoiceCorner />}
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </>, navSlot)}

          {/* phone: a fixed drawer over a scrim, never an in-flow block that
              shoves the page down */}
          {menuOpen && (
            <div className="nav-scrim" onClick={() => setMenuOpen(false)} />
          )}
          {/* the drawer is the ONLY navigation a phone has, so it shows the
              whole map — every group, primaries included — where it used to be
              a separately-written flat list that had already drifted (its own
              theme toggle, its own logout, no icons on any row) */}
          <div className={menuOpen ? 'nav-drawer open' : 'nav-drawer'}
               aria-hidden={!menuOpen}>
            <NavGroupList groups={[...recent, ...drawerGroups(gates)]}
                          counts={counts} tabIndex={menuOpen ? 0 : -1} />
            <div className="drawer-foot">
              <button className="ghost" tabIndex={menuOpen ? 0 : -1}
                      onClick={toggleTheme}>
                {theme === 'light' ? 'Dark mode' : 'Light mode'}</button>
              <button className="ghost" tabIndex={menuOpen ? 0 : -1}
                      onClick={logout}>Log out</button>
            </div>
          </div>
        </>
      )}
      {user && <GuiBridge />}
      {/* the music player renders nothing until something is queued into it */}
      {user && <Player />}
      {user && <Notices toasts={notices.toasts} dismiss={notices.dismiss}
                        clear={notices.clear} />}
      <NavSlotContext.Provider value={setNavSlot}>
      {/* Inside the provider and around the routes only: the nav, the player
          and the toasts stay mounted through a page's failure, so there is
          always a way out of a broken page. */}
      <ErrorBoundary resetKey={location.pathname}>
      <AppRoutes onLogin={setUser} authed={!!user} />
      </ErrorBoundary>
      </NavSlotContext.Provider>
    </div>
    </AskProvider>
  )
}
