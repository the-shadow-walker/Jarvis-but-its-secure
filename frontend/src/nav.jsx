// The navigation, written once.
//
// It used to be written three times: the top bar, the rail the Chat page
// publishes when its sidebar collapses, and a separately-authored mobile
// drawer that had drifted into carrying its own theme toggle and its own
// logout button. Adding a destination meant editing three lists and hoping.
// Everything below — bar, rail, drawer, and the overflow menu in all three —
// is rendered from NAV_GROUPS by NavItem, so a destination is one entry.
//
// The old split was four "primary" links and eight behind a `⋯ More` menu with
// no icons and no order, which is where Network, Context and Logs went to die.
// The fifteen routes actually answer three different questions, and that is the
// grouping:
//
//   Work         what am I working on?          Chat, Projects, Agents,
//                                               Schedules, Voice
//   Capabilities what is Jarvis made of?        Context, Skills, Tools,
//                                               Computer use, Artifacts
//   Oversight    what did it do, was it safe?   Review, Network, Logs
//
// `primary` is what earns a slot on the bar itself — the three surfaces work
// starts from, plus Review, which carries a live count and is the one link that
// asks the operator for something. The rest keep their group heading inside the
// menu, so "Network" is now filed under Oversight instead of being the sixth
// unlabelled row in a list of eight.
import { NavLink } from 'react-router-dom'

// ---- icons ----
// One glyph per destination — 24x24, 1.7 stroke, round caps, currentColor,
// matching the four that already existed. Every destination has one now: the
// eight behind the menu were text-only, in both the dropdown and the drawer,
// which is why the menu read as a wall and the rail could never hold them.
// The nav lives in two places and the icons FLY between them (the FLIP in
// App.jsx), so every placement must draw the same mark.
const PATHS = {
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.2-3.6A8.4 8.4 0 1 1 21 11.5Z" />,
  projects: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5
                      1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5Z" />,
  agents: <><circle cx="12" cy="8.6" r="3.4" /><path d="M5.5 19.4a6.5 6.5 0 0 1 13 0" /></>,
  review: <path d="M12 3.2 19.2 6v5.6c0 4-3 7.2-7.2 9.2-4.2-2-7.2-5.2-7.2-9.2V6Zm-2.6
                   8.6 2 2.1 4-4.2" />,
  // a calendar with one marked day
  schedules: <><rect x="3.5" y="5.2" width="17" height="15.3" rx="2.2" />
               <path d="M3.5 10h17M8 3.5v3.4M16 3.5v3.4M8.4 14.3h3" /></>,
  // the voice waveform, the same bars the corner button draws
  voice: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  // an open book: the memory files Jarvis reads before every turn
  context: <path d="M12 6.6C10.4 5.3 8.4 4.7 5 4.7v12.9c3.4 0 5.4.6 7 1.9 1.6-1.3
                    3.6-1.9 7-1.9V4.7c-3.4 0-5.4.6-7 1.9Zm0 0v12.9" />,
  // a four-point spark: a learned skill, not a tool
  skills: <path d="M12 3.4c.9 4.2 1.9 5.3 6.1 6.2-4.2.9-5.2 1.9-6.1 6.1-.9-4.2-1.9-5.2-6.1-6.1
                   4.2-.9 5.2-2 6.1-6.2ZM17.7 15.6c.4 1.9.9 2.4 2.8 2.8-1.9.4-2.4.9-2.8 2.8-.4-1.9-.9-2.4-2.8-2.8
                   1.9-.4 2.4-.9 2.8-2.8Z" />,
  // a wrench: the tool registry. The first draft of this path rendered as a
  // thin diagonal squiggle at 19px — the size it is actually drawn at — so it
  // is a single closed outline now: open jaws, a round head, a straight handle.
  tools: <path d="M14.8 6.4a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l3.3-3.3a5.4
                  5.4 0 0 1-7.1 7.1l-6.2 6.2a1.9 1.9 0 0 1-2.7-2.7l6.2-6.2a5.4
                  5.4 0 0 1 7.1-7.1Z" />,
  // a monitor on a stand: the paired machine
  computer: <><rect x="3" y="4.6" width="18" height="12" rx="1.8" />
              <path d="M9 20.2h6M12 16.6v3.6" /></>,
  // a page with a folded corner: the files Jarvis made in project-less chats
  artifacts: <path d="M14 3.4H7a1.8 1.8 0 0 0-1.8 1.8v13.6A1.8 1.8 0 0 0 7 20.6h10a1.8
                      1.8 0 0 0 1.8-1.8V8.2Zm0 0v4.8h4.8" />,
  // a globe: everything the guest is allowed to reach
  network: <><circle cx="12" cy="12" r="8.6" />
             <path d="M3.4 12h17.2M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6s-1.2 6.2-3.4
                      8.6c-2.2-2.4-3.4-5.4-3.4-8.6S9.8 5.8 12 3.4Z" /></>,
  // a stack of ruled lines: the transcript and cost log
  logs: <path d="M4.6 6.4h14.8M4.6 10.6h14.8M4.6 14.8h10.4M4.6 19h6.6" />,
}

