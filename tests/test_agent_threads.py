"""General agents: a chat thread that runs AS an agent.

The operator's ask was "agents that live in a project and help me build
things, like a Claude Code session". That is the chat path plus an identity —
NOT a second runtime — so these tests pin the seam rather than the machinery:
a conversation carries `agent_slug`, the turn assembles the AGENT.md prompt
ahead of the shared context, the definition's exclusions trim the tools the
project already allowed, and the identity does not drift across turns.

Offline: `chat.guest_turn` and `agents_run.run_agent_turn` are substituted, so
nothing here needs an API key.
"""
import asyncio
import contextlib

import httpx
import pytest

from backend.auth import hash_password
from backend.db import get_db, init_db
from backend.main import app
from backend.memory import ensure_memory_seeds


@pytest.fixture
async def client(tmp_env):
    await init_db()
    ensure_memory_seeds()
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            ("operator", hash_password("hunter2")))
        await db.commit()
    finally:
        await db.close()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        await c.post("/api/auth/login",
                     json={"username": "operator", "password": "hunter2"})
        yield c


def _capturing_turn(seen: list[dict]):
    """Stand-in for the guest loop that records the turn spec it was handed."""
    async def turn(cid, system_prompt, history, **kw):
        seen.append({"system_prompt": system_prompt, "history": history, **kw})
        yield {"type": "final", "content": "ok"}
    return turn


async def _settle():
    """Wait for the detached turn task to finish unwinding.

    POST /api/chat returns as soon as its SSE tail sees `final`, but the turn's
    `finally` — which closes the turn's DB handle — runs after that. Ending a
    test in that window strands an aiosqlite worker thread on a closed event
    loop, and a stranded non-daemon thread hangs the interpreter at exit. The
    handle is closed before the conversation leaves `_active_turns`, so
    draining that dict is the deterministic wait.
    """
    from backend import chat as chat_mod
    for _ in range(600):
        if not chat_mod._active_turns:
            return
        await asyncio.sleep(0.005)     # the close hops a worker thread: real time
    raise AssertionError("a chat turn never finished")


async def _make_agent(client, **fields):
    await client.post("/api/agents", json={"name": "Builder"})
    a = (await client.get("/api/agents/builder")).json()
    a.update({"prompt": "You are Builder. You build things.", **fields})
    assert (await client.put("/api/agents/builder", json=a)).status_code == 200
    return a


async def test_chat_thread_runs_as_the_agent(client, monkeypatch):
    """The whole feature in one turn: identity is stored on the conversation,
    the AGENT.md prompt leads the sandwich, and the definition's exclusions
    take tools away — including via skills_exclude, which bit nothing before
    (skills compile into the same registry as tools)."""
    from backend import chat as chat_mod
    await _make_agent(client, tools_exclude=["web_search"],
                      skills_exclude=["web_read"], max_iterations=9)
    seen: list[dict] = []
    monkeypatch.setattr(chat_mod, "guest_turn", _capturing_turn(seen))

    r = await client.post("/api/chat", json={"message": "hello",
                                             "confirm_peak": True,
                                             "agent": "builder"})
    assert r.status_code == 200
    await _settle()
    assert len(seen) == 1
    spec = seen[0]

    # the agent's prompt leads, the shared context follows
    assert spec["system_prompt"].startswith("You are Builder. You build things.")
    # ...and the operator's rules tail is still there: an agent definition
    # cannot opt out of them
    assert "operator" in spec["system_prompt"].lower()

    names = {t["function"]["name"] for t in spec["tool_specs"]}
    assert "web_search" not in names          # tools_exclude
    assert "web_read" not in names            # skills_exclude, same namespace
    assert "read_file" in names               # everything else still granted
    assert spec["max_iterations"] == 9

    db = await get_db()
    try:
        async with db.execute(
            "SELECT agent_slug, kind FROM conversations") as cur:
            row = await cur.fetchone()
    finally:
        await db.close()
    assert row["agent_slug"] == "builder"
    # deliberately an ordinary chat: it belongs in the chat sidebar, gets
    # compaction, and is stoppable/resumable through the chat endpoints
    assert row["kind"] == "chat"
    listed = (await client.get("/api/conversations")).json()["conversations"]
    assert [c["agent_slug"] for c in listed] == ["builder"]


