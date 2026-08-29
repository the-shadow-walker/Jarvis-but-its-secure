// What a paired machine says it has: screens, the speakers it can turn up or
// down, the speakers it can play through, and what is playing now. Rendered on
// the machine card and again on the set-up wizard's "Connected" step.
export default function Hardware({ d }) {
  const screens = d.screens || []
  const mixer = d.audio_devices || []
  const outs = d.play_devices || []
  const row = (label, items, empty) => (
    <>
      <dt>{label}</dt>
      <dd>{items.length ? items : <span className="dim">{empty}</span>}</dd>
    </>
  )
  return (
    <dl className="cu-hw">
      {row('Screens',
        screens.map((s) => (
          <div key={s.index}>Screen {s.index}{s.geometry ? ` — ${s.geometry}` : ''}</div>)),
        'none detected')}
      {/* Two different things, so two plain labels. "Mixer" and "ao device" are
          protocol words that meant nothing to anyone reading this page. */}
      {row('Speakers it can turn up or down',
        mixer.map((a) => <div key={a.id}>{a.label || a.id}</div>),
        'none detected')}
      {row('Speakers it can play through',
        outs.slice(0, 6).map((a) => <div key={a.id}>{a.id}</div>),
        'none — is mpv installed?')}
      {row('Playing now',
        (d.players || []).map((p) => <div key={p}>{p}</div>),
        'nothing')}
    </dl>
  )
}
