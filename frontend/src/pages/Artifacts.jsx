import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { SaveButton } from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Md from '../Md.jsx'
import { notify } from '../notify.js'
import { useAsk } from '../ask.jsx'
import Page from '../components/Page.jsx'

// Everything Jarvis made in project-less chats, grouped by chat: view/edit,
// turn a store into a real project, or merge its files into an existing one.
export default function Artifacts() {
  const [artifacts, setArtifacts] = useState([])
  const [projects, setProjects] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)          // { slug, path }
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(true)
  const ask = useAsk()

  const refresh = (query = q) =>
    api(`/api/artifacts${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then((r) => setArtifacts(r.artifacts))
  useEffect(() => {
    refresh('')
    api('/api/projects').then((r) => setProjects(r.projects))
  }, [])

  useEffect(() => {
    if (!sel) return
    api(`/api/projects/${sel.slug}/file?path=${encodeURIComponent(sel.path)}`)
      .then((r) => { setContent(r.binary ? '(binary file)' : r.content); setDirty(false) })
      .catch(() => setContent(''))
  }, [sel])

  async function save() {
    await api(`/api/projects/${sel.slug}/file`, {
      method: 'PUT', body: JSON.stringify({ path: sel.path, content }) })
    setDirty(false)
  }

  async function convert(a) {
    const name = await ask.prompt('Project name for this artifact store', a.title,
                                  { confirmLabel: 'Create project' })
    if (!name) return
    await api(`/api/artifacts/${a.slug}/convert`, {
      method: 'POST', body: JSON.stringify({ name }) })
    notify(`now a project: ${name}`, { sev: 'ok' })
    refresh()
  }

  async function merge(a, target) {
    if (!target) return
    const r = await api(`/api/artifacts/${a.slug}/merge`, {
      method: 'POST', body: JSON.stringify({ target }) })
    notify(`merged into ${target}: ${r.merged.join(', ')}`, { sev: 'ok' })
  }

  async function del(a) {
    if (!await ask.confirm(`Delete the artifact store from "${a.title}"?`,
                           { body: `${a.files.length} file(s) will be removed.`,
                             confirmLabel: 'Delete', danger: true })) return
    await api(`/api/artifacts/${a.slug}`, { method: 'DELETE' })
    if (sel?.slug === a.slug) setSel(null)
    refresh()
  }

  const isMd = sel && /\.md$/i.test(sel.path)
  return (
    <Page variant="split" title="Artifacts">
      <aside>
        <input placeholder="search name or content…" value={q}
               onChange={(e) => { setQ(e.target.value); refresh(e.target.value) }} />
        {artifacts.length === 0 && (
          <p className="dim small">nothing yet — files Jarvis creates in a chat
            with no project loaded land here</p>
        )}
        {artifacts.map((a) => (
          <div key={a.slug} className="artifact-group">
            <div className="side-title row">
              <span className="grow ellipsis" title={a.title}>{a.title}</span>
              <button className="win-btn" title="delete store" onClick={() => del(a)}>×</button>
            </div>
            <ul className="file-list">
              {a.files.map((f) => (
                <li key={f.path}
                    className={sel?.slug === a.slug && sel?.path === f.path ? 'active' : ''}
                    onClick={() => setSel({ slug: a.slug, path: f.path })}>
                  <span className="grow ellipsis">{f.path}</span>
                  <span className="dim small">{f.size}B</span>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="ghost" onClick={() => convert(a)}>→ project</button>
              <select defaultValue="" onChange={(e) => { merge(a, e.target.value); e.target.value = '' }}>
                <option value="" disabled>merge into…</option>
                {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            </div>
          </div>
        ))}
      </aside>
      <main className="editor-pane">
        {!sel ? (
          /* a paragraph, not EmptyState's default div: it sits directly in
             the editor pane and a paragraph's own margins are part of where
             this line lands */
          <EmptyState as="p" pad>pick a file to view or edit</EmptyState>
        ) : (
          <>
            <div className="pane-head">
              <h3>{sel.path}</h3>
              {isMd && (
                <button className="ghost" onClick={() => setPreview((v) => !v)}>
                  {preview ? '✎ edit' : '👁 preview'}</button>
              )}
              <SaveButton dirty={dirty} onSave={save} />
            </div>
            {isMd && preview
              ? <div className="md-preview grow"><Md text={content} /></div>
              : <textarea className="md-editor grow" value={content} spellCheck={false}
                          onChange={(e) => { setContent(e.target.value); setDirty(true) }} />}
          </>
        )}
      </main>
    </Page>
  )
}
