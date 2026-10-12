"""Small Markdown helpers: front-matter, title, summary, sections with line numbers, tables."""
from __future__ import annotations

import re
from dataclasses import dataclass

import yaml


@dataclass(frozen=True)
class Section:
    title: str
    level: int
    start: int  # 1-based line of the heading (or 1 for text before the first heading)
    end: int    # 1-based, inclusive
    text: str


def split_front_matter(text: str) -> tuple[dict, str, int]:
    """(front-matter dict, body, number of lines the front-matter took)."""
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            raw = text[4:end]
            consumed = text[: end + 4].count("\n") + 1
            try:
                data = yaml.safe_load(raw) or {}
            except yaml.YAMLError:
                data = {}
            body = text[end + 4:].lstrip("\n")
            return (data if isinstance(data, dict) else {}), body, consumed
    return {}, text, 0


def title_of(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def first_paragraph(text: str) -> str:
    """The first prose paragraph after the title (skips code fences, tables, lists, block quotes)."""
    in_fence, para = False, []
    seen_title = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.startswith("# ") and not seen_title:
            seen_title = True
            continue
        if not s:
            if para:
                break
            continue
        if s.startswith(("#", "|", "- ", "* ", ">", "<")):
            if para:
                break
            continue
        para.append(s)
    return re.sub(r"\s+", " ", " ".join(para)).strip()


def sections(text: str, max_lines: int = 60) -> list[Section]:
    """Heading-based sections (code fences respected), long ones split into chunks of at most max_lines."""
    lines = text.splitlines()
    marks: list[tuple[int, int, str]] = []  # (line index, level, title)
    in_fence = False
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_fence = not in_fence
        if not in_fence:
            m = re.match(r"^(#{1,4})\s+(.*)$", line)
            if m:
                marks.append((i, len(m.group(1)), m.group(2).strip()))
    if not marks or marks[0][0] > 0:
        marks.insert(0, (0, 0, ""))
    out: list[Section] = []
    for k, (i, level, title) in enumerate(marks):
        j = marks[k + 1][0] if k + 1 < len(marks) else len(lines)
        block = lines[i:j]
        while block and not block[-1].strip():
            block.pop()
        if not any(b.strip() for b in block):
            continue
        for off in range(0, len(block), max_lines):
            part = block[off:off + max_lines]
            out.append(Section(title, level, i + off + 1, i + off + len(part), "\n".join(part)))
    return out


def table_after(text: str, heading_contains: str) -> list[dict[str, str]]:
    """The first Markdown table under a heading containing `heading_contains`, as a list of row dicts."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^#{1,4}\s", line) and heading_contains.lower() in line.lower():
            j = i + 1
            while j < len(lines) and not lines[j].lstrip().startswith("|"):
                if re.match(r"^#{1,4}\s", lines[j]):
                    break
                j += 1
            rows = []
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                rows.append([c.strip() for c in lines[j].strip().strip("|").split("|")])
                j += 1
            if len(rows) >= 3:
                head = rows[0]
                return [dict(zip(head, r)) for r in rows[2:] if len(r) == len(head)]
            return []
    return []


def code_after(text: str, heading_contains: str) -> str:
    """The first fenced or indented code block under a heading containing `heading_contains`."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^#{1,4}\s", line) and heading_contains.lower() in line.lower():
            block, in_fence = [], False
            for l in lines[i + 1:]:
                if re.match(r"^#{1,4}\s", l):
                    break
                if l.strip().startswith("```"):
                    if in_fence:
                        break
                    in_fence = True
                    continue
                if in_fence or l.startswith("    "):
                    block.append(l[4:] if l.startswith("    ") and not in_fence else l)
                elif block:
                    break
            return "\n".join(block).strip()
    return ""
