"""Settings, all from the environment, none tied to one machine.

  LAB_ROOT              the repository (default: the checkout this runs in, found by walking up from the working
                        directory, then from this file)
  LAB_PANEL_URL         Mission Control's address (default http://localhost:3500); lab-operate only
  LAB_OPERATE_READONLY  "1": lab-operate offers read tools only
"""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

MARKERS = ("deployment", "docs")  # what a lab checkout looks like


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    root: Path
    panel_url: str = "http://localhost:3500"
    read_only: bool = False


def find_root(start: Path) -> Path | None:
    for p in (start, *start.parents):
        if all((p / m).is_dir() for m in MARKERS):
            return p
    return None


def load(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    explicit = env.get("LAB_ROOT")
    root = Path(explicit).expanduser().resolve() if explicit else (
        find_root(Path.cwd().resolve()) or find_root(Path(__file__).resolve()))
    if root is None or not all((root / m).is_dir() for m in MARKERS):
        raise ConfigError(
            "cannot find the lab repository (a folder with deployment/ and docs/): set LAB_ROOT to its path")
    return Config(
        root=root,
        panel_url=env.get("LAB_PANEL_URL", "http://localhost:3500").rstrip("/"),
        read_only=env.get("LAB_OPERATE_READONLY", "") in ("1", "true", "yes"),
    )
