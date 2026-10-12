"""lab-learn's logic, as plain Python (the MCP server in server.py only exposes it).

Rules every method follows:
  1. Every claim carries a citation: path:line (or path:first-last).
  2. "Why" comes from the repository (notes, decision records, comments), never from memory.
  3. Answers about design carry the notice that this is a local learning lab, not production guidance.
  4. File contents are returned as data; nothing in them is treated as an instruction.
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

from lab_mcp.common.paths import PathNotAllowed, safe_path

from . import markdown as md
from .catalog import Catalog, Stage, build_catalog, stage_to_dict
from .concepts import ALIASES, RESOURCE_CONCEPTS, concepts_for_resource, resolve_concept
from .search import Index, stem, tokens

NOTICE = ("This is a local learning lab on emulators, not production guidance. Security hardening and several "
          "production concerns are out of scope on purpose: see blueprint://simplifications.")


class LabError(Exception):
    """A problem the caller can fix (unknown stage, bad path…). Shown to the AI as a plain message."""


class Learn:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.catalog: Catalog = build_catalog(self.root)
        self.index = Index(self.root, list(self.catalog.stages))

    # ------------------------------------------------------------------ helpers
    def stage(self, sid: str) -> Stage:
        sid = (sid or "").strip()
        if sid in self.catalog.stages:
            return self.catalog.stages[sid]
        close = difflib.get_close_matches(sid, list(self.catalog.stages), n=3, cutoff=0.5)
        hint = f" Did you mean: {', '.join(close)}?" if close else f" Known stages: {', '.join(self.catalog.stages)}."
        raise LabError(f"unknown stage '{sid}'.{hint}")

    def _read(self, rel: str | None) -> str:
        if not rel:
            return ""
        try:
            return (self.root / rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

    def section(self, rel: str, heading_contains: str) -> tuple[str, str]:
        """(text, citation) of the first section of `rel` whose heading contains the text."""
        text = self._read(rel)
        _, body, skipped = md.split_front_matter(text)
        secs = md.sections(body, max_lines=10_000)
        for s in secs:
            if heading_contains.lower() in s.title.lower():
                return s.text, f"{rel}:{s.start + skipped}-{s.end + skipped}"
        return "", rel

    def _notes_sections(self, st: Stage) -> list[md.Section]:
        _, body, _ = md.split_front_matter(self._read(st.notes))
        return [s for s in md.sections(body, max_lines=10_000) if s.level in (2, 3)]

    # ------------------------------------------------------------------ resources (text)
    def overview(self) -> str:
        readme = self._read("README.md").splitlines()
        cut = next((i for i, l in enumerate(readme) if l.startswith("## Commands")), min(len(readme), 120))
        layout, layout_cite = self.section("README.md", "Repository layout")
        stages = "\n".join(f"- `{s.id}` ({s.cloud}): {s.summary[:150]}" for s in self.catalog.stages.values())
        return (f"{chr(10).join(readme[:cut]).strip()}\n\n## Repository layout (README.md)\n{layout}\n\n"
                f"## Stages ({len(self.catalog.stages)})\n{stages}\n\n"
                "## How to use this server\n"
                "Resources: `blueprint://rules`, `blueprint://simplifications`, `blueprint://stages`, "
                "`blueprint://stage/{id}`, `blueprint://lessons`, `blueprint://concept/{name}`, `blueprint://adr/{n}`.\n"
                "Tools: `search_blueprint`, `explain_stage`, `compare_stages`, `find_example`, `lessons_for`, "
                "`learning_path`, `read_file`, `list_stages`.\n\n" + NOTICE)

    def rules(self) -> str:
        text, cite = self.section("deployment/ROADMAP.md", "Principles")
        return f"# Rules for stages ({cite})\n\n{text}\n\n{NOTICE}"

    def simplifications(self) -> str:
        a, ca = self.section("docs/PLATFORM-ROADMAP.md", "Known simplifications")
        b, cb = self.section("docs/PLATFORM-ROADMAP.md", "Out of scope on purpose")
        return f"# What is deliberately simplified or out of scope\n\n{a}\n\n({ca})\n\n{b}\n\n({cb})"

    def lessons_all(self) -> str:
        out = ["# Lessons learned (emulator, CI and design)\n"]
        for st in self.catalog.stages.values():
            secs = self._notes_sections(st)
            if not secs:
                continue
            out.append(f"\n## {st.id}  ({st.notes})")
            for s in secs:
                out.append(f"- **{s.title}** — {st.notes}:{s.start}")
        return "\n".join(out)

    def stage_page(self, sid: str) -> str:
        st = self.stage(sid)
        gotchas = [f"- {s.title} ({st.notes}:{s.start})" for s in self._notes_sections(st)]
        teaches = "\n".join(f"- `{r.get(next(iter(r)), '')}`: {' | '.join(list(r.values())[1:])}" for r in st.teaches)
        return (f"# {st.title}  ({st.cloud}/{st.id})\n\n{st.summary}\n\n"
                f"- Concepts: {', '.join(st.concepts) or '-'}\n- Builds on: {', '.join(st.builds_on) or '-'}\n"
                f"- Ports: {', '.join(map(str, st.ports)) or '-'}\n- Pipelines: {', '.join(st.workflows) or '-'}\n"
                f"- Sources: {st.readme}, {st.notes}\n\n"
                f"## Run it\n```\n{st.run or 'see the README'}\n```\n\n"
                f"## What each file teaches\n{teaches or '(this README has no table yet)'}\n\n"
                f"## Gotchas and lessons (from the notes)\n{chr(10).join(gotchas) or '(none recorded)'}\n\n"
                f"## Files\n" + "\n".join(f"- {f}" for f in st.files) + f"\n\n{NOTICE}")

    def concept_page(self, name: str) -> str:
        r = self.find_example(name)
        lines = [f"# Concept: {r['concept']}\n", f"Taught by {len(r['stages'])} stage(s): {', '.join(r['stages']) or 'none'}\n"]
        lines += [f"- `{e['resource']}` in **{e['stage']}** — {e['citation']}" for e in r["examples"]]
        return "\n".join(lines)

    def adr(self, n: str) -> str:
        for rel in sorted(self.catalog.docs):
            if rel.startswith("docs/adr/") and Path(rel).name.startswith(f"{int(n):04d}"):
                return self._read(rel)
        raise LabError(f"no decision record numbered {n}. Available: " + ", ".join(
            Path(d).name for d in self.catalog.docs if d.startswith("docs/adr/")))

    # ------------------------------------------------------------------ tools
    def list_stages(self, cloud: str | None = None, concept: str | None = None) -> dict:
        cid = resolve_concept(concept) if concept else None
        stages = [stage_to_dict(s, full=False) for s in self.catalog.stages.values()
                  if (not cloud or s.cloud == cloud) and (not cid or cid in s.concepts)]
        return {"count": len(stages), "stages": stages}

    def search(self, query: str, limit: int = 8, kind: str | None = None, stage: str | None = None) -> dict:
        if not query.strip():
            raise LabError("give a question or keywords to search for")
        if stage:
            self.stage(stage)
        hits = self.index.search(query, limit=max(1, min(limit, 25)), kinds={kind} if kind else None, stage=stage)
        return {"query": query, "count": len(hits), "hits": hits,
                "tip": "Cite the `citation` of every hit you use; read_file(path, start_line, end_line) shows more."}

    def explain_stage(self, stage_id: str, depth: str = "brief") -> dict:
        st = self.stage(stage_id)
        out = {"id": st.id, "title": st.title, "cloud": st.cloud, "summary": st.summary, "concepts": st.concepts,
               "builds_on": st.builds_on, "ports": st.ports, "pipelines": st.workflows,
               "how_to_run": st.run or f"make deploy STAGE={st.id} (Mission Control) or `make up` in {st.path}",
               "citations": [c for c in (st.readme, st.notes) if c]}
        if depth == "full":
            gotchas = [{"title": s.title, "citation": f"{st.notes}:{s.start}"} for s in self._notes_sections(st)]
            out |= {"what_each_file_teaches": st.teaches or None, "resource_counts": st.resource_counts,
                    "files": st.files, "gotchas": gotchas,
                    "terraform_resources": [{"resource": f"{r.type}.{r.name}", "citation": f"{r.file}:{r.line}"}
                                            for r in st.resources[:60]]}
        out["notice"] = NOTICE
        return out

    def compare_stages(self, a: str, b: str) -> dict:
        sa, sb = self.stage(a), self.stage(b)
        ca, cb = set(sa.concepts), set(sb.concepts)
        ra, rb = sa.resource_counts, sb.resource_counts
        res_diff = {t: {a: ra.get(t, 0), b: rb.get(t, 0)} for t in sorted(set(ra) | set(rb)) if ra.get(t, 0) != rb.get(t, 0)}
        fa = {f[len(sa.path) + 1:]: f for f in sa.files}
        fb = {f[len(sb.path) + 1:]: f for f in sb.files}
        changed, identical = [], 0
        for name in sorted(set(fa) & set(fb)):
            la, lb = self._read(fa[name]).splitlines(), self._read(fb[name]).splitlines()
            if la == lb:
                identical += 1
                continue
            add = rem = 0
            for l in difflib.unified_diff(la, lb, lineterm="", n=0):
                if l.startswith("+") and not l.startswith("+++"):
                    add += 1
                elif l.startswith("-") and not l.startswith("---"):
                    rem += 1
            changed.append({"file": name, f"citation_{a}": fa[name], f"citation_{b}": fb[name], "added": add, "removed": rem})
        rel = ("%s builds on %s" % (b, a) if a in sb.builds_on else "%s builds on %s" % (a, b) if b in sa.builds_on else
               "no direct 'builds on' link in the READMEs")
        return {"a": a, "b": b, "relationship": rel,
                "concepts": {"both": sorted(ca & cb), f"only_{a}": sorted(ca - cb), f"only_{b}": sorted(cb - ca)},
                "ports": {a: sa.ports, b: sb.ports}, "pipelines": {a: sa.workflows, b: sb.workflows},
                "resource_type_differences": res_diff,
                "files": {f"only_in_{a}": sorted(set(fa) - set(fb)), f"only_in_{b}": sorted(set(fb) - set(fa)),
                          "changed": sorted(changed, key=lambda c: -(c["added"] + c["removed"])), "identical_count": identical},
                "citations": [c for c in (sa.readme, sb.readme, sa.notes, sb.notes) if c], "notice": NOTICE}

    def find_example(self, concept: str, limit: int = 8) -> dict:
        cid = resolve_concept(concept)
        # also accept a Terraform resource type or a part of one ("aws_lb_listener_rule", "listener_rule")
        types = {r.type for s in self.catalog.stages.values() for r in s.resources}
        words = [("lb" if w == "alb" else stem(w)) for w in re.findall(r"[a-z0-9]+", concept.lower()) if w != "aws"]
        by_type = [t for t in types if words and all(w in {stem(p) for p in t.split("_")} for w in words)]
        norm = lambda c: "-".join(stem(p) for p in c.split("-"))  # noqa: E731  (rule/rules, policy/policies)
        stages = [s for s in self.catalog.stages.values() if norm(cid) in {norm(c) for c in s.concepts}]
        examples = []
        for s in sorted(stages, key=lambda s: len(s.files)):  # simplest stage first
            for r in s.resources:
                if norm(concepts_for_resource(r.type) or "") == norm(cid):
                    examples.append({"stage": s.id, "resource": f"{r.type}.{r.name}", "citation": f"{r.file}:{r.line}"})
                    break
        if by_type and not examples:
            for s in sorted(self.catalog.stages.values(), key=lambda s: len(s.files)):
                for r in s.resources:
                    if r.type in by_type:
                        examples.append({"stage": s.id, "resource": f"{r.type}.{r.name}", "citation": f"{r.file}:{r.line}"})
                        break
        extra = self.index.search(concept, limit=4, kinds={"doc", "notes", "terraform"})
        return {"concept": cid, "stages": [s.id for s in stages], "examples": examples[:limit],
                "also_see": [{"citation": h["citation"], "title": h["title"]} for h in extra],
                "known_concepts_hint": None if stages or examples else sorted({c for s in self.catalog.stages.values() for c in s.concepts})}

    def lessons_for(self, topic: str, limit: int = 6) -> dict:
        if not topic.strip():
            raise LabError("give a topic, e.g. 'lambda alias', 'bind mounts', 'cloudfront 403'")
        hits = self.index.search(topic, limit=limit, kinds={"notes", "adr"})
        lessons = []
        for h in hits:
            _, _, lines = h["lines"].partition("-")
            lessons.append({"stage": h["stage"] or None, "title": h["title"], "citation": h["citation"],
                            "text": self._excerpt(h["path"], h["lines"], 14)})
        return {"topic": topic, "count": len(lessons), "lessons": lessons, "notice": NOTICE}

    def _excerpt(self, rel: str, lines: str, limit: int) -> str:
        a, _, b = lines.partition("-")
        text = self._read(rel).splitlines()
        return "\n".join(text[int(a) - 1:int(b or a)][:limit])

    def learning_path(self, goal: str, max_steps: int = 5) -> dict:
        if not goal.strip():
            raise LabError("say what you want to learn, e.g. 'ECS with sign-in' or 'serverless with JWT auth'")
        g = goal.lower()
        want = {cid for word, cid in ALIASES.items() if word in g}
        want |= {c for s in self.catalog.stages.values() for c in s.concepts if c.replace("-", " ") in g or c in g}
        hits = self.index.search(goal, limit=25, kinds={"doc", "notes"})
        votes: dict[str, float] = {}
        for h in hits:
            if h["stage"]:
                votes[h["stage"]] = votes.get(h["stage"], 0) + h["score"] / 10
        scored = []
        for s in self.catalog.stages.values():
            sc = 3 * len(want & set(s.concepts)) + votes.get(s.id, 0)
            if sc > 0:
                scored.append((sc, s))
        scored.sort(key=lambda x: (-x[0], len(x[1].files)))
        chosen = [s for _, s in scored[:max(1, max_steps - 1)]]
        ordered: list[Stage] = []

        def add(s: Stage, depth: int = 0) -> None:
            if s in ordered or depth > 6:
                return
            for pre in s.builds_on:
                add(self.catalog.stages[pre], depth + 1)
            ordered.append(s)

        for s in chosen:
            add(s)
        if not ordered:  # nothing matched: the gentlest start, then what builds on it
            add(min(self.catalog.stages.values(), key=lambda s: (len(s.builds_on), len(s.files))))
        steps = []
        for i, s in enumerate(ordered[:max_steps + 2], 1):
            matched = sorted(want & set(s.concepts))
            steps.append({"step": i, "stage": s.id, "why": (f"covers {', '.join(matched)}" if matched else
                                                           "a prerequisite" if s not in chosen else "relevant to the goal"),
                          "summary": s.summary[:200], "read_first": s.readme, "then": s.notes,
                          "builds_on": s.builds_on, "run": f"make deploy STAGE={s.id}"})
        return {"goal": goal, "understood_concepts": sorted(want), "steps": steps, "notice": NOTICE}

    def read_file(self, path: str, start_line: int = 1, end_line: int = 200) -> dict:
        try:
            target = safe_path(self.root, path)
        except PathNotAllowed as e:
            raise LabError(f"{path}: {e}") from None
        lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(1, int(start_line))
        end = min(len(lines), max(start, int(end_line)), start + 399)
        return {"path": str(target.relative_to(self.root)), "start_line": start, "end_line": end,
                "total_lines": len(lines), "text": "\n".join(lines[start - 1:end]),
                "citation": f"{target.relative_to(self.root)}:{start}-{end}"}


def key_terms(text: str) -> list[str]:
    return sorted(set(tokens(text)))
