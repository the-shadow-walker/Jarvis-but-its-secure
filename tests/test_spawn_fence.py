"""The fork-bomb fence across the host<->guest boundary (WP6).

`autonomy.MAX_SPAWN_DEPTH` is enforced in exactly one place: `_agent_tools`
reads `runtime.spawn_depth` and hands the child `spawn_agent` back only below
the cap. The spawn handlers increment that contextvar around the child's run.

A contextvar only propagates within one asyncio task. Every guest tool call
arrives on the GATEWAY's task (`VsockGateway._serve` creates it; its context is
the app lifespan's, not the turn's), so the depth reaches a brokered
`spawn_agent` only if `broker.TurnEnvelope` carries it and `broker_dispatch`
restores it — exactly how web_session / active_project / ephemeral already
travel.

These tests pin both halves: the producer (`vm/turn.py` must stamp the ambient
depth onto the envelope) and the consumer (`broker_dispatch` must restore it),
and then the property that actually matters — a chain of brokered spawns
terminates instead of recursing forever.

The gateway task is created with a FRESH `contextvars.Context()` here, because
that is what production does and a naive `create_task` from the test's own
context would copy the depth in and make a broken fence look fixed.
"""
import asyncio
import contextvars
import json
import socket

import pytest

from backend import agents_run, autonomy, runtime
from backend.vm import broker
from backend.vm.gateway_server import handle_conn

MAXD = autonomy.MAX_SPAWN_DEPTH


def _names(specs):
    return {s["function"]["name"] for s in specs}


async def _gateway_call(op_id: str, name: str, args: dict) -> str:
    """One `tool_broker_call` the way a guest makes it: over a socket, served on
    a task that does NOT inherit the caller's context."""
    loop = asyncio.get_running_loop()
    a, b = socket.socketpair()
    a.setblocking(False)
    b.setblocking(False)
    server = asyncio.create_task(handle_conn(loop, b),
                                 context=contextvars.Context())
    try:
        await loop.sock_sendall(a, (json.dumps(
            {"op": "tool_broker_call", "op_id": op_id, "name": name,
             "args": args}) + "\n").encode())
        data = b""
        while b"\n" not in data:
            chunk = await asyncio.wait_for(loop.sock_recv(a, 65536), timeout=10)
            if not chunk:
                break
            data += chunk
        return json.loads(data.split(b"\n", 1)[0])
    finally:
        a.close()
        await asyncio.wait_for(server, timeout=5)


# --- the consumer half: broker_dispatch restores the depth --------------------

async def test_broker_restores_spawn_depth(monkeypatch):
    """A tool brokered for a turn that is already N hops deep must see N."""
    from backend.agent.tools import registry

    seen = {}

    async def fake_dispatch(name, args):
        seen["depth"] = runtime.spawn_depth.get()
        return "ok"
    monkeypatch.setattr(registry, "dispatch", fake_dispatch)

    broker.register_turn(broker.TurnEnvelope(op_id="op-deep", spawn_depth=1))
    try:
        out = await _gateway_call("op-deep", "anything", {})
    finally:
        broker.release_turn("op-deep")
    assert out["type"] == "broker_result" and out["result"] == "ok"
    assert seen["depth"] == 1, (
        "the guest's tool call landed on the gateway task with spawn_depth "
        f"{seen['depth']} instead of the turn's 1 — MAX_SPAWN_DEPTH is only "
        "enforced within one host task, so every brokered spawn_agent hop "
        "restarts the count and the fork-bomb fence never trips")
    # and it is torn back down, like every other envelope var
    assert runtime.spawn_depth.get() == 0


# --- the producer half: run_agent_turn stamps the ambient depth ---------------

async def test_child_turn_envelope_carries_the_depth(monkeypatch):
    """A child run started from inside a brokered spawn builds its own turn
    envelope. If that envelope drops the depth, the child's guest gets a clean
    slate and the chain never ends — this is the key the AST parity test for the
    guest SPEC cannot see, because it travels host-side."""
    from backend.vm import guest_turn as gt_mod
    from backend.vm.turn import run_agent_turn

    captured = {}

    async def fake_guest_turn(cid, sysp, hist, **kw):
        captured["envelope"] = kw.get("envelope")
        yield {"type": "final", "content": ""}
    monkeypatch.setattr(gt_mod, "guest_turn", fake_guest_turn)

    tok = runtime.spawn_depth.set(1)
    try:
        async for _ in run_agent_turn(0, "sys", [], tools=[]):
            pass
    finally:
        runtime.spawn_depth.reset(tok)
    assert captured["envelope"].spawn_depth == 1


