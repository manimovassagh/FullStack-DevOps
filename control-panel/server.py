#!/usr/bin/env python3
"""Control panel for the local deployments: which stage is up, and buttons to start / stop / test them.

Standard library only. It runs on your machine (not in Docker) because the stages' Makefiles need
make, terraform, aws and kubectl. It only ever runs the fixed commands in STAGES and EMULATORS below.

    make -C control-panel run      → http://localhost:3500
"""
import json
import os
import re
import signal
import socket
import statistics
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEPLOY = ROOT / "deployment"
PORT = int(os.environ.get("PANEL_PORT", "3500"))
HISTORY_FILE = HERE / ".history.json"
LOG_DIR = HERE / ".logs"

# ── what can run ────────────────────────────────────────────────────────────────────────────────
# Emulators: one per cloud (the serverless stage has its own AWS Floci). Stages on the same emulator
# share its lock, so two applies never race against one emulator.
EMULATORS = [
    dict(id="aws", title="Floci · AWS", port=4566, dir=".", start="docker compose up -d --wait floci",
         stop="docker compose stop floci", used_by="8 AWS stages"),
    dict(id="serverless", title="Floci · AWS (nightly)", port=4567, dir="deployment/aws/serverless",
         start="make floci", stop="docker compose down", used_by="Serverless"),
    dict(id="gcp", title="Floci · Google Cloud", port=4588, dir="deployment/gcp/cloud-run",
         start="make floci", stop="docker compose down", used_by="Cloud Run"),
    dict(id="azure", title="Floci · Azure", port=4577, dir="deployment/azure/container-apps",
         start="make floci", stop="docker compose down", used_by="Container Apps"),
]
EMU = {e["id"]: e for e in EMULATORS}

STAGES = [
    dict(id="classic-ec2", title="Classic EC2", family="aws", kind="vm", dir="aws/classic-ec2", emulator="aws", port=8088,
         start="make init apply wait", note="EC2 instances behind an ALB, systemd units, artifacts in S3"),
    dict(id="ec2-asg", title="EC2 Auto Scaling", family="aws", kind="vm", dir="aws/ec2-asg", emulator="aws", port=8093,
         start="make init apply wait", note="Launch templates, Auto Scaling groups, self-healing, rolling replacement"),
    dict(id="ecs", title="ECS Fargate", family="aws", kind="container", dir="aws/ecs", emulator="aws", port=8089,
         start="make init apply wait", note="Task definitions, services, ALB, secrets injection"),
    dict(id="ecs-cognito", title="ECS + Cognito", family="aws", kind="container", dir="aws/ecs-cognito", emulator="aws", port=8096,
         start="make init apply wait", note="Sign-in with Amazon Cognito, per-user data",
         login="alice@plant.example · Plant-Parent-2026!"),
    dict(id="ecs-blue-green", title="ECS blue/green", family="aws", kind="container", dir="aws/ecs-blue-green", emulator="aws", port=8091,
         start="make init up", note="Weighted ALB, canary, preview listener on :8092"),
    dict(id="eks", title="EKS · Kustomize", family="aws", kind="k8s", dir="aws/eks", emulator="aws", port=8090,
         start="make init up", note="Kubernetes (k3s), Kustomize overlays, ALB"),
    dict(id="eks-helm", title="EKS · Helm", family="aws", kind="k8s", dir="aws/eks-helm", emulator="aws", port=8094,
         start="make init up", note="The app as a Helm chart, numbered releases, rollback"),
    dict(id="eks-gitops", title="EKS · Argo CD", family="aws", kind="k8s", dir="aws/eks-gitops", emulator="aws", port=8095,
         start="make init up", note="GitOps: Argo CD syncs the cluster from git"),
    dict(id="serverless", title="Serverless", family="aws", kind="serverless", dir="aws/serverless", emulator="serverless",
         url="http://127.0.0.1:4567/", host="plant.localhost:4567", open="http://plant.localhost:4567/",
         start="make up", note="Lambda + API Gateway + S3 + CloudFront"),
    dict(id="gcp-cloud-run", title="Cloud Run", family="gcp", kind="container", dir="gcp/cloud-run", emulator="gcp",
         url_cmd="terraform output -raw app_url", start="make up", note="Cloud Run + Cloud SQL + Cloud Storage"),
    dict(id="azure-container-apps", title="Container Apps", family="azure", kind="container", dir="azure/container-apps", emulator="azure",
         url_cmd="scripts/app-url.sh", start="make up", note="Container Apps + PostgreSQL Flexible Server"),
]
BY_ID = {s["id"]: s for s in STAGES}
ACTIONS = {"start": None, "stop": "make destroy", "smoke": "make smoke", "rollout": "make rollout", "forget": "make forget"}
DEFAULT_SECONDS = {"start": 360, "stop": 90, "smoke": 90, "rollout": 200, "forget": 2, "emu-start": 30, "emu-stop": 15}

