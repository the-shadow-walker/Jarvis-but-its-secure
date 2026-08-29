# Workbench plan — branch `agent-workbench`

Cut from `70b8270`. Goal, in the operator's words: make the GUI manageable and
easier to look at; get real control over **general agents** (unscheduled agents
that live in a project and help build things, like a Claude Code session); let
active agents talk to each other; and give agents separate sandboxes where that
is actually affordable.

This document is the shared context for every session working this branch.
**Read it first.** Each work package below is meant to be one conversation.

---

## House rules

1. **The repo working tree is shared** with other Claude sessions. Stage explicit
   paths; never `git commit -a`.
2. **Work on `agent-workbench`**, not `main`. Commit as you go; push when a work
   package is coherent.
3. **Never hardcode a colour.** The token palette in `frontend/src/styles.css`
   is the operator's locked-in taste (carbon dark / alabaster-sage light). No
   purple or blue gradients, ever. Glassy floating panels use the existing
   `--glass` + `backdrop-filter: blur(16px) saturate(1.15)` recipe.
4. **Nothing animates on page load.** Ambient motion must be caused by the
   operator. Layout moves use `cubic-bezier(.4,0,.2,1)`; front-loaded easings
   read as jolting.
5. **Verify GUI work on the Pi**, which has a screenshot rig in `~/uishots`:
   `audit.py` (every route at 1440/1280/390 + overflow), `themeshot.py` (both
   themes), `hit2.py` (authoritative broken-control hit test), `touch.py`
   (phone target sizes). Frontend-only changes need **no service restart** —
   `dist` is re-read per request. Iterate without WIP commits via
   `git diff | ssh grindlewalt@atomostest 'cd ~/jarvis && git apply'`.
6. **`tests/test_guest_spec_parity.py` AST-scans the `spec` dict** in
   `backend/vm/guest_turn.py` and asserts every key the host writes is read
   guest-side. Two production incidents came from dropped keys. If you add a
   spec field, add the guest-side read. Do not rename the `spec` literal.
7. The full suite takes ~3 min and **hits the real DeepSeek API** — there are no
   model mocks. `JARVIS_DEEPSEEK_API_KEY` must be set for any full-flow test.
8. Deploy loop: commit, push, then
   `ssh grindlewalt@atomostest 'cd ~/jarvis && git pull -q && (cd frontend && npm run build) && systemctl --user restart jarvis'`.
   **Before restarting, abort if a job is in flight** —
   `SELECT COUNT(*) FROM tool_calls WHERE created_at > datetime('now','-60 seconds')`
   must be 0, and the check has to exit non-zero, not just print.

---

## What the survey found

### Frontend (11,125 lines, 37 files)

`styles.css` alone is 2,360 lines (21% of the frontend). Colour tokens exist and
are good, for both themes. **Spacing and typography tokens do not exist at all**:
22 distinct `border-radius` values against 11 uses of `var(--radius)`, 19
`font-size` values (including `12.5px`, `13.5px`, `11.5px`), 16 `gap` values,
~50 padding combinations of which nine are near-identical row paddings.

There is **no `components/` directory** and no shared `Button`, `Card`, `Modal`,
`Input`, `Tag`, `Table` or `EmptyState`. Empty states are hand-written eight
different ways. The save-button pattern is copy-pasted verbatim in four places.

Oversized modules: `pages/Workspace.jsx` **1,643 lines** with 16 panel
components in one file; `pages/ComputerUse.jsx` 807; `pages/Chat.jsx` 704 (80 of
them a hardcoded `GREETINGS` literal); `App.jsx` 577, which is router *plus*
theme hook, VM status dropdown, GUI bridge and a FLIP animation controller.

Real duplication, not stylistic:
- `ChatBox.jsx` reimplements `Chat.jsx`'s streaming machinery near-verbatim —
  `handleTurnEvent`, open/resume, `stop()`, and three copy-pasted 409 branches.
- `pages/Network.jsx` contains the entire "Host approvals" card **twice in one
  file** (`:188-206` and `:300-319`), each with its own SSE and poll effects.
