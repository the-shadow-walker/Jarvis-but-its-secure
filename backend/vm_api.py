"""Operator control surface for the sandbox VM (Phase 2): status / boot /
teardown / nuke / selftest. The guest is disposable — nuke discards its overlay
disk and reboots fresh from the golden image. `selftest` boots the guest, lets
its stub reach the host model gateway over vsock for one completion, and returns
the reply — the end-to-end proof that the host<->guest model path works.

Every destructive route refuses with 409 while turns are running in the guest,
`force: true` being the deliberate override. Before that, POST /api/vm/selftest
tore down whatever was in flight, and the only guard on nuke was a client-side
check of a polled status field.

Routes carry an optional `guest` index so a host configured for more than one
sandbox can address them individually. It defaults to 0 — the guest every
existing caller means — and asking for a slot this host is not configured to run
is a 404, never a silent fallback to guest 0."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_user
from .vm.lifecycle import VMBusy, VMError, all_guests, guest_vm

router = APIRouter(prefix="/api/vm", tags=["vm"], dependencies=[Depends(require_user)])


class GuestBody(BaseModel):
    guest: int = 0


class NukeBody(GuestBody):
    confirm: bool = False
    # take the guest down even with turns in flight — the escape hatch for a
    # leaked refcount, never the routine path
    force: bool = False


def _vm(index: int):
    try:
        return guest_vm(index)
    except VMError as e:                             # slot this host doesn't run
        raise HTTPException(status_code=404, detail=str(e))


def _fail(e: VMError) -> HTTPException:
    # busy is a conflict the operator can resolve (wait, or force); anything else
    # is the host being unable to run a guest at all
    return HTTPException(status_code=409 if isinstance(e, VMBusy) else 502,
                         detail=str(e))


@router.get("/status")
async def status(guest: int = 0):
    return _vm(guest).status()


@router.get("/guests")
async def guests():
    """Every configured sandbox and its state — one entry unless the host has
    settings.vm_guests raised."""
    return [g.status() for g in all_guests()]


@router.post("/boot")
async def boot(body: GuestBody | None = None):
    vm = _vm((body or GuestBody()).guest)
    try:
        await vm.ensure_booted()
    except VMError as e:
        raise _fail(e)
    return vm.status()


@router.post("/teardown")
async def teardown(body: NukeBody | None = None):
    body = body or NukeBody()
    vm = _vm(body.guest)
    try:
        await vm.shutdown(force=body.force)
    except VMError as e:
        raise _fail(e)
    return vm.status()


@router.post("/nuke")
async def nuke(body: NukeBody):
    if not body.confirm:
        raise HTTPException(status_code=400, detail="nuke requires confirm=true")
    vm = _vm(body.guest)
    try:
        await vm.nuke(force=body.force)
    except VMError as e:
        raise _fail(e)
    return vm.status()


@router.post("/selftest")
async def selftest(body: GuestBody | None = None):
    vm = _vm((body or GuestBody()).guest)
    try:
        return await vm.selftest()
    except VMError as e:
        raise _fail(e)


@router.post("/rebuild")
async def rebuild(body: NukeBody):
    """Build the next golden-image version (patched kernel) in the background.
    Double-confirmed like nuke — it's a ~20-minute Pi operation. The image is
    shared by every guest, so this is not per-guest work; the index only picks
    which instance reports the rebuild state."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="rebuild requires confirm=true")
    return await _vm(body.guest).rebuild_image()
