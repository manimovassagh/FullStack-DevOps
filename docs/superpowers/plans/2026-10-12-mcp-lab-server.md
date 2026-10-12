# Plan: an MCP server for the lab (operate it, and learn from it)

Status: **built (phases 0–5)** in [mcp/](../../../mcp/README.md); phase 6 (hosted read-only lab-learn) is not. lab-operate ended with 20 tools (7 read, 8 act, 5 destructive), more than the "about 12" first planned, because each action stayed its own tool so clients can annotate each one. Decided: location (top-level `mcp/`, option A) and language (Python). The remaining open questions are in section 9.

## 1. Goal

Let any MCP-capable AI (Claude Code, Claude Desktop, Cursor, a custom agent) do two different things with this repository:

| | **Learn** | **Operate** |
|---|---|---|
| Purpose | understand the blueprint: what each stage is, why it is built that way, what went wrong and how it was fixed | run the local lab: deploy a stage, run a pipeline, read its log |
| Touches | repository files only | the running lab (Mission Control, Docker, local CI) |
| Risk | none (read-only) | real (deploys, destroys, drives Docker) |
| Needs the lab running | no | yes |

**Two servers, not one.** `lab-learn` and `lab-operate` ship from the same package but are separate processes with separate configuration. A learner AI never receives a tool that can deploy or destroy anything, and `lab-learn` can later be shared or hosted because it can only read.

## 2. What already exists (so this is mostly a wrapper plus curation)

- **Operate:** Mission Control's HTTP API already offers everything: stages and emulators (list, start, stop, deploy, destroy, smoke), local CI (up, run a workflow, job logs), load tests, observability, job status and cancel. It already refuses unsafe requests (one CI job at a time, stage actions paused while a pipeline runs, a same-site check on every POST). The MCP calls this API; it does not reimplement it.
- **Learn:** 17 stage READMEs, 17 `FLOCI-NOTES.md` (436 lines of emulator lessons), 206 Terraform files (808 comment lines), 7 plans/specs, 36 smoke and helper scripts, `deployment/README.md` (stage table), `deployment/ROADMAP.md` (the rules for adding a stage), `docs/PLATFORM-ROADMAP.md` (next improvements and the known simplifications).
- **Gaps that matter for learning:** no decision records (ADRs); only 7 of 17 READMEs have a "What each file teaches" table; no machine-readable list of which concepts each stage teaches.

## 3. Architecture

```
AI client ──stdio──► lab-learn    ──reads──► repo files + catalog.json          (no network, no Docker)
AI client ──stdio──► lab-operate  ──HTTP──► Mission Control :3500 ──► make / Docker / Gitea
```

- **Package:** `mcp/` at the repository root (Python, the official MCP SDK; Mission Control is Python too, so one toolchain). Entry points `lab-learn` and `lab-operate`.
- **Transport:** stdio, local only. The operate server never listens on a network port.
- **Catalog:** `mcp/src/lab_mcp/learn/catalog.py` builds `catalog.json` from the repo (stage list from `deployment/`, notes from each README and FLOCI-NOTES, concept tags from small front-matter in each README, ports and checks from the Makefiles). The docs stay the single source of truth; the catalog is generated, never edited by hand, and CI fails if it is out of date.
- **Config:** `LAB_ROOT` (repo path, default the checkout), `LAB_PANEL_URL` (default `http://localhost:3500`).

## 3a. Folder structure and separation rules

`mcp/` is not part of `platform/`: `platform/` is what *runs* the lab (CI, observability, dashboard, HTTPS); the MCP is an interface that sits on top of the lab and its documentation.

```
mcp/
├── README.md              what it is; connecting Claude Code, Claude Desktop, Cursor
├── Makefile               install · test · eval · catalog · run-learn · run-operate
├── pyproject.toml         package metadata, MCP SDK dependency, two entry points
├── src/lab_mcp/
│   ├── common/            config.py (LAB_ROOT, LAB_PANEL_URL, read-only switch) · paths.py (inside-repo guard, secret and state-file denylist)
│   ├── learn/             server.py · catalog.py · search.py · resources.py · tools.py · prompts/ (teach_stage, quiz_me, review_change, add_stage as Markdown)
│   └── operate/           server.py · panel.py (the only door to the lab) · tools_read.py · tools_act.py · tools_destructive.py
├── tests/                 learn/ (fixture repo) · operate/ (fake Mission Control, no Docker) · safety/
└── eval/                  questions.yaml (~20 questions with expected sources) · run.py (scores the learn server; runs in CI)
```

