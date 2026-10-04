# ECS (Fargate) + Amazon Cognito sign-in — on Floci

The [ecs](../ecs/) recipe with real authentication and authorization: users sign in with **Amazon Cognito**, the API verifies every request's token, and every user sees only their own plants (members of the `admin` group see all).

```
Browser ─► ALB localhost:8096
             ├─ /api/* ─► backend  (Fargate: Go API "backend-auth") ─► RDS Postgres, S3
             │             ├─ /api/auth/login|refresh|logout ─► Cognito InitiateAuth / RevokeToken   (public)
             │             └─ everything else: Bearer token verified against the pool's signing keys (JWKS)
             └─ /*     ─► frontend (Fargate: nginx + React "frontend-auth", with a login page)
 Cognito: user pool + app client + "admin" group + 3 demo users
```

The app is **not** the shared `backend/` and `frontend/`: it is their own copies, [`backend-auth/`](../../../backend-auth/) and [`frontend-auth/`](../../../frontend-auth/), so no other stage changes.

## How sign-in works

1. The login form posts the email and password to `POST /api/auth/login` (over TLS on real AWS). The API calls Cognito `InitiateAuth`; the browser never talks to Cognito.
2. The response carries a short-lived **access token** (a JWT, 60 min). The page keeps it **in memory only**. The long-lived **refresh token** comes back as an `HttpOnly; SameSite=Strict` cookie that scripts cannot read.
3. Every other `/api/*` call sends `Authorization: Bearer <access token>`. The API checks the signature (RS256 only, keys from the pool's JWKS), `iss`, `exp`, `token_use=access` and `client_id`.
4. When the token expires the page calls `/api/auth/refresh` (cookie) and retries once; a reload does the same. Logout revokes the refresh token in Cognito.

## What is protected, and how

| Rule | Where |
|---|---|
| no token, bad token, forged signature, expired, wrong pool/client → `401` | `internal/auth/verifier.go` |
| every query is filtered by the owner (`owner_id` = the token's `sub`); another user's plant or photo is `404`, not `403` | `internal/store/*.go`, migration `002_owner.sql` |
| the store refuses to run a query without an owner in the context (a forgotten middleware fails closed) | `internal/store/owner.go` |
| members of the Cognito group `admin` see every user's data | `cognito:groups` claim |
| wrong password and unknown user give the same answer; Cognito's throttling becomes `429` | `internal/auth/login.go` |
| no self sign-up; password policy of 12 characters with all classes | `cognito.tf` |

## Run it

    make up                          # repo root: Postgres + Floci
    cd deployment/aws/ecs-cognito
    make init
    make apply                       # build backend-auth/frontend-auth → push to ECR → terraform apply
    make wait
    make smoke                       # sign-in rules, API smoke as alice, browser tests with a real login
    open http://localhost:8096       # sign in as alice@plant.example / Plant-Parent-2026!
    make destroy

Demo users (all with the password in `var.demo_password`): `alice@plant.example` and `bob@plant.example` (members), `root@plant.example` (admin). They exist only because this is a throwaway local emulator; on real AWS you invite people (`admin-create-user`) and never keep passwords in Terraform.

## What `make smoke` proves

- [`scripts/auth-smoke.sh`](scripts/auth-smoke.sh): anonymous and forged requests are rejected; bob can neither see, change, delete, upload to nor download alice's plant and photo; the admin sees both; the refresh token is an HttpOnly cookie and is revoked by logout.
- the shared [`api-smoke.sh`](../../smoke/api-smoke.sh) runs as alice (`SMOKE_AUTH_TOKEN`);
- the shared Playwright suite signs in through the form first (`SMOKE_LOGIN_USER`), including a login-specific spec.

## Compared with ecs

| | ecs | ecs-cognito |
|---|---|---|
| app | `backend/`, `frontend/` | `backend-auth/`, `frontend-auth/` (copies) |
| identity | none | Cognito user pool, app client, group |
| `/api/*` | open | everything but `/api/health` and `/api/auth/*` needs a bearer token |
| data | shared by everyone | per user (`owner_id`), admin sees all |
| extra Terraform | – | `cognito.tf`, env vars on the backend task |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).

## Not in this stage (next steps for a real product)

- Hosted UI / social login (OIDC code flow with PKCE) instead of the password form; MFA (`mfa_configuration = "OPTIONAL"`).
- A WAF rate limit on `/api/auth/*`, and an ALB HTTPS listener with an ACM certificate (the cookie is `Secure` outside Floci).
- Validating the JWT at the edge as well (ALB OIDC action or an API Gateway JWT authorizer).
