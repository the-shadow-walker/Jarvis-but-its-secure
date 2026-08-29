import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Hardware from './Hardware.jsx'
import { Block, cleanToken, removeCommands } from './shared.jsx'

// --- set-up, one step at a time ----------------------------------------------
// A fixed-height dialog: each step fits, so nothing scrolls and nothing gets
// skipped. The previous version was one long column of prose, which is how a
// placeholder ends up pasted into a terminal instead of a token.

const STEPS = ['Name', 'Access', 'Set up', 'Connected', 'Keep running']

// A path may contain a space, and one that does would otherwise arrive at the
// client as two --allow-root values, neither of which exists.
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`

export default function Setup({ token, machines, onClose }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [roots, setRoots] = useState('')
  const [cfId, setCfId] = useState('')
  const [cfSecret, setCfSecret] = useState('')
  const [cfFromStore, setCfFromStore] = useState(false)
  const [jumped, setJumped] = useState(false)
  const [platform, setPlatform] = useState(
    () => (/Mac/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'linux'))

  // The token is stored once, host-side, so setting up the fifth machine does
  // not mean finding it in Zero Trust for the fifth time. Typing over it still
  // works — the field is prefilled, not locked.
  useEffect(() => {
    api('/api/computeruse/cfaccess').then((r) => {
      if (!r.configured) return
      setCfId(r.client_id)
      setCfSecret(r.secret)
      setCfFromStore(true)
    }).catch(() => { /* not behind Access, or never configured */ })
  }, [])

  const origin = window.location.origin
  // A unique URL per time this dialog is opened, because the origin saying
  // "no-store" is not retroactive. Cloudflare caches this path by its .gz
  // extension and had already pinned a four-hour copy before the header
  // existed; that entry goes on being served until it expires no matter what
  // the origin says now. A query parameter is a different cache key, so it
  // misses the old entry entirely — and it keeps working if this is ever put
  // behind a CDN that ignores the header again.
  const [bust] = useState(() => Date.now().toString(36))
  const behind = !!(cfId && cfSecret)
  const here = machines.find((m) => m.name === name)
  const rootList = roots.split(',').map((s) => s.trim()).filter(Boolean)

  // It arrives connected or it does not arrive: the set-up step is one paste
  // that ends with the client running, so the moment it lands the wizard should
  // be showing what landed rather than waiting to be clicked forward.
  useEffect(() => {
    if (here && step === 2 && !jumped) { setJumped(true); setStep(3) }
  }, [here, step, jumped])

  // One chained command, on purpose. Every line of it used to be a step the
  // operator ran by hand, and each one had a way to fail that left set-up half
  // done with no sign of it:
  //   - `unzip` is not in a base Linux install; tar is. The zip download
  //     succeeded and then died on `unzip: command not found`, and the next
  //     line ran anyway against a directory that was never unpacked.
  //   - `pip install` into the system python is refused outright on Arch and
  //     Debian (PEP 668), and into whatever venv happened to be active it puts
  //     the deps somewhere the service will never look.
  //   - Starting the client before its settings were saved just printed the
  //     usage message: --server and --token were only saved by --install, which
  //     came a step later.
  // So: && between every step so the first failure stops it, and --setup at the
  // end, which checks it can reach Jarvis, saves the settings, says what is
  // missing, and connects.
  const py = '~/jarvis-client/.venv/bin/python'
  const cmds = {
    setup: [
      `mkdir -p ~/jarvis-client && cd ~/jarvis-client`,
      // Two changes from `curl -fsSL`, both of which cost real debugging time:
      //
      //   -f prints NOTHING on an HTTP error — no status, no body — so every
      //   refusal looked the same and named nothing. -w '%{http_code}' keeps it.
      //
      //   -L silently FOLLOWED Cloudflare Access's 302 to its login page, which
      //   answers 200 with HTML. The status check passed, and the operator got
      //   "gzip: stdin: not in gzip format" from tar — an error about archives
      //   for what is actually an authentication problem. Redirects are not
      //   followed now, so a 302 is reported as a 302, and the gzip test below
      //   catches an HTML page that arrives with a 200 anyway (a WAF block page
      //   does exactly that).
      // -A names this request. curl's own user-agent happens to be allowed
      // today, but the very next step of set-up was refused with a 403 purely
      // for sending "Python-urllib/3.x", so the lesson is that an anonymous
      // request is a bot-rule away from failing. Both halves say the same name.
      `  && code=$(curl -sS -o c.tgz -w '%{http_code}' -A 'jarvis-computeruse/1.0'`,
      `  '${origin}/api/computeruse/client.tar.gz?v=${bust}'`,
      `  -H 'X-Jarvis-Token: ${token}'`,
      ...(behind ? [`  -H 'CF-Access-Client-Id: ${cfId}'`,
                    `  -H 'CF-Access-Client-Secret: ${cfSecret}'`] : []),
      `  )`,
      `  && { [ "$code" = 200 ] || { echo "the download answered HTTP $code, not 200:";`,
      `       head -c 300 c.tgz; echo;`,
      `       echo '  301/302 -> Cloudflare Access. This app needs its own Service';`,
      `       echo '             Auth policy naming your service token — policies are';`,
      `       echo '             per-application, so one that works for another host';`,
      `       echo '             does not cover this one.';`,
      `       echo '  401     -> Jarvis itself answered: the pairing token is stale.';`,
      `       echo '             Copy it again from the Computer use tab.';`,
      `       echo '  403     -> something in FRONT of Jarvis refused it. Jarvis never';`,
      `       echo '             answers 403 here, so look at a WAF rule, Bot Fight';`,
      `       echo '             Mode (it blocks curl by user-agent), or Access.';`,
      `       rm -f c.tgz; false; }; }`,
      `  && { gzip -t c.tgz 2>/dev/null || { echo 'that answered 200 but is not a tarball:';`,
      `       head -c 300 c.tgz; echo;`,
      `       echo 'HTML here means a login or block page replied instead of Jarvis.';`,
      `       rm -f c.tgz; false; }; }`,
      `  && tar xzf c.tgz && rm -f c.tgz`,
      `  && python3 -m venv .venv`,
      `  && .venv/bin/pip install -q -r computeruse/requirements.txt`,
      `  && .venv/bin/python computeruse/agent.py --setup`,
      `       --server ${origin}`,
      `       --token ${token}`,
      ...(name ? [`       --name ${name}`] : []),
      ...rootList.map((r) => `       --allow-root ${shq(r)}`),
      ...(behind ? [`       --cf-access-id ${cfId}`,
                    `       --cf-access-secret ${cfSecret}`] : []),
      `  || { rm -f c.tgz; echo 'set-up stopped — the error is above'; }`,
    ].join(' \\\n'),
    // no flags: --setup already wrote them to ~/.config/jarvis/computeruse.json
    install: `${py} ~/jarvis-client/computeruse/agent.py --install`,
    // one source of truth with the card's own Remove section — a second copy of
    // this is a second thing to forget when a path changes
    remove: removeCommands(platform),
    enable: platform === 'mac'
      ? 'launchctl bootstrap gui/$UID '
        + '~/Library/LaunchAgents/network.atomos.jarvis.computeruse.plist\n'
        + 'launchctl kickstart -p gui/$UID/network.atomos.jarvis.computeruse'
      : 'systemctl --user daemon-reload\n'
        + 'systemctl --user enable --now jarvis-computeruse.service\n'
        + 'loginctl enable-linger $USER',
  }

  const steps = [
    <>
      <label>Name this computer
        <input autoFocus placeholder="macbook" value={name}
               onChange={(e) => setName(
                 e.target.value.replace(/[^\w.-]/g, '').toLowerCase())} />
      </label>
      <div className="cu-plat">
        {[['linux', 'Linux'], ['mac', 'macOS']].map(([k, l]) => (
          <button key={k} className={platform === k ? 'on' : ''}
                  onClick={() => setPlatform(k)}>{l}</button>
        ))}
      </div>
      <label>Folders it may play from
        <span className="dim small">Optional — you can add and remove folders
          from this page afterwards and the client picks them up straight away,
          no restart. Comma separated.</span>
        <input placeholder={platform === 'mac'
                 ? '~/Music, ~/Movies' : '~/Music, ~/Videos'}
               value={roots} onChange={(e) => setRoots(e.target.value)} />
      </label>
    </>,
    <>
      <label>Cloudflare Access token
        <span className="dim small">
          {cfFromStore
            ? 'Filled in from the one Jarvis holds — nothing to type. Change it '
              + 'here to use a different token for just this machine; to rotate '
              + 'it everywhere, use the Access token panel on the Computer use '
              + 'tab instead.'
            : 'Only if Jarvis is behind Access. Save it on the Computer use tab '
              + 'and it will be filled in here from then on.'}
        </span>
        <input placeholder="Client Id" value={cfId}
               onChange={(e) => { setCfId(cleanToken(e.target.value)); setCfFromStore(false) }} />
        <input type="password" placeholder="Client Secret" value={cfSecret}
               onChange={(e) => { setCfSecret(cleanToken(e.target.value)); setCfFromStore(false) }} />
      </label>
    </>,
    <>
      <p>Paste this into a terminal on <strong>{name}</strong>:</p>
      <Block text={cmds.setup} />
      <p className="dim small">Downloads the client, gives it its own venv,
        checks it can reach Jarvis, lists anything missing with the install
        command for <em>this</em> machine, then connects and stays in the
        foreground.</p>
      <details className="cu-remove">
        <summary>Already set one up on this machine?</summary>
        <p className="dim small">Run this first. It stops the old client, takes
          away its service definition, and deletes its folder and saved token —
          each line is harmless if that part is already gone.</p>
        <Block text={cmds.remove} />
      </details>
    </>,
    <>
      {here ? (
        <>
          <p className="badge">✓ {here.name} connected
            <span className="dim"> · {here.platform === 'darwin'
              ? 'macOS' : here.platform}</span></p>
          <Hardware d={here.caps || {}} />
          <p className={(here.grants || []).length ? 'dim small' : 'warn'}>
            {(here.grants || []).length
              ? `${here.grants.length} folder${here.grants.length === 1 ? '' : 's'} granted`
              : 'No folders granted yet, so nothing on it can be played — add '
                + 'one from its card on this page.'}
          </p>
        </>
      ) : (
        <>
          <p>Waiting for <strong>{name || 'the client'}</strong>…</p>
          <p className="dim small">The command ends by connecting, and this
            fills in the moment it does. If it is still spinning, the terminal
            has the reason — a wrong address, a rotated token and a missing
            Cloudflare service token each say so by name.</p>
        </>
      )}
    </>,
    <>
      <p>Ctrl-C the client, then save what it is already using:</p>
      <Block text={cmds.install} />
      <p className="dim small">No flags — set-up saved them to
        ~/.config/jarvis/computeruse.json at 0600. The service definition gets
        the path, never the token.</p>
      <p>Then keep it running:</p>
      <Block text={cmds.enable} />
    </>,
  ]

  return (
    <div className="cu-scrim" onClick={onClose}>
      <div className="cu-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cu-modal-head">
          <strong>Connect a computer</strong>
          <span className="grow" />
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <ol className="cu-crumbs">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              {s}</li>
          ))}
        </ol>
        <div className="cu-modal-body">{steps[step]}</div>
        <div className="cu-modal-foot">
          <button className="ghost" disabled={!step}
                  onClick={() => setStep(step - 1)}>Back</button>
          <span className="grow" />
          {step < STEPS.length - 1
            ? <button disabled={!name} onClick={() => setStep(step + 1)}>Next</button>
            : <button onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  )
}
