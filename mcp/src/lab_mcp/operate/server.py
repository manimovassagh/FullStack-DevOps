"""lab-operate: run the local lab (deploy, smoke-test, pipelines, logs) through Mission Control, with guardrails.

Never touches Docker, a shell or files: it only calls Mission Control's HTTP API (panel.py), and Mission Control keeps
its own rules (one thing at a time, locks while CI runs). Destructive tools do nothing without confirm=true.
"""
from __future__ import annotations

import functools
import sys

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from lab_mcp import __version__
from lab_mcp.common.config import Config, ConfigError, load

from .panel import Panel
from .tools import Operate, OperateError

INSTRUCTIONS = """\
Controls the local Plant Parent cloud lab through Mission Control. Mission Control must be running \
(`make dashboard-up`); if it is not, the tools say so.

How to use it well:
- Look first: `list_stages`, `stage_status`, `ci_status`, `pipeline_runs`.
- Actions (`deploy_stage`, `smoke_stage`, `run_pipeline`…) start a job and return a `job_id` immediately. Deploys take \
minutes and pipelines up to ten: poll `job_log(job_id)` (use `next_from_line`) until the state is no longer 'running'. \
Never wait inside one call. Pipeline jobs are read with `job_log(job_id, kind='pipeline')`.
- One thing at a time: Mission Control refuses overlapping work and tells you what is running.
- Destructive tools (`destroy_stage`, `stop_emulator`, `stop_ci`, `stop_observability`, `cancel_job`) change nothing \
unless `confirm=true`. Call them without it first, show the user the stated effects, and confirm only if the user agreed.
- Long runs need the Mac awake (a sleep kills running jobs); say so to the user instead of working around it."""

LOOK = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
ACT = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)
DESTROY = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=False)


def as_tool_error(fn):
    """Show an OperateError's message to the client (it says what to do next)."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except OperateError as e:
            raise ToolError(str(e)) from None
    return wrapper


def build_server(config: Config | None = None, panel: Panel | None = None) -> MCPServer:
    cfg = config or load()
    op = Operate(panel or Panel(cfg.panel_url))
    mcp = MCPServer("lab-operate", instructions=INSTRUCTIONS, version=__version__)

    def tool(annotations):
        def deco(fn):
            return mcp.tool(annotations=annotations)(as_tool_error(fn))
        return deco

    # ---- read ------------------------------------------------------------------------------------
    @tool(LOOK)
    def list_stages() -> dict:
        """Every stage with its state (up, down, partial, stale), URL and any job running on it, plus which emulators are up."""
        return op.list_stages()

    @tool(LOOK)
    def stage_status(stage_id: str) -> dict:
        """One stage in detail: state and what it means, URL, resources, running job, last runs, login hints, Terraform outputs, containers."""
        return op.stage_status(stage_id)

    @tool(LOOK)
    def list_emulators() -> dict:
        """The local cloud emulators (Floci instances): port, up or down, which stages use each."""
        return op.list_emulators()

    @tool(LOOK)
    def ci_status() -> dict:
        """Local CI: is Gitea and its runner up, the available workflows, a job running now, the latest runs."""
        return op.ci_status()

    @tool(LOOK)
    def pipeline_runs(limit: int = 10, workflow: str | None = None) -> dict:
        """Recent pipeline runs with the status of each job (job_id is what job_log(kind='pipeline') takes). Optionally only one workflow."""
        return op.pipeline_runs(limit, workflow)

    @tool(LOOK)
    def recent_activity(limit: int = 10) -> dict:
        """Recent jobs Mission Control ran (deploys, destroys, smoke tests…) with exit codes and durations."""
        return op.recent_activity(limit)

    @tool(LOOK)
    def job_log(job_id: str, from_line: int = 0, tail: int = 120, kind: str = "panel") -> dict:
        """A job's log, ANSI colours removed. kind='panel' (default): a job Mission Control ran; poll with from_line=next_from_line. kind='pipeline': one job of a CI run (ids from pipeline_runs). Returns at most `tail` lines (10-400)."""
        return op.job_log(job_id, from_line, tail, kind)

    if cfg.read_only:  # LAB_OPERATE_READONLY=1: look, never touch
        return mcp

    # ---- act: start something, return a job id ------------------------------------------------------
    @tool(ACT)
    def deploy_stage(stage_id: str) -> dict:
        """Deploy a stage (emulator, images, Terraform, wait until healthy). Returns a job_id immediately; takes about 3-6 minutes."""
        return op.deploy_stage(stage_id)

    @tool(ACT)
    def smoke_stage(stage_id: str) -> dict:
        """Run a deployed stage's smoke tests (API journey and browser tests). The stage must be up."""
        return op.smoke_stage(stage_id)

    @tool(ACT)
    def rollout_stage(stage_id: str) -> dict:
        """Ship a new release to a deployed stage and check it goes live (the stage must be up)."""
        return op.rollout_stage(stage_id)

    @tool(ACT)
    def run_pipeline(workflow: str) -> dict:
        """Run one CI workflow (e.g. 'ecs-cloudfront-signup-https.yml') on the local CI. Run one at a time; local CI must be up (start_ci)."""
        return op.run_pipeline(workflow)

    @tool(ACT)
    def start_ci() -> dict:
        """Start the local CI (Gitea and its runner)."""
        return op.start_ci()

    @tool(ACT)
    def start_emulator(emulator_id: str) -> dict:
        """Start a cloud emulator by id (see list_emulators)."""
        return op.start_emulator(emulator_id)

    @tool(ACT)
    def start_observability() -> dict:
        """Start Prometheus and Grafana."""
        return op.start_observability()

    @tool(ACT)
    def run_loadtest(stage_id: str, profile: str = "smoke") -> dict:
        """Run a k6 load test (profile: smoke, load, spike, stress) against a stage that is up. Needs observability running."""
        return op.run_loadtest(stage_id, profile)

    # ---- destructive: nothing happens without confirm=true ----------------------------------------------
    @tool(DESTROY)
    def destroy_stage(stage_id: str, confirm: bool = False) -> dict:
        """DESTRUCTIVE. Destroy a stage's resources. Without confirm=true it only describes the effects: show them to the user first."""
        return op.destroy_stage(stage_id, confirm)

    @tool(DESTROY)
    def stop_emulator(emulator_id: str, confirm: bool = False) -> dict:
        """DESTRUCTIVE. Stop an emulator; everything deployed on it is lost. Without confirm=true it only describes the effects."""
        return op.stop_emulator(emulator_id, confirm)

    @tool(DESTROY)
    def stop_ci(confirm: bool = False) -> dict:
        """DESTRUCTIVE. Stop the local CI (kills a running pipeline). Without confirm=true it only describes the effects."""
        return op.stop_ci(confirm)

    @tool(DESTROY)
    def stop_observability(confirm: bool = False) -> dict:
        """DESTRUCTIVE. Stop Prometheus and Grafana. Without confirm=true it only describes the effects."""
        return op.stop_observability(confirm)

    @tool(DESTROY)
    def cancel_job(job_id: str, confirm: bool = False) -> dict:
        """DESTRUCTIVE. Cancel a running Mission Control job; a deploy cancelled half-way can leave a stage partly deployed. Without confirm=true it only describes the effects."""
        return op.cancel_job(job_id, confirm)

    return mcp


def main() -> None:
    try:
        server = build_server()
    except ConfigError as e:
        print(f"lab-operate: {e}", file=sys.stderr)
        raise SystemExit(2) from None
    server.run("stdio")


if __name__ == "__main__":
    main()
