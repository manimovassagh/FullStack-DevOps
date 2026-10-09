#!/usr/bin/env python3
"""Control panel API: run and watch the local deployments, emulators, load tests and pipelines.

Standard library only. It runs on your machine (not in Docker) because the stages' Makefiles need make,
terraform, aws and kubectl. It serves the single-page app in ui/dist and only ever runs the fixed commands
defined below; nothing from a request becomes part of a command.

    make -C control-panel run      → http://localhost:3500
"""
import json
import mimetypes
import os
import re
import signal
import socket
import statistics
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEPLOY = ROOT / "deployment"
UI = HERE / "ui" / "dist"
PORT = int(os.environ.get("PANEL_PORT", "3500"))
PROMETHEUS = os.environ.get("PROMETHEUS_URL", "http://localhost:9091")
HISTORY_FILE = HERE / ".history.json"
LOG_DIR = HERE / ".logs"

# ── what can run ────────────────────────────────────────────────────────────────────────────────
# Emulators: one per cloud (the serverless stage has its own AWS Floci). Stages on the same emulator share
# its lock, so two applies never race against one emulator.
EMULATORS = [
    dict(id="aws", title="Floci · AWS", cloud="aws", port=4566, dir=".", container="fullstack-devops-floci-1",
         start="docker compose up -d --wait floci", stop="docker compose stop floci"),
    dict(id="serverless", title="Floci · AWS nightly", cloud="aws", port=4567, dir="deployment/aws/serverless",
         container="plant-serverless-floci-1", start="make floci", stop="docker compose down"),
    dict(id="serverless-cognito", title="Floci · AWS nightly · auth", cloud="aws", port=4568, dir="deployment/aws/serverless-cognito",
         container="plant-serverless-cognito-floci-1", start="make floci", stop="docker compose down"),
    dict(id="ecs-alb-auth", title="Floci · AWS nightly · ALB auth", cloud="aws", port=4569, dir="deployment/aws/ecs-alb-auth",
         container="plant-ecs-alb-auth-floci-1", start="make floci", stop="docker compose down"),
    dict(id="serverless-gateway-auth", title="Floci · AWS nightly · gateway auth", cloud="aws", port=4570, dir="deployment/aws/serverless-gateway-auth",
         container="plant-serverless-gateway-auth-floci-1", start="make floci", stop="docker compose down"),
    dict(id="gcp", title="Floci · Google Cloud", cloud="gcp", port=4588, dir="deployment/gcp/cloud-run",
         container="plant-gcp-floci-gcp-1", start="make floci", stop="docker compose down"),
    dict(id="azure", title="Floci · Azure", cloud="azure", port=4577, dir="deployment/azure/container-apps",
         container="plant-azure-floci-az", start="make floci", stop="docker compose down"),
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
         start="make init apply wait", note="Sign-in with Amazon Cognito, per-user data, admin group",
         login={"users": ["alice@plant.example", "bob@plant.example", "root@plant.example"], "password": "Plant-Parent-2026!"}),
    dict(id="ecs-alb-auth", title="ECS + ALB sign-in", family="aws", kind="container", dir="aws/ecs-alb-auth", emulator="ecs-alb-auth",
         port=8097, start="make floci init apply wait", note="Sign-in at the load balancer (authenticate-cognito), unchanged app",
         login={"users": ["alice@plant.example", "bob@plant.example"], "password": "Plant-Parent-2026!"}),
    dict(id="ecs-blue-green", title="ECS blue/green", family="aws", kind="container", dir="aws/ecs-blue-green", emulator="aws", port=8091,
         start="make init up", note="Weighted ALB, canary releases, preview listener on :8092"),
    dict(id="eks", title="EKS · Kustomize", family="aws", kind="k8s", dir="aws/eks", emulator="aws", port=8090,
         start="make init up", note="Kubernetes (k3s), Kustomize overlays, ALB"),
    dict(id="eks-helm", title="EKS · Helm", family="aws", kind="k8s", dir="aws/eks-helm", emulator="aws", port=8094,
         start="make init up", note="The app as a Helm chart, numbered releases, rollback"),
    dict(id="eks-gitops", title="EKS · Argo CD", family="aws", kind="k8s", dir="aws/eks-gitops", emulator="aws", port=8095,
         start="make init up", note="GitOps: Argo CD syncs the cluster from git"),
    dict(id="serverless-cognito", title="Serverless + Cognito", family="aws", kind="serverless", dir="aws/serverless-cognito",
         emulator="serverless-cognito", url="http://127.0.0.1:4568/", host="plant-auth.localhost:4568", open="http://plant-auth.localhost:4568/",
         start="make up", note="Lambda + API Gateway + CloudFront with Amazon Cognito sign-in, per-user data",
         login={"users": ["alice@plant.example", "bob@plant.example", "root@plant.example"], "password": "Plant-Parent-2026!"}),
    dict(id="serverless-gateway-auth", title="Serverless + gateway auth", family="aws", kind="serverless", dir="aws/serverless-gateway-auth",
         emulator="serverless-gateway-auth", url="http://127.0.0.1:4570/", host="plant-gw.localhost:4570", open="http://plant-gw.localhost:4570/",
         start="make up", note="Cognito sign-in with the token checked by API Gateway's JWT authorizer before the Lambda runs",
         login={"users": ["alice@plant.example", "bob@plant.example", "root@plant.example"], "password": "Plant-Parent-2026!"}),
    dict(id="serverless", title="Serverless", family="aws", kind="serverless", dir="aws/serverless", emulator="serverless",
         url="http://127.0.0.1:4567/", host="plant.localhost:4567", open="http://plant.localhost:4567/",
         start="make up", note="Lambda + API Gateway + S3 + CloudFront"),
    dict(id="gcp-cloud-run", title="Cloud Run", family="gcp", kind="container", dir="gcp/cloud-run", emulator="gcp",
         url_cmd="terraform output -raw app_url", start="make up", note="Cloud Run + Cloud SQL + Cloud Storage"),
    dict(id="azure-container-apps", title="Container Apps", family="azure", kind="container", dir="azure/container-apps",
         emulator="azure", url_cmd="scripts/app-url.sh", start="make up", note="Container Apps + PostgreSQL Flexible Server"),
]
BY_ID = {s["id"]: s for s in STAGES}
ACTIONS = {"start": None, "stop": "make destroy", "smoke": "make smoke", "rollout": "make rollout", "forget": "make forget"}
LOADTEST_PROFILES = ["smoke", "load", "spike", "stress"]
LOADTEST_STAGES = {s["id"] for s in STAGES if "port" in s}
DEFAULT_SECONDS = {"start": 360, "stop": 90, "smoke": 90, "rollout": 200, "forget": 2, "emu-start": 30, "emu-stop": 15,
                   "loadtest-smoke": 40, "loadtest-load": 280, "loadtest-spike": 120, "loadtest-stress": 220,
                   "ci-up": 60, "ci-down": 15, "ci-run": 900}

