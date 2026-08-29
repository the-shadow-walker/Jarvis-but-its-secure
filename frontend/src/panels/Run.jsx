import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { rawUrl } from './util.js'

const IMG_EXT = /\.(png|jpg|jpeg|gif|svg|webp)$/i

// The python sandbox: a scratch pad or a .py file in the project, run in the
// guest and answering with stdout, stderr and whatever artifacts it wrote.
export default function RunPanel({ slug, state, setState }) {
  const [pyFiles, setPyFiles] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const code = state.code ??
    '# scratch pad — numpy / matplotlib / sympy / pandas / reportlab available\nprint("hello")\n'
  const runFile = state.runFile || ''

  useEffect(() => {
    api(`/api/projects/${slug}/files`).then((r) =>
      setPyFiles(r.files.map((f) => f.path).filter((p) => p.endsWith('.py'))))
  }, [slug, result])

  async function run(body) {
    setBusy(true)
    setResult(null)
    try {
      setResult(await api(`/api/projects/${slug}/run`, {
        method: 'POST', body: JSON.stringify(body) }))
    } catch (err) {
      setResult({ exit_code: -1, stdout: '', stderr: err.detail || String(err), artifacts: [] })
    }
    setBusy(false)
  }

  return (
    <div className="pane-col">
      <textarea className="md-editor code grow" spellCheck={false} value={code}
                onChange={(e) => setState({ code: e.target.value })} />
      <div className="row">
        <button onClick={() => run({ code })} disabled={busy}>
          {busy ? 'running…' : '▶ scratch'}</button>
        <select className="grow" value={runFile}
                onChange={(e) => setState({ runFile: e.target.value })}>
          <option value="">— or a .py file —</option>
          {pyFiles.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="ghost" disabled={!runFile || busy}
                onClick={() => run({ path: runFile })}>▶ file</button>
      </div>
      {result && (
        <div className="run-result">
          <div className="dim">exit {result.exit_code} · {result.duration}s
            {result.timed_out && <span className="warn"> · timed out</span>}</div>
          {result.stdout && <pre className="console">{result.stdout}</pre>}
          {result.stderr && <pre className="console err">{result.stderr}</pre>}
          {result.artifacts?.length > 0 && result.artifacts.map((a) => (
            <div key={a} className="artifact">
              <a href={rawUrl(slug, a)} target="_blank" rel="noreferrer">{a}</a>
              {IMG_EXT.test(a) && <img src={`${rawUrl(slug, a)}?t=${Date.now()}`} alt={a} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
