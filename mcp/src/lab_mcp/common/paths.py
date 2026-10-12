"""The only way the servers read repository files.

Everything handed to an AI goes through here: a path must stay inside the repository (no `..`, no absolute path,
no symlink out), must be a small text file of a known kind, and must not be something that holds secrets or state
(Terraform state, certificates and keys, .env files, variable files, the panel's logs). File contents are data:
nothing in them is ever treated as an instruction.
"""
from __future__ import annotations

from pathlib import Path

MAX_BYTES = 512 * 1024

# Folders that are never read or indexed: dependencies, build output, runtime data, secrets.
DENY_DIRS = frozenset({".git", ".terraform", "node_modules", "certs", ".logs", ".session", "build", ".venv", "venv",
                       "__pycache__", "dist", "test-results", "playwright-report", ".pytest_cache", ".idea", ".vscode"})
# Files that are never read: secrets, state, runtime data.
DENY_SUFFIXES = (".pem", ".key", ".crt", ".p12", ".tfstate", ".backup", ".tfvars", ".pid", ".log")
DENY_NAMES = frozenset({".history.json", ".DS_Store"})
# Text files worth reading: documentation, infrastructure code, scripts, configuration.
TEXT_SUFFIXES = frozenset({".md", ".tf", ".tftpl", ".sh", ".yaml", ".yml", ".json", ".toml", ".py", ".ts", ".tsx",
                           ".go", ".js", ".mjs", ".css", ".html", ".conf", ".sql", ".txt", ".hcl", ".mod"})
TEXT_NAMES = frozenset({"Makefile", "Dockerfile", "Caddyfile", ".gitignore", ".dockerignore", ".editorconfig"})


class PathNotAllowed(Exception):
    """The path is outside the repository, or is a file kind the servers do not serve."""


def is_denied(rel: Path) -> bool:
    parts = rel.parts
    if any(p in DENY_DIRS for p in parts[:-1]):
        return True
    name = parts[-1] if parts else ""
    if name in DENY_NAMES or name.startswith(".env"):
        return True
    return name.endswith(DENY_SUFFIXES)


def is_text_file(rel: Path) -> bool:
    return rel.name in TEXT_NAMES or rel.suffix in TEXT_SUFFIXES


def safe_path(root: Path, rel: str) -> Path:
    """Resolve `rel` (relative to the repository) or raise PathNotAllowed. Returns the absolute path."""
    if not rel or "\0" in rel:
        raise PathNotAllowed("empty or invalid path")
    if Path(rel).is_absolute():
        raise PathNotAllowed("give a path relative to the repository, not an absolute one")
    root = root.resolve()
    target = (root / rel).resolve()  # resolves symlinks and `..`
    try:
        inside = target.relative_to(root)
    except ValueError:
        raise PathNotAllowed("path is outside the repository") from None
    if is_denied(inside):
        raise PathNotAllowed("this file is never served (secrets, state, build output or runtime data)")
    if not is_text_file(inside):
        raise PathNotAllowed("only text files (docs, Terraform, scripts, configuration) are served")
    if not target.is_file():
        raise PathNotAllowed("no such file")
    if target.stat().st_size > MAX_BYTES:
        raise PathNotAllowed(f"file is larger than {MAX_BYTES // 1024} KB")
    return target


def walk_files(root: Path):
    """Every servable file under the repository, as paths relative to it (denied folders are not entered)."""
    root = root.resolve()
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            entries = sorted(d.iterdir())
        except OSError:
            continue
        for e in entries:
            rel = e.relative_to(root)
            if e.is_dir():
                if e.name not in DENY_DIRS and not e.is_symlink():
                    stack.append(e)
            elif e.is_file() and not e.is_symlink() and is_text_file(rel) and not is_denied(rel):
                yield rel