# Containers by name, so the panel can say what is running (Floci runs every service as a real container).
GROUPS = [("floci-ecs-", "ECS tasks"), ("floci-rds-", "Databases"), ("floci-eks-", "EKS nodes"), ("floci-ec2-", "EC2 instances"),
          ("floci-lambda", "Lambda"), ("floci-gcp-", "Cloud Run / SQL"), ("floci-az", "Azure apps"), ("GITEA-ACTIONS-", "CI jobs")]

# ── state ───────────────────────────────────────────────────────────────────────────────────────
jobs = {}            # job id → dict(target, action, lines, rc, started, ended, pid)
busy = {}            # emulator id → job id
lock = threading.Lock()
since = {}           # stage id → (state, first seen at)
_url_cache, _system = {}, {"at": 0}
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def load_history():
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:
        return []


history = load_history()


def save_history(entry):
    history.append(entry)
    del history[:-300]
    try:
        HISTORY_FILE.write_text(json.dumps(history))
    except OSError:
        pass


def sh(cmd, cwd=None, timeout=20):
    try:
        r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except Exception:
        return 1, ""


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def resource_count(stage):
    try:
        return len(json.loads((DEPLOY / stage["dir"] / "terraform.tfstate").read_text()).get("resources", []))
    except Exception:
        return 0


def stage_url(stage):
    if "url" in stage:
        return stage["url"]
    if "port" in stage:
        return f"http://localhost:{stage['port']}/"
    hit = _url_cache.get(stage["id"])
    if hit and time.time() - hit[0] < 30:
        return hit[1]
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
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Host": host} if host else {}), timeout=2) as r:
            return r.status < 400
    except Exception:
        return False


def expected_seconds(target, action):
    done = [h["ended"] - h["started"] for h in history if h["target"] == target and h["action"] == action and h["rc"] == 0]
    return round(statistics.median(done[-5:])) if done else DEFAULT_SECONDS.get(action, 120)


def job_summary(job_id):
    j = jobs.get(job_id)
    if not j:
        return None
    last = next((ANSI.sub("", l).strip() for l in reversed(j["lines"]) if l.strip() and not l.startswith("$ ")), "")
    return dict(id=job_id, action=j["action"], rc=j["rc"], started=j["started"], ended=j["ended"],
                expected=j["expected"], step=last[:160])


def last_run(target):
    mine = [h for h in history if h["target"] == target]
    return mine[-1] if mine else None


def ci_running():
    rc, out = sh("docker ps --format '{{.Names}}' | grep -c GITEA-ACTIONS")
    return out.strip() not in ("", "0")


def stage_status(stage):
    job_id = busy.get(stage["emulator"])
    running = job_id and jobs[job_id]["rc"] is None and jobs[job_id]["target"] == stage["id"]
    url = stage_url(stage)
    up = answers(url, stage.get("host"))
    res = resource_count(stage)
    state = "up" if up else ("partial" if res else "down")
    prev = since.get(stage["id"])
    if not prev or prev[0] != state:
        since[stage["id"]] = (state, time.time())
    return dict(
        id=stage["id"], title=stage["title"], family=stage["family"], kind=stage["kind"], emulator=stage["emulator"],
        note=stage["note"], login=stage.get("login"), state=state, since=since[stage["id"]][1],
        url=(stage.get("open") or url) if up else None, resources=res,
        job=job_summary(job_id) if running else None, last=last_run(stage["id"]),
        emulator_up=port_open(EMU[stage["emulator"]]["port"]),
    )


def refresh_system():
    """Docker-wide numbers; slow (docker stats), so computed in the background."""
    while True:
        try:
            rc, total = sh("docker info --format '{{.MemTotal}}'")
            rc, stats = sh("docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}'", timeout=30)
            used, groups = 0.0, {}
            for line in stats.splitlines():
                name, _, mem = line.partition("|")
                used += to_bytes(mem.split("/")[0].strip())
                g = next((label for prefix, label in GROUPS if name.startswith(prefix)), "Other")
                groups[g] = groups.get(g, 0) + 1
            _system.update(at=time.time(), mem_total=int(total or 0), mem_used=int(used), containers=len(stats.splitlines()),
                           groups=groups)
        except Exception:
            pass
        time.sleep(8)


def to_bytes(text):
    m = re.match(r"([\d.]+)\s*([KMGT]?i?B)", text)
    if not m:
        return 0
    unit = {"B": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9}
    return float(m.group(1)) * unit.get(m.group(2), 1)


def all_status():
    with ThreadPoolExecutor(max_workers=12) as pool:
        stages = list(pool.map(stage_status, STAGES))
    emulators = []
    for e in EMULATORS:
        job_id = busy.get(e["id"])
        j = job_summary(job_id) if job_id and jobs[job_id]["rc"] is None and jobs[job_id]["target"] == "emu:" + e["id"] else None
        emulators.append(dict(id=e["id"], title=e["title"], port=e["port"], up=port_open(e["port"]), used_by=e["used_by"], job=j,
                              busy=bool(job_id and jobs[job_id]["rc"] is None)))
    tools = dict(grafana=port_open(3400), gitea=port_open(3300))
    return dict(stages=stages, emulators=emulators, system={k: v for k, v in _system.items()}, ci_running=ci_running(),
                tools=tools, now=time.time())


