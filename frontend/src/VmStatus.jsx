import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { useDismiss } from './useDismiss.js'
import { notify, notifyError } from './notify.js'
import { useAsk } from './ask.jsx'

// Guest-VM status (GET /api/vm/status) plus the one operator control: nuke —
// discard the overlay and reboot fresh from the golden image. Nuke is
// double-confirmed and refuses while a turn is in flight; boot/teardown stay
// elsewhere. The status read itself never mutates.
// (The runtime model switch lives in the chat composer now — ComposerModel in
// Chat.jsx; the bar copy was redundant and the operator asked for its removal.)
// It rides the status cluster beside the theme toggle — in the top bar, or in
// the rail's foot when the nav is collapsed. No prop for the two cases: the
// rail's container carries .side-nav, which is all the CSS needs.
//
// Module-level on purpose, and it stays that way: railing the nav moves this
// chip between two places in the React tree, which unmounts one instance and
// mounts another. Component state cannot survive that; this can. A context or
// a store would work too and would be two more moving parts for one cached
// object that nothing else reads.
let lastVmStatus = null   // survives the bar <-> rail remount; see below

export default function VmStatus() {
  // Seeding from the last known status keeps the chip on screen through the
  // move — without it the new instance renders null and blinks out until its
  // first poll comes back.
  const [s, setS] = useState(lastVmStatus)
  const [open, setOpen] = useState(false)
  const [nuking, setNuking] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [toast, setToast] = useState('')
  const load = () => api('/api/vm/status')
    .then((r) => { lastVmStatus = r; setS(r) })
    .catch(() => { lastVmStatus = null; setS(null) })
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  const closeDrop = useCallback(() => setOpen(false), [])
  const wrapRef = useDismiss(open, closeDrop)
  const ask = useAsk()

  async function nuke() {
    if (s?.inflight > 0) {
      notify(`${s.inflight} turn(s) in flight — wait for them to finish before nuking.`)
      return
    }
    if (!await ask.confirm('Nuke the guest VM?',
                           { body: 'Its overlay disk is discarded and it reboots fresh '
                                   + 'from the golden image. In-flight work is lost.',
                             confirmLabel: 'Nuke it', danger: true })) return
    setNuking(true)
    try {
      const r = await api('/api/vm/nuke', {
        method: 'POST', body: JSON.stringify({ confirm: true }) })
      lastVmStatus = r
      setS(r)
    } catch (err) { notifyError(err) }
    setNuking(false)
  }

  // Rebuild the golden image from scratch — heavy, so double-confirmed.
  async function rebuild() {
    if (!await ask.confirm('Rebuild the guest image from scratch?',
                           { body: 'This can take a while.',
                             confirmLabel: 'Rebuild' })) return
    if (!await ask.confirm('Are you sure?',
                           { body: 'The current image is replaced once the build finishes.',
                             confirmLabel: 'Yes, rebuild', danger: true })) return
    setRebuilding(true)
    setToast('rebuild started…')
    try {
      await api('/api/vm/rebuild', { method: 'POST', body: JSON.stringify({ confirm: true }) })
      setToast('image rebuild kicked off')
      load()
    } catch (err) { setToast(err.detail || String(err)) }
    setRebuilding(false)
    setTimeout(() => setToast(''), 4000)
  }

  if (!s) return null
  const age = s.age_seconds != null
    ? (s.age_seconds < 90 ? `${s.age_seconds}s` : `${Math.round(s.age_seconds / 60)}m`)
    : null
  // newer backends carry image freshness metadata; older ones omit it entirely
  const hasImageMeta = s.image_stale !== undefined || s.image_built_at !== undefined
    || s.image_age_days !== undefined
  const imageAge = s.image_age_days != null
    ? `${s.image_age_days}d old` : (s.image_built_at ? String(s.image_built_at).slice(0, 10) : null)
  return (
    <div className="notif-wrap vm-wrap" ref={wrapRef}>
      <button className="nav-chip" onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`guest VM — ${s.running ? 'running' : 'off'}`}
              title="guest VM status">
        <span className={`run-dot ${s.running ? 'running' : ''}`} />
        <span className="vm-word">VM</span>
        {s.image_stale && <span className="notif-badge vm-stale-badge" title="image is stale">!</span>}
      </button>
      {open && (
        <div className="notif-drop vm-drop">
          <div className="notif-item"><span className="grow">state</span>
            <span className={s.running ? '' : 'dim'}>
              {s.running ? 'running' : (s.base_built ? 'off' : 'no image')}</span></div>
          {s.running && age && (
            <div className="notif-item"><span className="grow">age</span><span>{age}</span></div>)}
          {s.running && (
            <div className="notif-item"><span className="grow">in-flight turns</span>
              <span>{s.inflight}</span></div>)}
          <div className="notif-item"><span className="grow">gateway</span>
            <span className={s.gateway ? '' : 'dim'}>{s.gateway ? 'on' : 'off'}</span></div>
          <div className="notif-item"><span className="grow">image</span>
            <span className={s.image_stale ? 'warn' : 'dim'}
                  title={s.image_built_at ? `built ${s.image_built_at}` : undefined}>
              {s.image_version}{s.image_stale && imageAge ? ` · ${imageAge}` : ''}</span></div>
          {s.image_stale && (
            <div className="notif-item"><span className="grow warn">stale image</span>
              <span className="warn small">{imageAge || 'rebuild suggested'}</span></div>)}
          {s.idle_scrub_seconds > 0 && (
            <div className="notif-item"><span className="grow">idle scrub</span>
              <span className="dim">{s.idle_scrub_seconds}s</span></div>)}
          {toast && <div className="notif-item"><span className="grow small dim">{toast}</span></div>}
          {hasImageMeta && (
            <div className="vm-nuke-row">
              <button className="ghost" disabled={rebuilding}
                      title="rebuild the golden image from scratch"
                      onClick={rebuild}>{rebuilding ? 'rebuilding…' : '⟳ rebuild image'}</button>
            </div>
          )}
          <div className="vm-nuke-row">
            <button className="ghost danger" disabled={nuking || !s.running}
                    title={s.running ? 'discard the overlay, reboot fresh'
                                     : 'nothing to nuke — guest is off'}
                    onClick={nuke}>{nuking ? 'nuking…' : '☢ nuke guest'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
