"""A second guest is now possible — and stays impossible by default.

The goal of WP6's second half is that per-agent sandboxes become a config change
on a host that can afford them, NOT that this Pi starts running six. 3.7 GiB
total, 2.4 GiB available, 768 MB per guest: two is the honest ceiling. So the
default is one, `settings.vm_guests` is the only opt-in, and every observable
thing about guest 0 — CID, file names, MAC, socket path, the `vm` object six
modules import — is byte-identical to before.

What is asserted here is the parameterisation, not a running second guest: no
KVM, no vsock and no golden image exist in CI, so booting one is unverified. The
things that CAN be checked offline are the ones that were hardcoded."""
import pytest

import backend.vm.lifecycle as lc
from backend.config import settings
from backend.guest_shell import sock_path
from backend.vm.lifecycle import GuestVM, VMError, all_guests, guest_vm, vm


@pytest.fixture(autouse=True)
def clean_registry():
    lc._guests.clear()
    yield
    lc._guests.clear()


# --- guest 0 is exactly what it was ------------------------------------------

def test_slot_zero_is_the_module_singleton():
    """Six modules import `vm` by name and tests monkeypatch it; guest_vm(0) has
    to be that same object, not a cached twin."""
    assert guest_vm(0) is vm
    assert lc.default_guest() is vm


def test_guest_zero_paths_are_unsuffixed(tmp_env, monkeypatch):
    monkeypatch.setattr(settings, "vm_dir", tmp_env / "vm")
    g = GuestVM(0)
    assert g.overlay.name == "overlay.qcow2"
    assert g.efi_vars.name == "efi_vars_run.fd"
    assert g.console_log.name == "console.log"
    assert g.cid == settings.vm_guest_cid
    assert g.tap == settings.vm_egress_tap
    assert g.mac == settings.vm_guest_mac      # the MAC dnsmasq pins its lease to
    assert sock_path(0).name == "guest-shell.sock"


# --- a second guest collides with nothing ------------------------------------

def test_guest_one_shares_no_runtime_state(tmp_env, monkeypatch):
    monkeypatch.setattr(settings, "vm_dir", tmp_env / "vm")
    a, b = GuestVM(0), GuestVM(1)
    for attr in ("overlay", "efi_vars", "console_log"):
        assert getattr(a, attr) != getattr(b, attr), attr
    assert a.cid != b.cid
    assert a.tap != b.tap
    assert a.mac != b.mac
    assert sock_path(0) != sock_path(1)


def test_the_orphan_kill_is_not_a_substring_sweep(tmp_env, monkeypatch):
    """`pkill -9 -f <overlay path>` matched the pattern anywhere in ANY process's
    command line. The scan now asks two questions — is it a qemu, does it have
    our overlay as an argument — so a shell, an editor or the other guest's qemu
    is never a candidate."""
    monkeypatch.setattr(settings, "vm_dir", tmp_env / "vm")
    a, b = GuestVM(0), GuestVM(1)
    procs = {
        1001: ("qemu-system-aarch64", ["qemu", f"file={a.overlay},if=virtio"]),
        1002: ("qemu-system-aarch64", ["qemu", f"file={b.overlay},if=virtio"]),
        1003: ("bash", ["bash", "-c", f"ls -l {a.overlay}"]),      # not a qemu
        1004: ("qemu-img", ["qemu-img", "info", str(a.overlay)]),  # not a guest
    }

    class _Entry:
        def __init__(self, pid):
            self.name = str(pid)
            self._pid = pid

        def joinpath(self, what):
            comm, args = procs[self._pid]
            return _File(comm if what == "comm" else "\0".join(args))

    class _File:
        def __init__(self, text):
            self._text = text

        def read_text(self):
            return self._text

        def read_bytes(self):
            return self._text.encode()

    class _Proc:
        def is_dir(self):
            return True

        def iterdir(self):
            return [_Entry(p) for p in procs]

    monkeypatch.setattr(lc, "Path", lambda p: _Proc() if p == "/proc" else None)
    assert a._orphan_pids() == [1001]           # only its own guest
    assert b._orphan_pids() == [1002]


