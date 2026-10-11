# Fargate + CloudFront + sign-up — on Floci

The most common web-app shape with the account features people expect. The React app is static files in S3 behind CloudFront. The Go API runs on ECS **Fargate** behind an ALB that only CloudFront may call. **Amazon Cognito** handles accounts that people create themselves.

```
browser ─► CloudFront plant-signup.localhost:4572
             ├─ /*      ─► S3 site bucket (frontend-signup: home, sign up, confirm, sign in, forgot/reset, account)
             └─ /api/*  ─► ALB (403 unless CloudFront's secret header) ─► Fargate: backend-signup ─► RDS Postgres, S3 media
                                                                            └─► Cognito (every account step)
 Cognito ─► email with a 6-digit code (Floci: its SES inbox, GET :4572/_aws/ses)
```

Built from [ecs-cloudfront](../ecs-cloudfront/) (same CDN, origin lock and Fargate service) and [ecs-cognito](../ecs-cognito/) (sign-in through the API). It runs its own copies of the app, [`apps/backend-signup/`](../../../apps/backend-signup/) and [`apps/frontend-signup/`](../../../apps/frontend-signup/), so no other stage changes.

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

    cd deployment/aws/ecs-cloudfront-signup
    make up        # Floci :4572, Fargate API, React site on S3, CloudFront, Cognito; then wait for healthy
    make smoke     # origin lock; a brand-new person through every account step; API + browser tests as alice
    open http://plant-signup.localhost:4572     # sign up yourself, or alice@plant.example / Plant-Parent-2026!
    make destroy && docker compose down

**Reading the emails locally:** Floci does not send email. Every code Cognito "sends" lands in Floci's SES inbox:

    curl -s http://localhost:4572/_aws/ses | jq -r '.messages | sort_by(.Timestamp) | .[-1] | "\(.Destination.ToAddresses[0]): \(.Body.text_part)"'

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
