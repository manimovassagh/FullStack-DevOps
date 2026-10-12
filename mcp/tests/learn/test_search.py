"""Search: every hit is a citation, ranking favours the 'why', plurals match, a stage name focuses the answer."""
from pathlib import Path

from lab_mcp.learn.catalog import build_catalog
from lab_mcp.learn.search import Index, stem

from ..conftest import write


def index(repo: Path) -> Index:
    return Index(repo, list(build_catalog(repo).stages))


def test_every_hit_cites_a_real_line_range(repo):
    hits = index(repo).search("bind mounts checkout")
    assert hits
    for h in hits:
        path, _, rng = h["citation"].partition(":")
        first = int(rng.split("-")[0])
        assert (repo / path).is_file() and 1 <= first <= len((repo / path).read_text().splitlines())


def test_the_lesson_is_found_and_ranked_first(repo):
    top = index(repo).search("why did the alias never move on rollout")[0]
    assert top["path"].endswith("demo-ecs/FLOCI-NOTES.md") and top["kind"] == "notes"
    assert top["title"] == "Lambda version list order"


def test_plurals_match(repo):
    assert stem("mounts") == "mount" and stem("policies") == "policy" and stem("access") == "access"
    assert index(repo).search("bind mount")[0]["path"] == index(repo).search("bind mounts")[0]["path"]


def test_a_stage_name_in_the_query_focuses_the_answer(repo):
    hits = index(repo).search("terminated certificate demo-tls")
    assert hits[0]["stage"] == "demo-tls"


def test_comments_in_terraform_scripts_and_makefiles_are_searchable(repo):
    ix = index(repo)
    assert ix.search("Fargate service per tier", kinds={"terraform"})[0]["path"].endswith("demo-ecs/main.tf")
    assert ix.search("checks the certificate protocol", kinds={"script"})[0]["path"].endswith("tls-check.sh")


def test_filters_by_kind_and_stage(repo):
    ix = index(repo)
    assert {h["kind"] for h in ix.search("cognito", kinds={"notes"})} <= {"notes"}
    assert {h["stage"] for h in ix.search("cognito", stage="demo-auth")} == {"demo-auth"}


def test_plans_rank_below_readmes_and_notes(repo):
    write(repo, "docs/superpowers/plans/p.md", "# Plan\n\nlambda alias version order rollout bind mounts checkout\n")
    hits = index(repo).search("lambda alias version order rollout")
    assert hits[0]["kind"] == "notes"


def test_nothing_is_returned_for_an_empty_or_unknown_query(repo):
    ix = index(repo)
    assert ix.search("   ") == [] and ix.search("zzzzqqqq") == []


def test_the_sample_app_source_and_secrets_are_not_indexed(repo):
    write(repo, "apps/backend/internal/x.go", "// secretword in application source\npackage x\n")
    write(repo, "apps/backend/README.md", "# Backend\n\nreadmeword\n")
    ix = index(repo)
    assert ix.search("secretword") == []
    assert ix.search("readmeword")  # a README of an app is documentation
    assert ix.search("state") == [] or all("tfstate" not in h["path"] for h in ix.search("state"))
