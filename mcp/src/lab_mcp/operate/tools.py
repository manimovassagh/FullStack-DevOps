"""lab-operate's logic (the MCP server in server.py only exposes it). Three classes of tool:

  read         look at the lab: stages, emulators, CI, pipeline runs, logs
  act          start something: returns a job id at once, never waits (deploys take minutes: poll job_log)
  destructive  remove or stop something: nothing happens unless confirm=true; the first call only describes it
"""
from __future__ import annotations

import re
import time

from .panel import Panel, PanelError, PanelUnavailable

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
LOADTEST_PROFILES = ("smoke", "load", "spike", "stress")


class OperateError(Exception):
    """Something the caller can act on, in plain words."""


def clean(line: str) -> str:
    return ANSI.sub("", line)


class Operate:
    def __init__(self, panel: Panel):
        self.panel = panel

    # ------------------------------------------------------------------ plumbing
    def _get(self, path: str):
        try:
            return self.panel.get(path)
        except PanelUnavailable as e:
            raise OperateError(str(e)) from None
        except PanelError as e:
            raise OperateError(self._explain(e)) from None

    def _post(self, path: str) -> dict:
        try:
            return self.panel.post(path)
        except PanelUnavailable as e:
            raise OperateError(str(e)) from None
        except PanelError as e:
            raise OperateError(self._explain(e)) from None

    @staticmethod
    def _explain(e: PanelError) -> str:
        if e.status == 409:
            more = f" (running job: {e.job})" if e.job else ""
            return (f"Mission Control refused because something else is running{more}: {e.message}. "
                    "Look at ci_status / stage_status, read job_log, wait or cancel_job, then try again.")
        if e.status == 404:
            return f"not found: {e.message}"
        if e.status == 403:
            return f"Mission Control refused the request: {e.message}"
        return f"Mission Control answered {e.status}: {e.message}"

    def _status(self) -> dict:
        return self._get("/api/status")

    def _stage(self, stage_id: str) -> dict:
        stages = {s["id"]: s for s in self._status()["stages"]}
        if stage_id not in stages:
            raise OperateError(f"unknown stage '{stage_id}'. Known stages: {', '.join(stages)}")
        return stages[stage_id]

    @staticmethod
    def _job(s: dict | None) -> dict | None:
        if not s:
            return None
        return {"job_id": s["id"], "action": s["action"], "target": s.get("target"), "step": s.get("step"),
                "running_for_s": int(time.time() - s["started"]) if s.get("started") else None,
                "expected_s": s.get("expected")}

    # ------------------------------------------------------------------ read
    def list_stages(self) -> dict:
        st = self._status()
        return {"stages": [{"id": s["id"], "title": s["title"], "state": s["state"], "url": s["url"],
                            "busy": self._job(s["job"])} for s in st["stages"]],
                "emulators_up": [e["id"] for e in st["emulators"] if e["up"]],
                "ci_running": st["ci_running"], "running_jobs": [self._job(j) for j in st["active"]]}

    def stage_status(self, stage_id: str) -> dict:
        self._stage(stage_id)
        d = self._get(f"/api/stages/{stage_id}")
        s = d["status"]
        hint = {"down": "not deployed: deploy_stage starts it", "up": "running: smoke_stage tests it, destroy_stage removes it",
                "partial": "partly deployed (an earlier run did not finish): deploy_stage again, or destroy_stage",
                "stale": "left over from an emulator that was reset: deploy_stage starts clean"}.get(s["state"], "")
        return {"id": s["id"], "title": s["title"], "state": s["state"], "meaning": hint, "url": s["url"],
                "resources": s["resources"], "busy": self._job(s["job"]),
                "last_run": s["last"], "recent_runs": d["runs"][:5], "login": s.get("login"),
                "outputs": {k: v for k, v in list(d["outputs"].items())[:20]},
                "containers": [{"name": c["name"], "state": c["state"]} for c in d["containers"]["items"]][:20]}

    def list_emulators(self) -> dict:
        return {"emulators": [{"id": e["id"], "title": e["title"], "port": e["port"], "up": e["up"], "used_by": e["used_by"],
                               "busy": self._job(e["job"])} for e in self._status()["emulators"]]}

    def ci_status(self) -> dict:
        d = self._get("/api/ci")
        return {"gitea_up": d["gitea"], "runner_up": d["runner"], "url": d["url"], "workflows": d["workflows"],
                "busy": self._job(d["job"]), "latest_runs": [self._run(r) for r in d["runs"][:5]]}

    @staticmethod
    def _run(r: dict) -> dict:
        return {"run": r["id"], "workflow": r["workflow"], "status": r["status"],
                "jobs": [{"job_id": j["id"], "name": j["name"], "status": j["status"]} for j in r["jobs"]],
                "started": r["started"], "stopped": r["stopped"]}

    def pipeline_runs(self, limit: int = 10, workflow: str | None = None) -> dict:
        runs = self._get("/api/ci")["runs"]
        if workflow:
            runs = [r for r in runs if r["workflow"] == workflow]
        return {"runs": [self._run(r) for r in runs[:max(1, min(limit, 25))]]}

    def recent_activity(self, limit: int = 10) -> dict:
        return {"activity": [{"job_id": h["id"], "target": h["target"], "action": h["action"], "exit_code": h["rc"],
                              "took_s": int(h["ended"] - h["started"])}
                             for h in self._get("/api/history")[:max(1, min(limit, 50))]]}

    def job_log(self, job_id: str, from_line: int = 0, tail: int = 120, kind: str = "panel") -> dict:
        """kind='panel': a job Mission Control ran (deploy, destroy, smoke…); kind='pipeline': one job of a CI run."""
        tail = max(10, min(int(tail), 400))
        if kind == "pipeline":
            if not str(job_id).isdigit():
                raise OperateError("a pipeline job id is a number (see pipeline_runs)")
            d = self._get(f"/api/ci/jobs/{job_id}/log")
            lines = [clean(l) for l in d["lines"]]
            return {"kind": kind, "job_id": job_id, "total_lines": len(lines), "lines": lines[-tail:],
                    "note": d.get("note") or None, "tip": "pipeline jobs are read as a whole; the last lines are returned"}
        d = self._get(f"/api/jobs/{job_id}/log?from={max(0, int(from_line))}")
        lines = [clean(l) for l in d["lines"]]
        done = d["rc"] is not None
        return {"kind": kind, "job_id": job_id, "action": d["action"], "target": d["target"],
                "state": "running" if not done else ("succeeded" if d["rc"] == 0 else f"failed (exit {d['rc']})"),
                "exit_code": d["rc"], "next_from_line": d["next"], "lines": lines[-tail:],
                "dropped_lines": max(0, len(lines) - tail),
                "tip": "call again with from_line=next_from_line until state is no longer 'running'"}

    # ------------------------------------------------------------------ act (start something, return a job id)
    def _started(self, what: str, body: dict) -> dict:
        job = body.get("job")
        return {"started": what, "job_id": job, "next": f"poll job_log(job_id='{job}') until the state is not 'running'; "
                                                          "do not wait inside one call"}

    def deploy_stage(self, stage_id: str) -> dict:
        s = self._stage(stage_id)
        return self._started(f"deploy {stage_id}", self._post(f"/api/stages/{stage_id}/start")) | {"was": s["state"]}

    def smoke_stage(self, stage_id: str) -> dict:
        s = self._stage(stage_id)
        if s["state"] != "up":
            raise OperateError(f"{stage_id} is '{s['state']}', not up: deploy_stage first")
        return self._started(f"smoke-test {stage_id}", self._post(f"/api/stages/{stage_id}/smoke"))

    def rollout_stage(self, stage_id: str) -> dict:
        s = self._stage(stage_id)
        if s["state"] != "up":
            raise OperateError(f"{stage_id} is '{s['state']}', not up: deploy_stage first")
        return self._started(f"roll out a new release of {stage_id}", self._post(f"/api/stages/{stage_id}/rollout"))

    def run_pipeline(self, workflow: str) -> dict:
        ci = self._get("/api/ci")
        if workflow not in ci["workflows"]:
            raise OperateError(f"unknown workflow '{workflow}'. Known: {', '.join(ci['workflows'])}")
        if not (ci["gitea"] and ci["runner"]):
            raise OperateError("local CI is not up: start_ci first")
        return self._started(f"pipeline {workflow}", self._post(f"/api/ci/run/{workflow}")) | {
            "note": "a pipeline takes about 6-12 minutes; run one at a time and keep the Mac awake (caffeinate)"}

    def start_ci(self) -> dict:
        return self._started("local CI (Gitea + runner)", self._post("/api/ci/up"))

    def start_emulator(self, emulator_id: str) -> dict:
        ids = [e["id"] for e in self._status()["emulators"]]
        if emulator_id not in ids:
            raise OperateError(f"unknown emulator '{emulator_id}'. Known: {', '.join(ids)}")
        return self._started(f"emulator {emulator_id}", self._post(f"/api/emulators/{emulator_id}/start"))

    def start_observability(self) -> dict:
        return self._started("observability (Prometheus + Grafana)", self._post("/api/observability/up"))

    def run_loadtest(self, stage_id: str, profile: str = "smoke") -> dict:
        if profile not in LOADTEST_PROFILES:
            raise OperateError(f"profile must be one of {', '.join(LOADTEST_PROFILES)}")
        s = self._stage(stage_id)
        if s["state"] != "up":
            raise OperateError(f"{stage_id} is '{s['state']}', not up: deploy_stage first")
        return self._started(f"{profile} load test on {stage_id}", self._post(f"/api/loadtests/{stage_id}/{profile}"))

    # ------------------------------------------------------------------ destructive (confirm=true or nothing happens)
    @staticmethod
    def _needs_confirm(action: str, effects: str) -> dict:
        return {"confirmation_required": True, "action": action, "effects": effects,
                "nothing_changed": True,
                "to_proceed": "show this to the user; if they agree, call the same tool again with confirm=true"}

    def destroy_stage(self, stage_id: str, confirm: bool = False) -> dict:
        s = self._stage(stage_id)
        effects = (f"destroys the Terraform-managed resources of '{stage_id}' (state: {s['state']}, "
                   f"{s['resources']} resources in the local emulator) and clears its state. Data in it is lost.")
        if s["state"] == "down" and not s["resources"]:
            return {"nothing_to_do": f"{stage_id} is not deployed"}
        if not confirm:
            return self._needs_confirm(f"destroy {stage_id}", effects)
        return self._started(f"destroy {stage_id}", self._post(f"/api/stages/{stage_id}/stop"))

    def stop_emulator(self, emulator_id: str, confirm: bool = False) -> dict:
        emus = {e["id"]: e for e in self._status()["emulators"]}
        if emulator_id not in emus:
            raise OperateError(f"unknown emulator '{emulator_id}'. Known: {', '.join(emus)}")
        e = emus[emulator_id]
        effects = (f"stops the emulator '{emulator_id}' (:{e['port']}); everything deployed on it "
                   f"({', '.join(e['used_by']) or 'nothing'}) loses its resources, because emulators keep state in memory.")
        if not e["up"]:
            return {"nothing_to_do": f"{emulator_id} is not running"}
        if not confirm:
            return self._needs_confirm(f"stop emulator {emulator_id}", effects)
        return self._started(f"stop emulator {emulator_id}", self._post(f"/api/emulators/{emulator_id}/stop"))

    def stop_ci(self, confirm: bool = False) -> dict:
        if not confirm:
            return self._needs_confirm("stop local CI", "stops Gitea and its runner; a pipeline that is running is "
                                                        "killed. Run history stays in Gitea's volume.")
        return self._started("stop local CI", self._post("/api/ci/down"))

    def stop_observability(self, confirm: bool = False) -> dict:
        if not confirm:
            return self._needs_confirm("stop observability", "stops Prometheus and Grafana; their dashboards go dark.")
        return self._started("stop observability", self._post("/api/observability/down"))

    def cancel_job(self, job_id: str, confirm: bool = False) -> dict:
        if not confirm:
            return self._needs_confirm(f"cancel job {job_id}", "sends SIGTERM to the running job; a deploy cancelled "
                                                               "half-way can leave a partly deployed stage.")
        return {"cancelled": job_id, **self._post(f"/api/jobs/{job_id}/cancel")}
