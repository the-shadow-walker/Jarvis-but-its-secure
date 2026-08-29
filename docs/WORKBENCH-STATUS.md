# Workbench status — handoff record

Branch `agent-workbench`, 28 commits ahead of `main`, a clean fast-forward
(main is a direct ancestor — promoting is `git checkout main && git merge --ff-only agent-workbench`).
1006 tests passing. Frontend builds clean on the Pi. Verified from real screenshots, both themes.

## Done and merged into agent-workbench (6 of 6 packages)

| Package | Branch | What landed |
|---|---|---|
| Design system | `wb/design-system` | spacing/type/radius tokens, 9 components, colour-fixes, dead-code deletion |
| Guest concurrency | `wb/guest-concurrency` | **fork-bomb fence closed** (was open across the broker hop), nuke/teardown/selftest refuse under live turns, multi-guest parameterised (default 1, egress refuses a 2nd) |
| General agents | `wb/general-agents` | `conversations.agent_slug` — an agent is a chat with a name; own_memory removed, skills_exclude/max_iterations honoured; agent-run stop endpoint |
| Inter-agent comms | `wb/agent-comms` | `send_message`/`inbox_fetch` over an `agent_messages` table, drained between loop iterations; run tree reconnected |
| Navigation | `wb/navigation` | one nav source, grouped IA, 404, page shell, lazy routes (**bundle 727kB→298kB**) |
| Consolidation | `wb/consolidation` | Workspace 1643→341, ComputerUse 807→267, App 577→229; one panel registry; unified chat hook; also fixed a LIVE OrganizerPanel crash |

## Merged and verified: `wb/comms-fixes`

Fixes for the three defects the verification agent found in the comms work, all
independently re-verified before merge (op_id fix falsified both ways; migration
tested against a copy of the live 376-conversation DB):

1. **SECURITY: op_id substitution — FIXED.** A guest could borrow another live
   turn's identity (and its project pin, web_session, artifact_slug, Budget) via
   a guessable op_id the gateway only checked for existence. Now bound to the
   turn with a per-turn capability token (`op_token`, 192-bit, `compare_digest`,
   fails closed). Honest limit: stops op_id *guessing*, not a guest that can
   already read another turn's task-local state.
2. **Slug addressing — FIXED.** `agents_run` now passes `agent=`, so
   spawned/scheduled/interactive runs are addressable; temp agents stay NULL.
3. **Incognito send — FIXED.** Refused (send dropped from the ephemeral tool
   set); by-id refusal closed at the source of truth via a new
   `conversations.ephemeral` column that outlives the envelope and dies with the
   row. Two sibling bugs also fixed (by-id accept-destroy, delete destroying
   sent messages).

CONFIRMED-good by verification: fork-bomb fix (falsified both ways),
taint-on-receive, VM busy-guards, own_memory removal, migration safety against
a copy of the live 375-conversation DB, the atomic message claim.

## Known-but-unfixed, lower priority (from verification)

- Chat's only `<h1>` is inside the empty-state branch — an open conversation
  (the app's normal state) renders zero page headings.
- Live DB already carries 23 pre-existing FK violations (orphan runs/messages);
  harmless now, but any future table rebuild trips on them.
- ComputerUse still has its own `.cu-head`/`.cu-page .panel` CSS after the
  shared page-header rules — a follow-up restyle, not a refactor.

## Sequencing with the jav3 rebrand

`rebrand jarvis to jav3` is holding until this lands on `main`. Its scripts are
at `/home/claude/rename-jav3/`; it re-runs them over post-overhaul `main` rather
than merging its stale commit (which predates ~24 new files incl. install.sh).
`CLAUDE.md` and `BACKLOG.md` are gitignored — the rebrand can't touch them; they
need a manual pass. The `JARVIS_` env prefix, `jarvis` service name and DB path
are deliberately NOT renamed (deploy-breaking); identity strings only.

## To promote when ready

1. Finish + verify `wb/comms-fixes`, merge into `agent-workbench`.
2. `git checkout main && git merge --ff-only agent-workbench && git push`.
3. Deploy to the Pi (guard against in-flight jobs first — see CLAUDE.md).
4. Tell the rebrand session main is ready.
