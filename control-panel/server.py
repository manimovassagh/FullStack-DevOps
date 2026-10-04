#!/usr/bin/env python3
"""Control panel for the local deployments: which stage is up, and buttons to start / stop / test them.

Standard library only. It runs on your machine (not in Docker) because the stages' Makefiles need
make, terraform, aws and kubectl. It only ever runs the fixed commands in STAGES below.

    python3 control-panel/server.py        # or: make -C control-panel run      → http://localhost:3500
"""
import json
import os
import signal
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deployment"
PORT = int(os.environ.get("PANEL_PORT", "3500"))

AWS_FLOCI = "docker compose up -d --wait floci"  # run in the repo root: the shared Floci every AWS stage uses

# id → what the stage is and how to drive it. `emulator` stages that share one emulator can't run two operations at once.
STAGES = [
    dict(id="classic-ec2", title="Classic EC2", family="AWS · virtual machines", dir="aws/classic-ec2", emulator="aws",
         url="http://localhost:8088/", start="make init apply wait", note="EC2 + ALB, systemd, artifacts in S3"),
    dict(id="ec2-asg", title="EC2 Auto Scaling", family="AWS · virtual machines", dir="aws/ec2-asg", emulator="aws",
         url="http://localhost:8093/", start="make init apply wait", note="launch templates, scaling groups, self-healing"),
    dict(id="ecs", title="ECS Fargate", family="AWS · containers", dir="aws/ecs", emulator="aws",
         url="http://localhost:8089/", start="make init apply wait", note="task definitions, services, ALB"),
    dict(id="ecs-cognito", title="ECS + Cognito sign-in", family="AWS · containers", dir="aws/ecs-cognito", emulator="aws",
         url="http://localhost:8096/", start="make init apply wait", note="alice / bob / root @plant.example · Plant-Parent-2026!"),
    dict(id="ecs-blue-green", title="ECS blue/green", family="AWS · containers", dir="aws/ecs-blue-green", emulator="aws",
         url="http://localhost:8091/", start="make init up", note="weighted ALB, canary, preview on :8092"),
    dict(id="eks", title="EKS (Kustomize)", family="AWS · Kubernetes", dir="aws/eks", emulator="aws",
         url="http://localhost:8090/", start="make init up", note="k3s cluster, Kustomize, ALB"),
    dict(id="eks-helm", title="EKS + Helm", family="AWS · Kubernetes", dir="aws/eks-helm", emulator="aws",
         url="http://localhost:8094/", start="make init up", note="Helm chart, numbered releases"),
    dict(id="eks-gitops", title="EKS + Argo CD", family="AWS · Kubernetes", dir="aws/eks-gitops", emulator="aws",
         url="http://localhost:8095/", start="make init up", note="GitOps: Argo CD pulls from git"),
    dict(id="serverless", title="Serverless", family="AWS · serverless", dir="aws/serverless", emulator="serverless",
         url="http://127.0.0.1:4567/", host="plant.localhost:4567", start="make up", note="Lambda + API Gateway + CloudFront, own Floci"),
    dict(id="gcp-cloud-run", title="Cloud Run", family="Google Cloud", dir="gcp/cloud-run", emulator="gcp",
         url_cmd="terraform output -raw app_url", start="make up", note="Cloud Run + Cloud SQL + Cloud Storage"),
    dict(id="azure-container-apps", title="Container Apps", family="Azure", dir="azure/container-apps", emulator="azure",
         url_cmd="scripts/app-url.sh", start="make up", note="Container Apps + PostgreSQL Flexible Server"),
]
BY_ID = {s["id"]: s for s in STAGES}
ACTIONS = {  # action → (command run in the stage directory, only for stages with this target)
    "start": None,  # per stage (see `start` above)
    "stop": "make destroy",
    "rollout": "make rollout",
    "smoke": "make smoke",
    "forget": "make forget",  # leftover Terraform state after the emulator was restarted
}

jobs = {}  # id → dict(stage, action, lines, rc, started, ended, pid)
jobs_lock = threading.Lock()
busy_emulators = {}  # emulator → job id
_url_cache = {}


def sh(cmd, cwd=None, timeout=20):
    try:
        r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except Exception:
        return 1, ""


def resource_count(stage):
    f = DEPLOY / stage["dir"] / "terraform.tfstate"
    try:
        return len(json.loads(f.read_text()).get("resources", []))
    except Exception:
        return 0


def stage_url(stage):
    if "url" in stage:
        return stage["url"]
    cached = _url_cache.get(stage["id"])
    if cached and time.time() - cached[0] < 30:
        return cached[1]
    url = None
    if resource_count(stage):
        rc, out = sh(stage["url_cmd"], cwd=DEPLOY / stage["dir"], timeout=15)
        url = out.splitlines()[-1] if rc == 0 and out else None
    _url_cache[stage["id"]] = (time.time(), url)
    return url


def answers(url, host=None):
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={"Host": host} if host else {})
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status < 400
    except Exception:
        return False


def ci_running():
    rc, out = sh("docker ps --format '{{.Names}}' | grep -c GITEA-ACTIONS")
    return out.strip() not in ("", "0")


