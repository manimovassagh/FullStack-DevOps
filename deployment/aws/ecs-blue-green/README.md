# ecs-blue-green: blue/green and canary releases on ECS

The same Plant Parent app as [`../ecs`](../ecs), but with **two complete environments** (blue and green) behind one load balancer, so a new version can be tested, introduced gradually and rolled back in seconds.

```
                         ┌─ weight 100−g ─▶ blue  target groups ◄─ ECS services blue-frontend,  blue-backend   (image tag A)
 Browser ─▶ ALB :8091 ───┤
 (public listener)       └─ weight g     ─▶ green target groups ◄─ ECS services green-frontend, green-backend  (image tag B)

 Browser ─▶ ALB :8092  ── 100% ──▶ green   (preview listener: test the candidate before any user gets it)
```

`g` is `green_weight`. Everything else (VPC, RDS, secret, S3, IAM) is a copy of the ECS stage; only `alb.tf` and `ecs.tf` changed, and `scripts/` was added.

## Run it

    make up                  # repo root first: Postgres + Floci
    cd deployment/aws/ecs-blue-green
    make init images up      # blue runs the current commit with 100% of the traffic
    make smoke               # API + browser tests through http://localhost:8091

A release (use any new image tag; `make images IMAGE_TAG=v2` builds one):

    make release TAG=v2      # green starts on v2 with 0% of user traffic
    make preview             # smoke-test green alone: http://localhost:8092
    make canary PCT=10       # 10% of users to green
    make sample N=50         # which environment served 50 requests? → blue=44 green=6
    make promote             # 100% to green; blue keeps running
    make rollback            # …or send everyone back to blue, instantly
    make finalize            # blue takes v2, green is switched off: v2 is the new stable
    make abort               # drop a candidate that never got traffic

`make rollout` runs the whole journey and asserts where the traffic goes after every step. `make status` shows the release state and target health. `make destroy` tears everything down.

## How it works

- **The release is a state file.** `scripts/release.sh` edits `release.auto.tfvars.json` (`blue_tag`, `green_tag`, `blue_count`, `green_count`, `green_weight`), then `make` runs `terraform apply`. The transitions are refused when they don't make sense (a canary with no green, an abort while green has traffic).
- **Traffic is weights on the listener.** `alb.tf` has one `forward` action with two weighted target groups, for the default (frontend) action and the `/api/*` rule. 0 means nobody, 100 means everybody.
- **Four ECS services.** `blue-backend`, `blue-frontend`, `green-backend`, `green-frontend`. Each environment has its own task definitions, so the two can run different image tags at the same time. Green runs 0 tasks until a release.
- **The preview listener** always forwards to green: the same idea as CodeDeploy's "test listener". It lets you run the real smoke tests against the candidate through the real load balancer before a single user sees it.
- **`finalize` is two applies.** First blue takes green's tag while green still serves 100% (blue is replaced with no user impact), then the weight returns to blue and green stops.

## Compared with a rolling deploy (the `ecs` stage)

| | ecs (rolling) | ecs-blue-green |
|---|---|---|
| new version visible to users | replaces tasks one by one, everyone gets it | nobody until you move weight |
| test before users | no | yes (preview listener) |
| partial exposure | no | canary percentage |
| rollback | deploy the old version again (minutes) | move the weight back (seconds) |
| cost | one set of tasks | two sets while a release is in flight |
| moving parts | 2 services | 4 services, 4 target groups, 2 listeners |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).
