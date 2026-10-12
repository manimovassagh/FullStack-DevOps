"""Score lab-learn on questions.yaml against the real repository.

    python eval/run.py [--root PATH] [--min 0.9] [-v]

Exit code 1 when the score is below --min. Retrieval only: it checks that the right sources and phrases come back
with citations, which is what lab-learn promises. (Whether the AI then explains well is the client's job.)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from lab_mcp.common.config import load
from lab_mcp.learn.service import Learn


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root")
    ap.add_argument("--min", type=float, default=0.9)
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    root = Path(a.root).resolve() if a.root else load().root
    learn = Learn(root)
    questions = yaml.safe_load((Path(__file__).parent / "questions.yaml").read_text())
    passed, failures = 0, []
    for q in questions:
        try:
            method = {"search_blueprint": "search"}.get(q["tool"], q["tool"])  # MCP tool name -> service method
            result = getattr(learn, method)(**q["args"])
            blob = json.dumps(result, ensure_ascii=False).lower()
            missing = [e for e in q["expect"] if e.lower() not in blob]
            cited = blob.count("path") + blob.count("citation") + blob.count("read_first") + blob.count("deployment/")
            if not missing and cited == 0:
                missing = ["(no citation or path in the result)"]
        except Exception as e:  # a tool that fails is a failed question
            missing = [f"tool error: {e}"]
        if missing:
            failures.append((q["id"], q["question"], missing))
        else:
            passed += 1
        if a.v or missing:
            print(f"{'ok  ' if not missing else 'FAIL'} {q['id']:<18} {q['question']}" + (f"\n       missing: {missing}" if missing else ""))
    score = passed / len(questions)
    print(f"\n{passed}/{len(questions)} questions answered with the right sources: {score:.0%} (minimum {a.min:.0%})")
    return 0 if score >= a.min else 1


if __name__ == "__main__":
    sys.exit(main())
