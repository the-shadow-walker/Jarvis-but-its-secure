"""App-owned lifecycle for the disposable guest VM.

The FastAPI app boots QEMU as a subprocess in its own process group (so teardown
kills the whole tree), running a qcow2 overlay on the read-only golden image with
a vhost-vsock channel and NO network device. A guest dies with the app — fine, it
is disposable; nothing durable lives inside. No systemd (that was the old
persistent model); the app owns the guest, which is the path to the per-turn /
pooled guests of Phase 3.
"""
import asyncio
import os
import re
import signal
import socket
import time
from pathlib import Path

from ..config import settings
from .gateway_server import gateway


class VMError(Exception):
    pass


class VMBusy(VMError):
    """A destructive lifecycle op was asked for while turns hold the guest.

    REFUSE rather than wait, deliberately. These are operator actions from the VM
    widget, and a turn can hold the guest for many minutes (a research job, a
    long agent run) — waiting would hang the HTTP request with no bound and no
    feedback, and the operator would not know why. Refusing names what is running
    and hands the decision back, the same shape as the deploy guard's in-flight
    check. `force` is the escape hatch: a leaked refcount (a turn whose release
    never ran) must not make the guest permanently un-nukeable."""


_VERSION_RE = re.compile(r"base-v(\d+)\.qcow2$")


def _base_image() -> Path:
    """The active golden image: the HIGHEST base-v<N>.qcow2 present, so a rebuild
    (which creates the next version, never mutating in place) auto-activates on
    the next guest boot. Falls back to the configured version when none exist."""
    versions = [(int(m.group(1)), p) for p in settings.vm_dir.glob("base-v*.qcow2")
                if (m := _VERSION_RE.search(p.name))]
    if versions:
        return max(versions)[1]
    return settings.vm_dir / f"base-{settings.vm_image_version}.qcow2"


def _active_version() -> str:
    m = _VERSION_RE.search(_base_image().name)
    return f"v{m.group(1)}" if m else settings.vm_image_version


def _next_version() -> int:
    versions = [int(m.group(1)) for p in settings.vm_dir.glob("base-v*.qcow2")
                if (m := _VERSION_RE.search(p.name))]
    return (max(versions) if versions else 0) + 1


def _image_meta() -> dict:
    """Wall-clock build time + age of the active image (its file mtime), and
    whether it is past vm_image_max_age_days — the VM widget's amber signal."""
    p = _base_image()
    if not p.exists():
        return {"image_built_at": None, "image_age_days": None, "image_stale": False}
    import datetime
    built = datetime.datetime.fromtimestamp(p.stat().st_mtime)
    age = (datetime.datetime.now() - built).total_seconds() / 86400
    return {"image_built_at": built.isoformat(timespec="seconds"),
            "image_age_days": round(age, 1),
            "image_stale": age > settings.vm_image_max_age_days}


def base_built() -> bool:
    return _base_image().exists()


def _console_log(index: int = 0) -> Path:
    return settings.vm_dir / _suffixed("console.log", index)


def _suffixed(name: str, index: int) -> str:
    """Per-guest runtime file name. Guest 0 keeps the bare name, so an existing
    install's overlay.qcow2 / efi_vars_run.fd / console.log — and every script,
    log-tail habit and orphan-kill pattern built around them — are unchanged.
    Guest N gets `overlay-g1.qcow2` and friends. The golden base images stay
    shared and read-only, which is why this suffixes files rather than giving
    each guest its own VM_DIR: a per-guest dir would mean copying a multi-GB
    image per sandbox."""
    if not index:
        return name
    stem, dot, ext = name.partition(".")
    return f"{stem}-g{index}{dot}{ext}"


