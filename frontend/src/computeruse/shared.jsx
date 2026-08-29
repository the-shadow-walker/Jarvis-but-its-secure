import { useState } from 'react'

// The pieces the Computer-use page, the machine card and the set-up wizard all
// need. They were three separate concerns in one 807-line file; this is what is
// genuinely common to them.

// Cloudflare's dashboard shows a service token as whole header lines, so that is
// what gets pasted. Strip the header name, quotes and whitespace rather than
// letting "CF-Access-Client-Id: abc.access" through as the id.
export function cleanToken(v) {
  return String(v || '')
    .replace(/^\s*CF[-_]?Access[-_]?Client[-_]?(Id|Secret)\s*[:=]\s*/i, '')
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\s+/g, '')
    .trim()
}

// Copies what it is GIVEN, not what is on screen. The set-up command renders a
// placeholder until the token is revealed, and copying the rendered text meant
// pasting the literal "<reveal the token above>" into a terminal.
export function Copy({ text, label = 'copy' }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="copy-btn" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const ta = document.createElement('textarea')   // no secure context
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      setDone(true)
      setTimeout(() => setDone(false), 1600)
    }}>{done ? 'copied' : label}</button>
  )
}

export const Block = ({ text }) => (
  <div className="cu-block"><Copy text={text} /><pre>{text}</pre></div>
)

// Everything that takes the client off a machine, in the order it has to happen.
//
// Written out by hand rather than calling `agent.py --uninstall`, and that is
// deliberate: the copy being removed is by definition the OLD one, and it may
// predate the flag. Every line is also safe to run when the thing it names is
// not there, so this is one paste whether the client was installed as a
// service, left running in a terminal, or half set up and abandoned.
//
// There is no button for this and there should not be. The client only ever
// accepts verbs from the closed table in backend/computeruse.py, and none of
// them can stop or uninstall it — a Jarvis that could remove itself from the
// operator's machines is a remote-kill primitive, and the whole design assumes
// Jarvis may be compromised. Ending access is the operator's own act, at their
// own terminal. Closing the process is all it takes; nothing listens here.
export function removeCommands(platform) {
  const mac = platform === 'darwin' || platform === 'mac'
  return (mac
    ? 'launchctl bootout gui/$UID/network.atomos.jarvis.computeruse 2>/dev/null\n'
      + 'rm -f ~/Library/LaunchAgents/network.atomos.jarvis.computeruse.plist\n'
    : 'systemctl --user disable --now jarvis-computeruse.service 2>/dev/null\n'
      + 'rm -f ~/.config/systemd/user/jarvis-computeruse.service\n'
      + 'systemctl --user daemon-reload\n')
    // a client started by --setup runs in the foreground and has no service to
    // stop, so the paste has to cover that too or it looks like it worked and
    // the machine stays connected
    + 'pkill -f computeruse/agent.py 2>/dev/null\n'
    + 'rm -rf ~/jarvis-client\n'
    + 'rm -f ~/.config/jarvis/computeruse.json'
}