# Containers by name: Floci runs every service as a real container.
GROUPS = [("floci-ecs-", "ECS tasks"), ("floci-rds-", "Databases"), ("floci-eks-", "EKS nodes"), ("floci-ec2-", "EC2 instances"),
          ("floci-lambda", "Lambda"), ("floci-gcp-", "Cloud Run / SQL"), ("floci-az", "Azure apps"), ("GITEA-ACTIONS-", "CI jobs"),
          ("plant-ci-", "CI server"), ("plant-observability-", "Observability"), ("floci-ecr", "Registry")]

# ── state ───────────────────────────────────────────────────────────────────────────────────────
jobs = {}      # job id → dict(target, action, lines, rc, started, ended, pid, expected)
busy = {}      # lock key (emulator id, "loadtest", "ci") → job id
lock = threading.Lock()
since = {}     # stage id → (state, first seen at)
_cache = {}    # small TTL cache
_system = {"at": 0, "containers": []}
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# The browser smoke tests download Chromium (and ffmpeg for videos) from Playwright's CDN, which is not always
# reachable from a laptop. When Chrome is installed, the panel's runs use it instead and skip the recording.
BROWSER_ENV = ({"PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1", "SMOKE_BROWSER_CHANNEL": "chrome", "SMOKE_VIDEO": "off"}
               if Path("/Applications/Google Chrome.app").exists() and not os.environ.get("SMOKE_USE_PLAYWRIGHT_CHROMIUM") else {})


def cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def load_history():
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:
        return []


history = load_history()