- `human()` is defined identically in `Network.jsx` and `Logs.jsx`; a third
  variant `fmtBytes()` in `SecurityBoard.jsx` emits `kB` where the others emit
  `KB`, so the app shows two different byte units depending on the page.
- `SEV`/`sevClass` duplicated; `ts()` exists twice with different output.
- `@keyframes drop-in` and `scrim-in` are each defined twice; `.convo-list`,
  `.window` and `.convo-list li.active .convo-title` are declared twice.

Theme-breaking hardcoded colours: `#fff` on `.notif-badge` (`styles.css:267`),
`#fff` on `.preview-frame` (`:942`, renders white in dark mode), `#000` on
`.media-dock video` (`:1654`), `#0e1013` in the Player (`:1810`).

Dead: `src/DiffView.jsx` (68 lines) imported by nothing, plus its CSS.
`.panel` has **no base style at all**, so ComputerUse's seven "cards" are bare
divs. `.panel.split > aside` is declared three times but `panel split` appears
in no JSX. `pages/Tools.jsx:6-19` ships a hardcoded roadmap array as UI.
`Voice.jsx:185` links to `/?c=<id>` but nothing in the app reads query params.

Four uncoordinated breakpoints (1024/768/640/400), with 768 also hardcoded in JS
at four places in `Chat.jsx`. Cross-cutting state runs through six ad-hoc
`window` CustomEvents; `App.jsx:145` keeps a module-level mutable global.
`GET /api/projects` fires from six independent pages with no cache.

### Agents

**The thing the operator wants mostly exists already** — it is the Workspace
`chat` panel (`ChatBox.jsx`, backed by `POST /api/chat`). That surface already
has everything the agent path lacks: multi-turn history with tier-2 compaction,
project pinning, detached execution surviving panel close, re-attach, a stop
endpoint, the full tool set, and companion panels (a real PTY *inside the guest*,
task board, git review) on the same board.

**What it lacks is identity.** Its system prompt is always central Jarvis
(`chat.py:368-369`); there is no way to say "this thread runs as `<slug>`".
`ChatRequest` has no `agent` field and `conversations` has no `agent_slug`
column. The reusable pieces are already factored: `_agent_system_prompt`
(`agents_run.py:125-133`) and `_agent_tools` (`:75-91`) take a plain dict, not a
slug, so they drop straight into the chat path.

**Every agent run is one-shot.** Both `_run_headless` (`:229`) and
`_run_interactive` (`:347`) build `history = [{"role":"user","content":task}]`
and open a brand-new conversation. There is no follow-up endpoint, no
`compaction.assemble` on the agent path, and **no stop endpoint** — chat has
`POST /api/chat/{cid}/stop`, agents have nothing, though `_active_runs` holds
the task handle and would make cancel a few lines.

Declared-but-inert fields, all three visible in the GUI: `own_memory` is stored
and checkboxed and **read by no runtime code**; `skills_exclude` is never
referenced (skills compile into the tool registry, so only `tools_exclude`
bites); `max_iterations` is honoured on the headless path only (`:228` vs `:348`)
and has no GUI field. A UI that offers switches which do nothing is worse than
one that omits them.

Run-tree gaps: `spawn_agent`/`spawn_temp_agent` children are opened with
`parent=None` (`agents_run.py:144-145`), so the tree is **disconnected exactly
where Jarvis delegates from a chat**. The chat-to-job link exists only as an
ephemeral bus event (`bus.announce_job`) — reloading a chat loses it.

Stale docs to fix while you are in here: `Agent.spawn()` was deleted, but
`orchestrator.py:156-158` and `CLAUDE.md:40` still call it "the seam".

### Inter-agent communication — none exists

Parent to child, once, at spawn: an opaque task string. Child to parent, once,
at completion: a compacted report. **Siblings never learn anything from each
other** — `orchestrator.py:143-147` gathers them with `parent_summary=brief`,
the parent's own brief, not any sibling's rollup.

There is no messaging tool among the 49 in `tools/`, no mailbox table among the
20 in `db.py`, and **no agent anywhere subscribes to the bus** — every
`bus.subscribe` call site is an HTTP SSE handler. The bus is strictly
agent-to-browser. The host never initiates anything to a running guest: the
gateway dispatches exactly four ops (`model_call`, `tool_broker_call`,
`get_guest_package`, `ping`), and `guest_turn` writes the spec once then only
reads. There is no way to inject a message into a turn already in flight.

