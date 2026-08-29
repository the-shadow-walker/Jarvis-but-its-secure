import { useEffect, useState } from 'react'

// Recently-opened project workspaces, for the nav.
//
// `/projects/:slug` — the Workspace, the board with the files, the guest
// terminal, the task list and the git review on it — had no nav entry at all.
// The only ways in were a row on the Projects page and a toast Jarvis might
// send you. The most-used surface in the app was two clicks from everywhere and
// unreachable from the drawer.
//
// It cannot have a *fixed* entry, because it has no fixed URL — so the entry is
// the last few slugs you actually opened, which is the thing you want anyway.
//
// The slug is the label. The alternative is a name lookup, and `GET
// /api/projects` already fires from six independent pages with no cache; a
// seventh caller, on every route change, to render a menu that is usually
// closed, is not worth it. Slugs are derived from the project name and read
// fine.
const KEY = 'jarvis.projects.recent'
const CAP = 5

// Every read is defensive: private mode throws on access, and a hand-edited or
// half-written value must degrade to "no recents", never to a broken nav.
function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []
  } catch { return [] }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private mode */ }
}

// `/projects/foo` -> 'foo'. `/projects` and `/projects/foo/bar` -> null: only
// the workspace route itself counts as having opened a project.
//
// decodeURIComponent throws on a malformed escape (`/projects/%`), and this
// runs on every route change — an unparseable URL must mean "no recent", not a
// nav that throws on the way past.
export function slugFromPath(pathname) {
  const m = /^\/projects\/([^/]+)\/?$/.exec(pathname || '')
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}

export function remember(slug) {
  if (!slug) return read()
  const next = [slug, ...read().filter((s) => s !== slug)].slice(0, CAP)
  write(next)
  return next
}

// Records the workspace you are on and hands back the list. Lives in App, next
// to the nav it feeds, so nothing in Workspace.jsx has to know the nav exists.
export function useRecentProjects(pathname) {
  const [recent, setRecent] = useState(read)
  useEffect(() => {
    const slug = slugFromPath(pathname)
    if (!slug) return
    setRecent(remember(slug))
  }, [pathname])
  return recent
}

// Shaped as a NAV_GROUPS group so the menu and the drawer render it with the
// same code as every other group — it just happens to be built at runtime.
export function recentGroup(recent) {
  if (!recent.length) return []
  return [{
    id: 'recent',
    label: 'Recent workspaces',
    items: recent.map((slug) => ({
      to: `/projects/${encodeURIComponent(slug)}`,
      label: slug,
      title: `${slug} workspace`,
      icon: 'projects',
    })),
  }]
}
