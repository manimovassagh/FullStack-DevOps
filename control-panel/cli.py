#!/usr/bin/env python3
"""Terminal front door to the control panel: the same actions as the buttons, with the job's log streamed here.

    python3 control-panel/cli.py stages
    python3 control-panel/cli.py deploy ecs        (also: destroy, smoke, release, forget)
    python3 control-panel/cli.py loadtest ecs-cognito load
    python3 control-panel/cli.py emulator aws start

Runs go through the panel API (http://localhost:3500), so they appear live in the panel too, with the same
safety rules (one operation per emulator, paused during CI, emulator-reset handling). Exit code = the job's.
"""
import json
import sys
import time
import urllib.error
import urllib.request

PANEL = "http://localhost:3500"
ACTIONS = {"deploy": "start", "destroy": "stop", "smoke": "smoke", "release": "rollout", "forget": "forget"}
COLOR = {"up": "\033[32m", "down": "\033[90m", "partial": "\033[31m", "stale": "\033[35m", "busy": "\033[33m"}
RESET = "\033[0m"


def call(method, path):
    req = urllib.request.Request(PANEL + path, method=method, headers={"X-Panel": "1"} if method == "POST" else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except urllib.error.URLError:
        sys.exit("The control panel is not running: `make dashboard-up` starts it.")


def follow(job):
    sent, rc = 0, None
    while rc is None:
        code, j = call("GET", f"/api/jobs/{job}/log?from={sent}")
        if code != 200:
            time.sleep(1)
            continue
        for line in j["lines"]:
            print(line, flush=True)
        sent, rc = j["next"], j["rc"]
        if rc is None:
            time.sleep(1)
    return rc


def run(path, what):
    code, body = call("POST", path)
    if code not in (200, 202):
        sys.exit(f"✗ {what}: {body.get('error', code)}")
    print(f"▶ {what} (job {body['job']}, live in the panel too: {PANEL}/activity)\n", flush=True)
    rc = follow(body["job"])
    print(f"\n{'✓' if rc == 0 else '✗'} {what}: {'done' if rc == 0 else f'failed (exit {rc})'}")
    return rc


def stages():
    _, s = call("GET", "/api/status")
    print(f"{'STAGE':<22}{'STATE':<16}{'URL':<34}NOTE")
    for st in s["stages"]:
        state = f"{st['job']['action']}…" if st["job"] else st["state"]
        key = "busy" if st["job"] else st["state"]
        print(f"{st['id']:<22}{COLOR.get(key, '')}{state:<16}{RESET}{(st['url'] or '-'):<34}{st['note']}")
    emus = "  ".join(f"{e['id']}:{'up' if e['up'] else 'off'}" for e in s["emulators"])
    print(f"\nemulators  {emus}\ncontainers {s['system']['running']} running · panel {PANEL}")


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd in ("stages", "status"):
        stages()
        return 0
    if cmd in ACTIONS and len(args) == 1:
        return run(f"/api/stages/{args[0]}/{ACTIONS[cmd]}", f"{cmd} {args[0]}")
    if cmd == "loadtest" and len(args) in (1, 2):
        profile = args[1] if len(args) == 2 else "load"
        return run(f"/api/loadtests/{args[0]}/{profile}", f"{profile} load test on {args[0]}")
    if cmd == "emulator" and len(args) == 2:
        return run(f"/api/emulators/{args[0]}/{args[1]}", f"emulator {args[0]} {args[1]}")
    sys.exit(f"unknown command: {' '.join(argv)}  (see --help)")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