# --- the ceiling holds --------------------------------------------------------

def test_default_host_runs_exactly_one_guest():
    assert settings.vm_guests == 1
    assert [g.index for g in all_guests()] == [0]
    with pytest.raises(VMError) as e:
        guest_vm(1)
    assert "vm_guests" in str(e.value)


def test_raising_the_knob_is_the_only_opt_in(monkeypatch):
    monkeypatch.setattr(settings, "vm_guests", 2)
    assert [g.index for g in all_guests()] == [0, 1]
    assert guest_vm(1).name == "guest1"
    assert guest_vm(1) is guest_vm(1)            # cached: it owns a subprocess
    with pytest.raises(VMError):
        guest_vm(2)


def test_a_second_guest_refuses_to_boot_under_monitored_egress(monkeypatch):
    """The nftables ruleset names jvtap0 in three chains and dnsmasq pins one
    lease, so a second guest would share guest 0's tap and its traffic would be
    attributed — and policed — as guest 0's. Refuse rather than get that wrong."""
    monkeypatch.setattr(settings, "vm_guests", 2)
    monkeypatch.setattr(settings, "vm_egress", True)
    guest_vm(0)._check_egress_ceiling()          # guest 0 is fine
    with pytest.raises(VMError) as e:
        guest_vm(1)._check_egress_ceiling()
    assert "egress" in str(e.value)
    monkeypatch.setattr(settings, "vm_egress", False)
    guest_vm(1)._check_egress_ceiling()          # netless: two guests are fine


# --- the boot environment carries every per-guest value ----------------------

def test_run_vm_env_names_every_parameterised_value(tmp_env, monkeypatch):
    """vm/run_vm.sh ignored JARVIS_VM_TAP even though the host exported it and
    net_up.sh honoured it. Anything the host varies per guest must arrive in the
    child env AND be read by the script."""
    import pathlib
    monkeypatch.setattr(settings, "vm_guests", 2)
    monkeypatch.setattr(settings, "vm_dir", tmp_env / "vm")
    g = GuestVM(1)
    script = (pathlib.Path(__file__).resolve().parents[1] / "vm/run_vm.sh").read_text()
    for var, value in (("JARVIS_VM_CID", str(g.cid)),
                       ("JARVIS_VM_OVERLAY", g.overlay.name),
                       ("JARVIS_VM_EFI_VARS", g.efi_vars.name),
                       ("JARVIS_VM_CONSOLE", g.console_log.name),
                       ("JARVIS_VM_TAP", g.tap),
                       ("JARVIS_VM_MAC", g.mac)):
        assert f"${{{var}:-" in script, f"run_vm.sh never reads {var}"
        assert value                              # the host has a value to pass
    # ...and none of the old literals are still baked in
    assert "ifname=jvtap0" not in script
    assert "mac=52:54:00:12:34:60" not in script
    assert "file=overlay.qcow2" not in script
    assert "serial file:console.log" not in script


# --- the operator surface addresses guests by index --------------------------

@pytest.fixture
async def client(tmp_env):
    import httpx
    from backend.auth import hash_password
    from backend.db import get_db, init_db
    from backend.main import app
    from backend.memory import ensure_memory_seeds
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


async def test_status_defaults_to_guest_zero(client):
    r = await client.get("/api/vm/status")
    assert r.status_code == 200
    assert r.json()["guest"] == 0 and r.json()["cid"] == settings.vm_guest_cid


async def test_guests_listing_matches_the_configured_count(client, monkeypatch):
    assert len((await client.get("/api/vm/guests")).json()) == 1
    monkeypatch.setattr(settings, "vm_guests", 2)
    listing = (await client.get("/api/vm/guests")).json()
    assert [g["guest"] for g in listing] == [0, 1]
    assert listing[1]["cid"] == settings.vm_guest_cid + 1


async def test_an_unconfigured_slot_is_a_404_not_a_silent_guest_zero(client):
    r = await client.get("/api/vm/status?guest=1")
    assert r.status_code == 404
    r = await client.post("/api/vm/nuke", json={"confirm": True, "guest": 4})
    assert r.status_code == 404
