import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { TAB_ID, setTabName, tabName } from '../tab.js'

// --- open Jarvis tabs ---------------------------------------------------------
//
// The other kind of "computer" Jarvis can put sound on: a browser with Jarvis
// open. Music used to start in ALL of them at once because none had a name and
// there was nothing to address. They have names now, so this shows them and
// lets you change what this one is called — which is what you then say to
// Jarvis ("put it on the mac").
export default function Tabs() {
  const [tabs, setTabs] = useState([])
  const [name, setName] = useState(tabName())
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const load = () => api('/api/gui/tabs').then((r) => setTabs(r.tabs || []))
                          .catch(() => {})
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [])

  function save(e) {
    e.preventDefault()
    setTabName(name)
    setSaved(true)
    setTimeout(() => setSaved(false), 4000)
  }

  return (
    <section className="panel">
      <h2>Open Jarvis tabs</h2>
      <p className="dim small">
        Music and video play in ONE of these — the tab you asked from, unless you
        name another. Say the name to Jarvis.
      </p>
      {tabs.length === 0
        ? <p className="dim small">none reporting yet</p>
        : (
          <ul className="cu-grants">
            {tabs.map((t) => (
              <li key={t.id}>
                <span className="grow">{t.name}</span>
                {t.id === TAB_ID && <span className="tag">this one</span>}
              </li>
            ))}
          </ul>
        )}
      <form className="row" onSubmit={save}>
        <input className="grow" value={name} maxLength={60}
               onChange={(e) => setName(e.target.value)}
               placeholder="what to call this browser" />
        <button type="submit" disabled={!name.trim()}>Rename this tab</button>
      </form>
      {saved && (
        <p className="dim small">
          Saved. It takes the new name when this tab next reconnects — reload to
          do that now.
        </p>
      )}
    </section>
  )
}
