import { NetworkPanel } from '../pages/Network.jsx'
import ChatPanel from './Chat.jsx'
import JournalPanel from './Journal.jsx'
import EditorPanel from './Editor.jsx'
import RendererPanel from './Renderer.jsx'
import OrganizerPanel from './Organizer.jsx'
import RunPanel from './Run.jsx'
import TodoPanel from './Todos.jsx'
import GitPanel from './Git.jsx'
import TaskBoardPanel from './TaskBoard.jsx'
import ContextPanel from './ContextFiles.jsx'
import AgentPanel from './AgentRun.jsx'
import ResearchPanel from './Research.jsx'
import ReviewPanel from './Review.jsx'
import SecretsPanel from './Secrets.jsx'
import TerminalPanel from './Terminal.jsx'

// The panel registry. Adding a capability to the board is one component and one
// entry here.
//
// It used to be two: a PANEL_TYPES map of labels and default sizes near the top
// of Workspace.jsx, and a `switch (props.type)` 475 lines further down that
// decided what to render. They drifted — which is why the switch still carries a
// `default:` arm and why loadLayout filters saved panels against the map. Both
// of those are kept, because they answer a different question: a *persisted*
// board can name a panel type that no longer exists (there was a 'staging' one),
// and no registry can retroactively know about a type that has been deleted.
//
// Every panel is rendered with the same props — {type, slug, project,
// refreshProject, state, setState, onToggleExpand} — and takes the ones it
// wants. `state`/`setState` are the panel's slice of the persisted layout.
export const PANELS = {
  chat: { label: 'Chat — Jarvis or an agent', w: 440, h: 520, Component: ChatPanel },
  journal: { label: 'Journal — project.md', w: 460, h: 420, Component: JournalPanel },
  editor: { label: 'Editor — text & markdown', w: 520, h: 440, Component: EditorPanel },
  renderer: { label: 'Renderer — html / pdf / images', w: 520, h: 440, Component: RendererPanel },
  organizer: { label: 'File organizer', w: 580, h: 460, Component: OrganizerPanel },
  run: { label: 'Run — python sandbox', w: 560, h: 470, Component: RunPanel },
  todos: { label: 'To-dos', w: 360, h: 380, Component: TodoPanel },
  git: { label: 'Git — review, approve, push', w: 560, h: 480, Component: GitPanel },
  board: { label: 'Task board — goal / plan / runs', w: 400, h: 540, Component: TaskBoardPanel },
  context: { label: 'Context files — load into Jarvis', w: 440, h: 460, Component: ContextPanel },
  agent: { label: 'Run an agent', w: 460, h: 520, Component: AgentPanel },
  research: { label: 'Research bots — live', w: 620, h: 560, Component: ResearchPanel },
  review: { label: 'Review — approvals & alerts', w: 480, h: 540, Component: ReviewPanel },
  network: { label: 'Network — egress & host approvals', w: 480, h: 560, Component: NetworkPanel },
  secrets: { label: 'Secrets — key grants for this project', w: 460, h: 380, Component: SecretsPanel },
  terminal: { label: 'Terminal — shell in the guest VM', w: 560, h: 360, Component: TerminalPanel },
}

export function PanelBody(props) {
  const C = PANELS[props.type]?.Component
  if (!C) return <div className="dim">unknown panel</div>
  return <C {...props} />
}
