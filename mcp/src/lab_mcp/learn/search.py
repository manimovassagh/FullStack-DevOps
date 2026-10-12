"""Search over the blueprint: Markdown sections, notes, and the comments in Terraform, scripts, Makefiles, compose
files and workflows. Pure Python (BM25), no network. Every hit carries a citation: path:first-last line."""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from lab_mcp.common.paths import walk_files

from . import markdown as md

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP = frozenset("a an and are as at be but by for from has have how i if in into is it its of on or so than that the "
                 "their then there these this to was were what when where which who why will with you your do does did "
                 "can could should would not no we our".split())


@dataclass
class Chunk:
    path: str
    start: int
    end: int
    title: str
    kind: str       # doc | notes | adr | plan | terraform | script | makefile | compose | workflow
    stage: str      # stage id when under deployment/<cloud>/<id>/, else ""
    text: str

    @property
    def citation(self) -> str:
        return f"{self.path}:{self.start}-{self.end}" if self.end != self.start else f"{self.path}:{self.start}"


def stem(t: str) -> str:
    """Plural-only stemming (mounts -> mount, rules -> rule, policies -> policy): enough for a technical corpus."""
    if len(t) > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss") and not t.endswith("us"):
        return t[:-1]
    return t


def tokens(text: str) -> list[str]:
    return [stem(t) for t in TOKEN_RE.findall(text.lower()) if t not in STOP and len(t) > 1]


def _kind(rel: str) -> str:
    name = Path(rel).name
    if name == "FLOCI-NOTES.md":
        return "notes"
    if rel.startswith("docs/adr/"):
        return "adr"
    if rel.startswith("docs/superpowers/"):
        return "plan"
    if rel.endswith(".md"):
        return "doc"
    if rel.endswith(".tf"):
        return "terraform"
    if rel.endswith(".sh"):
        return "script"
    if name == "Makefile":
        return "makefile"
    if name.startswith("compose") or name == "Caddyfile":
        return "compose"
    if rel.startswith(".github/workflows/"):
        return "workflow"
    return ""


def _stage_of(rel: str) -> str:
    parts = rel.split("/")
    return parts[2] if len(parts) > 3 and parts[0] == "deployment" and parts[1] in ("aws", "gcp", "azure") else ""


def _comment_blocks(lines: list[str], marker: str = "#") -> list[tuple[int, int]]:
    """(first, last) 1-based line ranges of runs of at least two comment lines, plus the line after the run."""
    out, i = [], 0
    while i < len(lines):
        if lines[i].lstrip().startswith(marker) and not lines[i].startswith("#!"):
            j = i
            while j + 1 < len(lines) and lines[j + 1].lstrip().startswith(marker):
                j += 1
            if j > i:
                out.append((i + 1, min(j + 2, len(lines))))
            i = j + 1
        else:
            i += 1
    return out


def chunks_for(root: Path, rel: str) -> list[Chunk]:
    kind = _kind(rel)
    if not kind:
        return []
    try:
        text = (root / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    stage = _stage_of(rel)
    if kind in ("doc", "notes", "adr", "plan"):
        _, body, skipped = md.split_front_matter(text)
        return [Chunk(rel, s.start + skipped, s.end + skipped, s.title or Path(rel).stem, kind, stage, s.text)
                for s in md.sections(body)]
    lines = text.splitlines()
    out = []
    for first, last in _comment_blocks(lines):
        block = "\n".join(lines[first - 1:last])
        title = next((l.strip() for l in lines[last - 1:last + 1] if l.strip() and not l.strip().startswith("#")), "")
        out.append(Chunk(rel, first, last, title[:80] or Path(rel).name, kind, stage, block))
    return out


class Index:
    def __init__(self, root: Path, stage_ids: list[str]):
        self.root = root
        self.stage_ids = sorted(stage_ids, key=len, reverse=True)
        self.chunks: list[Chunk] = []
        for rel in walk_files(root):
            r = str(rel)
            if r.startswith("apps/") and not r.endswith("README.md"):
                continue  # the sample application's source is not part of the blueprint's teaching material
            self.chunks += chunks_for(root, r)
        self.tf: list[Counter] = []
        self.df: Counter = Counter()
        for c in self.chunks:
            title_tokens = tokens(c.title) * 3 + tokens(c.path.replace("/", " ").replace("-", " ")) * 2
            tf = Counter(tokens(c.text) + title_tokens)
            self.tf.append(tf)
            self.df.update(tf.keys())
        self.n = max(len(self.chunks), 1)
        self.avg = sum(sum(t.values()) for t in self.tf) / self.n or 1.0

    def _idf(self, term: str) -> float:
        d = self.df.get(term, 0)
        return math.log(1 + (self.n - d + 0.5) / (d + 0.5))

    def search(self, query: str, limit: int = 8, kinds: set[str] | None = None, stage: str | None = None) -> list[dict]:
        terms = tokens(query)
        if not terms:
            return []
        q_low = query.lower()
        mentioned = {s for s in self.stage_ids if s in q_low}
        k1, b = 1.5, 0.75
        scored: list[tuple[float, int]] = []
        for i, c in enumerate(self.chunks):
            if kinds and c.kind not in kinds:
                continue
            if stage and c.stage != stage:
                continue
            tf, dl = self.tf[i], sum(self.tf[i].values())
            score = 0.0
            for t in terms:
                f = tf.get(t, 0)
                if f:
                    score += self._idf(t) * f * (k1 + 1) / (f + k1 * (1 - b + b * dl / self.avg))
            if score <= 0:
                continue
            if c.stage and c.stage in mentioned:
                score *= 1.6
            if c.kind in ("notes", "adr"):
                score *= 1.15  # the "why" lives here
            elif c.kind == "plan":
                score *= 0.7  # design plans describe intent; READMEs and notes describe what exists
            scored.append((score, i))
        scored.sort(reverse=True)
        out, seen = [], set()
        for score, i in scored:
            c = self.chunks[i]
            key = (c.path, c.start // 40)
            if key in seen:
                continue
            seen.add(key)
            out.append({"path": c.path, "lines": f"{c.start}-{c.end}", "citation": c.citation, "title": c.title,
                        "kind": c.kind, "stage": c.stage, "score": round(score, 2), "snippet": snippet(c.text, terms)})
            if len(out) >= limit:
                break
        return out


def snippet(text: str, terms: list[str], width: int = 360) -> str:
    lines = [l for l in text.splitlines() if l.strip()]
    hit = [l for l in lines if any(t in l.lower() for t in terms)]
    chosen = (hit or lines)[:4]
    s = " ⏎ ".join(l.strip() for l in chosen)
    return s if len(s) <= width else s[:width - 1] + "…"