Usable seams: `bus.publish_to` already does single-recipient delivery;
`bus._subscribers` already namespaces by arbitrary string key;
`broker._envelopes` is a live per-`op_id` registry of in-flight turns with their
project and conversation context; `broker_dispatch` is the single chokepoint
every guest tool call already crosses, with op_id pinning that stops a
compromised guest forging identities; and guest-side `turnctx` already proves
concurrent turns in one guest keep separate identities.

### A second guest VM — the honest ceiling

Measured on the Pi: **3.7 GiB total RAM, 2.4 GiB available**, guest allocation
768 MB, 4 cores with 2 given to the guest. That is **two, maybe three concurrent
guests** before swapping — not "as many as you want". `config.py:217-222`
explicitly rejects a warm pool as the wrong fit for this box, and that judgement
still holds. Real per-agent density needs x86: main is gated on a BIOS SVM
toggle, and the Pi is GICv2 so Firecracker cannot run there at all.

Everything that blocks a second guest today, concretely: a single `vm_guest_cid`
scalar with no allocator (`config.py:200`); the module singleton
`vm = GuestVM()` (`lifecycle.py:344`) with six importers; fixed
`overlay.qcow2`, `efi_vars_run.fd` and `console.log` names in one `VM_DIR`;
`pkill -9 -f <overlay>` as a blunt global kill (`lifecycle.py:122-134`); tap
`jvtap0` and MAC `52:54:00:12:34:60` as literals in `run_vm.sh:30-32` (which
ignores the `JARVIS_VM_TAP` env var the host exports); guest IP `10.201.0.2` and
proxy `http://10.201.0.1:8443` hardcoded in guest code
(`guest/backend/server.py:134,176`); a single egress-proxy listener;
`net_up.sh` deleting and recreating the tap on every `up`; one
`guest-shell.sock`; and `vm_api` routes that carry no guest id.

**Two bugs here exist today, with one guest**, and are worth fixing regardless:
`nuke()` and `selftest()` tear the guest down **without checking `_inflight`**
(`lifecycle.py:204-207`, `:318`/`:337`), so hitting `/api/vm/selftest` kills
live turns; and `_ws_holds` is keyed by slug alone (`guest_turn.py:30`), which
becomes a correctness break the moment a second guest exists.

**Probable fork-bomb hole:** `runtime.spawn_depth` is a contextvar the spawn
handlers increment and `_agent_tools` reads, but it is **not** a field of
`broker.TurnEnvelope` and **not** restored in `broker_dispatch`. Guest tool
calls arrive on the gateway's own task, so each brokered `spawn_agent` hop
re-reads depth as 0 and hands the child spawn tools again — `MAX_SPAWN_DEPTH`
is enforced only within one host task. The shared `Budget` *is* carried, so cost
is still fenced; the recursion fence appears not to be. **Verify before fixing.**

---

## Work packages

Each is one conversation. WP1 first — the others build on its primitives.
WP6 is independent and can run in parallel from the start.

### WP1 — Design system foundation
Add spacing, typography and radius scales as CSS custom properties beside the
existing colour tokens. Build `frontend/src/components/` with `Button`, `Card`,
`Modal`, `Input`, `Select`, `Tag`, `EmptyState`, `PageHeader`, `Toolbar` — modelled
on the markup already repeated across pages, not invented. Replace the
theme-breaking hardcoded colours. Delete the duplicate keyframes and duplicate
selectors. Delete `DiffView.jsx` and its CSS, the dead `.panel.split > aside`
rules, and the `Tools.jsx` roadmap array. Give `.panel` a real base style or
remove the class from ComputerUse. **Do not restyle pages yet** — this package
ships primitives and deletions only, and the app must look unchanged apart from
the fixed colours. Verify with `themeshot.py` in both themes.