def save_history(entry):
    history.append(entry)
    del history[:-500]
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


def tfstate(stage):
    try:
        return json.loads((DEPLOY / stage["dir"] / "terraform.tfstate").read_text())
    except Exception:
        return {}


def resource_count(stage):
    return len(tfstate(stage).get("resources", []))


def is_stale(stage):
    """The emulators keep everything in memory: after a restart the state file still lists resources that are gone.
    Check one resource the state says exists (the VPC, or else a bucket) against the emulator."""
    st = tfstate(stage)
    if not st.get("resources"):
        return False
    emu = EMU[stage["emulator"]]
    if not port_open(emu["port"]):
        return True  # emulator down → whatever the state lists is gone
    if emu["cloud"] != "aws":
        return False

    def check():
        for res in st["resources"]:
            for inst in res.get("instances", []):
                attrs = inst.get("attributes", {})
                aws = f"aws --endpoint-url http://localhost:{emu['port']} --region us-east-1"
                env = "AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test "
                if res["type"] == "aws_vpc" and attrs.get("id"):
                    rc, _ = sh(f"{env}{aws} ec2 describe-vpcs --vpc-ids {attrs['id']}", timeout=10)
                    return rc != 0
                if res["type"] == "aws_s3_bucket" and attrs.get("bucket"):
                    rc, _ = sh(f"{env}{aws} s3api head-bucket --bucket {attrs['bucket']}", timeout=10)
                    return rc != 0
        return False

    return cached("stale:" + stage["id"], 15, check)


def stage_url(stage):
    if "url" in stage:
        return stage["url"]
    if "port" in stage:
        return f"http://localhost:{stage['port']}/"
    if not resource_count(stage):
        return None

    def get():
        rc, out = sh(stage["url_cmd"], cwd=DEPLOY / stage["dir"], timeout=15)
        return out.splitlines()[-1] if rc == 0 and out else None

    return cached("url:" + stage["id"], 30, get)


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
    return dict(id=job_id, target=j["target"], action=j["action"], rc=j["rc"], started=j["started"], ended=j["ended"],
                expected=j["expected"], step=last[:200])


def running_job(key, target=None):
    job_id = busy.get(key)
    if job_id and jobs[job_id]["rc"] is None and (target is None or jobs[job_id]["target"] == target):
        return job_summary(job_id)
    return None


def last_run(target):
    return next((h for h in reversed(history) if h["target"] == target), None)


def ci_jobs_running():
    return any(c["name"].startswith("GITEA-ACTIONS-") and c["state"] == "running" for c in _system["containers"])


def stage_status(stage):
    job = running_job(stage["emulator"], stage["id"])
    url = stage_url(stage)
    up = answers(url, stage.get("host"))
    res = resource_count(stage)
    state = "up" if up else ("stale" if res and is_stale(stage) else "partial" if res else "down")
    prev = since.get(stage["id"])
    if not prev or prev[0] != state:
        since[stage["id"]] = (state, time.time())
    return dict(
        id=stage["id"], title=stage["title"], family=stage["family"], kind=stage["kind"], emulator=stage["emulator"],
        note=stage["note"], login=stage.get("login"), state=state, since=since[stage["id"]][1],
        url=(stage.get("open") or url) if up else None, port=stage.get("port"), resources=res,
        job=job, last=last_run(stage["id"]), loadtest=stage["id"] in LOADTEST_STAGES,
        loadtest_job=running_job("loadtest", "loadtest:" + stage["id"]),
    )


# ── docker (background) ─────────────────────────────────────────────────────────────────────────
def to_bytes(text):
    m = re.match(r"([\d.]+)\s*([KMGT]?i?B)", text)
    unit = {"B": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9}
    return float(m.group(1)) * unit.get(m.group(2), 1) if m else 0


