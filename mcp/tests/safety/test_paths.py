"""The file guard: nothing outside the repository, no secrets, no state, no binaries."""
import os

import pytest

from lab_mcp.common.config import ConfigError, load
from lab_mcp.common.paths import PathNotAllowed, safe_path, walk_files

from ..conftest import write


def test_a_repository_file_is_served(repo):
    assert safe_path(repo, "deployment/aws/demo-ecs/main.tf").name == "main.tf"
    assert safe_path(repo, "README.md").name == "README.md"


@pytest.mark.parametrize("rel", ["../outside.md", "deployment/../../outside.md", "/etc/passwd", "", "a\0b.md"])
def test_paths_outside_the_repository_are_refused(repo, rel):
    with pytest.raises(PathNotAllowed):
        safe_path(repo, rel)


def test_a_symlink_out_of_the_repository_is_refused(repo, tmp_path):
    secret = tmp_path / "secret.md"
    secret.write_text("secret")
    os.symlink(secret, repo / "docs" / "link.md")
    with pytest.raises(PathNotAllowed, match="outside"):
        safe_path(repo, "docs/link.md")


@pytest.mark.parametrize("rel", [
    "deployment/aws/demo-ecs/terraform.tfstate",   # state
    "deployment/aws/demo-tls/certs/tls-key.pem",   # key, in a denied folder
    "deployment/aws/demo-ecs/.env",                # environment file
    "deployment/aws/demo-ecs/build/out.txt",       # build output folder
    "deployment/aws/demo-tls/vars.tfvars",         # variable file
])
def test_secrets_state_and_build_output_are_never_served(repo, rel):
    with pytest.raises(PathNotAllowed):
        safe_path(repo, rel)


def test_binaries_and_unknown_kinds_are_refused(repo):
    write(repo, "docs/shot.png", "not text")
    write(repo, "docs/data.bin", "x")
    for rel in ("docs/shot.png", "docs/data.bin"):
        with pytest.raises(PathNotAllowed, match="text files"):
            safe_path(repo, rel)


def test_missing_and_oversized_files_are_refused(repo):
    with pytest.raises(PathNotAllowed, match="no such file"):
        safe_path(repo, "docs/missing.md")
    write(repo, "docs/big.md", "x" * (600 * 1024))
    with pytest.raises(PathNotAllowed, match="larger"):
        safe_path(repo, "docs/big.md")


def test_walking_never_enters_denied_folders_or_lists_secrets(repo):
    found = {str(p) for p in walk_files(repo)}
    assert "deployment/aws/demo-ecs/main.tf" in found
    assert not [f for f in found if "tfstate" in f or "certs/" in f or "/build/" in f or f.endswith((".env", ".tfvars", ".pem"))]


def test_config_finds_the_repository_from_the_environment_and_refuses_a_wrong_folder(repo, tmp_path):
    cfg = load({"LAB_ROOT": str(repo), "LAB_PANEL_URL": "http://x:1/", "LAB_OPERATE_READONLY": "1"})
    assert cfg.root == repo.resolve() and cfg.panel_url == "http://x:1" and cfg.read_only
    with pytest.raises(ConfigError, match="LAB_ROOT"):
        load({"LAB_ROOT": str(tmp_path)})
