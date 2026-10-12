"""Destructive tools change nothing without confirm=true, and say what they would do."""
import pytest

from lab_mcp.operate.panel import Panel
from lab_mcp.operate.tools import Operate


@pytest.fixture
def op(panel):
    panel.set_state("demo-ecs", "up", resources=49)
    return Operate(Panel(panel.url))


CALLS = [
    ("destroy_stage", ("demo-ecs",)), ("stop_emulator", ("e1",)), ("stop_ci", ()),
    ("stop_observability", ()), ("cancel_job", ("123",)),
]


@pytest.mark.parametrize("name,args", CALLS)
def test_without_confirm_nothing_is_sent_and_the_effects_are_described(op, panel, name, args):
    r = getattr(op, name)(*args)
    assert r["confirmation_required"] is True and r["nothing_changed"] is True
    assert "confirm=true" in r["to_proceed"] and r["effects"]
    assert panel.posts == []


@pytest.mark.parametrize("name,args,path", [
    ("destroy_stage", ("demo-ecs",), "/api/stages/demo-ecs/stop"), ("stop_emulator", ("e1",), "/api/emulators/e1/stop"),
    ("stop_ci", (), "/api/ci/down"), ("stop_observability", (), "/api/observability/down"),
    ("cancel_job", ("123",), "/api/jobs/123/cancel"),
])
def test_with_confirm_exactly_that_request_is_sent(op, panel, name, args, path):
    getattr(op, name)(*args, confirm=True)
    assert panel.posts == [path]


def test_the_description_names_what_would_be_lost(op):
    assert "49 resources" in op.destroy_stage("demo-ecs")["effects"]
    e = op.stop_emulator("e1")["effects"]
    assert "Title demo-ecs" in e and "Title demo-auth" in e and "4573" in e


def test_destroying_something_that_is_not_deployed_is_a_no_op(op, panel):
    assert "not deployed" in op.destroy_stage("demo-auth", confirm=True)["nothing_to_do"]
    assert panel.posts == []