export function NavIcon({ name, innerRef }) {
  return (
    <span className="nav-ico" ref={innerRef} aria-hidden="true">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </svg>
    </span>
  )
}

// The overflow button's own glyph. It is not a destination, so it is not in
// PATHS, but it has to draw at the same weight in a 38px rail cell.
export const MoreIcon = () => (
  <span className="nav-ico" aria-hidden="true">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  </span>
)

// ---- the destinations ----
// `end` matches react-router's exact flag. `gate` names a runtime capability
// the item needs — 'voice' is dropped when the backend reports voice mode off,
// because a dead link is worse than a missing one.
export const NAV_GROUPS = [
  {
    id: 'work',
    label: 'Work',
    items: [
      { to: '/', label: 'Chat', icon: 'chat', end: true, primary: true },
      // no `end`: /projects stays lit on /projects/:slug, so the Workspace is
      // located in the nav even while it has no row of its own
      { to: '/projects', label: 'Projects', icon: 'projects', primary: true },
      { to: '/agents', label: 'Agents', icon: 'agents', primary: true },
      { to: '/schedules', label: 'Schedules', icon: 'schedules' },
      { to: '/voice', label: 'Voice', icon: 'voice', gate: 'voice' },
    ],
  },
  {
    id: 'capabilities',
    label: 'Capabilities',
    items: [
      { to: '/context', label: 'Context', icon: 'context' },
      { to: '/skills', label: 'Skills', icon: 'skills' },
      { to: '/tools', label: 'Tools', icon: 'tools' },
      { to: '/computer', label: 'Computer use', icon: 'computer' },
      { to: '/artifacts', label: 'Artifacts', icon: 'artifacts' },
    ],
  },
  {
    id: 'oversight',
    label: 'Oversight',
    items: [
      // `count: 'review'` is the pending-approval badge; see App.jsx's notices
      { to: '/review', label: 'Review', icon: 'review', primary: true, count: 'review' },
      { to: '/network', label: 'Network', icon: 'network' },
      { to: '/logs', label: 'Logs', icon: 'logs' },
    ],
  },
]

const ALL = NAV_GROUPS.flatMap((g) => g.items)
export const PRIMARY_ITEMS = ALL.filter((i) => i.primary)

// Groups with the bar's own links removed — what the overflow menu shows. A
// group that empties out disappears rather than leaving a bare heading.
export function overflowGroups(gates = {}) {
  return NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.primary && (!i.gate || gates[i.gate])),
    }))
    .filter((g) => g.items.length > 0)
}

// The drawer shows everything, primaries included: on a phone it is the only
// navigation there is, so it has to be the whole map, not the leftovers.
export function drawerGroups(gates = {}) {
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.gate || gates[i.gate]) }))
    .filter((g) => g.items.length > 0)
}

// Counts come from live queues and reached 294 in practice, which overflowed
// the badge and smeared across the icon.
export const badge = (n) => (n > 99 ? '99+' : String(n))

// ---- one link, every placement ----
// The bar, the rail, the menu and the drawer all render this. They differ by
// the container's class and by CSS, never by markup — which is exactly what
// lets the icons fly between the bar and the rail, and what stops the drawer
// drifting away from the bar again.
export function NavItem({
  item, className, iconRef, count = 0, onClick, tabIndex, role,
}) {
  return (
    <NavLink to={item.to} end={item.end} title={item.title || item.label}
             className={className} onClick={onClick} tabIndex={tabIndex} role={role}>
      <NavIcon name={item.icon} innerRef={iconRef} />
      <span className="nav-label">{item.label}</span>
      {count > 0 && <span className="nav-count">{badge(count)}</span>}
    </NavLink>
  )
}

// A run of grouped items under their headings — the body of the overflow menu
// and the body of the drawer, which are the same list in two containers. The
// heading is a plain div, not a heading element: it labels a menu, and the
// group carries the accessible name instead so the page outline stays clean.
export function NavGroupList({
  groups, itemClassName, counts = {}, onNavigate, tabIndex, itemRole,
}) {
  return groups.map((g) => (
    <div className="nav-group" key={g.id} role="group" aria-label={g.label}>
      <div className="nav-group-label" aria-hidden="true">{g.label}</div>
      {g.items.map((item) => (
        <NavItem key={item.to} item={item} className={itemClassName}
                 count={counts[item.count] || 0} role={itemRole}
                 onClick={onNavigate} tabIndex={tabIndex} />
      ))}
    </div>
  ))
}