def stage_status(stage):
    job_id = busy_emulators.get(stage["emulator"])
    job = jobs.get(job_id) if job_id else None
    url = stage_url(stage)
    up = answers(url, stage.get("host"))
    state = "up" if up else ("partial" if resource_count(stage) else "down")
    op = None
    if job and job["rc"] is None and job["stage"] == stage["id"]:
        op = {"start": "starting", "stop": "stopping"}.get(job["action"], job["action"] + "…")
    return dict(id=stage["id"], title=stage["title"], family=stage["family"], emulator=stage["emulator"], note=stage["note"],
                state=state, op=op, url=url if up else None, resources=resource_count(stage),
                job=job_id if job and job["stage"] == stage["id"] else last_job(stage["id"]))


def last_job(stage_id):
    mine = [k for k, j in jobs.items() if j["stage"] == stage_id]
    return max(mine, key=lambda k: jobs[k]["started"]) if mine else None


def all_status():
    with ThreadPoolExecutor(max_workers=12) as pool:
        stages = list(pool.map(stage_status, STAGES))
    rc, out = sh("docker ps -q | wc -l")
    return dict(stages=stages, containers=int(out or 0), ci_running=ci_running(),
                busy={e: j for e, j in busy_emulators.items() if jobs[j]["rc"] is None})


def run_job(job_id, stage, action, command):
    job = jobs[job_id]
    cwd = DEPLOY / stage["dir"]
    steps = []
    if stage["emulator"] == "aws" and action in ("start",):
        steps.append((AWS_FLOCI, ROOT))  # the shared Floci (and nothing else) must be up first
    steps.append((command, cwd))
    try:
        for cmd, where in steps:
            job["lines"].append(f"$ (cd {where.relative_to(ROOT) if where != ROOT else '.'}) {cmd}")
            p = subprocess.Popen(cmd, shell=True, cwd=where, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 start_new_session=True, env={**os.environ, "CI": ""})
            job["pid"] = p.pid
            for line in p.stdout:
                job["lines"].append(line.rstrip("\n"))
            p.wait()
            if p.returncode != 0:
                job["rc"] = p.returncode
                break
        else:
            job["rc"] = 0
    except Exception as e:
        job["lines"].append(f"panel error: {e}")
        job["rc"] = 1
    finally:
        job["ended"] = time.time()
        job["lines"].append(f"[{'done' if job['rc'] == 0 else 'failed (exit ' + str(job['rc']) + ')'}]")
        with jobs_lock:
            if busy_emulators.get(stage["emulator"]) == job_id:
                del busy_emulators[stage["emulator"]]
        _url_cache.pop(stage["id"], None)


def start_job(stage_id, action):
    stage = BY_ID.get(stage_id)
    if not stage or action not in ACTIONS:
        return 404, {"error": "unknown stage or action"}
    if ci_running():
        return 409, {"error": "a CI job is running on this Docker (it uses the same ports); wait for it or stop it first"}
    command = stage["start"] if action == "start" else ACTIONS[action]
    with jobs_lock:
        current = busy_emulators.get(stage["emulator"])
        if current and jobs[current]["rc"] is None:
            other = jobs[current]
            return 409, {"error": f"{other['stage']} is {other['action']}ing on the same emulator; one operation at a time", "job": current}
        job_id = f"{int(time.time()*1000)}"
        jobs[job_id] = dict(stage=stage_id, action=action, lines=[], rc=None, started=time.time(), ended=None, pid=None)
        busy_emulators[stage["emulator"]] = job_id
    threading.Thread(target=run_job, args=(job_id, stage, action, command), daemon=True).start()
    return 202, {"job": job_id}


def cancel_job(job_id):
    job = jobs.get(job_id)
    if not job or job["rc"] is not None or not job["pid"]:
        return 404, {"error": "no such running job"}
    try:
        os.killpg(job["pid"], signal.SIGTERM)
    except ProcessLookupError:
        pass
    job["lines"].append("[cancelled]")
    return 200, {"ok": True}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def same_origin(self):
        # Stops another website from making your browser POST to localhost and start deployments.
        origin = self.headers.get("Origin")
        return self.headers.get("X-Panel") == "1" and (origin is None or origin.split("//", 1)[-1] == self.headers.get("Host"))

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path in ("/", "/index.html"):
            return self.send(200, (Path(__file__).parent / "index.html").read_bytes(), "text/html; charset=utf-8")
        if path == "/api/stages":
            return self.send(200, all_status())
        if path.startswith("/api/jobs/"):
            job = jobs.get(path.split("/")[3])
            if not job:
                return self.send(404, {"error": "no such job"})
            offset = int(dict(p.split("=") for p in query.split("&") if "=" in p).get("from", 0))
            return self.send(200, dict(lines=job["lines"][offset:], next=len(job["lines"]), rc=job["rc"], stage=job["stage"], action=job["action"]))
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.same_origin():
            return self.send(403, {"error": "cross-origin request refused"})
        parts = self.path.strip("/").split("/")  # api/stages/<id>/<action>  |  api/jobs/<id>/cancel
        if len(parts) == 4 and parts[:2] == ["api", "stages"]:
            code, body = start_job(parts[2], parts[3])
        elif len(parts) == 4 and parts[:2] == ["api", "jobs"] and parts[3] == "cancel":
            code, body = cancel_job(parts[2])
        else:
            code, body = 404, {"error": "not found"}
        self.send(code, body)


if __name__ == "__main__":
    print(f"control panel on http://localhost:{PORT}  (repo: {ROOT})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