### WP2 — Page consolidation
Split `Workspace.jsx`: panels into `frontend/src/panels/`, one file each, and
collapse `PANEL_TYPES` and the `PanelBody` switch into **one registry that
carries the component** — the two-place, 475-line-apart drift is why the
`default:` arm and the `loadLayout` filter exist. Move the layout geometry
helpers out of the page. Split `ComputerUse.jsx` (the 240-line `Setup` modal
first). Move `Chat.jsx`'s `GREETINGS` to a data file. Extract `App.jsx`'s
`VmStatus`, `GuiBridge`, `useTheme` and the FLIP controller into modules.
Unify `Chat.jsx`/`ChatBox.jsx` on one shared streaming hook. Delete the second
copy of the Host approvals card in `Network.jsx`. Move `human`/`fmtBytes`,
`SEV`/`sevClass` and `ts` into one utils module and pick one byte unit.
Adopt WP1's primitives as you touch each page. Behaviour must not change.

### WP3 — Navigation and information architecture
Fifteen flat routes, no nested layouts, no 404. Four primary links, eight behind
a `⋯` menu with **no icons at all**, and the same link set written three times
(top bar, portal rail, mobile drawer). `/projects/:slug` — the Workspace, the
most important surface in the app — **has no nav entry**. Design a real IA and a
shared page shell (today there are three shells plus four bespoke layouts, and
heading levels are arbitrary: six pages have no page-level heading). Add a 404.
Consolidate the breakpoints into tokens and remove the hardcoded 768 from
`Chat.jsx`. Verify with `navsweep.py` and `audit.py`.

### WP4 — General agents
Give a conversation an identity. Add `conversations.agent_slug` (manual
`ALTER TABLE` in `db.py:init_db`, following the existing migration style), an
`agent` field on `ChatRequest`, and a seam in `_run_chat_turn` that prepends the
AGENT.md prompt and applies `context_exclude`/`tools_exclude` — reuse
`_agent_system_prompt` and `_agent_tools`, which already take a plain dict.
The result is a project-scoped, multi-turn, stoppable, resumable agent thread
with the full tool set: what the operator described. Surface it in the Workspace
`chat` panel as an agent picker, and let a board hold several such panels.
Then close the honesty gaps: implement or remove `own_memory` and
`skills_exclude`, expose `max_iterations` in the GUI and honour it on both
paths. Add `POST /api/agents/runs/{cid}/stop` (the task handle is already in
`_active_runs`). Rework the Agents page on WP1's primitives — it is the oldest
page in the app. Fix the stale `Agent.spawn()` references in `orchestrator.py`
and `CLAUDE.md`.

### WP5 — Inter-agent communication
Design and build a real message primitive. Requirements: addressed to a
*running* turn, delivered through `broker_dispatch` so op_id pinning applies and
a compromised guest cannot forge a sender; persisted so a message survives a
reload (the chat-to-job link is ephemeral today and this must not repeat);
non-blocking, and lossy delivery must not silently drop an addressed message the
way the browser bus deliberately does. Start from `broker._envelopes` as the
registry of live turns. Expected surface: a `send_message` tool and an inbox the
receiving loop drains between iterations. Also in scope: set `parent` on
`spawn_agent`/`spawn_temp_agent` children so the run tree stops being
disconnected at the point Jarvis delegates, and persist the chat-to-job link.
**Depends on WP4** — addressing needs identity first.

### WP6 — Guest concurrency and the spawn fence
Independent of the GUI work; start it in parallel. First, **verify the
`spawn_depth` hole** described above with a test that spawns through the guest
boundary, then carry the depth in `TurnEnvelope` and restore it in
`broker_dispatch` if confirmed. Fix `nuke()` and `selftest()` tearing down under
live turns. Key `_ws_holds` by `(guest, slug)`. Then parameterise the guest so a
second instance is *possible*: a CID allocator instead of the scalar, a guest
registry instead of the module singleton, per-instance `VM_DIR` paths, a
targeted kill instead of `pkill -f`, and honour `JARVIS_VM_TAP` and a derived
MAC in `run_vm.sh`. **Do not build a warm pool and do not run more than two
guests on the Pi** — 2.4 GiB available at 768 MB each is the ceiling, and
`config.py:217-222` argues against a pool for good reasons. The goal is that
per-agent sandboxes become a config change on a host that can afford them, not
that the Pi starts running six.