async def test_plain_chat_is_untouched(client, monkeypatch):
    """No agent = central Jarvis, exactly as before."""
    from backend import chat as chat_mod
    await _make_agent(client, tools_exclude=["web_search"])
    seen: list[dict] = []
    monkeypatch.setattr(chat_mod, "guest_turn", _capturing_turn(seen))

    r = await client.post("/api/chat", json={"message": "hi", "confirm_peak": True})
    assert r.status_code == 200
    await _settle()
    assert not seen[0]["system_prompt"].startswith("You are Builder")
    assert seen[0]["max_iterations"] is None
    names = {t["function"]["name"] for t in seen[0]["tool_specs"]}
    assert "web_search" in names


async def test_identity_is_pinned_and_multi_turn(client, monkeypatch):
    """A thread's identity binds at creation and cannot be swapped underneath
    the transcript — and the follow-up is a real second turn, with the first
    exchange in its history."""
    from backend import chat as chat_mod
    await _make_agent(client)
    seen: list[dict] = []
    monkeypatch.setattr(chat_mod, "guest_turn", _capturing_turn(seen))

    r = await client.post("/api/chat", json={"message": "first",
                                             "confirm_peak": True,
                                             "agent": "builder"})
    assert r.status_code == 200
    await _settle()
    cid = None
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM conversations") as cur:
            cid = (await cur.fetchone())["id"]
    finally:
        await db.close()

    # a second message naming a DIFFERENT agent must not re-cast the thread
    await client.post("/api/agents", json={"name": "Other"})
    r = await client.post("/api/chat", json={"message": "second",
                                             "conversation_id": cid,
                                             "confirm_peak": True,
                                             "agent": "other"})
    assert r.status_code == 200
    await _settle()
    assert len(seen) == 2
    assert seen[1]["system_prompt"].startswith("You are Builder")
    # multi-turn: the earlier exchange rides along (this is what the one-shot
    # agent run path never had)
    assert any(m.get("content") == "first" for m in seen[1]["history"])


async def test_unknown_agent_is_a_404_not_a_dead_thread(client):
    r = await client.post("/api/chat", json={"message": "hi", "confirm_peak": True,
                                             "agent": "nope"})
    assert r.status_code == 404
    db = await get_db()
    try:
        async with db.execute("SELECT COUNT(*) AS c FROM conversations") as cur:
            assert (await cur.fetchone())["c"] == 0   # no orphan row
    finally:
        await db.close()


async def test_agent_run_stop(client, monkeypatch):
    """Agents never had a stop endpoint even though _active_runs held the task
    handle. Cancelling must also leave the interruption in the transcript, the
    way a stopped chat turn does."""
    from backend import agents_run, chat as chat_mod
    await _make_agent(client)
    release = asyncio.Event()
    started = asyncio.Event()

    async def blocking_turn(cid, system_prompt, history, **kw):
        started.set()
        await release.wait()
        yield {"type": "final", "content": "never"}

    monkeypatch.setattr(agents_run, "run_agent_turn", blocking_turn)
    post = asyncio.create_task(client.post(
        "/api/agents/builder/run", json={"task": "go", "confirm_peak": True}))
    await asyncio.wait_for(started.wait(), 5)
    cid = max(agents_run._active_runs)
    task = agents_run._active_runs[cid]

    r = await client.post(f"/api/agents/runs/{cid}/stop")
    assert r.json() == {"stopped": True}
    with contextlib.suppress(asyncio.CancelledError):
        await task            # let the run unwind before reading its transcript
    assert cid not in agents_run._active_runs
    assert (await client.post(f"/api/agents/runs/{cid}/stop")).json() == {"stopped": False}

    msgs = (await client.get(f"/api/conversations/{cid}/messages")).json()["messages"]
    assert msgs[-1]["content"] == chat_mod.INTERRUPTED_MARKER

    release.set()
    post.cancel()
    with contextlib.suppress(asyncio.CancelledError, httpx.HTTPError):
        await post