def refresh_system():
    while True:
        try:
            rc, total = sh("docker info --format '{{.MemTotal}} {{.NCPU}}'")
            mem_total, ncpu = (total.split() + ["0", "0"])[:2] if rc == 0 else ("0", "0")
            rc, ps = sh("docker ps -a --format '{{json .}}'")
            rc2, stats = sh("docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}'", timeout=30)
            st = {}
            for line in stats.splitlines():
                name, cpu, mem = (line.split("|") + ["", "", ""])[:3]
                st[name] = (float(cpu.rstrip("%") or 0), to_bytes(mem.split("/")[0].strip()))
            containers = []
            for line in ps.splitlines():
                try:
                    c = json.loads(line)
                except ValueError:
                    continue
                name = c["Names"]
                cpu, mem = st.get(name, (0.0, 0))
                containers.append(dict(name=name, image=c["Image"], state=c["State"], status=c["Status"], ports=c.get("Ports", ""),
                                       group=next((g for p, g in GROUPS if name.startswith(p)), "Other"), cpu=cpu, mem=int(mem)))
            _system.update(at=time.time(), docker=rc == 0, mem_total=int(mem_total or 0), ncpu=int(ncpu or 0),
                           mem_used=int(sum(c["mem"] for c in containers)), containers=containers)
        except Exception as e:
            print("system refresh:", e, flush=True)
        time.sleep(6)


def all_status():
    with ThreadPoolExecutor(max_workers=12) as pool:
        stages = list(pool.map(stage_status, STAGES))
    emulators = [dict(id=e["id"], title=e["title"], cloud=e["cloud"], port=e["port"], up=port_open(e["port"]),
                      used_by=[s["title"] for s in STAGES if s["emulator"] == e["id"]],
                      job=running_job(e["id"], "emu:" + e["id"]), busy=bool(running_job(e["id"]))) for e in EMULATORS]
    groups = {}
    for c in _system["containers"]:
        if c["state"] == "running":
            groups[c["group"]] = groups.get(c["group"], 0) + 1
    active = [job_summary(j) for k, j in busy.items() if jobs[j]["rc"] is None]
    return dict(
        stages=stages, emulators=emulators, active=active,
        system=dict(docker=_system.get("docker", False), mem_total=_system.get("mem_total", 0), mem_used=_system.get("mem_used", 0),
                    ncpu=_system.get("ncpu", 0), running=sum(groups.values()), groups=groups),
        tools=dict(grafana=port_open(3400), prometheus=port_open(9091), gitea=port_open(3300)),
        ci_running=ci_jobs_running(), now=time.time(),
    )


def stage_detail(stage_id):
    stage = BY_ID.get(stage_id)
    if not stage:
        return None
    st = tfstate(stage)
    types = {}
    for r in st.get("resources", []):
        if r.get("mode") == "managed":
            types[r["type"]] = types.get(r["type"], 0) + len(r.get("instances", []))
    outputs = {k: v.get("value") for k, v in st.get("outputs", {}).items() if not v.get("sensitive")}
    return dict(status=stage_status(stage), resources=sorted(types.items(), key=lambda kv: (-kv[1], kv[0])), outputs=outputs,
                runs=[h for h in reversed(history) if h["target"] in (stage_id, "loadtest:" + stage_id)][:40],
                commands=dict(start=stage["start"], **{k: v for k, v in ACTIONS.items() if v}), dir=f"deployment/{stage['dir']}")


# ── local CI (Gitea) ────────────────────────────────────────────────────────────────────────────
WORKFLOWS = sorted(p.name for p in (ROOT / ".github/workflows").glob("*.yml") if not p.name.startswith("deploy-"))
SQL = ("SELECT r.id, r.workflow_id, r.status, r.started, r.stopped, "
       "(SELECT group_concat(j.name || '=' || j.status, '|') FROM action_run_job j WHERE j.run_id = r.id) "
       "FROM action_run r ORDER BY r.id DESC LIMIT 25")
RUN_STATUS = {1: "success", 2: "failure", 3: "cancelled", 4: "skipped", 5: "waiting", 6: "running", 7: "blocked"}


def ci_status():
    gitea = port_open(3300)
    runs = []
    if gitea:
        rc, out = sh(f"docker exec plant-ci-gitea-1 sqlite3 -cmd '.timeout 5000' -json /data/gitea/gitea.db \"{SQL}\"", timeout=15)
        try:
            for r in json.loads(out or "[]"):
                vals = list(r.values())
                jobs_ = [dict(name=x.split("=")[0], status=RUN_STATUS.get(int(x.split("=")[1]), "?")) for x in (vals[5] or "").split("|") if "=" in x]
                runs.append(dict(id=vals[0], workflow=vals[1], status=RUN_STATUS.get(vals[2], "?"), started=vals[3], stopped=vals[4], jobs=jobs_))
        except Exception:
            pass
    runner = any(c["name"] == "plant-ci-runner-1" and c["state"] == "running" for c in _system["containers"])
    return dict(gitea=gitea, runner=runner, workflows=WORKFLOWS, runs=runs, url="http://localhost:3300/ci/FullStack-DevOps/actions",
                job=running_job("ci"))


