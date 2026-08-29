import { useState } from 'react'
import Hardware from './Hardware.jsx'
import { Block, removeCommands } from './shared.jsx'

// --- one computer ------------------------------------------------------------
export default function Machine({ m, caps, served, expanded, onToggle, probe, onProbe,
                                  onPriv, onAdd, onRevoke }) {
  const [root, setRoot] = useState('')
  const privs = m.privileges || {}
  const off = Object.values(privs).filter((v) => v === false).length
  const folders = m.grants || []
  // What that machine says about each granted folder. Keyed by path, because a
  // grant is a string here and a real directory (or not) over there — and the
  // gap between those two is exactly where "I added the folders" and "there are
  // no folders" were both true.
  const health = {}
  for (const r of (probe?.roots_detail || [])) health[r.path] = r
  const stale = served && m.version && m.version !== served

  return (
    <section className="panel cu-machine">
      <button className="cu-machine-head" onClick={onToggle}>
        <span className="run-dot running" />
        <span className="grow">
          <strong>{m.name}</strong>
          <span className="dim"> · {m.platform === 'darwin' ? 'macOS' : m.platform}</span>
          {m.caps?.dry_run && <span className="tag">dry run</span>}
          {/* A stale client and a broken one look identical from here, and the
              difference has cost two evenings — a CDN pinned an old download
              twice. Now it says so. */}
          {stale && <span className="tag warn" title={
            `running build ${m.version || 'unknown'}, this Jarvis serves ${served}`
          }>old build — re-run set-up</span>}
        </span>
        <span className="dim small">
          {folders.length} folder{folders.length === 1 ? '' : 's'}
          {off > 0 && ` · ${off} revoked`}
        </span>
        <span className={expanded ? 'chev open' : 'chev'} aria-hidden="true">›</span>
      </button>

      {expanded && (
        <div className="cu-machine-body">
          <h3>Allowed to</h3>
          <ul className="cu-privs">
            {Object.entries(caps).map(([key, meta]) => {
              const on = privs[key] !== false
              return (
                <li key={key} className={on ? '' : 'revoked'}>
                  <span className="grow">
                    <strong>{meta.label}</strong>
                    <span className="dim small"> {meta.note}</span>
                  </span>
                  <button className={on ? 'ghost danger' : ''}
                          onClick={() => onPriv(m.name, key, !on)}>
                    {on ? 'Revoke' : 'Grant'}</button>
                </li>
              )
            })}
          </ul>

          <h3>Folders on this computer</h3>
          {folders.length === 0
            ? <p className="dim small">None, so nothing on it can be played.</p>
            : (
              <ul className="cu-grants">
                {folders.map((g) => {
                  const h = health[g.root]
                  return (
                    <li key={g.id}>
                      <code className="grow">{g.root}</code>
                      {!g.client && <span className="tag">all computers</span>}
                      {h && h.ok && (
                        <span className="dim small">
                          {h.audio} audio · {h.video} video</span>)}
                      {h && !h.ok && (
                        <span className="warn small" title={h.why}>{h.why}</span>)}
                      <button className="ghost danger"
                              onClick={() => onRevoke(g.id)}>remove</button>
                    </li>
                  )
                })}
              </ul>
            )}
          {probe?.grant_note && (
            <p className="warn small">{probe.grant_note}</p>)}
          {probe && !probe.loading && !probe.error
            && Array.isArray(probe.binaries) && !probe.binaries.includes('mpv') && (
            <p className="warn small">
              mpv is not installed on this computer, so it can play nothing from
              disk. <code>brew install mpv</code> on a Mac, then restart the
              client.
            </p>
          )}
          <form className="row" onSubmit={(e) => {
            e.preventDefault(); onAdd(m.name, root.trim()); setRoot('')
          }}>
            <input className="grow" value={root}
                   placeholder={m.platform === 'darwin'
                     ? '/Users/you/Movies' : '/home/you/Music'}
                   onChange={(e) => setRoot(e.target.value)} />
            <button type="submit" disabled={!root.trim().startsWith('/')}>
              Add</button>
          </form>

          <h3>Hardware</h3>
          {!probe ? <button className="ghost" onClick={onProbe}>Check</button>
            : probe.loading ? <p className="dim">asking…</p>
            : probe.error ? <p className="error">{probe.error}</p>
            : <Hardware d={probe} />}

          {/* Folded, because it is not the thing you came here for — but on the
              card, not buried in the set-up wizard, because "get this off my
              machine" is the one instruction you want to find in a hurry. */}
          <details className="cu-remove">
            <summary>Remove Jarvis from {m.name}</summary>
            <p className="dim small">
              Paste this into a terminal <strong>on {m.name}</strong>. It stops
              the client however it was started, removes its service definition,
              and deletes its folder and its saved pairing token. Every line is
              harmless if that part is already gone. {m.name} disappears from
              this page the moment the process ends.
            </p>
            <Block text={removeCommands(m.platform)} />
            <p className="dim small">
              Folders and privileges you granted {m.name} stay here, so setting
              it up again picks them straight back up. Remove them above if you
              want them gone. The pairing token is shared by every machine —
              rotating it disconnects all of them, so only do that if this one
              was compromised.
            </p>
          </details>
        </div>
      )}
    </section>
  )
}
