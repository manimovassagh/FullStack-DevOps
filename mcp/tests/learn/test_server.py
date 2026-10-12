"""lab-learn through the MCP protocol, as a client sees it."""
import json
from pathlib import Path

from mcp.client.client import Client

from lab_mcp.common.config import Config
from lab_mcp.learn.server import build_server

from ..conftest import run


def client(repo: Path):
    return Client(build_server(Config(root=repo)))


def test_it_offers_the_planned_tools_resources_and_prompts(repo):
    async def go():
        async with client(repo) as c:
            tools = {t.name for t in (await c.list_tools()).tools}
            resources = {str(r.uri) for r in (await c.list_resources()).resources}
            templates = {t.uri_template for t in (await c.list_resource_templates()).resource_templates}
            prompts = {p.name for p in (await c.list_prompts()).prompts}
        assert tools == {"list_stages", "search_blueprint", "explain_stage", "compare_stages", "find_example", "lessons_for",
                         "learning_path", "read_file"}
        assert {"blueprint://overview", "blueprint://rules", "blueprint://simplifications", "blueprint://stages",
                "blueprint://lessons"} <= resources
        assert templates == {"blueprint://stage/{stage_id}", "blueprint://concept/{name}", "blueprint://adr/{n}"}
        assert prompts == {"teach_stage", "quiz_me", "review_change", "add_stage"}
    run(go())


def test_every_tool_is_marked_read_only_and_has_a_description(repo):
    async def go():
        async with client(repo) as c:
            return (await c.list_tools()).tools
    for t in run(go()):
        assert t.annotations.read_only_hint is True and t.annotations.destructive_hint is False, t.name
        assert t.description and len(t.description) > 40, t.name


def test_a_tool_result_is_structured_and_cited(repo):
    async def go():
        async with client(repo) as c:
            return await c.call_tool("search_blueprint", {"query": "alias rollout"})
    r = run(go())
    data = json.loads(r.content[0].text)
    assert not r.is_error and data["hits"][0]["citation"].endswith("FLOCI-NOTES.md:3-5")


def test_the_fix_hint_reaches_the_client(repo):
    async def go():
        async with client(repo) as c:
            a = await c.call_tool("explain_stage", {"stage_id": "demo-ec"})
            b = await c.call_tool("read_file", {"path": "../secret.md"})
            return a, b
    a, b = run(go())
    assert a.is_error and "Did you mean: demo-ecs" in a.content[0].text
    assert b.is_error and "outside the repository" in b.content[0].text


def test_resources_and_prompts_work(repo):
    async def go():
        async with client(repo) as c:
            page = (await c.read_resource("blueprint://stage/demo-tls")).contents[0].text
            simp = (await c.read_resource("blueprint://simplifications")).contents[0].text
            prompt = await c.get_prompt("teach_stage", {"stage": "demo-ecs", "level": "advanced"})
            return page, simp, prompt
    page, simp, prompt = run(go())
    assert "Demo TLS" in page and "plain HTTP" in simp
    text = prompt.messages[0].content.text
    assert "demo-ecs" in text and "advanced" in text and "explain_stage" in text and "{stage}" not in text


def test_instructions_tell_the_ai_to_cite_and_to_state_the_simplifications(repo):
    async def go():
        async with client(repo) as c:
            return c.instructions
    ins = run(go())
    assert "cite" in ins.lower() and "path:line" in ins and "simplifications" in ins and "data" in ins


def test_every_tool_returns_one_json_object_never_a_list(repo):
    """A list result reaches a client as several content blocks; one object is one predictable shape."""
    async def go():
        async with client(repo) as c:
            calls = {"list_stages": {}, "search_blueprint": {"query": "alias"}, "explain_stage": {"stage_id": "demo-ecs"},
                     "compare_stages": {"a": "demo-ecs", "b": "demo-auth"}, "find_example": {"concept": "cognito"},
                     "lessons_for": {"topic": "alias"}, "learning_path": {"goal": "cognito"},
                     "read_file": {"path": "README.md"}}
            return {n: await c.call_tool(n, a) for n, a in calls.items()}
    for name, r in run(go()).items():
        assert not r.is_error and len(r.content) == 1 and isinstance(json.loads(r.content[0].text), dict), name
