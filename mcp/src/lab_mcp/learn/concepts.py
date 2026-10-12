"""Concepts a stage teaches, derived from what it actually contains (Terraform resource types, files, README words)
so the catalog never depends on hand-written tags. A stage README can still add or override with front-matter
(`concepts: [...]`)."""
from __future__ import annotations

import re

# Terraform resource-type prefix -> concept. First match wins, so list specific prefixes first.
RESOURCE_CONCEPTS: list[tuple[str, str]] = [
    ("aws_lb_listener_rule", "alb-listener-rules"), ("aws_lb", "application-load-balancer"),
    ("aws_alb", "application-load-balancer"),
    ("aws_ecs_task_definition", "ecs-fargate"), ("aws_ecs", "ecs-fargate"),
    ("aws_cloudfront", "cloudfront"), ("aws_s3_bucket", "s3"),
    ("aws_cognito", "cognito"), ("aws_lambda", "lambda"), ("aws_apigatewayv2", "api-gateway"),
    ("aws_api_gateway", "api-gateway"), ("aws_db_", "rds-postgres"), ("aws_rds", "rds-postgres"),
    ("aws_eks", "eks"), ("helm_release", "helm"), ("kubernetes_", "kubernetes"),
    ("aws_autoscaling", "auto-scaling"), ("aws_launch_template", "auto-scaling"), ("aws_instance", "ec2"),
    ("aws_secretsmanager", "secrets-manager"), ("aws_ecr", "ecr"), ("aws_iam", "iam"),
    ("aws_cloudwatch", "cloudwatch-logs"), ("aws_vpc", "vpc-networking"), ("aws_subnet", "vpc-networking"),
    ("aws_security_group", "security-groups"), ("aws_vpc_security_group", "security-groups"),
    ("aws_nat_gateway", "vpc-networking"), ("aws_internet_gateway", "vpc-networking"),
    ("aws_route", "vpc-networking"), ("aws_codedeploy", "blue-green-deployments"),
    ("aws_acm", "certificates"), ("aws_wafv2", "waf"),
    ("azurerm_", "azure-container-apps"), ("google_cloud_run", "cloud-run"), ("google_", "google-cloud"),
    ("random_password", "generated-secrets"), ("tls_", "certificates"),
]

# README / notes words that mark a concept the resource types alone do not show.
TEXT_CONCEPTS: list[tuple[str, re.Pattern[str]]] = [
    ("tls-https", re.compile(r"\bTLS\b|mkcert|\bHSTS\b|https only", re.I)),
    ("oauth2-proxy", re.compile(r"oauth2-proxy", re.I)),
    ("hosted-ui-login", re.compile(r"hosted (UI|login)", re.I)),
    ("jwt-authorizer", re.compile(r"JWT authorizer", re.I)),
    ("origin-lock", re.compile(r"X-Origin-Verify|origin lock", re.I)),
    ("blue-green-deployments", re.compile(r"blue/green|blue-green", re.I)),
    ("gitops", re.compile(r"\bgitops\b|argo ?cd|\bflux\b", re.I)),
    ("self-service-accounts", re.compile(r"sign[- ]?up|forgot password|emailed code", re.I)),
    ("rollout-testing", re.compile(r"make rollout|rollout", re.I)),
    ("idempotency-check", re.compile(r"make check|idempoten", re.I)),
]

# Words people use for a concept, mapped to the concept id (used by find_example and learning_path).
ALIASES: dict[str, str] = {
    "alb": "application-load-balancer", "load balancer": "application-load-balancer",
    "listener rule": "alb-listener-rules", "fargate": "ecs-fargate", "ecs": "ecs-fargate",
    "cdn": "cloudfront", "static site": "s3", "bucket": "s3", "auth": "cognito", "login": "cognito",
    "sign in": "cognito", "sign up": "self-service-accounts", "signup": "self-service-accounts",
    "serverless": "lambda", "function": "lambda", "database": "rds-postgres", "postgres": "rds-postgres",
    "kubernetes": "eks", "k8s": "eks", "vm": "ec2", "autoscaling": "auto-scaling",
    "secrets": "secrets-manager", "network": "vpc-networking", "vpc": "vpc-networking",
    "https": "tls-https", "tls": "tls-https", "ssl": "tls-https", "certificate": "certificates",
    "azure": "azure-container-apps", "gcp": "cloud-run", "google cloud": "cloud-run",
    "blue green": "blue-green-deployments", "canary": "blue-green-deployments",
}


def concepts_for_resource(rtype: str) -> str | None:
    for prefix, concept in RESOURCE_CONCEPTS:
        if rtype.startswith(prefix):
            return concept
    return None


def resolve_concept(word: str) -> str:
    """A concept id from what a person typed: an exact alias, else the longest alias that appears as whole words
    in the phrase ('alb listener rule' -> alb-listener-rules; 'oauth2-proxy' does not match 'auth'), else the
    phrase itself as an id."""
    w = re.sub(r"[\s_]+", " ", word.strip().lower().replace("-", " "))
    if w in ALIASES:
        return ALIASES[w]
    for key in sorted(ALIASES, key=len, reverse=True):
        if re.search(rf"(?<![a-z0-9]){re.escape(key)}(?:e?s)?(?![a-z0-9])", w):  # whole words, plural allowed
            return ALIASES[key]
    return w.replace(" ", "-")