_REPLY_RE = re.compile(r"GUEST-SELFTEST-REPLY: '(.*?)'")
_ERROR_RE = re.compile(r"GUEST-SELFTEST-(?:ERROR|CRASH): (.*)")
_IFACES_RE = re.compile(r"GUEST-NET-IFACES: (\[.*?\])")
_EXTERNAL_RE = re.compile(r"GUEST-NET-EXTERNAL-REACHABLE: (True|False)")


class GuestVM:
    """One sandbox guest. `index` is its slot: 0 is THE guest — the one every
    existing caller means, with today's CID, file names and behaviour unchanged.
    A host configured for more gets 1, 2, ... each with its own CID and its own
    overlay/console/EFI files, so nothing about a second instance is implicit."""

    def __init__(self, index: int = 0):
        self.index = index
        self.name = f"guest{index}"
        self._proc: asyncio.subprocess.Process | None = None
        # lifecycle transitions (boot/teardown/reap) are serialized so the idle
        # reaper can never nuke a guest a turn is starting on, and two turns never
        # double-boot. `_inflight` counts turns holding the guest; `_idle_since`
        # is when it last fell to zero (the reaper's clock).
        self._lock = asyncio.Lock()
        self._inflight = 0
        self._idle_since: float | None = None
        self._booted_at: float | None = None
        self._rebuilding = False

    @property
    def cid(self) -> int:
        """This guest's vsock CID. A property, not a snapshot, so tests and the
        env-file config keep working by moving settings.vm_guest_cid."""
        return settings.vm_guest_cid + self.index

    @property
    def overlay(self) -> Path:
        return settings.vm_dir / _suffixed("overlay.qcow2", self.index)

    @property
    def efi_vars(self) -> Path:
        return settings.vm_dir / _suffixed("efi_vars_run.fd", self.index)

    @property
    def console_log(self) -> Path:
        return _console_log(self.index)

    @property
    def tap(self) -> str:
        """The tap NIC this guest attaches to under monitored egress. Only guest
        0 has one — see `_check_egress_ceiling`."""
        return settings.vm_egress_tap if not self.index else \
            f"{settings.vm_egress_tap.rstrip('0123456789')}{self.index}"

    @property
    def mac(self) -> str:
        """Guest 0 keeps the exact MAC vm/net/dnsmasq-egress.conf pins its lease
        to; guest N adds N to the last octet. Deterministic, so a lease could be
        written for it — see `_check_egress_ceiling` for why none is yet."""
        head, _, last = settings.vm_guest_mac.rpartition(":")
        return f"{head}:{(int(last, 16) + self.index) & 0xFF:02x}"

    def _check_egress_ceiling(self) -> None:
        """Monitored egress is single-tap by construction: vm/net/jarvis-egress.nft
        names jvtap0 in three chains and dnsmasq-egress.conf pins one interface,
        one MAC and one lease. A second guest would therefore share guest 0's tap,
        and the egress proxy attributes traffic to a project by which turn is
        live, not by source address — so the second guest's requests would be
        policed and logged as the first's. Refuse instead of quietly getting the
        attribution wrong; making egress multi-tap is a design job, not a knob."""
        if self.index and settings.vm_egress:
            raise VMError(
                f"{self.name} cannot boot while monitored egress is on: the "
                "nftables ruleset and dnsmasq lease are written for the single "
                "tap "
                f"{settings.vm_egress_tap}. Run one guest, or turn off "
                "JARVIS_VM_EGRESS.")

    def running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    def status(self) -> dict:
        age = int(time.monotonic() - self._booted_at) if self._booted_at else None
        return {"guest": self.index,
                "name": self.name,
                "cid": self.cid,
                "image_version": _active_version(),
                "base_built": base_built(),
                "running": self.running(),
                "gateway": gateway.enabled,
                "inflight": self._inflight,
                "age_seconds": age,
                "idle_scrub_seconds": settings.vm_idle_scrub_seconds,
                "egress": settings.vm_egress,
                "rebuilding": self._rebuilding,
                **_image_meta()}

    async def _build_overlay(self) -> None:
        base = _base_image()
        if not base.exists():
            raise VMError(f"no golden image {base.name} — run vm/build_base.sh on the Pi")
        overlay = self.overlay
        overlay.unlink(missing_ok=True)
        proc = await asyncio.create_subprocess_exec(
            "qemu-img", "create", "-f", "qcow2", "-b", str(base), "-F", "qcow2",
            str(overlay), stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE)
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise VMError(f"overlay create failed: {err.decode(errors='replace')}")

    def _orphan_pids(self) -> list[int]:
        """PIDs of qemu processes still holding THIS guest's overlay.

        Was `pkill -9 -f <overlay path>`, which matches the pattern anywhere in
        any process's full command line — a shell that mentions the path, an
        editor, a qemu-img, an operator's `ls -l .../overlay.qcow2` all matched,
        and with several guests the blast radius only grows. This asks two
        questions instead: is it a qemu, and does it have our overlay as an
        argument. Reading /proc directly also means no dependency on procps."""
        overlay = str(self.overlay)
        found = []
        proc_dir = Path("/proc")
        if not proc_dir.is_dir():                    # not Linux — nothing to reap
            return found
        for entry in proc_dir.iterdir():
            if not entry.name.isdigit():
                continue
            try:
                if not entry.joinpath("comm").read_text().startswith("qemu-system"):
                    continue
                args = entry.joinpath("cmdline").read_bytes().decode(
                    errors="replace").split("\0")
            except OSError:                          # the process went away
                continue
            if any(overlay in a for a in args):
                found.append(int(entry.name))
        return found

    async def _kill_orphans(self) -> None:
        """Kill any qemu still holding OUR overlay (hence the guest CID) that we no
        longer track — a guest orphaned across an app restart (setsid detaches it
        from the process group teardown kills). Without this, a reboot's fresh guest
        can't bind the CID and the host would keep talking to the stale one."""
        for pid in self._orphan_pids():
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass

    async def _net(self, action: str) -> None:
        """Run net_up.sh up|down via passwordless sudo (Pi). Best-effort: a
        failure to bring the net up is logged to console but doesn't wedge boot —
        the guest then simply has no working egress (fails closed)."""
        script = settings.base_dir / "vm" / "net" / "net_up.sh"
        env = {**os.environ,
               "JARVIS_VM_TAP": self.tap,
               "JARVIS_VM_HOST_IP": settings.vm_egress_host_ip,
               "JARVIS_VM_PCAP": "1" if settings.vm_egress_pcap else "0"}
        try:
            proc = await asyncio.create_subprocess_exec(
                "sudo", "-n", "bash", str(script), action, env=env,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            _, err = await proc.communicate()
            if proc.returncode:
                print(f"[egress] net {action} failed: {err.decode(errors='replace')[:300]}")
        except (FileNotFoundError, OSError) as e:
            print(f"[egress] net {action} unavailable: {e}")

    async def net_up(self) -> None:
        """Bring the monitored-egress network up. Called ONCE from the app
        lifespan when vm_egress is on — before the proxy binds its host IP and
        before any guest boots."""
        await self._net("up")

    async def net_down(self) -> None:
        await self._net("down")

    async def boot(self) -> None:
        if self.running():
            return
        self._check_egress_ceiling()
        await self._kill_orphans()
        await self._build_overlay()
        self.console_log.unlink(missing_ok=True)
        # the monitored-egress network (tap/nft/dnsmasq/proxy) is APP-lifecycle,
        # not per-boot — it's up before any guest and survives idle-scrub reboots,
        # so the proxy's host-IP binding never flaps mid-operation. run_vm.sh
        # attaches to the pre-existing jvtap0.
        run_vm = settings.base_dir / "vm" / "run_vm.sh"
        env = {**os.environ,
               "VM_DIR": str(settings.vm_dir),
               "JARVIS_VM_BASE": _base_image().name,
               "JARVIS_VM_MEM_MB": str(settings.vm_memory_mb),
               "JARVIS_VM_CPUS": str(settings.vm_cpus),
               "JARVIS_VM_CID": str(self.cid),
               # per-guest runtime files + NIC identity. run_vm.sh defaults each
               # of these to guest 0's old literal, so an out-of-band `bash
               # vm/run_vm.sh` still boots the guest it always did.
               "JARVIS_VM_OVERLAY": self.overlay.name,
               "JARVIS_VM_EFI_VARS": self.efi_vars.name,
               "JARVIS_VM_CONSOLE": self.console_log.name,
               "JARVIS_VM_TAP": self.tap,
               "JARVIS_VM_MAC": self.mac,
               "JARVIS_VM_EGRESS": "1" if settings.vm_egress else "0"}
        self._proc = await asyncio.create_subprocess_exec(
            "bash", str(run_vm), env=env, preexec_fn=os.setsid,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        self._booted_at = time.monotonic()
        self._idle_since = time.monotonic()

    async def teardown(self) -> None:
        if self._proc is not None and self._proc.returncode is None:
            try:
                os.killpg(os.getpgid(self._proc.pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=10)
            except asyncio.TimeoutError:
                pass
        self._proc = None
        self._booted_at = None
        await self._kill_orphans()
        for path in (self.overlay, self.efi_vars, self.console_log):
            path.unlink(missing_ok=True)

    def _refuse_if_busy(self, what: str, force: bool = False) -> None:
        """Guard for the destructive operator ops. Call under `_lock` so a turn
        cannot slip past between the check and the teardown — `acquire` takes the
        same lock to bump `_inflight`."""
        if self._inflight > 0 and not force:
            raise VMBusy(
                f"{self._inflight} turn(s) are running in the guest — {what} "
                "would kill them mid-flight. Wait for them to finish, or repeat "
                "with force=true to take the guest down anyway.")

    async def ensure_booted(self) -> None:
        """The operator's boot button. `boot()` itself takes no lock, and two
        concurrent boots are not idempotent — the second would _kill_orphans the
        first's qemu and rebuild the overlay under it — so the operator path goes
        through the same lock `acquire` and the reaper use."""
        async with self._lock:
            await self.boot()

    async def shutdown(self, force: bool = False) -> None:
        """The operator's teardown button: refuses while turns hold the guest.
        `teardown()` stays unguarded because the reaper, selftest and app
        shutdown call it having already established the guest is free."""
        async with self._lock:
            self._refuse_if_busy("teardown", force)
            await self.teardown()

    async def nuke(self, force: bool = False) -> None:
        async with self._lock:
            self._refuse_if_busy("nuke", force)
            await self.teardown()
            await self.boot()

    async def rebuild_image(self) -> dict:
        """Build the NEXT golden-image version in the background (vm/build_base.sh,
        ~20 min on the Pi). It never touches the running guest or the current base;
        on success the higher version auto-activates on the next boot. Returns
        immediately — progress streams on the 'vm-rebuild' bus channel."""
        if self._rebuilding:
            return {"started": False, "reason": "a rebuild is already running"}
        version = f"v{_next_version()}"
        self._rebuilding = True
        asyncio.create_task(self._run_rebuild(version))
        return {"started": True, "version": version}

    async def _run_rebuild(self, version: str) -> None:
        from .. import bus
        chan, script = "vm-rebuild", settings.base_dir / "vm" / "build_base.sh"
        env = {**os.environ, "JARVIS_VM_IMAGE_VERSION": version}
        bus.publish(chan, {"type": "rebuild", "phase": "start", "version": version})
        try:
            proc = await asyncio.create_subprocess_exec(
                "bash", str(script), env=env, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT)
            if proc.stdout is not None:
                async for line in proc.stdout:
                    bus.publish(chan, {"type": "rebuild", "phase": "log",
                                       "line": line.decode(errors="replace").rstrip()})
            rc = await proc.wait()
            ok = rc == 0 and (settings.vm_dir / f"base-{version}.qcow2").exists()
            bus.publish(chan, {"type": "rebuild", "phase": "done",
                               "version": version, "ok": ok, "returncode": rc})
        except (FileNotFoundError, OSError) as e:
            bus.publish(chan, {"type": "rebuild", "phase": "error", "error": str(e)})
        finally:
            self._rebuilding = False

    # --- refcount + idle scrub -------------------------------------------------

    async def acquire(self) -> None:
        """Ensure the guest is up and pin it for one turn. Serialized so the reaper
        can't tear down between the readiness check and the pin."""
        async with self._lock:
            await self._ensure_ready_locked()
            self._inflight += 1

    def release(self) -> None:
        """Release one turn's hold; start the idle clock when the last one leaves."""
        self._inflight = max(0, self._inflight - 1)
        if self._inflight == 0:
            self._idle_since = time.monotonic()

    async def reap_if_idle(self) -> None:
        """If scrubbing is on and the guest has sat idle past the threshold, reboot
        it so the next operation batch starts fresh. No-op while a turn is in
        flight or scrubbing is disabled."""
        window = settings.vm_idle_scrub_seconds
        if not window or not self.running() or self._inflight > 0:
            return
        if self._idle_since is None or time.monotonic() - self._idle_since < window:
            return
        async with self._lock:
            if self._inflight > 0:          # a turn arrived while we waited
                return
            await self.teardown()
            await self.boot()

    async def _ensure_ready_locked(self) -> None:
        """Boot the guest if it isn't running and wait until its run-turn server
        accepts a connection. Caller holds `_lock`. Idempotent — one guest serves
        many turns; the idle reaper reboots it between operation batches."""
        if not base_built():
            raise VMError("no golden image — run vm/build_base.sh on the Pi first")
        if not gateway.enabled:
            raise VMError("vsock gateway not running (no vsock on this host?)")
        from .guest_turn import GUEST_RUNTURN_PORT
        await self.boot()
        loop = asyncio.get_event_loop()
        deadline = loop.time() + settings.vm_boot_timeout_seconds
        while loop.time() < deadline:
            s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
            try:
                await asyncio.get_running_loop().run_in_executor(
                    None, s.connect, (self.cid, GUEST_RUNTURN_PORT))
                return
            except OSError:
                await asyncio.sleep(1)
            finally:
                s.close()
        raise VMError("guest run-turn server did not become ready in time")

    def _isolation(self) -> dict:
        log = self.console_log
        text = log.read_text(errors="replace") if log.exists() else ""
        ifaces = _IFACES_RE.search(text)
        external = _EXTERNAL_RE.search(text)
        return {"interfaces": ifaces.group(1) if ifaces else None,
                "external_reachable": (external.group(1) == "True") if external else None}

    async def selftest(self) -> dict:
        """Boot the guest and run ONE real no-tools reasoning turn INSIDE it via
        guest_turn (the loop runs in the guest, its model calls dialing back to
        the host gateway). Returns the guest's answer + the isolation report.

        Refuses while turns hold the guest, and tears the guest down after ONLY
        if it is still free — the teardown in the finally used to fire
        unconditionally, so hitting /api/vm/selftest killed every live turn. The
        boot is under `_lock` for the same reason `ensure_booted` is."""
        if not base_built():
            raise VMError("no golden image — run vm/build_base.sh on the Pi first")
        if not gateway.enabled:
            raise VMError("vsock gateway not running (no vsock on this host?)")
        from ..agent.model import confirm_peak
        from .guest_turn import guest_turn
        confirm_peak(0)                        # the turn-level peak decision is the
        # caller's (here, the operator running the selftest); the guest's per-call
        # model_calls then pass the gateway's peak gate, as a host chat turn does.
        async with self._lock:
            self._refuse_if_busy("selftest")
            await self.boot()
        deadline = asyncio.get_event_loop().time() + settings.vm_boot_timeout_seconds
        final = None
        try:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    async for ev in guest_turn(
                            conversation_id=0,
                            system_prompt="You are terse.",
                            history=[{"role": "user",
                                      "content": "Reply with exactly the word PONG and nothing else."}],
                            op_id=f"vm-selftest-{self.name}", self_check=False,
                            guest=self):
                        if ev.get("type") == "final":
                            final = ev.get("content")
                    break
                except (ConnectionError, OSError):
                    await asyncio.sleep(2)      # guest run-turn server not up yet
            isolation = self._isolation()
        finally:
            # the selftest's own turn has released by now (its generator ran to
            # exhaustion); anything still holding the guest is a REAL turn that
            # started while we were testing, and it keeps the guest.
            async with self._lock:
                if self._inflight == 0:
                    await self.teardown()
        if final is None:
            raise VMError("guest run-turn server did not become reachable in time")
        return {"reply": final, "isolation": isolation}


# --- the guest registry ------------------------------------------------------
# Slot 0 is the module-level `vm` below, unchanged, because six modules and
# several tests import it by that name and mean exactly that object. Higher slots
# live here and are created lazily on first use, so a host configured for one
# guest never constructs a second — raising settings.vm_guests is the whole
# opt-in. Instances are cached: a GuestVM owns a subprocess handle and a
# refcount, so handing out a fresh one per call would lose track of a live guest.
_guests: dict[int, GuestVM] = {}


def guest_vm(index: int = 0) -> GuestVM:
    """The guest in slot `index`, created on first use. Raises rather than
    silently falling back to guest 0 — a caller asking for a sandbox this host
    is not configured to run wants to hear about it."""
    if index < 0 or index >= max(1, settings.vm_guests):
        raise VMError(
            f"no guest {index}: this host is configured for "
            f"{max(1, settings.vm_guests)} (settings.vm_guests). Each guest "
            f"costs {settings.vm_memory_mb} MB of RAM, so raise it only on a "
            "host with the memory to spare.")
    if not index:
        # slot 0 resolves to the module-level `vm` every time, not to a cached
        # copy — six modules import that name and tests monkeypatch it, and both
        # must keep meaning the same object as this function returns.
        return vm
    g = _guests.get(index)
    if g is None:
        g = _guests[index] = GuestVM(index)
    return g


def default_guest() -> GuestVM:
    """The sandbox a caller means when it doesn't name one. Everything that runs
    a turn goes through here rather than importing `vm` directly, so which guest
    serves a turn becomes a routing decision instead of a module import."""
    return vm


def all_guests() -> list[GuestVM]:
    """Every configured slot, instantiating any not yet used — the operator's
    view (GET /api/vm/guests) and the shutdown sweep both want the full set."""
    return [guest_vm(i) for i in range(max(1, settings.vm_guests))]


def live_guests() -> list[GuestVM]:
    """Only the slots that have actually been instantiated. Used where creating a
    guest object as a side effect would be wrong (teardown, the reaper)."""
    return [vm, *(g for _, g in sorted(_guests.items()))]


# module-level singleton for slot 0, driven by the vm_api router. Six modules
# import this name; `guest_vm(0)` resolves to it rather than shadowing it.
vm = GuestVM()


async def teardown_all() -> None:
    """App shutdown: never leave a guest running past the process that owns it."""
    for g in live_guests():
        await g.teardown()


async def reaper_loop() -> None:
    """Background: scrub each guest once it has gone idle (M4c). Cheap and inert
    while vm_idle_scrub_seconds is 0. Started from the app lifespan."""
    while True:
        try:
            await asyncio.sleep(settings.vm_reaper_interval_seconds)
            for g in live_guests():
                await g.reap_if_idle()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a reaper hiccup must never kill the loop
            pass
