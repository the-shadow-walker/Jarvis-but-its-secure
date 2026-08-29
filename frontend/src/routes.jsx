import { Suspense, lazy, useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Chat from './pages/Chat.jsx'
import NotFound from './pages/NotFound.jsx'

// The routing table, in the order the navigation groups it (see nav.jsx):
// Work, then Capabilities, then Oversight, then the things that are not
// destinations. Fifteen routes used to sit in one undifferentiated block with
// no catch-all, so an unknown path rendered the chrome around nothing at all
// and looked precisely like a page that had failed to load.
//
// Login and Chat are eager: Login is the first thing an unauthenticated visit
// needs, and Chat is `/`, which is where almost every session starts. Everything
// else is a chunk — the frontend is ~11k lines and Workspace alone is 1,600 of
// them, none of which the chat page has any use for.
//
// The chunks are then pulled in on idle, right after the first page settles.
// Without that, every first visit to a route pays a blank frame while its chunk
// arrives, which is the jank the house rules are about; with it, the fallback
// realistically never renders. It starts on idle rather than on mount so it
// cannot compete with the first paint, and a browser without
// requestIdleCallback just gets a short timer.
const Projects = lazy(() => import('./pages/Projects.jsx'))
const Workspace = lazy(() => import('./pages/Workspace.jsx'))
const Agents = lazy(() => import('./pages/Agents.jsx'))
const Schedules = lazy(() => import('./pages/Schedules.jsx'))
const Voice = lazy(() => import('./pages/Voice.jsx'))

const Context = lazy(() => import('./pages/Context.jsx'))
const Skills = lazy(() => import('./pages/Skills.jsx'))
const Tools = lazy(() => import('./pages/Tools.jsx'))
const ComputerUse = lazy(() => import('./pages/ComputerUse.jsx'))
const Artifacts = lazy(() => import('./pages/Artifacts.jsx'))

const Review = lazy(() => import('./pages/Review.jsx'))
const Network = lazy(() => import('./pages/Network.jsx'))
const Logs = lazy(() => import('./pages/Logs.jsx'))

const PREFETCH = [
  () => import('./pages/Projects.jsx'), () => import('./pages/Workspace.jsx'),
  () => import('./pages/Agents.jsx'), () => import('./pages/Schedules.jsx'),
  () => import('./pages/Voice.jsx'), () => import('./pages/Context.jsx'),
  () => import('./pages/Skills.jsx'), () => import('./pages/Tools.jsx'),
  () => import('./pages/ComputerUse.jsx'), () => import('./pages/Artifacts.jsx'),
  () => import('./pages/Review.jsx'), () => import('./pages/Network.jsx'),
  () => import('./pages/Logs.jsx'),
]

function usePrefetchRoutes(enabled) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = () => { if (!cancelled) PREFETCH.forEach((load) => { load() }) }
    const idle = window.requestIdleCallback
    const id = idle ? idle(run, { timeout: 3000 }) : setTimeout(run, 1200)
    return () => {
      cancelled = true
      if (idle) window.cancelIdleCallback?.(id)
      else clearTimeout(id)
    }
  }, [enabled])
}

export default function AppRoutes({ onLogin, authed }) {
  usePrefetchRoutes(authed)
  return (
    // The fallback paints nothing rather than a spinner: it is on screen for a
    // few tens of milliseconds at most, and a control that appears and vanishes
    // that fast reads as a flicker, not as progress.
    <Suspense fallback={<div className="route-pending" aria-busy="true" />}>
      <Routes>
        <Route path="/login" element={<Login onLogin={onLogin} />} />

        {/* Work — what am I working on */}
        <Route path="/" element={<Chat />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:slug" element={<Workspace />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/voice" element={<Voice />} />

        {/* Capabilities — what Jarvis is made of */}
        <Route path="/context" element={<Context />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/computer" element={<ComputerUse />} />
        <Route path="/artifacts" element={<Artifacts />} />

        {/* Oversight — what it did, and whether it was safe */}
        <Route path="/review" element={<Review />} />
        <Route path="/network" element={<Network />} />
        <Route path="/logs" element={<Logs />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