# --- the property that matters: the chain terminates --------------------------

async def _run_spawn_chain(monkeypatch, tmp_env, limit=12):
    """Simulate the real chain with the real fence pieces in place:

        host turn -> guest brokers spawn_agent -> the REAL handler increments
        the depth -> a child agent run builds its tool set from the depth it
        can see -> its own guest turn brokers spawn_agent -> ...

    Only the transport and the model are faked; `_agent_tools`, the spawn
    handler, `broker_dispatch`, the gateway and `run_agent_turn`'s envelope are
    all the production code. Returns the depth seen at each hop."""
    from backend.agent import budget as bmod
    from backend.db import init_db
    from backend.vm import guest_turn as gt_mod
    from backend.vm.turn import run_agent_turn

    await init_db()
    depths, cid = [], [100]

    async def fake_guest_turn(conversation_id, system_prompt, history, **kw):
        """Stands in for the guest: registers the envelope host-side (as the
        real guest_turn does), then, if the turn was handed spawn tools, makes
        one brokered spawn_agent call the way the guest would."""
        env, op_id = kw.get("envelope"), kw.get("op_id")
        broker.register_turn(env)
        try:
            if "spawn_agent" in _names(kw.get("tool_specs") or []):
                if len(depths) < limit:
                    await _gateway_call(op_id, "spawn_agent",
                                        {"agent": "worker", "task": "go"})
            yield {"type": "final", "content": "done"}
        finally:
            broker.release_turn(op_id)
    monkeypatch.setattr(gt_mod, "guest_turn", fake_guest_turn)

    async def fake_headless(slug, task, active=agents_run._USE_DB):
        """`_run_headless` minus the DB/prompt work: the two things that matter
        are the depth its tool set is built from and that its turn runs in the
        guest."""
        depths.append(runtime.spawn_depth.get())
        tools = agents_run._agent_tools({})
        cid[0] += 1
        async for _ in run_agent_turn(cid[0], "sys", [], tools=tools):
            pass
        return {"conversation_id": cid[0], "agent": slug, "final": "done"}
    monkeypatch.setattr(agents_run, "run_agent_headless", fake_headless)

    bmod.register("op-root", bmod.Budget(10**9, 10**9))
    try:
        async for _ in run_agent_turn(cid[0], "sys", [],
                                      tools=agents_run._agent_tools({})):
            pass
    finally:
        bmod.release("op-root")
    return depths


async def test_brokered_spawn_chain_hits_the_cap(monkeypatch, tmp_env):
    depths = await _run_spawn_chain(monkeypatch, tmp_env)
    assert depths, "the root turn never spawned — the simulation is not running"
    assert depths == list(range(1, MAXD + 1)), (
        f"brokered spawn depths were {depths}; expected each hop to see one "
        f"more than the last and the chain to stop at MAX_SPAWN_DEPTH={MAXD}. "
        "A flat sequence means every hop re-read the depth as 0 and handed the "
        "child spawn tools again — unbounded recursion, fenced only by cost.")


async def test_spawn_tools_are_dropped_at_the_cap_over_the_broker(monkeypatch,
                                                                  tmp_env):
    """The same fence, asserted from the child's side: a brokered spawn made by
    a turn already at MAXD-1 must produce a leaf agent."""
    from backend.db import init_db

    await init_db()
    seen = {}

    async def fake_headless(slug, task, active=agents_run._USE_DB):
        seen["names"] = _names(agents_run._agent_tools({}))
        return {"conversation_id": 1, "agent": slug, "final": "done"}
    monkeypatch.setattr(agents_run, "run_agent_headless", fake_headless)

    broker.register_turn(broker.TurnEnvelope(op_id="op-cap",
                                             spawn_depth=MAXD - 1))
    try:
        await _gateway_call("op-cap", "spawn_agent",
                            {"agent": "worker", "task": "go"})
    finally:
        broker.release_turn("op-cap")
    assert "spawn_agent" not in seen["names"]
    assert "spawn_temp_agent" not in seen["names"]


@pytest.mark.parametrize("depth,leaf", [(0, False), (MAXD - 1, False),
                                        (MAXD, True)])
def test_agent_tools_fence_reads_the_restored_depth(depth, leaf):
    """Pins the one place the cap is enforced, so a refactor that moves the
    check has to come here first."""
    tok = runtime.spawn_depth.set(depth)
    try:
        names = _names(agents_run._agent_tools({}))
    finally:
        runtime.spawn_depth.reset(tok)
    assert ("spawn_agent" not in names) is leaf