# ── jobs ────────────────────────────────────────────────────────────────────────────────────────
def run_job(job_id, emulator, steps):
    job = jobs[job_id]
    LOG_DIR.mkdir(exist_ok=True)
    logf = open(LOG_DIR / f"{job_id}.log", "w")
    try:
        for cmd, where in steps:
            rel = where.relative_to(ROOT) if where != ROOT else Path(".")
            job["lines"].append(f"$ (cd {rel}) {cmd}")
            p = subprocess.Popen(cmd, shell=True, cwd=where, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 start_new_session=True, env={**os.environ, "CI": "", "TF_IN_AUTOMATION": "1"})
            job["pid"] = p.pid
            for line in p.stdout:
                job["lines"].append(line.rstrip("\n"))
                logf.write(line)
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
        if job.get("cancelled"):
            job["rc"] = 130
        job["lines"].append("[done]" if job["rc"] == 0 else f"[failed: exit {job['rc']}]")
        logf.close()
        save_history(dict(id=job_id, target=job["target"], action=job["action"], rc=job["rc"], started=job["started"], ended=job["ended"]))
        with lock:
            if busy.get(emulator) == job_id:
                del busy[emulator]
        _url_cache.clear()


def launch(target, action, emulator, steps):
    if ci_running():
        return 409, {"error": "A CI job is running on this Docker and uses the same ports. Wait for it to finish."}
    with lock:
        current = busy.get(emulator)
        if current and jobs[current]["rc"] is None:
            other = jobs[current]
            return 409, {"error": f"{other['target']} is busy ({other['action']}) on the same emulator. One operation at a time.", "job": current}
        job_id = str(int(time.time() * 1000))
        jobs[job_id] = dict(target=target, action=action, lines=[], rc=None, started=time.time(), ended=None, pid=None,
                            expected=expected_seconds(target, action))
        busy[emulator] = job_id
    threading.Thread(target=run_job, args=(job_id, emulator, steps), daemon=True).start()
    return 202, {"job": job_id}


def stage_action(stage_id, action):
    stage = BY_ID.get(stage_id)
    if not stage or action not in ACTIONS:
        return 404, {"error": "unknown stage or action"}
    steps = []
    if action == "start" and not port_open(EMU[stage["emulator"]]["port"]) and stage["emulator"] == "aws":
        steps.append((EMU["aws"]["start"], ROOT))  # the shared AWS Floci first
    steps.append((stage["start"] if action == "start" else ACTIONS[action], DEPLOY / stage["dir"]))
    return launch(stage_id, action, stage["emulator"], steps)


def emulator_action(emu_id, action):
    e = EMU.get(emu_id)
    if not e or action not in ("start", "stop"):
        return 404, {"error": "unknown emulator or action"}
    return launch("emu:" + emu_id, "emu-" + action, emu_id, [(e[action], ROOT / e["dir"])])


def cancel(job_id):
    job = jobs.get(job_id)
    if not job or job["rc"] is not None or not job["pid"]:
        return 404, {"error": "no such running job"}
    job["cancelled"] = True
    try:
        os.killpg(job["pid"], signal.SIGTERM)
    except ProcessLookupError:
        pass
    return 200, {"ok": True}


def read_log(job_id, offset):
    job = jobs.get(job_id)
    if job:
        return dict(lines=job["lines"][offset:], next=len(job["lines"]), rc=job["rc"], target=job["target"], action=job["action"],
                    started=job["started"], ended=job["ended"], expected=job["expected"])
    f = LOG_DIR / f"{job_id}.log"  # a job from before a panel restart
    h = next((x for x in history if x["id"] == job_id), None)
    if f.exists() and h:
        lines = f.read_text(errors="replace").splitlines()
        return dict(lines=lines[offset:], next=len(lines), rc=h["rc"], target=h["target"], action=h["action"],
                    started=h["started"], ended=h["ended"], expected=None)
    return None


# ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
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
        params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
        if path in ("/", "/index.html"):
            return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if path == "/api/status":
            return self.send(200, all_status())
        if path == "/api/history":
            return self.send(200, list(reversed(history[-50:])))
        if path.startswith("/api/jobs/"):
            body = read_log(path.split("/")[3], int(params.get("from", 0)))
            return self.send(200, body) if body else self.send(404, {"error": "no such job"})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.same_origin():
            return self.send(403, {"error": "cross-origin request refused"})
        p = self.path.strip("/").split("/")
        if len(p) == 4 and p[:2] == ["api", "stages"]:
            code, body = stage_action(p[2], p[3])
        elif len(p) == 4 and p[:2] == ["api", "emulators"]:
            code, body = emulator_action(p[2], p[3])
        elif len(p) == 4 and p[:2] == ["api", "jobs"] and p[3] == "cancel":
            code, body = cancel(p[2])
        else:
            code, body = 404, {"error": "not found"}
        self.send(code, body)


if __name__ == "__main__":
    threading.Thread(target=refresh_system, daemon=True).start()
    print(f"control panel on http://localhost:{PORT}  (repo: {ROOT})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
