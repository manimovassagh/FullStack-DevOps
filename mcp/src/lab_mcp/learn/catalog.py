"""The catalog: one record per deployment stage, generated from the repository (never stored, never hand-edited).

    python -m lab_mcp.learn.catalog            # a table of every stage
    python -m lab_mcp.learn.catalog --json     # the full catalog
    python -m lab_mcp.learn.catalog --check    # exit 1 when the docs and the generator disagree (CI)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

from lab_mcp.common.config import ConfigError, load
from lab_mcp.common.paths import walk_files

from . import markdown as md
from .concepts import TEXT_CONCEPTS, concepts_for_resource

RESOURCE_RE = re.compile(r'^resource\s+"([A-Za-z0-9_]+)"\s+"([^"]+)"', re.M)
PORT_RE = re.compile(r'^\s*-\s*"(?:127\.0\.0\.1:)?(\d+):(\d+)')


@dataclass
class Resource:
    type: str
    name: str
    file: str
    line: int


@dataclass
class Stage:
    id: str
    cloud: str
    path: str
    title: str = ""
    summary: str = ""
    readme: str | None = None
    notes: str | None = None
    builds_on: list[str] = field(default_factory=list)
    concepts: list[str] = field(default_factory=list)
    resources: list[Resource] = field(default_factory=list)
    ports: list[int] = field(default_factory=list)
    workflows: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    teaches: list[dict[str, str]] = field(default_factory=list)
    run: str = ""
    front_matter: dict = field(default_factory=dict)

    @property
    def resource_counts(self) -> dict[str, int]:
        return dict(Counter(r.type for r in self.resources).most_common())

    @property
    def has_teaching_table(self) -> bool:
        return bool(self.teaches)


@dataclass
class Catalog:
    root: Path
    stages: dict[str, Stage]
    docs: list[str]


DOC_PATTERNS = ("README.md", "deployment/README.md", "deployment/ROADMAP.md", "docs/*.md", "docs/adr/*.md",
                "docs/superpowers/plans/*.md", "docs/superpowers/specs/*.md", "platform/*/README.md",
                "apps/*/README.md", "mcp/README.md")


def _read(root: Path, rel: str | None) -> str:
    if not rel:
        return ""
    try:
        return (root / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _stage_dirs(root: Path) -> list[tuple[str, str]]:
    out = []
    dep = root / "deployment"
    for cloud in sorted(p for p in dep.iterdir() if p.is_dir()):
        for d in sorted(p for p in cloud.iterdir() if p.is_dir()):
            if any(d.glob("*.tf")) or (d / "README.md").is_file():
                out.append((cloud.name, d.name))
    return out


def build_catalog(root: Path) -> Catalog:
    root = root.resolve()
    all_files = [str(p) for p in walk_files(root)]
    workflows = {rel: _read(root, rel) for rel in all_files if rel.startswith(".github/workflows/") and rel.endswith(".yml")}
    stages: dict[str, Stage] = {}
    for cloud, sid in _stage_dirs(root):
        base = f"deployment/{cloud}/{sid}"
        files = sorted(f for f in all_files if f.startswith(base + "/"))
        st = Stage(id=sid, cloud=cloud, path=base, files=files)
        if f"{base}/README.md" in files:
            st.readme = f"{base}/README.md"
        if f"{base}/FLOCI-NOTES.md" in files:
            st.notes = f"{base}/FLOCI-NOTES.md"
        raw = _read(root, st.readme)
        st.front_matter, body, _ = md.split_front_matter(raw)
        st.title = md.title_of(body) or sid
        st.summary = md.first_paragraph(body)
        st.teaches = md.table_after(body, "What each file teaches")
        st.run = md.code_after(body, "Run it")
        for f in files:
            if not f.endswith(".tf"):
                continue
            text = _read(root, f)
            for m in RESOURCE_RE.finditer(text):
                st.resources.append(Resource(m.group(1), m.group(2), f, text.count("\n", 0, m.start()) + 1))
        compose = _read(root, f"{base}/compose.yaml")
        st.ports = sorted({int(m.group(1)) for line in compose.splitlines() if (m := PORT_RE.match(line))})
        st.workflows = sorted(Path(w).name for w, t in workflows.items() if f"{base}/**" in t)
        found = {c for r in st.resources if (c := concepts_for_resource(r.type))}
        text_all = body + "\n" + _read(root, st.notes)
        found |= {name for name, rx in TEXT_CONCEPTS if rx.search(text_all)}
        if any(f.endswith(("Caddyfile", "scripts/tls-check.sh")) or "caddy" in f.lower() for f in files):
            found.add("tls-https")
        found |= {str(c) for c in (st.front_matter.get("concepts") or [])}
        st.concepts = sorted(found)
        stages[sid] = st
    for st in stages.values():  # "builds on": README links to a sibling stage near the top
        head = "\n".join(_read(root, st.readme).splitlines()[:30])
        refs = re.findall(r"\]\((?:\.\./)+([A-Za-z0-9._-]+)/?\)", head)
        explicit = [str(x) for x in (st.front_matter.get("builds_on") or [])]
        st.builds_on = [r for r in dict.fromkeys([*explicit, *refs]) if r in stages and r != st.id]
    docs: list[str] = []
    for pat in DOC_PATTERNS:
        docs += sorted(str(p.relative_to(root)) for p in root.glob(pat) if p.is_file())
    return Catalog(root=root, stages=stages, docs=list(dict.fromkeys(docs)))


def stage_to_dict(s: Stage, full: bool = True) -> dict:
    d = {"id": s.id, "cloud": s.cloud, "path": s.path, "title": s.title, "summary": s.summary,
         "concepts": s.concepts, "builds_on": s.builds_on, "ports": s.ports, "workflows": s.workflows,
         "readme": s.readme, "notes": s.notes}
    if full:
        d |= {"resource_counts": s.resource_counts, "files": s.files, "teaches": s.teaches, "run": s.run}
    return d


def check(cat: Catalog) -> tuple[list[str], list[str]]:
    """(errors, warnings). Errors mean the docs and the generator disagree; warnings are content still to write."""
    errors, warnings = [], []
    for s in cat.stages.values():
        if not s.readme:
            errors.append(f"{s.path}: no README.md")
        elif not s.summary:
            errors.append(f"{s.readme}: no summary paragraph after the title")
        if not s.notes:
            errors.append(f"{s.path}: no FLOCI-NOTES.md")
        if not s.concepts:
            errors.append(f"{s.path}: no concepts found (no Terraform resources and no front-matter)")
        if not s.workflows:
            warnings.append(f"{s.path}: no workflow runs this stage")
        if s.readme and not s.has_teaching_table:
            warnings.append(f"{s.readme}: no 'What each file teaches' table")
    if not cat.stages:
        errors.append("no stages found under deployment/")
    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", help="the repository (default: LAB_ROOT or the checkout)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    try:
        root = Path(a.root).resolve() if a.root else load().root
    except ConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    cat = build_catalog(root)
    if a.json:
        print(json.dumps({"stages": [stage_to_dict(s) for s in cat.stages.values()], "docs": cat.docs}, indent=2))
        return 0
    if a.check:
        errors, warnings = check(cat)
        for w in warnings:
            print(f"warning: {w}")
        for e in errors:
            print(f"ERROR: {e}")
        print(f"{len(cat.stages)} stages, {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1 if errors else 0
    print(f"{'STAGE':<30}{'CLOUD':<7}{'FILES':>5} {'RES':>4}  CONCEPTS")
    for s in cat.stages.values():
        print(f"{s.id:<30}{s.cloud:<7}{len(s.files):>5} {len(s.resources):>4}  {', '.join(s.concepts[:6])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
