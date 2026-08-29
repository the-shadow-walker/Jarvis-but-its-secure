import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Machine from '../computeruse/Machine.jsx'
import Setup from '../computeruse/Setup.jsx'
import Tabs from '../computeruse/Tabs.jsx'
import { cleanToken } from '../computeruse/shared.jsx'

// The Computer use page: the machines Jarvis is paired with, the browser tabs it
// can put sound on, and the three credentials that make the rest work.
//
// The parts that are their own thing are their own file now (../computeruse):
// the five-step Setup wizard, the per-machine card, the tab list, the hardware
// table, and the clipboard/token helpers all three share. This file is the page
// — its state, the calls that change it, and the layout.

export default function ComputerUse() {
  const [state, setState] = useState(null)
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(null)      // expanded machine
  const [probe, setProbe] = useState({})
  const [setupOpen, setSetupOpen] = useState(false)
  const [msg, setMsg] = useState(null)
  const [tm, setTm] = useState({ url: '', cf_id: '', secret_set: false })
  const [tmSecret, setTmSecret] = useState('')
  const [tmTest, setTmTest] = useState(null)
  const [jf, setJf] = useState({ url: '', key_set: false })
  const [jfKey, setJfKey] = useState('')
  const [cf, setCf] = useState({ configured: false, client_id: '', hosts: [] })
  const [cfId, setCfId] = useState('')
  const [cfSecret, setCfSecret] = useState('')
  const [cfResult, setCfResult] = useState(null)

  const refresh = () => api('/api/computeruse/status').then(setState)
  const loadCf = () => api('/api/computeruse/cfaccess')
    .then((r) => { setCf(r); setCfId(r.client_id || '') }).catch(() => {})
  useEffect(() => {
    refresh()
    api('/api/computeruse/token').then((r) => setToken(r.token)).catch(() => {})
    api('/api/computeruse/tarmac').then(setTm).catch(() => {})
    api('/api/computeruse/jellyfin').then(setJf).catch(() => {})
    loadCf()
    const t = setInterval(refresh, 6000)
    return () => clearInterval(t)
  }, [])

  // Rotating is the whole reason this panel exists, so it reports which
  // machines took the new token and which it could not reach — the second list
  // is the operator's remaining work, and leaving it out would imply the
  // rotation was complete when it was not.
  async function saveCf(e) {
    e.preventDefault()
    setCfResult(null)
    try {
      const r = await api('/api/computeruse/cfaccess', {
        method: 'PUT',
        body: JSON.stringify({ client_id: cfId, secret: cfSecret }) })
      setCfSecret('')
      setCfResult(r)
      loadCf()
    } catch (err) { setCfResult({ error: err.detail || String(err) }) }
  }

  const say = (m) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  async function runProbe(name) {
    setProbe((p) => ({ ...p, [name]: { loading: true } }))
    try {
      const r = await api(
        `/api/computeruse/probe?client_id=${encodeURIComponent(name)}`,
        { method: 'POST' })
      setProbe((p) => ({ ...p, [name]: r.result || r }))
    } catch (err) {
      setProbe((p) => ({ ...p, [name]: { error: err.detail || String(err) } }))
    }
  }

  async function togglePriv(client, capability, allowed) {
    try {
      await api('/api/computeruse/privileges', {
        method: 'PUT', body: JSON.stringify({ client, capability, allowed }) })
      refresh()
    } catch (err) { say(err.detail || String(err)) }
  }

  async function addFolder(client, root) {
    try {
      await api('/api/computeruse/grants', {
        method: 'POST', body: JSON.stringify({ root, client }) })
      refresh()
      // and ask the machine what it made of it. A folder that exists here as a
      // string and not there as a directory is the commonest way to end up
      // being told there are no folders after adding one — the probe is what
      // turns that into a line of text next to the folder.
      runProbe(client)
      // No restart line any more: the host pushes the folder list to the
      // connected machine as part of this call. It used to say "restart the
      // client", which was true and useless — the restart meant re-running the
      // set-up command, so folders were the one setting this tab could not
      // actually change.
    } catch (err) { say(err.detail || String(err)) }
  }

  const revoke = async (id) => {
    await api(`/api/computeruse/grants/${id}`, { method: 'DELETE' })
    refresh()
  }

  // Only the URL now. The music server's Access token stopped being its own
  // thing — it is the one token, held above, and having a second copy here is
  // precisely how rotating it broke music while everything else looked fine.
  async function saveMusic(e) {
    e.preventDefault()
    setTmTest(null)
    try {
      setTm(await api('/api/computeruse/tarmac', {
        method: 'PUT', body: JSON.stringify({ url: tm.url }) }))
      say('Music server saved')
    } catch (err) { say(err.detail || String(err)) }
  }

  async function testMusic() {
    setTmTest({ testing: true })
    try {
      setTmTest(await api('/api/computeruse/tarmac/test', { method: 'POST' }))
    } catch (err) { setTmTest({ ok: false, error: err.detail || String(err) }) }
  }

  async function saveJellyfin(e) {
    e.preventDefault()
    try {
      setJf(await api('/api/computeruse/jellyfin', {
        method: 'PUT', body: JSON.stringify({ url: jf.url, key: jfKey }) }))
      setJfKey('')
      say('Jellyfin saved')
    } catch (err) { say(err.detail || String(err)) }
  }

  if (!state) return <div className="page"><p className="dim">loading…</p></div>
  const machines = state.clients || []
  const caps = state.capabilities || {}
  const orphans = (state.grants || []).filter(
    (g) => g.client && !machines.some((m) => m.name === g.client))

  return (
    <div className="page cu-page">
      <div className="cu-head">
        <h1>Computer use</h1>
        <button onClick={() => setSetupOpen(true)}>Connect a computer</button>
      </div>
      {msg && <p className="warn">{msg}</p>}

      {machines.length === 0 ? (
        <section className="panel cu-empty">
          <p>No computer connected.</p>
          <p className="dim small">
            Jarvis can only reach a machine running the client. It dials out, so
            nothing needs to be open on your side.
          </p>
        </section>
      ) : machines.map((m) => (
        <Machine key={m.id} m={m} caps={caps} served={state.served_version}
                 expanded={open === m.name}
                 onToggle={() => {
                   const opening = open !== m.name
                   setOpen(opening ? m.name : null)
                   // probe on open, not on a button: the folder health is the
                   // reason to open this at all
                   if (opening && !probe[m.name]) runProbe(m.name)
                 }}
                 probe={probe[m.name]} onProbe={() => runProbe(m.name)}
                 onPriv={togglePriv} onAdd={addFolder} onRevoke={revoke} />
      ))}

      <Tabs />

      {orphans.length > 0 && (
        <section className="panel">
          <h2>Folders for computers that aren’t connected</h2>
          <ul className="cu-grants">
            {orphans.map((g) => (
              <li key={g.id}>
                <code className="grow">{g.root}</code>
                <span className="tag">{g.client}</span>
                <button className="ghost danger" onClick={() => revoke(g.id)}>
                  remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Cloudflare Access token</h2>
        <form className="row" onSubmit={saveCf}>
          <input className="grow" placeholder="Client Id (ends in .access)"
                 value={cfId}
                 onChange={(e) => setCfId(cleanToken(e.target.value))} />
          <input type="password"
                 placeholder={cf.configured ? 'secret (stored)' : 'Client Secret'}
                 value={cfSecret}
                 onChange={(e) => setCfSecret(cleanToken(e.target.value))} />
          <button type="submit" disabled={!cfId || !cfSecret}>Save & push</button>
        </form>
        {cfResult && (cfResult.error
          ? <p className="error">{cfResult.error}</p>
          : <p className="badge">
              Saved.{' '}
              {cfResult.updated?.length
                ? `Pushed to ${cfResult.updated.join(', ')} — `
                  + 'each takes it on its next reconnect.'
                : 'No machine was connected to push it to.'}
              {cfResult.missed?.length
                ? ` Could not reach ${cfResult.missed.join(', ')}.` : ''}
            </p>)}
        <p className="dim small">
          One token, held here and used for everything: Jarvis, the music server,
          and the set-up command, which fills it in so you never type it. Saving
          a rotated one pushes it to every machine that is connected right now —
          a machine that is offline cannot be told, because Jarvis is behind the
          thing being rotated, so that one needs it pasted in once.
        </p>
      </section>

      <section className="panel">
        <h2>Music server</h2>
        <form className="row" onSubmit={saveMusic}>
          <input className="grow" placeholder="https://music.atomos.network"
                 value={tm.url}
                 onChange={(e) => setTm({ ...tm, url: e.target.value })} />
          <button type="submit">Save</button>
          <button type="button" className="ghost" onClick={testMusic}
                  disabled={!tm.url}>Test</button>
        </form>
        {tmTest && (
          <p className={tmTest.ok ? 'badge' : 'error'}>
            {tmTest.testing ? 'asking…' : tmTest.ok
              ? `${tmTest.status?.tracks ?? '?'} tracks · `
                + `${tmTest.status?.players_connected ?? 0} player(s) open`
              : tmTest.error}
          </p>
        )}
        <p className="dim small">
          It is a separate Cloudflare Access application, so the token above
          needs its own Service Auth policy there as well as on this one.
        </p>
      </section>

      <section className="panel">
        <h2>Jellyfin</h2>
        <form className="row" onSubmit={saveJellyfin}>
          <input className="grow" placeholder="https://jellyfin.example"
                 value={jf.url}
                 onChange={(e) => setJf({ ...jf, url: e.target.value })} />
          <input type="password"
                 placeholder={jf.key_set ? 'API key (stored)' : 'API key'}
                 value={jfKey} onChange={(e) => setJfKey(e.target.value)} />
          <button type="submit">Save</button>
        </form>
      </section>

      {setupOpen && (
        <Setup token={token} machines={machines}
               onClose={() => { setSetupOpen(false); refresh() }} />
      )}
    </div>
  )
}