async def test_interactive_run_honours_max_iterations(client, monkeypatch):
    """max_iterations was read on the headless path and ignored here, so one
    definition ran two different caps depending on who started it."""
    from backend import agents_run
    await _make_agent(client, max_iterations=5)
    seen: list[dict] = []
    release, started = asyncio.Event(), asyncio.Event()

    async def turn(cid, system_prompt, history, **kw):
        seen.append(kw)
        started.set()
        await release.wait()
        yield {"type": "final", "content": "done"}

    monkeypatch.setattr(agents_run, "run_agent_turn", turn)
    post = asyncio.create_task(client.post(
        "/api/agents/builder/run", json={"task": "go", "confirm_peak": True}))
    await asyncio.wait_for(started.wait(), 5)
    task = agents_run._active_runs[max(agents_run._active_runs)]
    release.set()
    await task                 # deterministic: the run closes its DB handle here
    assert (await post).status_code == 200
    assert seen[0]["max_iterations"] == 5


async def test_interactive_run_sets_agent_slug(client, monkeypatch):
    """WP5 addressing needs every agent RUN to carry its identity, not just the
    chat path. `_run_headless` was covered; the interactive endpoint
    (POST /api/agents/{slug}/run) opened its conversation without `agent=`, so
    an interactive run was unaddressable by name and a message to it was told
    the opposite of the truth. Regression guard for agents_run.run_agent."""
    from backend import agents_run
    await _make_agent(client)
    release = asyncio.Event()
    started = asyncio.Event()

    async def blocking_turn(cid, system_prompt, history, **kw):
        started.set()
        await release.wait()
        yield {"type": "final", "content": "done"}

    monkeypatch.setattr(agents_run, "run_agent_turn", blocking_turn)
    post = asyncio.create_task(client.post(
        "/api/agents/builder/run", json={"task": "go", "confirm_peak": True}))
    try:
        await asyncio.wait_for(started.wait(), 5)
        cid = max(agents_run._active_runs)
        db = await get_db()
        try:
            async with db.execute(
                "SELECT agent_slug FROM conversations WHERE id = ?", (cid,)) as cur:
                assert (await cur.fetchone())["agent_slug"] == "builder", (
                    "an interactive agent run has no identity, so send_message "
                    "cannot address it by name")
        finally:
            await db.close()
    finally:
        release.set()
        task = agents_run._active_runs.get(max(agents_run._active_runs, default=0))
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        with contextlib.suppress(asyncio.CancelledError, httpx.HTTPError):
            await post


async def test_ephemeral_chat_is_not_offered_send_message(client, monkeypatch):
    """send_message has no `requires_project`, so it survived the ephemeral tool
    filter and was offered to an incognito turn that can only ever be refused
    when it calls it. It is dropped from the tool set now (chat.py), so the model
    is not invited to promise a message it cannot send. Asserts ABSENCE, not
    present-but-erroring."""
    from backend import chat as chat_mod
    seen: list[dict] = []
    monkeypatch.setattr(chat_mod, "guest_turn", _capturing_turn(seen))

    r = await client.post("/api/chat", json={"message": "hi", "ephemeral": True})
    assert r.status_code == 200
    await _settle()
    assert len(seen) == 1
    names = {t["function"]["name"] for t in seen[0]["tool_specs"]}
    assert "send_message" not in names, (
        "an incognito turn was handed send_message, which its own handler "
        "refuses — a tool that can only error should not be offered")
    # a persistent chat still gets it, so the filter is scoped to incognito
    seen.clear()
    r = await client.post("/api/chat", json={"message": "hi"})
    assert r.status_code == 200
    await _settle()
    names = {t["function"]["name"] for t in seen[0]["tool_specs"]}
    assert "send_message" in names
