"""The servers as a real client starts them: separate processes speaking MCP over stdio, configured by environment."""
import json
import sys

from mcp.client.client import Client
from mcp.client.stdio import StdioServerParameters

from .conftest import run


def params(module: str, **env) -> StdioServerParameters:
    return StdioServerParameters(command=sys.executable, args=["-m", module], env=env)


def test_lab_learn_starts_over_stdio_and_answers(repo):
    async def go():
        async with Client(params("lab_mcp.learn.server", LAB_ROOT=str(repo))) as c:
            tools = {t.name for t in (await c.list_tools()).tools}
            r = await c.call_tool("explain_stage", {"stage_id": "demo-tls"})
            return tools, json.loads(r.content[0].text)
    tools, data = run(go())
    assert "search_blueprint" in tools and data["builds_on"] == ["demo-auth"]


def test_lab_operate_starts_over_stdio_and_reaches_the_panel(repo, panel):
    async def go():
        async with Client(params("lab_mcp.operate.server", LAB_ROOT=str(repo), LAB_PANEL_URL=panel.url)) as c:
            r = await c.call_tool("list_stages", {})
            d = await c.call_tool("destroy_stage", {"stage_id": "demo-ecs"})
            return json.loads(r.content[0].text), d
    stages, d = run(go())
    assert [s["id"] for s in stages["stages"]] == ["demo-ecs", "demo-auth"]
    assert panel.posts == []  # asking to destroy without confirm changed nothing


def test_lab_operate_in_read_only_mode_offers_only_look_tools(repo, panel):
    async def go():
        async with Client(params("lab_mcp.operate.server", LAB_ROOT=str(repo), LAB_PANEL_URL=panel.url,
                                 LAB_OPERATE_READONLY="1")) as c:
            return {t.name for t in (await c.list_tools()).tools}
    names = run(go())
    assert "list_stages" in names and "deploy_stage" not in names and "destroy_stage" not in names
