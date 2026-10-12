# 0005. The "signup" naming

Status: accepted

## Context
Several stages add Cognito sign-in. One of them also lets people create their own account. Names such as `auth2` or `v2` say nothing.

## Decision
Names state what the stage adds: `ecs-cognito` and `ecs-alb-auth` sign users in, `ecs-cloudfront-signup` adds self-service sign-up, and the `-https` suffix means the same stage behind local TLS. The app folders follow (`backend-signup`, `frontend-signup`).

## Consequences
- A new variant is a new folder with a descriptive name; old stages are not renamed or edited.
