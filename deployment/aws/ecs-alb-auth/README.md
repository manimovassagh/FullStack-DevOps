# ECS + sign-in at the load balancer — on Floci

```
browser ─► :8097 ─► everyone can browse (pages, GET /api/*) ─► frontend / backend (the repo's images)
                    ├─ "Sign in" or "Add plant" signed out ─► Cognito hosted login ─► back, with a session
                    └─ POST/PUT/PATCH/DELETE /api/* without a session ─► 401
 real AWS: the ALB's authenticate-cognito rules (alb.tf)     Floci: an oauth2-proxy task in front (proxy.tf)
 backend task ─► RDS Postgres ─► S3 plant-ecs-alb-auth-media
```

The [ecs](../ecs/) recipe with **optional sign-in in front of the app**: the app opens for everyone and has a Sign in button; adding, watering, editing or deleting a plant needs a Cognito session. The backend contains no auth code and the frontend is the shared `frontend/` plus [`signin/signin.js`](signin/signin.js) (the button, and "sign in first" when a signed-out visitor tries a change), added at image build time.

On real AWS the load balancer enforces it: `authenticate-cognito` with `on_unauthenticated_request = "allow"` for pages and reads, `"deny"` (401) for API changes, `"authenticate"` on the `/oauth2/start` sign-in link. Floci stores these actions but does not run them, so on Floci an **oauth2-proxy** ECS task applies the same rules with the same pool and client (see FLOCI-NOTES.md).

## Run it

    cd deployment/aws/ecs-alb-auth
    make floci               # this stage's own Floci on :4569 (a nightly; see FLOCI-NOTES.md)
    make init
    make apply               # build images → push to ECR → terraform apply (Cognito + the ECS stack)
    make wait                # both target groups healthy
    make smoke               # sign in through the hosted login, then the ALB rules, API and browser tests
    open http://localhost:8097   # Sign in: alice@plant.example or bob@plant.example, password Plant-Parent-2026!
    make destroy && docker compose down

`make check` proves the deployment is idempotent. `make rollout` ships a new task-definition revision and proves the session from before the rollout still works (the cookie belongs to the ALB, not to the tasks).

## What each file teaches

| File | AWS concept |
|---|---|
| cognito.tf | user pool, **hosted UI domain**, a **confidential** app client (with a secret, the authorization-code flow, the ALB's `/oauth2/idpresponse` callback) |
| alb.tf | listener actions in order: `authenticate-cognito` (order 1) then `forward` (order 2); `on_unauthenticated_request = "authenticate"` for pages, `"deny"` for the API |
| variables.tf | `on_floci`: HTTP listener on Floci, **HTTPS + ACM certificate** on real AWS (ALB authentication requires HTTPS) |
| ecr.tf, ecs.tf, iam.tf, database.tf, network.tf, security.tf, storage.tf | the ecs recipe, copied unchanged apart from names |
| scripts/auth-rules.sh | what the ALB lets through, with and without a session, with a forged cookie |

## Compared with ecs-cognito

| | ecs-alb-auth | ecs-cognito |
|---|---|---|
| where the sign-in is checked | the ALB, before the request reaches a task | the Go API, on every request (JWT + JWKS) |
| app changes | none | own copies `backend-auth/`, `frontend-auth/` |
| who is calling | the app only knows if it reads the ALB's `x-amzn-oidc-*` headers | the token's claims, per-user data, an admin group |
| login page | Cognito's hosted UI | the app's own form |
| API clients without a browser | no (they would need the ALB session cookie) | yes, with a bearer token |
| logout | not built in: expire the ALB cookie and send the user to the hosted `/logout` | revokes the refresh token |
| real AWS requirement | an HTTPS listener and a certificate | none |

**When to choose which:** put auth at the edge to protect an app you cannot or do not want to change (an internal tool, a vendor dashboard, a legacy service) where "signed in or not" is enough. Put it in the app once it needs to know *who* is calling: per-user data, roles, API clients.

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md). Shared tests: [smoke](../../smoke/).