Elsewhere in the repository: `docs/adr/` (new decision records), `.github/workflows/mcp.yml` (tests, evaluation, "catalog is up to date"), and a small front-matter block plus a "What each file teaches" table in every stage README.

**Separation rules** (these keep `mcp/` extractable into its own repository later, e.g. with `git subtree split`, without changing anything inside it):

1. `mcp/` imports nothing from `apps/`, `platform/` or `deployment/`. `lab-learn` reads files; `lab-operate` calls Mission Control's HTTP API. Nothing else.
2. `learn/` and `operate/` never import each other; they share only `common/`. A learner process contains no code that can act on the lab.
3. `operate/panel.py` is the only door to the lab: no `subprocess`, no Docker calls, no shell.
4. The repository location is a setting (`LAB_ROOT`), never a hard-coded path.
5. Its own `pyproject.toml`, tests and workflow; its CI filter is `mcp/**`.
6. `catalog.json` is generated, never committed and never edited by hand.

## 4. `lab-learn`: capabilities

### Resources (read-only, addressed by URI)

| URI | Content |
|---|---|
| `blueprint://overview` | what the lab is, how it is laid out (`apps/`, `platform/`, `deployment/`), how to read it |
| `blueprint://rules` | the rules for stages (standalone cookbooks, no shared Terraform, each style has CI smoke tests) |
| `blueprint://simplifications` | what is deliberately simplified or out of scope (security hardening, the HTTP origin leg, demo users). **Attached to every teaching answer** so local shortcuts are never presented as production advice |
| `blueprint://stage/{id}` | README, FLOCI-NOTES, ports, smoke checks, files, concepts |
| `blueprint://lessons` | all emulator and CI lessons, grouped by topic (e.g. "Lambda version order", "bind mounts in CI") |
| `blueprint://concept/{name}` | where a concept is implemented (ALB listener rules, Cognito flows, CloudFront origins…) with file and line |
| `blueprint://adr/{n}` | decision records |
| `blueprint://file/{path}` | any tracked file (read-only, restricted to the repo, no secrets or state) |

### Tools

| Tool | What it returns |
|---|---|
| `search_blueprint(query)` | ranked matches over docs and code comments, each with `path:line` and a snippet |
| `explain_stage(id, depth)` | a structured explanation: shape, key files, what it teaches, gotchas, how to run and verify |
| `compare_stages(a, b)` | what differs: resources, files, ports, auth, TLS, tests |
| `find_example(concept)` | the best place in the repo that shows the concept, plus alternatives |
| `lessons_for(topic)` | the lessons learned about a topic, with the symptom, the cause and the fix |
| `learning_path(goal)` | an ordered list of stages and docs for a goal ("learn ECS with auth") |

### Prompts

- `teach_stage` — explain a stage step by step at a chosen level, then check understanding.
- `quiz_me` — questions about a stage, with answers cited from the repo.
- `review_change` — check a proposed change against the blueprint's rules.
- `add_stage` — walk through adding a new stage the way the rules require.

### Grounding rules (these are what make it trustworthy)

1. Every claim in a tool result carries a citation (`path:line`).
2. "Why" comes from the repository (FLOCI-NOTES, ADRs, comments), not from the model's memory.
3. Results end with the simplifications notice when they describe design choices.
4. File contents are returned as data; nothing in a file is treated as an instruction.

## 5. `lab-operate`: capabilities

| Tool | Class | Does |
|---|---|---|
| `list_stages`, `stage_status(id)` | read | state, URL, resources, last run |
| `list_emulators` | read | which emulators are up |
| `ci_status`, `pipeline_runs(limit)` | read | Gitea up, runner up, recent runs with job states |
| `job_log(job_id, from)` | read | a panel job's log or a pipeline job's log, paged |
| `deploy_stage(id)`, `smoke_stage(id)` | act | start the job, return a job id |
| `run_pipeline(workflow)` | act | start one pipeline (refuses while another runs) |
| `start_ci`, `start_emulator(id)`, `start_observability` | act | bring pieces up |
| `destroy_stage(id)`, `stop_emulator(id)`, `stop_ci`, `cancel_job(id)` | **destructive** | requires `confirm=true`; the first call without it only describes what would happen |

