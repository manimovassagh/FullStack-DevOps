"""lab-operate through the MCP protocol: tool classes, read-only mode, guardrails as a client experiences them."""
import json

import pytest
from mcp.client.client import Client

from lab_mcp.common.config import Config
from lab_mcp.operate.panel import Panel
from lab_mcp.operate.server import build_server

from ..conftest import run

READ = {"list_stages", "stage_status", "list_emulators", "ci_status", "pipeline_runs", "recent_activity", "job_log"}
ACT = {"deploy_stage", "smoke_stage", "rollout_stage", "run_pipeline", "start_ci", "start_emulator", "start_observability", "run_loadtest"}
DESTRUCTIVE = {"destroy_stage", "stop_emulator", "stop_ci", "stop_observability", "cancel_job"}


def client(repo, panel, read_only=False):
    return Client(build_server(Config(root=repo, panel_url=panel.url, read_only=read_only), Panel(panel.url)))


def test_tools_are_classified_by_what_they_can_do(repo, panel):
    async def go():
        async with client(repo, panel) as c:
            return (await c.list_tools()).tools
    tools = {t.name: t for t in run(go())}
    assert set(tools) == READ | ACT | DESTRUCTIVE
    assert {n for n, t in tools.items() if t.annotations.read_only_hint} == READ
    assert {n for n, t in tools.items() if t.annotations.destructive_hint} == DESTRUCTIVE
    for n in DESTRUCTIVE:
        assert tools[n].description.startswith("DESTRUCTIVE") and "confirm" in tools[n].description


def test_read_only_mode_offers_no_way_to_change_anything(repo, panel):
    async def go():
        async with client(repo, panel, read_only=True) as c:
            return {t.name for t in (await c.list_tools()).tools}
    assert run(go()) == READ


def test_a_destructive_call_without_confirm_leaves_no_trace(repo, panel):
    panel.set_state("demo-ecs", "up", resources=3)

    async def go():
        async with client(repo, panel) as c:
            out = {}
            for name, args in (("destroy_stage", {"stage_id": "demo-ecs"}), ("stop_emulator", {"emulator_id": "e1"}),
                               ("stop_ci", {}), ("cancel_job", {"job_id": "1"}), ("stop_observability", {})):
                r = await c.call_tool(name, args)
                out[name] = json.loads(r.content[0].text)
            return out
    out = run(go())
    assert all(v["confirmation_required"] and v["nothing_changed"] for v in out.values())
    assert panel.posts == []


def test_confirming_through_the_protocol_sends_the_request(repo, panel):
    panel.set_state("demo-ecs", "up", resources=3)

    async def go():
        async with client(repo, panel) as c:
            return json.loads((await c.call_tool("destroy_stage", {"stage_id": "demo-ecs", "confirm": True})).content[0].text)
    r = run(go())
    assert r["job_id"] == "job-1" and panel.posts == ["/api/stages/demo-ecs/stop"]


@pytest.mark.parametrize("bad", ["yes please", {"x": 1}, [True]])
def test_a_confirm_that_is_not_a_boolean_is_rejected_not_guessed(repo, panel, bad):
    panel.set_state("demo-ecs", "up", resources=3)

    async def go():
        async with client(repo, panel) as c:
            return await c.call_tool("destroy_stage", {"stage_id": "demo-ecs", "confirm": bad})
    assert run(go()).is_error and panel.posts == []


def test_errors_tell_the_ai_what_to_do_next(repo, panel):
    panel.busy_job = "55"

    async def go():
        async with client(repo, panel) as c:
            return await c.call_tool("deploy_stage", {"stage_id": "demo-ecs"}), await c.call_tool("stage_status", {"stage_id": "zzz"})
    busy, unknown = run(go())
    assert busy.is_error and "something else is running" in busy.content[0].text and "55" in busy.content[0].text
    assert unknown.is_error and "Known stages" in unknown.content[0].text


def test_the_instructions_explain_the_job_pattern_and_the_confirmation_rule(repo, panel):
    async def go():
        async with client(repo, panel) as c:
            return c.instructions
    ins = run(go())
    assert "job_id" in ins and "next_from_line" in ins and "confirm=true" in ins and "caffeinate" not in ins.split("Never wait")[0]


def test_every_read_tool_returns_one_json_object_never_a_list(repo, panel):
    async def go():
        async with client(repo, panel) as c:
            calls = {"list_stages": {}, "stage_status": {"stage_id": "demo-ecs"}, "list_emulators": {}, "ci_status": {},
                     "pipeline_runs": {}, "recent_activity": {}, "job_log": {"job_id": "9"}}
            return {n: await c.call_tool(n, a) for n, a in calls.items()}
    for name, r in run(go()).items():
        assert not r.is_error and len(r.content) == 1 and isinstance(json.loads(r.content[0].text), dict), name
