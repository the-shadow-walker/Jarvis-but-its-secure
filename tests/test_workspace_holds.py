"""Workspace holds are per (guest, slug), not per slug.

Unpacking a workspace rmtree's the guest's dir for that project, so among
concurrent operations on one slug only the FIRST may ship a copy; the rest join
it and the last one out sweeps the shared write buffer home. Keyed by slug
alone, a top-level turn landing in a SECOND guest would be told it is a joiner
and would then reuse — and sweep home — a workspace copy that lives in the other
guest, which has none of its files. Wrong data, silently.

Also pins the asymmetry between the two sweep sites, which is deliberate:
`guest_turn` sweeps only when last-out AND not the owner (the owner's turn-end
`staged` pack already brought its edits home), while `orchestrator` primes
out-of-band, gets no such pack, and so sweeps whenever it is last out."""
import ast
import pathlib

from backend.vm.guest_turn import (_ws_holds, acquire_workspace,
                                   release_workspace)
from backend.vm.lifecycle import GuestVM, default_guest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class _Guest:
    def __init__(self, name):
        self.name = name


def setup_function():
    _ws_holds.clear()


def test_first_in_owns_the_copy_and_last_out_reports_it():
    g = _Guest("guest0")
    assert acquire_workspace(g, "proj") is True        # first in ships the copy
    assert acquire_workspace(g, "proj") is False       # joiner reuses it
    assert release_workspace(g, "proj") is False       # not the last one out
    assert release_workspace(g, "proj") is True        # last out sweeps
    assert _ws_holds == {}


def test_two_guests_do_not_share_a_slug_hold():
    a, b = _Guest("guest0"), _Guest("guest1")
    assert acquire_workspace(a, "proj") is True
    # the same project in a DIFFERENT guest is a different workspace dir: this
    # turn must ship its own copy, not join guest0's
    assert acquire_workspace(b, "proj") is True
    assert release_workspace(a, "proj") is True        # each sweeps its own
    assert release_workspace(b, "proj") is True


def test_one_guest_still_separates_projects():
    g = _Guest("guest0")
    assert acquire_workspace(g, "a") is True
    assert acquire_workspace(g, "b") is True
    assert release_workspace(g, "a") is True
    assert acquire_workspace(g, "b") is False         # b still held


def test_guests_have_distinct_names_and_cids():
    assert default_guest().name == "guest0"
    a, b = GuestVM(0), GuestVM(1)
    assert a.name != b.name
    assert a.cid != b.cid
    assert a.cid == default_guest().cid               # slot 0 is today's guest


def _sweep_condition(path: str, fn_name: str) -> str:
    """The source of the `if` that guards the sweep in one call site."""
    tree = ast.parse((ROOT / path).read_text())
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
              and n.name == fn_name)
    node = next(n for n in ast.walk(fn)
                if isinstance(n, ast.If)
                and "release_workspace" in ast.unparse(n.test))
    return ast.unparse(node.test)


def test_the_two_sweep_sites_stay_asymmetric():
    """A future reader will be tempted to 'fix' one of these to match the other.
    They are different on purpose; make that a decision, not an accident."""
    turn = _sweep_condition("backend/vm/guest_turn.py", "guest_turn")
    job = _sweep_condition("backend/orchestrator.py", "run_job")
    assert "not owns_ws" in turn, (
        "guest_turn must sweep only when it is NOT the workspace owner — the "
        "owner's edits already came home in its turn-end `staged` pack")
    assert "owns_ws" not in job, (
        "a job primes out-of-band and receives no turn-end pack, so it must "
        "sweep whenever it is last out, owner or not")
