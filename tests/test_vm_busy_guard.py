"""Destructive lifecycle ops must not tear the guest down under live turns.

`nuke()` took `_lock` but never looked at `_inflight`, and `selftest()` called
`boot()` unlocked and `teardown()` in a `finally` regardless — so hitting
POST /api/vm/selftest from the VM widget killed every turn running in the guest,
and nuke's only guard was a client-side check of a polled status field.

The policy is REFUSE, not wait: these are operator buttons, a research job can
hold the guest for many minutes, and a request that hangs unboundedly with no
feedback is worse than one that says what is running. `force: true` stays, so a
leaked refcount can never make the guest permanently un-nukeable.

Offline — boot/teardown are stubbed, as in test_phase4_scrub."""
import httpx
import pytest

import backend.vm.lifecycle as lc
from backend.auth import hash_password
from backend.db import get_db, init_db
from backend.main import app
from backend.memory import ensure_memory_seeds
from backend.vm.lifecycle import GuestVM, VMBusy


class _FakeProc:
    returncode = None


def _stub(monkeypatch, vm, calls):
    async def fake_boot():
        vm._proc = _FakeProc()
        vm._booted_at = 1000.0
        calls.append("boot")

    async def fake_teardown():
        vm._proc = None
        calls.append("teardown")

    async def fake_ensure_locked():
        if not vm.running():
            await fake_boot()
    monkeypatch.setattr(vm, "boot", fake_boot)
    monkeypatch.setattr(vm, "teardown", fake_teardown)
    monkeypatch.setattr(vm, "_ensure_ready_locked", fake_ensure_locked)
    return calls


# --- unit: the guard itself ---------------------------------------------------

async def test_nuke_refuses_while_a_turn_holds_the_guest(monkeypatch):
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    await vm.acquire()
    with pytest.raises(VMBusy) as e:
        await vm.nuke()
    assert "1 turn(s)" in str(e.value)
    assert calls == ["boot"]                     # nothing was torn down
    assert vm.running()


async def test_nuke_proceeds_once_the_turn_is_done(monkeypatch):
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    await vm.acquire()
    vm.release()
    await vm.nuke()
    assert calls == ["boot", "teardown", "boot"]


async def test_force_is_the_escape_hatch(monkeypatch):
    """A turn whose release never ran must not wedge the guest forever."""
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    await vm.acquire()
    await vm.nuke(force=True)
    assert calls == ["boot", "teardown", "boot"]


async def test_shutdown_refuses_while_busy(monkeypatch):
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    await vm.acquire()
    with pytest.raises(VMBusy):
        await vm.shutdown()
    assert "teardown" not in calls
    await vm.shutdown(force=True)
    assert "teardown" in calls


async def test_selftest_refuses_while_busy(monkeypatch):
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    monkeypatch.setattr(lc, "base_built", lambda: True)
    monkeypatch.setattr(lc.gateway, "enabled", True)
    await vm.acquire()
    with pytest.raises(VMBusy):
        await vm.selftest()
    # the old code booted, ran, then tore down in a finally — none of that here
    assert calls == ["boot"]


async def test_selftest_leaves_a_turn_that_arrived_mid_test_alone(monkeypatch):
    """The refusal is only half of it: a turn can start while the selftest runs,
    and the unconditional teardown in the finally would still have killed it."""
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    monkeypatch.setattr(lc, "base_built", lambda: True)
    monkeypatch.setattr(lc.gateway, "enabled", True)
    monkeypatch.setattr(vm, "_isolation", lambda: {})

    async def fake_guest_turn(**kw):
        await vm.acquire()                       # a real turn slips in
        yield {"type": "final", "content": "PONG"}
    import backend.vm.guest_turn as gt
    monkeypatch.setattr(gt, "guest_turn", fake_guest_turn)

    out = await vm.selftest()
    assert out["reply"] == "PONG"
    assert "teardown" not in calls               # the arrived turn keeps the guest
    vm.release()


async def test_selftest_tears_down_when_the_guest_is_free(monkeypatch):
    vm = GuestVM()
    calls = _stub(monkeypatch, vm, [])
    monkeypatch.setattr(lc, "base_built", lambda: True)
    monkeypatch.setattr(lc.gateway, "enabled", True)
    monkeypatch.setattr(vm, "_isolation", lambda: {})

    async def fake_guest_turn(**kw):
        yield {"type": "final", "content": "PONG"}
    import backend.vm.guest_turn as gt
    monkeypatch.setattr(gt, "guest_turn", fake_guest_turn)

    out = await vm.selftest()
    assert out["reply"] == "PONG"
    assert calls == ["boot", "teardown"]


# --- API: the operator's buttons ---------------------------------------------

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


@pytest.fixture
def busy_vm(monkeypatch):
    """The app's guest, stubbed and holding one turn."""
    calls = _stub(monkeypatch, lc.vm, [])
    monkeypatch.setattr(lc, "base_built", lambda: True)
    monkeypatch.setattr(lc.gateway, "enabled", True)
    monkeypatch.setattr(lc.vm, "_inflight", 1)
    yield calls
    monkeypatch.setattr(lc.vm, "_inflight", 0)


async def test_api_nuke_is_a_409_while_busy(client, busy_vm):
    r = await client.post("/api/vm/nuke", json={"confirm": True})
    assert r.status_code == 409
    assert "in the guest" in r.json()["detail"]
    assert busy_vm == []


async def test_api_selftest_is_a_409_while_busy(client, busy_vm):
    r = await client.post("/api/vm/selftest")
    assert r.status_code == 409
    assert busy_vm == []                         # not even booted


async def test_api_teardown_is_a_409_while_busy(client, busy_vm):
    r = await client.post("/api/vm/teardown")
    assert r.status_code == 409
    assert busy_vm == []


async def test_api_force_overrides(client, busy_vm):
    r = await client.post("/api/vm/nuke", json={"confirm": True, "force": True})
    assert r.status_code == 200
    assert busy_vm == ["teardown", "boot"]
