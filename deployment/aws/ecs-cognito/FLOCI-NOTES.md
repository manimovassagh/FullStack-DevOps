# Floci notes for the ECS + Cognito stage

Everything in [ecs](../ecs/FLOCI-NOTES.md) applies. Cognito specifics, verified against Floci 2.1.0:

## What works like real AWS

- **User pools, app clients, groups, users** (`AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup`), `InitiateAuth` with `USER_PASSWORD_AUTH` and `REFRESH_TOKEN_AUTH`, `GetUser`, `RevokeToken`.
- **Tokens are real RS256 JWTs** with the claims a Cognito access token has (`sub`, `token_use=access`, `client_id`, `cognito:groups`, `exp`, `iss`), signed with keys published at `<endpoint>/<pool id>/.well-known/jwks.json`.
- **Revocation works**: a refresh token revoked by logout can no longer be exchanged.

## Differences

- **Issuer.** Floci puts its own URL as seen from the host (`http://localhost:4566/<pool id>`) into `iss`; real Cognito uses `https://cognito-idp.<region>.amazonaws.com/<pool id>`. `var.on_floci` picks the right value for `COGNITO_ISSUER`.
- **Signing keys.** A task container cannot reach `localhost:4566`. The API therefore fetches the keys from `AWS_ENDPOINT_URL` (injected by Floci into task containers) plus the pool id, while still comparing `iss` with the host-side value (`internal/config`).
- **Browser access.** Floci answers CORS preflight requests to Cognito with 405, so a page could not call Cognito directly from another origin. The sign-in goes through the API (which is the pattern this stage teaches anyway).
- **Access-token `username`** is the user's id, as in real Cognito for pools that sign in by email; the email is read with `GetUser`.
- **The refresh cookie** is not `Secure` while on Floci (plain HTTP), `COOKIE_SECURE=false` via `var.on_floci`.
- **Hosted UI, MFA, email delivery, advanced security** are not exercised.

## Terraform drift on Floci

None found: `make check` shows no changes.
