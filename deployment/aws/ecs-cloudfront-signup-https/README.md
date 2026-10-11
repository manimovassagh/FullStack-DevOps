# Fargate + CloudFront + sign-up over HTTPS — on Floci

The most common web-app shape with the account features people expect. The React app is static files in S3 behind CloudFront. The Go API runs on ECS **Fargate** behind an ALB that only CloudFront may call. **Amazon Cognito** handles accounts that people create themselves.

The same app as [ecs-cloudfront-signup](../ecs-cloudfront-signup/), served the way a real deployment is: **HTTPS only**. Nothing in the other stage changes; this is a copy beside it.

```
browser ─► https://plant-signup-https.localhost:4443   (Caddy: TLS terminated here, certificate from mkcert)
             └─► CloudFront plant-signup-https.localhost:4573
             ├─ /*      ─► S3 site bucket (frontend-signup: home, sign up, confirm, sign in, forgot/reset, account)
             └─ /api/*  ─► ALB (403 unless CloudFront's secret header) ─► Fargate: backend-signup ─► RDS Postgres, S3 media
                                                                            └─► Cognito (every account step)
 Cognito ─► email with a 6-digit code (Floci: its SES inbox, GET :4573/_aws/ses)
```

Built from [ecs-cloudfront](../ecs-cloudfront/) (same CDN, origin lock and Fargate service) and [ecs-cognito](../ecs-cognito/) (sign-in through the API). It runs its own copies of the app, [`apps/backend-signup/`](../../../apps/backend-signup/) and [`apps/frontend-signup/`](../../../apps/frontend-signup/), so no other stage changes.

## What HTTPS changes here

| | plain stage | this stage |
|---|---|---|
| address | `http://plant-signup.localhost:4572` | `https://plant-signup-https.localhost:4443` |
| TLS | none (Floci's CloudFront is plain HTTP, it has no ACM) | a **Caddy** in this stage's compose file terminates TLS in front of it, as CloudFront does on real AWS |
| certificate | none | **mkcert** (`make tls`): a private local CA that macOS and your browser trust, so no warning. One-time per Mac: `brew install mkcert && mkcert -install` |
| refresh cookie | `Secure` only on real AWS | `Secure; HttpOnly; SameSite=Strict` here too |
| browser headers | none | `Strict-Transport-Security` (Caddy locally; a CloudFront response-headers policy on real AWS, see `cdn.tf`) |
| smoke test | origin lock, account flow, API, browser | the same, plus [`scripts/tls-check.sh`](scripts/tls-check.sh): certificate names and validity, TLS 1.2+ only, no plain HTTP on the TLS port, HSTS, `Secure` cookie |

Why a private CA and not a "real" certificate: nothing here is public. The CA lives on your Mac only; `make tls` signs the certificate for `plant-signup-https.localhost`. In CI, [`scripts/ci-trust.sh`](scripts/ci-trust.sh) makes a throwaway CA per job, so curl and the test browser verify the certificate like any client.

### A known simplification: the CloudFront → load balancer leg is plain HTTP

Viewers always talk HTTPS (to CloudFront, or to Caddy locally). The *origin* leg, CloudFront → ALB, is `http-only` in `cdn.tf`, as in the base stage, because the emulator has no ACM and the ALB listener is HTTP. On real AWS that leg carries the API traffic (including sign-in) inside AWS's network, but a production version should use an HTTPS ALB listener with an ACM certificate and `origin_protocol_policy = "https-only"` (as [`ecs-alb-auth`](../ecs-alb-auth/) does for its listener). Left out on purpose: this lab is a blueprint, not a hardened deployment (see [docs/PLATFORM-ROADMAP.md](../../../docs/PLATFORM-ROADMAP.md)).

## The account flow

| Step | Page | API | Cognito |
|---|---|---|---|
| Sign up (name, email, password with a live strength checklist) | `/signup` | `POST /api/auth/signup` | `SignUp` → emails a code |
| Confirm the email (6-digit code, "send a new code" after 30 s) | `/confirm` | `POST /api/auth/confirm`, `/resend` | `ConfirmSignUp`, `ResendConfirmationCode` |
| Sign in (an unconfirmed account goes to the code step) | `/login` | `POST /api/auth/login` | `InitiateAuth` (USER_PASSWORD_AUTH) |
| Stay signed in across reloads | — | `POST /api/auth/refresh` (HttpOnly cookie) | `InitiateAuth` (REFRESH_TOKEN_AUTH) |
| Forgot password → code → new password | `/forgot`, `/reset` | `POST /api/auth/forgot`, `/reset` | `ForgotPassword`, `ConfirmForgotPassword` |
| Profile name | `/account` | `GET/PATCH /api/account` | `GetUser`, `UpdateUserAttributes` |
| Change password | `/account` | `POST /api/account/password` | `ChangePassword` |
| Sign out here / everywhere | header, `/account` | `POST /api/auth/logout`, `/api/account/signout-everywhere` | `RevokeToken`, `GlobalSignOut` |

The browser talks only to the API, never to Cognito. The page keeps the short-lived access token in memory. The refresh token stays in an `HttpOnly; SameSite=Strict` cookie that scripts cannot read.

**What a stranger cannot find out:** "resend code" and "forgot password" give the same answer whether or not an account exists, so they cannot be used to check email addresses. Only sign-up says "this email is taken", as every app's sign-up must.

## Run it

    cd deployment/aws/ecs-cloudfront-signup-https
    make up        # Floci :4573, Fargate API, React site on S3, CloudFront, Cognito; then wait for healthy
    make smoke     # origin lock; a brand-new person through every account step; API + browser tests as alice
    open https://plant-signup-https.localhost:4443    # sign up yourself, or alice@plant.example / Plant-Parent-2026!
    make destroy && docker compose down

**Reading the emails locally:** Floci does not send email. Every code Cognito "sends" lands in Floci's SES inbox:

    curl -s http://localhost:4573/_aws/ses | jq -r '.messages | sort_by(.Timestamp) | .[-1] | "\(.Destination.ToAddresses[0]): \(.Body.text_part)"'

On real AWS, Cognito emails the code. Its own sender (`COGNITO_DEFAULT`) has a low daily limit; production uses SES with your domain (see `cognito.tf`).

## What each file teaches

| File | Concept |
|---|---|
| cognito.tf | self sign-up (`allow_admin_create_user_only = false`), email verification with a code, account recovery by verified email, the email template, a public client with the attributes it may read and write, token lifetimes and revocation |
| cdn.tf, alb.tf | CloudFront with S3 (OAC) and the ALB as origins; the ALB answers only requests carrying CloudFront's secret header |
| ecs.tf | the Fargate service; the API gets the pool's issuer and client ID |
| scripts/account-flow.sh | every account step through CloudFront, with the codes read from the emulator's inbox |
| scripts/origin-lock.sh | skipping CloudFront gets 403 |

See [FLOCI-NOTES.md](FLOCI-NOTES.md) for what differs on the emulator.
