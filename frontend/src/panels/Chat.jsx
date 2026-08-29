import ChatBox from '../ChatBox.jsx'

// The board's chat panel. The panel owns the thread's identity ('' = Jarvis,
// else an agent slug) in its persisted state, so a board can hold several agent
// threads on the same project and each survives a reload.
export default function ChatPanel({ slug, state, setState }) {
  return (
    <ChatBox projectSlug={slug} agent={state?.agent || ''}
             onAgentChange={(a) => setState({ agent: a })} />
  )
}
