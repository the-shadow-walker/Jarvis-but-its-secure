import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Md from '../Md.jsx'
import { useAsk } from '../ask.jsx'
import { SaveButton } from '../components/Button.jsx'

const TEXT_EXT = /\.(md|txt|py|js|jsx|ts|json|html|css|csv|toml|yaml|yml|sh|tex)$/i

// Text & markdown editor over the project's files, with a rendered preview for
// .md/.txt. The open path lives in the panel's persisted state.
export default function EditorPanel({ slug, state, setState }) {
  const [files, setFiles] = useState([])
  const ask = useAsk()
  const [content, setContent] = useState('')
  const [binary, setBinary] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(false)
  const path = state.path || ''
  const previewable = /\.(md|txt)$/i.test(path)

  const refresh = useCallback(() =>
    api(`/api/projects/${slug}/files`).then((r) =>
      setFiles(r.files.map((f) => f.path).filter((p) => TEXT_EXT.test(p)))), [slug])
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!path) { setContent(''); return }
    api(`/api/projects/${slug}/file?path=${encodeURIComponent(path)}`)
      .then((r) => { setBinary(r.binary); setContent(r.binary ? '' : r.content); setDirty(false) })
      .catch(() => { setContent(''); setState({ path: '' }) })
  }, [slug, path]) // eslint-disable-line

  async function save() {
    await api(`/api/projects/${slug}/file`, {
      method: 'PUT', body: JSON.stringify({ path, content }) })
    setDirty(false)
  }
  async function newFile() {
    const p = await ask.prompt('New file path', '',
      { placeholder: 'e.g. notes/plan.md, code/sim.py', confirmLabel: 'Create' })
    if (!p) return
    await api(`/api/projects/${slug}/file`, {
      method: 'PUT', body: JSON.stringify({ path: p, content: '' }) })
    await refresh()
    setState({ path: p })
  }

  return (
    <div className="pane-col">
      <div className="row">
        <select className="grow" value={path} onChange={(e) => setState({ path: e.target.value })}>
          <option value="">— pick a file —</option>
          {files.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="ghost" onClick={refresh} title="refresh">↻</button>
        <button className="ghost" onClick={newFile}>+ new</button>
        {previewable && (
          <button className="ghost" title={preview ? 'edit' : 'rendered preview'}
                  onClick={() => setPreview((v) => !v)}>{preview ? '✎' : '👁'}</button>
        )}
        <SaveButton dirty={dirty} disabled={!path} onSave={save} />
      </div>
      {binary
        ? <div className="dim center-pad">binary file</div>
        : preview && previewable
          ? (/\.md$/i.test(path)
              ? <div className="md-preview grow"><Md text={content} /></div>
              : <pre className="md-preview grow">{content}</pre>)
          : <textarea className="md-editor grow" spellCheck={false} value={content}
                    disabled={!path}
                    placeholder="pick or create a file…"
                    onChange={(e) => { setContent(e.target.value); setDirty(true) }} />}
    </div>
  )
}
