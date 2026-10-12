"""The catalog is generated from the repository: stages, concepts, ports, pipelines, what builds on what."""
from lab_mcp.learn import markdown as md
from lab_mcp.learn.catalog import build_catalog, check

from ..conftest import REAL_ROOT, write


def test_every_stage_directory_becomes_a_stage(repo):
    cat = build_catalog(repo)
    assert list(cat.stages) == ["demo-auth", "demo-ecs", "demo-tls"]
    s = cat.stages["demo-ecs"]
    assert s.cloud == "aws" and s.title == "Demo ECS — on Floci"
    assert s.summary.startswith("A container service behind a load balancer")
    assert s.readme == "deployment/aws/demo-ecs/README.md" and s.notes.endswith("FLOCI-NOTES.md")


def test_concepts_are_derived_from_what_the_stage_contains(repo):
    cat = build_catalog(repo)
    assert {"application-load-balancer", "alb-listener-rules", "ecs-fargate"} <= set(cat.stages["demo-ecs"].concepts)
    assert "cognito" in cat.stages["demo-auth"].concepts and "cognito" not in cat.stages["demo-ecs"].concepts
    assert "tls-https" in cat.stages["demo-tls"].concepts  # from the Caddyfile and the README words
    assert "custom-concept" in cat.stages["demo-tls"].concepts  # front-matter adds to the derived ones


def test_terraform_resources_have_file_and_line(repo):
    r = {(x.type, x.name): x for x in build_catalog(repo).stages["demo-ecs"].resources}
    rule = r[("aws_lb_listener_rule", "api")]
    assert rule.file.endswith("demo-ecs/main.tf") and rule.line == 5


def test_ports_pipelines_and_the_run_block_are_read_from_the_stage(repo):
    s = build_catalog(repo).stages["demo-ecs"]
    assert s.ports == [4573, 8100]
    assert s.workflows == ["demo-ecs.yml"]
    assert "make up" in s.run and "make smoke" in s.run


def test_builds_on_comes_from_readme_links_to_sibling_stages(repo):
    cat = build_catalog(repo)
    assert cat.stages["demo-auth"].builds_on == ["demo-ecs"]
    assert cat.stages["demo-tls"].builds_on == ["demo-auth"]
    assert cat.stages["demo-ecs"].builds_on == []


def test_the_teaching_table_is_parsed(repo):
    t = build_catalog(repo).stages["demo-ecs"].teaches
    assert t[0] == {"File": "alb.tf", "Concept": "listener rules and target groups"}


def test_check_reports_errors_for_broken_docs_and_warnings_for_missing_content(repo):
    errors, warnings = check(build_catalog(repo))
    assert errors == []  # the fixture is consistent
    assert any("demo-auth/README.md" in w and "teaches" in w for w in warnings)
    (repo / "deployment/aws/demo-auth/FLOCI-NOTES.md").unlink()
    write(repo, "deployment/aws/demo-tls/README.md", "# Only a title\n")
    errors, _ = check(build_catalog(repo))
    assert any("demo-auth" in e and "FLOCI-NOTES" in e for e in errors)
    assert any("demo-tls" in e and "summary" in e for e in errors)


def test_markdown_helpers_ignore_headings_inside_code_fences():
    text = "# T\n\nintro\n\n## A\n\n```\n# not a heading\n```\n\n## B\n\nend\n"
    assert [s.title for s in md.sections(text)] == ["T", "A", "B"]
    assert md.first_paragraph(text) == "intro"


def test_the_real_repository_catalog_has_no_errors():
    if not (REAL_ROOT / "deployment").is_dir():
        return
    cat = build_catalog(REAL_ROOT)
    errors, _ = check(cat)
    assert errors == []
    assert "ecs-cloudfront-signup-https" in cat.stages
    assert "tls-https" in cat.stages["ecs-cloudfront-signup-https"].concepts
