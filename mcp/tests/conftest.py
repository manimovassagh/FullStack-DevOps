"""Shared fixtures: a small fixture repository and a fake Mission Control (no Docker, no network beyond loopback)."""
from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import pytest

REAL_ROOT = Path(__file__).resolve().parents[2]


def run(coro):
    return asyncio.run(coro)


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def make_repo(root: Path) -> Path:
    write(root, "README.md", "# Demo lab\n\nA demo lab.\n\n## Commands\n\n`make up`\n\n## Repository layout\n\n```\ndeployment/  stages\n```\n")
    write(root, "deployment/ROADMAP.md", "# Roadmap\n\n## Principles\n\n- Stages are standalone cookbooks: never share Terraform.\n- Every stage has CI smoke tests.\n\n## Phases\n\ndone\n")
    write(root, "docs/PLATFORM-ROADMAP.md", "# Platform roadmap\n\n## Out of scope on purpose: deep security hardening\n\nThis is a blueprint.\n\n## Known simplifications (kept on purpose)\n\n- The origin leg is plain HTTP.\n")
    write(root, "docs/adr/0001-why-floci.md", "# 1. Why Floci\n\nWe run on an emulator so everything is local.\n")
    write(root, ".github/workflows/demo-ecs.yml", "on:\n  push:\n    paths:\n      - deployment/aws/demo-ecs/**\n")
    write(root, ".github/workflows/demo-auth.yml", "on:\n  push:\n    paths:\n      - deployment/aws/demo-auth/**\n")
    # --- demo-ecs: the base stage
    write(root, "deployment/aws/demo-ecs/README.md",
          "# Demo ECS — on Floci\n\nA container service behind a load balancer, with a database.\n\n```\nbrowser -> alb -> task\n```\n\n"
          "## Run it\n\n    make up\n    make smoke\n\n## What each file teaches\n\n| File | Concept |\n|---|---|\n"
          "| alb.tf | listener rules and target groups |\n| ecs.tf | a Fargate service |\n")
    write(root, "deployment/aws/demo-ecs/FLOCI-NOTES.md",
          "# Floci notes for demo-ecs\n\n## Lambda version list order\n\nThe provider takes the last version as the newest, so the rollout never moved the alias.\n\n"
          "## Bind mounts in CI\n\nA CI job container checkout is a volume, so bind mounts come up empty.\n")
    write(root, "deployment/aws/demo-ecs/main.tf",
          '# The load balancer: public, in front of the tasks.\n# Listener rules route /api to the backend.\nresource "aws_lb" "main" {}\n\n'
          'resource "aws_lb_listener_rule" "api" {}\n\n# One Fargate service per tier.\n# Desired count is one.\nresource "aws_ecs_service" "app" {}\n')
    write(root, "deployment/aws/demo-ecs/compose.yaml", 'services:\n  floci:\n    ports:\n      - "4573:4566"\n      - "8100:80"\n')
    write(root, "deployment/aws/demo-ecs/Makefile", "# Demo ECS.\n# Run from this directory.\nup:\n\techo up\n")
    # --- demo-auth: builds on demo-ecs and adds Cognito
    write(root, "deployment/aws/demo-auth/README.md",
          "# Demo auth — on Floci\n\nThe [demo-ecs](../demo-ecs/) recipe plus Amazon Cognito sign-in.\n\n## Run it\n\n    make up\n")
    write(root, "deployment/aws/demo-auth/FLOCI-NOTES.md", "# Floci notes for demo-auth\n\n## Hosted login\n\nFloci's hosted login page is bare HTML.\n")
    write(root, "deployment/aws/demo-auth/main.tf",
          '# Users sign in with Cognito.\n# The hosted UI is the login page.\nresource "aws_cognito_user_pool" "main" {}\nresource "aws_ecs_service" "app" {}\n')
    write(root, "deployment/aws/demo-auth/compose.yaml", 'services:\n  floci:\n    ports:\n      - "4574:4566"\n')
    # --- demo-tls: HTTPS variant of demo-auth
    write(root, "deployment/aws/demo-tls/README.md",
          "---\nconcepts: [custom-concept]\n---\n# Demo TLS — on Floci\n\nThe [demo-auth](../demo-auth/) stage over HTTPS with mkcert and a Caddy proxy, TLS terminated in front.\n\n## Run it\n\n    make up\n")
    write(root, "deployment/aws/demo-tls/FLOCI-NOTES.md", "# Floci notes for demo-tls\n\n## HTTPS\n\nCaddy terminates TLS.\n")
    write(root, "deployment/aws/demo-tls/main.tf", '# TLS is terminated by Caddy.\n# The certificate comes from mkcert.\nresource "aws_cognito_user_pool" "main" {}\nresource "aws_ecs_service" "app" {}\n')
    write(root, "deployment/aws/demo-tls/Caddyfile", "# TLS in front of the emulator.\n# Certificates come from mkcert.\nexample.localhost {\n}\n")
    write(root, "deployment/aws/demo-tls/scripts/tls-check.sh", "#!/usr/bin/env bash\n# Checks the certificate.\n# And the protocol.\necho ok\n")
    # --- things that must never be served
    write(root, "deployment/aws/demo-ecs/terraform.tfstate", '{"secret": "state"}')
    write(root, "deployment/aws/demo-tls/certs/tls-key.pem", "-----BEGIN PRIVATE KEY-----")
    write(root, "deployment/aws/demo-ecs/.env", "TOKEN=secret")
    write(root, "deployment/aws/demo-ecs/build/out.txt", "build output")
    write(root, "deployment/aws/demo-tls/vars.tfvars", "password = \"x\"")
    return root


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    return make_repo(tmp_path / "lab")


