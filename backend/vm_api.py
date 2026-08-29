"""Operator control surface for the sandbox VM (Phase 2): status / boot /
teardown / nuke / selftest. The guest is disposable — nuke discards its overlay
disk and reboots fresh from the golden image. `selftest` boots the guest, lets
its stub reach the host model gateway over vsock for one completion, and returns
the reply — the end-to-end proof that the host<->guest model path works.

Every destructive route refuses with 409 while turns are running in the guest,
`force: true` being the deliberate override. Before that, POST /api/vm/selftest
tore down whatever was in flight, and the only guard on nuke was a client-side
check of a polled status field."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_user
from .vm.lifecycle import VMBusy, VMError, vm

router = APIRouter(prefix="/api/vm", tags=["vm"], dependencies=[Depends(require_user)])


class NukeBody(BaseModel):
    confirm: bool = False
    # take the guest down even with turns in flight — the escape hatch for a
    # leaked refcount, never the routine path
    force: bool = False


def _fail(e: VMError) -> HTTPException:
    # busy is a conflict the operator can resolve (wait, or force); anything else
    # is the host being unable to run a guest at all
    return HTTPException(status_code=409 if isinstance(e, VMBusy) else 502,
                         detail=str(e))


@router.get("/status")
async def status():
    return vm.status()


@router.post("/boot")
async def boot():
    try:
        await vm.ensure_booted()
    except VMError as e:
        raise _fail(e)
    return vm.status()


@router.post("/teardown")
async def teardown(body: NukeBody | None = None):
    try:
        await vm.shutdown(force=(body or NukeBody()).force)
    except VMError as e:
        raise _fail(e)
    return vm.status()


@router.post("/nuke")
async def nuke(body: NukeBody):
    if not body.confirm:
        raise HTTPException(status_code=400, detail="nuke requires confirm=true")
    try:
        await vm.nuke(force=body.force)
    except VMError as e:
        raise _fail(e)
    return vm.status()


@router.post("/selftest")
async def selftest():
    try:
        return await vm.selftest()
    except VMError as e:
        raise _fail(e)


@router.post("/rebuild")
async def rebuild(body: NukeBody):
    """Build the next golden-image version (patched kernel) in the background.
    Double-confirmed like nuke — it's a ~20-minute Pi operation."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="rebuild requires confirm=true")
    return await vm.rebuild_image()
