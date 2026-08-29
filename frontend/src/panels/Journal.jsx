import { useState } from 'react'
import { api } from '../api.js'
import { SaveButton } from '../components/Button.jsx'

// project.md — the journal Jarvis loads with this project.
export default function JournalPanel({ slug, project, refreshProject }) {
  const [md, setMd] = useState(project.project_md)
  const [dirty, setDirty] = useState(false)
  async function save() {
    await api(`/api/projects/${slug}/md`, {
      method: 'PUT', body: JSON.stringify({ content: md }) })
    setDirty(false)
    refreshProject()
  }
  return (
    <div className="pane-col">
      <textarea className="md-editor grow" spellCheck={false} value={md}
                onChange={(e) => { setMd(e.target.value); setDirty(true) }} />
      <div className="row">
        <span className="dim grow">the journal Jarvis loads with this project</span>
        <SaveButton dirty={dirty} onSave={save} />
      </div>
    </div>
  )
}
