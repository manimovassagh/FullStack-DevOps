# Floci notes for ecs-alb-auth

## Its own emulator, a dated nightly

`compose.yaml` runs `floci/floci:nightly-10012026` on :4569, with the ALB listener published on :8097. The pinned release used by the other stages (2.1.0) has no ALB authentication. Checked in the binaries on 2026-10-09: the nightly contains `authenticate-cognito`, `AuthenticateCognitoConfig`, the ALB callback path `/oauth2/idpresponse` and `AWSELBAuthSessionCookie`, and 2.1.0 contains none of them. Move to a release once one has them.

## HTTP listener on Floci

Real ALBs accept authenticate actions only on HTTPS listeners. Floci has no ACM, so `on_floci = true` makes the listener plain HTTP on port 80. On real AWS, set `on_floci = false`, `certificate_arn` and `public_url`: the listener moves to 443 and the Cognito callback becomes `<public_url>/oauth2/idpresponse`.

## Live run 2026-10-09: Floci does not enforce the sign-in (NO-GO locally)

- `terraform apply` succeeds (59 resources): user pool, hosted-UI domain, confidential client, listener and rule with `authenticate-cognito` (order 1) + `forward` (order 2). `describe-listeners` / `describe-rules` return both actions.
- But every anonymous request is forwarded: `GET /` → 200 (no redirect), `GET /api/plants` → 200. The same with an HTTPS listener created by hand (imported self-signed certificate): Floci's "HTTPS" listener serves plain HTTP and also answers 200.
- The `/oauth2/idpresponse` string found in the binary belongs to Floci's Cognito (`CognitoOAuthController.idpResponse`), not to the ALB.
- So on Floci this stage can show the Terraform and deploy, but not the behaviour. On real AWS the same code enforces the sign-in.

## Fixed during the live run

- **Images from this stage's Floci:** Floci returns ECR URLs with its internal port 4566; the task definitions now swap in this Floci's host port (4569), otherwise every task fails with "failed to resolve reference …:4566/…".
- **Security-group enforcement off:** the nightly does not allow the ALB (inside the Floci container) through the tasks' security-group sidecars, so health checks timed out (`Target.Timeout`).

## 2026-10-10: oauth2-proxy does the sign-in on Floci

Because Floci never runs `authenticate-cognito`, `on_floci = true` replaces it with `proxy.tf`: ALB :80 → oauth2-proxy task (:4180) → ALB listener :81 inside Floci → frontend / backend. Same pool, same confidential client, same rules (GET open, changes need a session, `/oauth2/start` signs in). Verified live: anonymous page and reads 200, anonymous create/delete 401, Add plant → hosted login → back signed in → plant saved; `scripts/auth-rules.sh` 9/9.

- **No OIDC discovery:** Floci's discovery document names `localhost:4566`, which inside a task is the task itself. The proxy gets the issuer string (`http://localhost:4566/<pool>`, what Floci puts in `iss`), sends browsers to `localhost:4569` for the login, and redeems codes / fetches keys at `floci:4566`.
- **`/oauth2/userinfo` answers `{}` (200) without a session**, because the "GET is open" route also covers it. `signin.js` treats a session as present only when an email comes back.
- **The hosted login page is bare HTML:** Floci's stand-in for the Cognito hosted UI. Real Cognito shows its styled (brandable) page.
- **Signed-in state on real AWS:** the ALB has no `/oauth2/userinfo` or sign-out endpoint, so `signin.js` there shows the Sign in button only; the sign-in itself and the 401 on changes work.