# ----------------------------------------------------------------------------------------------
class FakePanel:
    """Behaves like Mission Control where it matters: X-Panel header required on POST, 409 when busy."""

    def __init__(self):
        self.posts: list[str] = []
        self.gets: list[str] = []
        self.busy_job: str | None = None
        self.stage_state = "down"
        self.job_lines = ["\x1b[1m$ make up\x1b[0m", "creating…"]
        self.job_rc: int | None = None
        stage = lambda i, st: {"id": i, "title": f"Title {i}", "family": "aws", "kind": "container", "emulator": "e1", "note": "",
                               "login": None, "state": st, "since": 0, "url": None, "port": None, "resources": 0, "job": None,
                               "last": None, "loadtest": True, "loadtest_job": None}
        self.stages = {"demo-ecs": stage("demo-ecs", "down"), "demo-auth": stage("demo-auth", "down")}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def set_state(self, sid: str, state: str, resources: int = 0):
        self.stages[sid]["state"], self.stages[sid]["resources"] = state, resources

    def _handler(self):
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def _send(self, code, body):
                raw = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                path = urlparse(self.path).path
                fake.gets.append(self.path)
                if path == "/api/status":
                    return self._send(200, {"stages": list(fake.stages.values()), "now": 1000, "ci_running": False, "active": [],
                                            "emulators": [{"id": "e1", "title": "Emulator 1", "cloud": "aws", "port": 4573, "up": True,
                                                           "used_by": ["Title demo-ecs", "Title demo-auth"], "job": None, "busy": False}],
                                            "system": {}, "tools": {}})
                if path.startswith("/api/stages/"):
                    sid = path.rsplit("/", 1)[1]
                    if sid not in fake.stages:
                        return self._send(404, {"error": "no such stage"})
                    return self._send(200, {"status": fake.stages[sid], "resources": [], "outputs": {"app_url": "http://x"},
                                            "runs": [{"id": "1", "action": "start", "rc": 0}], "commands": {}, "dir": "d",
                                            "addresses": [], "readme": "", "containers": {"items": [{"name": "c1", "state": "running"}]}})
                if path == "/api/ci":
                    return self._send(200, {"gitea": True, "runner": True, "workflows": ["demo-ecs.yml", "demo-auth.yml"],
                                            "url": "http://ci", "job": None,
                                            "runs": [{"id": 7, "workflow": "demo-ecs.yml", "status": "success", "started": 1, "stopped": 2,
                                                      "jobs": [{"id": 70, "name": "Backend", "status": "success"}]}]})
                if path == "/api/history":
                    return self._send(200, [{"id": "9", "target": "demo-ecs", "action": "start", "rc": 0, "started": 1, "ended": 61}])
                if path.startswith("/api/ci/jobs/") and path.endswith("/log"):
                    return self._send(200, {"lines": ["2026-10-12T10:00:00Z \x1b[32mok\x1b[0m"] * 3, "note": ""})
                if path.startswith("/api/jobs/") and path.endswith("/log"):
                    return self._send(200, {"id": "9", "action": "start", "target": "demo-ecs", "lines": fake.job_lines,
                                            "next": len(fake.job_lines), "rc": fake.job_rc, "started": 1, "ended": None, "expected": 60})
                return self._send(404, {"error": "not found"})

            def do_POST(self):
                if self.headers.get("X-Panel") != "1":
                    return self._send(403, {"error": "cross-origin request refused"})
                fake.posts.append(self.path)
                if fake.busy_job:
                    return self._send(409, {"error": "a pipeline is running", "job": fake.busy_job})
                return self._send(200, {"job": f"job-{len(fake.posts)}"})

        return H


@pytest.fixture
def panel():
    p = FakePanel()
    yield p
    p.server.shutdown()