# ── jobs ────────────────────────────────────────────────────────────────────────────────────────
def run_job(job_id, key, steps):
    job = jobs[job_id]
    LOG_DIR.mkdir(exist_ok=True)
    logf = open(LOG_DIR / f"{job_id}.log", "w")
    try:
        for cmd, where in steps:
            rel = where.relative_to(ROOT) if where != ROOT else Path(".")
            job["lines"].append(f"$ (cd {rel}) {cmd}")
            logf.write(f"$ (cd {rel}) {cmd}\n")
            p = subprocess.Popen(cmd, shell=True, cwd=where, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 start_new_session=True, env={**os.environ, "CI": "", "TF_IN_AUTOMATION": "1", **BROWSER_ENV})
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
            if busy.get(key) == job_id:
                del busy[key]
        _cache.clear()


def launch(target, action, key, steps, block_on_ci=True):
    if block_on_ci and ci_jobs_running():
        return 409, {"error": "A pipeline is running on this Docker (local CI) and uses the same ports. Wait for it to finish."}
    with lock:
        current = busy.get(key)
        if current and jobs[current]["rc"] is None:
            other = jobs[current]
            return 409, {"error": f"Busy: {other['target']} is running '{other['action']}'. One operation at a time here.", "job": current}
        job_id = str(int(time.time() * 1000))
        jobs[job_id] = dict(target=target, action=action, lines=[], rc=None, started=time.time(), ended=None, pid=None,
                            expected=expected_seconds(target, action))
        busy[key] = job_id
    threading.Thread(target=run_job, args=(job_id, key, steps), daemon=True).start()
    return 202, {"job": job_id}


def stage_action(stage_id, action):
    stage = BY_ID.get(stage_id)
    if not stage or action not in ACTIONS:
        return 404, {"error": "unknown stage or action"}
    emu = EMU[stage["emulator"]]
    where = DEPLOY / stage["dir"]
    stale = resource_count(stage) and is_stale(stage)
    steps = []
    if stage["emulator"] == "aws" and not port_open(emu["port"]) and action != "forget":
        steps.append((emu["start"], ROOT))  # the shared AWS Floci first, for every action
    if action == "start":
        if stale:
            steps.append(("make forget", where))  # the emulator lost these resources: start from a clean state
        steps.append((stage["start"], where))
    elif action == "stop" and stale:
        steps.append(("make forget", where))  # nothing left to destroy
    else:
        steps.append((ACTIONS[action], where))
    return launch(stage_id, action, stage["emulator"], steps)


def emulator_action(emu_id, action):
    e = EMU.get(emu_id)
    if not e or action not in ("start", "stop"):
        return 404, {"error": "unknown emulator or action"}
    return launch("emu:" + emu_id, "emu-" + action, emu_id, [(e[action], ROOT / e["dir"])])


def loadtest_action(stage_id, profile):
    if stage_id not in LOADTEST_STAGES or profile not in LOADTEST_PROFILES:
        return 404, {"error": "unknown stage or profile"}
    if not port_open(9091):
        return 409, {"error": "Start the observability stack first (Prometheus receives the load-test metrics)."}
    return launch("loadtest:" + stage_id, "loadtest-" + profile, "loadtest", [(f"make {profile} STAGE={stage_id}", ROOT / "loadtest")])


def ci_action(action, arg=None):
    if action == "up":
        return launch("ci", "ci-up", "ci", [("make up", ROOT / "local-ci")], block_on_ci=False)
    if action == "down":
        return launch("ci", "ci-down", "ci", [("make down", ROOT / "local-ci")], block_on_ci=False)
    if action == "run" and arg in WORKFLOWS:
        return launch("ci:" + arg, "ci-run", "ci", [("make push BRANCH=ci-test", ROOT / "local-ci"), (f"./dispatch.sh {arg}", ROOT / "local-ci")],
                      block_on_ci=False)
    return 404, {"error": "unknown CI action"}


