"""The learning tools: explain, compare, find examples, lessons, learning path, safe file reading."""
import pytest

from lab_mcp.learn.service import NOTICE, LabError, Learn


@pytest.fixture
def learn(repo):
    return Learn(repo)


def test_explain_brief_has_the_essentials_and_the_notice(learn):
    r = learn.explain_stage("demo-auth")
    assert r["builds_on"] == ["demo-ecs"] and "cognito" in r["concepts"] and r["how_to_run"].strip() == "make up"
    assert r["citations"] == ["deployment/aws/demo-auth/README.md", "deployment/aws/demo-auth/FLOCI-NOTES.md"]
    assert r["notice"] == NOTICE and "what_each_file_teaches" not in r


def test_explain_full_adds_files_resources_and_gotchas_with_citations(learn):
    r = learn.explain_stage("demo-ecs", "full")
    assert r["what_each_file_teaches"][1]["File"] == "ecs.tf"
    assert {g["title"] for g in r["gotchas"]} == {"Lambda version list order", "Bind mounts in CI"}
    assert all(":" in g["citation"] for g in r["gotchas"])
    assert any(t["resource"] == "aws_lb.main" and t["citation"].endswith("main.tf:3") for t in r["terraform_resources"])


def test_a_mistyped_stage_gets_a_suggestion(learn):
    with pytest.raises(LabError, match="Did you mean: demo-ecs"):
        learn.explain_stage("demo-ec")


def test_compare_shows_what_a_variant_adds(learn):
    r = learn.compare_stages("demo-auth", "demo-tls")
    assert r["relationship"] == "demo-tls builds on demo-auth"
    assert r["concepts"]["only_demo-tls"] == ["custom-concept", "tls-https"]
    assert "Caddyfile" in r["files"]["only_in_demo-tls"] and "scripts/tls-check.sh" in r["files"]["only_in_demo-tls"]
    assert any(c["file"] == "main.tf" and c["added"] > 0 for c in r["files"]["changed"])
    assert r["notice"] == NOTICE


def test_find_example_gives_file_and_line_simplest_stage_first(learn):
    r = learn.find_example("listener rule")
    assert r["concept"] == "alb-listener-rules" and r["examples"][0]["stage"] == "demo-ecs"
    assert r["examples"][0]["citation"].endswith("demo-ecs/main.tf:5")
    assert learn.find_example("aws_cognito_user_pool")["examples"], "a Terraform resource type works too"
    assert learn.find_example("sign in")["concept"] == "cognito"  # alias


def test_find_example_understands_how_people_phrase_things(learn):
    for phrase in ("alb listener rule", "listener rules", "ALB Listener Rules", "aws_lb_listener_rule"):
        r = learn.find_example(phrase)
        assert r["examples"] and r["examples"][0]["resource"] == "aws_lb_listener_rule.api", phrase
    assert learn.find_example("oauth2-proxy")["concept"] != "cognito", "'auth' must not match inside 'oauth2'"


def test_lessons_come_from_the_notes_with_their_citation(learn):
    r = learn.lessons_for("bind mounts in a CI job")
    assert r["lessons"][0]["citation"].endswith("demo-ecs/FLOCI-NOTES.md:7-9") or "Bind mounts" in r["lessons"][0]["title"]
    assert "volume" in r["lessons"][0]["text"]
    with pytest.raises(LabError):
        learn.lessons_for("  ")


def test_a_learning_path_puts_prerequisites_first(learn):
    steps = learn.learning_path("sign in with Cognito over HTTPS")["steps"]
    order = [s["stage"] for s in steps]
    assert order.index("demo-ecs") < order.index("demo-auth") < order.index("demo-tls")
    assert steps[0]["read_first"].endswith("README.md") and steps[0]["run"].startswith("make deploy STAGE=")


def test_a_goal_nothing_matches_still_gets_a_gentle_start(learn):
    assert learn.learning_path("quantum knitting")["steps"][0]["stage"] == "demo-ecs"


def test_resources_render_and_cite(learn):
    assert "standalone cookbooks" in learn.rules()
    s = learn.simplifications()
    assert "plain HTTP" in s and "blueprint" in s
    page = learn.stage_page("demo-ecs")
    assert "## Run it" in page and "make smoke" in page and "FLOCI-NOTES.md:" in page
    assert "Why Floci" in learn.adr("1")
    with pytest.raises(LabError, match="Available"):
        learn.adr("9")


def test_read_file_limits_lines_and_refuses_bad_paths(learn):
    r = learn.read_file("deployment/aws/demo-ecs/main.tf", 1, 3)
    assert r["end_line"] == 3 and r["citation"] == "deployment/aws/demo-ecs/main.tf:1-3" and "load balancer" in r["text"]
    for bad in ("../x.md", "/etc/passwd", "deployment/aws/demo-ecs/terraform.tfstate", "deployment/aws/demo-tls/certs/tls-key.pem"):
        with pytest.raises(LabError):
            learn.read_file(bad)