**Long-running pattern.** Deploys take minutes and pipelines up to ten, so tools never block: an action returns a job id immediately; the AI polls `stage_status` or `job_log`. This matches how Mission Control works already.

**Guardrails**
- Local only (stdio, loopback to the panel). No network exposure.
- Read tools work without any confirmation; destructive tools need `confirm=true` and name the stage and what it will remove.
- The panel's own rules apply and are surfaced as clear errors (busy, CI running, not up).
- **Not offered, on purpose:** arbitrary shell, Docker passthrough, file writes, anything outside the panel's API.
- Optional `LAB_OPERATE_READONLY=1` hides every action tool.

## 6. Content work this needs (it also improves the repo for humans)

1. **ADRs** (`docs/adr/`): why Floci; why stages never share Terraform; why local CI on Gitea; why `apps/` + `platform/`; why `signup`; why nightly-10102026 for the serverless stages; why HTTPS terminates in Caddy.
2. **A "What each file teaches" table** in the 10 READMEs that lack one.
3. **Small front-matter in each stage README** (concepts, prerequisites, level) so the catalog can answer "which stage teaches X".
4. **A concept index** (concept → stages and files), generated from that front-matter.

## 7. Phases

| # | Phase | Delivers | Effort | Done when |
|---|---|---|---|---|
| 0 | Content prep | ADRs, missing tables, front-matter | M | every stage README has the table and front-matter; 7 ADRs exist |
| 1 | Catalog + learn resources | `catalog.py`, `lab-learn` with resources and `search_blueprint` | M | the evaluation set (section 8) scores at least 80 % with citations |
| 2 | Learn tools and prompts | explain, compare, find_example, lessons, learning_path, prompts | M | all tools covered by tests; prompts exercised in a client |
| 3 | Operate, read-only | status, logs, pipeline runs | S | every read tool matches what Mission Control shows |
| 4 | Operate, actions | deploy/smoke/run_pipeline, destructive tools with `confirm`, job pattern | M | a stage deployed, smoked and destroyed end to end by an AI |
| 5 | Tests, CI, docs | unit tests, contract test with the MCP inspector, catalog drift check in CI, client configuration snippets | M | CI green; README shows setup for Claude Code, Claude Desktop, Cursor |
| 6 | *(optional)* shared learn server | `lab-learn` over HTTP, read-only, hosted | M | nothing in it can act on a lab |

Suggested order: 0 → 1 → 2 (a complete, safe, useful product), then 3 → 4 → 5, then 6 if wanted. The learn half is first because it has no risk and forces the documentation work that helps everyone.

## 8. How we will know it works

- **Evaluation set** (`mcp/eval/`): about 20 questions with expected sources, e.g. "why did `serverless-cognito`'s rollout not move the alias?" (expects FLOCI-NOTES of the serverless stages and the nightly pin), "which stage teaches a Cognito hosted login?" (expects `ecs-alb-auth`), "why can't a CI job bind-mount the checkout?" (expects the bind-mount lessons). Scored on: correct answer, correct citations, simplifications notice present.
- **Operate:** every action tool has a dry-run test against a fake panel, plus one real end-to-end run in the lab.
- **Safety tests:** a destructive tool without `confirm=true` changes nothing; a path outside the repo is refused; secrets and state files are never returned.

## 9. Open questions for you

0. **Decided:** location is top-level `mcp/` (not `platform/`, not a separate repository yet); language is **Python** (matches Mission Control; `uvx` gives the same one-line install as `npx` if the learn server is ever published).
1. **Names:** `lab-learn` / `lab-operate`, or a more distinctive product name?
3. **Learn server sharing:** local only for now, or also publish the read-only server so others can use the blueprint without cloning?
4. **Confirmation style:** `confirm=true` argument (simple), or rely on the client's own approval prompt for destructive tools, or both?
5. **Mission Control API stability:** add a `/api/v1` prefix before the MCP depends on it?

## 10. Risks

- **Documentation drift:** the learn server is only as good as the docs. Mitigation: generated catalog and a CI drift check; the evaluation set runs in CI.
- **Too many tools:** models pick worse when offered dozens. Mitigation: about 6 learn tools and 12 operate tools, each with a precise description.
- **Operate misuse:** a confused agent could destroy a stage. Mitigation: confirmation, no shell, read-only switch, and the panel's existing locks.
- **Out-of-date answers about emulators:** Floci changes quickly. Mitigation: every lesson names the Floci version it was observed on.