def observability_action(action):
    if action not in ("up", "down"):
        return 404, {"error": "unknown action"}
    return launch("observability", "obs-" + action, "observability", [(f"make {action}", ROOT / "observability")], block_on_ci=False)


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
        return dict(id=job_id, lines=job["lines"][offset:], next=len(job["lines"]), rc=job["rc"], target=job["target"],
                    action=job["action"], started=job["started"], ended=job["ended"], expected=job["expected"])
    f = LOG_DIR / f"{job_id}.log"  # a job from before a panel restart
    h = next((x for x in history if x["id"] == job_id), None)
    if f.exists() and h:
        lines = f.read_text(errors="replace").splitlines()
        return dict(id=job_id, lines=lines[offset:], next=len(lines), rc=h["rc"], target=h["target"], action=h["action"],
                    started=h["started"], ended=h["ended"], expected=None)
    return None


def prometheus(path, query):
    if path not in ("query", "query_range"):
        return 404, {"error": "unknown"}
    try:
        with urllib.request.urlopen(f"{PROMETHEUS}/api/v1/{path}?{query}", timeout=10) as r:
            return 200, json.loads(r.read())
    except Exception as e:
        return 502, {"status": "error", "error": f"Prometheus not reachable ({e.__class__.__name__}); start observability"}


# ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json", cache="no-store"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)

    def same_origin(self):
        # Stops another website from making your browser POST to localhost and start deployments.
        origin = self.headers.get("Origin")
        return self.headers.get("X-Panel") == "1" and (origin is None or origin.split("//", 1)[-1] == self.headers.get("Host"))

    def static(self, path):
        if not UI.exists():
            return self.send(503, b"The UI is not built yet: run `make -C control-panel run` (it builds it first).", "text/plain")
        f = (UI / path.lstrip("/")).resolve()
        if path == "/" or not f.is_file() or UI not in f.parents:
            f = UI / "index.html"  # single-page app: every unknown path is a client-side route
        immutable = "/assets/" in str(f)
        return self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream",
                         "public, max-age=31536000, immutable" if immutable else "no-cache")

    def do_GET(self):
        path, _, query = self.path.partition("?")
        params = dict(urllib.parse.parse_qsl(query))
        if not path.startswith("/api/"):
            return self.static(path)
        parts = path.strip("/").split("/")
        if path == "/api/status":
            return self.send(200, all_status())
        if path == "/api/containers":
            return self.send(200, dict(at=_system["at"], containers=_system["containers"]))
        if path == "/api/history":
            return self.send(200, list(reversed(history[-100:])))
        if path == "/api/ci":
            return self.send(200, ci_status())
        if len(parts) == 3 and parts[1] == "stages":
            body = stage_detail(parts[2])
            return self.send(200, body) if body else self.send(404, {"error": "no such stage"})
        if len(parts) == 3 and parts[1] == "prom":
            code, body = prometheus(parts[2], query)
            return self.send(code, body)
        if len(parts) == 4 and parts[1] == "jobs" and parts[3] == "log":
            body = read_log(parts[2], int(params.get("from", 0)))
            return self.send(200, body) if body else self.send(404, {"error": "no such job"})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.same_origin():
            return self.send(403, {"error": "cross-origin request refused"})
        p = self.path.strip("/").split("/")
        route = {
            ("stages", 4): lambda: stage_action(p[2], p[3]),
            ("emulators", 4): lambda: emulator_action(p[2], p[3]),
            ("loadtests", 4): lambda: loadtest_action(p[2], p[3]),
            ("ci", 3): lambda: ci_action(p[2]),
            ("ci", 4): lambda: ci_action(p[2], p[3]),
            ("observability", 3): lambda: observability_action(p[2]),
            ("jobs", 4): lambda: cancel(p[2]) if p[3] == "cancel" else (404, {"error": "not found"}),
        }.get((p[1] if len(p) > 1 else "", len(p)))
        code, body = route() if route and p[0] == "api" else (404, {"error": "not found"})
        self.send(code, body)


if __name__ == "__main__":
    threading.Thread(target=refresh_system, daemon=True).start()
    print(f"control panel on http://localhost:{PORT}  (repo: {ROOT})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
