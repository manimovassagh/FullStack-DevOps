# Serverless + sign-in checked at the gateway — on Floci

```
browser ─► CloudFront plant-gw.localhost:4570 ─┬─ /*      ─► S3 (frontend-auth build)
                                               └─ /api/* ─► API Gateway ─┬─ GET /api/health, POST /api/auth/*  ─► Lambda (open)
                                                                         └─ ANY /api/{proxy+} ─[JWT authorizer]─► Lambda
                                                     no / bad token → 401 {"message":"Unauthorized"} from the gateway; the Lambda never runs
 Lambda (backend-serverless-auth) ─► RDS Postgres, S3 media; users in Amazon Cognito
```

The [serverless-cognito](../serverless-cognito/) recipe with one change: **API Gateway** checks the Cognito access token on every protected route before it invokes the function. Same app (`backend-serverless-auth`, `frontend-auth`), same users, same sign-in page.

## Run it

    cd deployment/aws/serverless-gateway-auth
    make up                  # own Floci on :4570, function zip, React build, terraform apply, upload the site
    make smoke               # gateway vs function 401s, per-user rules, API + browser smoke tests
    open http://plant-gw.localhost:4570   # alice@plant.example / bob@plant.example / root@plant.example, Plant-Parent-2026!
    make destroy && docker compose down

`make check` proves the deployment is idempotent; `make rollout` publishes a new function version behind the `live` alias.

## What changes compared with serverless-cognito

| File | What it teaches |
|---|---|
| api.tf | a **JWT authorizer** (issuer = the user pool, audience = the app client), **open** routes (`GET /api/health`, `POST /api/auth/{proxy+}`) next to a **protected** catch-all, and route matching (the most specific route wins) |
| scripts/gateway-rules.sh | tells a 401 from the gateway (`{"message":"Unauthorized"}`) from one sent by the function (`{"error": …}`): the body proves whether the Lambda ran |

Everything else is copied from serverless-cognito apart from names and ports.

| | serverless-cognito | serverless-gateway-auth |
|---|---|---|
| who rejects a bad token | the function | API Gateway, before the function |
| cost of a flood of bad tokens | one Lambda invocation each | none (the gateway answers) |
| routes | one catch-all | open sign-in and health routes + a protected catch-all |
| the function's own check | the only one | still there, as defence in depth |

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md). Shared tests: [smoke](../../smoke/).
