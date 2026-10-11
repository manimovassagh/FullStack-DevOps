"""Prometheus exporter for the local AWS-style stacks.

Reads three things and turns them into metrics:
  * Docker: every container (Floci runs ECS tasks, RDS, EKS nodes ... as real containers) with CPU and memory
  * the Floci AWS API: ECS services and tasks, ALB target health, Auto Scaling groups
  * Kubernetes: nodes, pods and deployments of every EKS cluster (a k3s container, queried with `kubectl` inside it)

Every source is optional: if a stack is not running its metrics are simply absent, and
observability_source_up{source} says which sources answered.
"""
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
import docker
from botocore.config import Config
from prometheus_client import REGISTRY, start_http_server
from prometheus_client.core import GaugeMetricFamily

FLOCI = os.environ.get("FLOCI_ENDPOINT", "http://host.docker.internal:4566")
REGION = os.environ.get("AWS_REGION", "us-east-1")
INTERVAL = int(os.environ.get("SCRAPE_INTERVAL_SECONDS", "10"))

# container name prefix -> the group shown in the dashboard
GROUPS = [
    ("floci-ecs-", "ecs task"),
    ("floci-rds-", "rds database"),
    ("floci-eks-", "eks node (k3s)"),
    ("floci-ec2-", "ec2 instance"),
    ("floci-ecr", "ecr registry"),
    ("floci-lambda-", "lambda"),
    ("floci-gcp-", "gcp (cloud run / sql)"),
    ("floci-az-", "azure"),
    ("GITEA-ACTIONS-", "ci job"),
    ("plant-ci-", "ci server"),
    ("plant-observability-", "observability"),
]


def group_of(name: str) -> str:
    for prefix, group in GROUPS:
        if name.startswith(prefix):
            return group
    if "floci" in name:
        return "emulator"
    if "postgres" in name or "gitops-git" in name:
        return "support"
    return "other"


def aws(service: str):
    return boto3.client(
        service, region_name=REGION, endpoint_url=FLOCI,
        aws_access_key_id="test", aws_secret_access_key="test",
        config=Config(connect_timeout=3, read_timeout=8, retries={"max_attempts": 1}),
    )


def gauge(name, doc, labels):
    return GaugeMetricFamily(name, doc, labels=labels)


# ---------------------------------------------------------------- docker
def cpu_percent(s):
    try:
        cpu = s["cpu_stats"]["cpu_usage"]["total_usage"] - s["precpu_stats"]["cpu_usage"]["total_usage"]
        sys = s["cpu_stats"]["system_cpu_usage"] - s["precpu_stats"]["system_cpu_usage"]
        cpus = s["cpu_stats"].get("online_cpus") or len(s["cpu_stats"]["cpu_usage"].get("percpu_usage", [1]))
        return cpu / sys * cpus * 100.0 if sys > 0 and cpu >= 0 else 0.0
    except (KeyError, ZeroDivisionError):
        return 0.0


def memory_bytes(s):
    m = s.get("memory_stats", {})
    return max(0, m.get("usage", 0) - m.get("stats", {}).get("inactive_file", 0))


def collect_docker(client):
    containers = client.containers.list(all=True)
    running = [c for c in containers if c.status == "running"]

    def stats(c):
        try:
            return c.name, c.stats(stream=False)
        except Exception:
            return c.name, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        st = dict(pool.map(stats, running))

    info = gauge("container_info", "1 per container, labelled with its group, image and state", ["name", "group", "image", "state"])
    up = gauge("container_up", "1 if the container is running", ["name", "group"])
    cpu = gauge("container_cpu_percent", "CPU use in percent of one core", ["name", "group"])
    mem = gauge("container_memory_bytes", "memory in use", ["name", "group"])
    restarts = gauge("container_restarts", "Docker restart count", ["name", "group"])
    for c in containers:
        g = group_of(c.name)
        tags = c.image.tags[0] if c.image.tags else c.image.short_id
        info.add_metric([c.name, g, tags, c.status], 1)
        up.add_metric([c.name, g], 1 if c.status == "running" else 0)
        restarts.add_metric([c.name, g], c.attrs.get("RestartCount", 0))
        s = st.get(c.name)
        if s:
            cpu.add_metric([c.name, g], cpu_percent(s))
            mem.add_metric([c.name, g], memory_bytes(s))
    return [info, up, cpu, mem, restarts]


# ---------------------------------------------------------------- ecs
def collect_ecs():
    ecs = aws("ecs")
    desired = gauge("ecs_service_desired", "desired task count", ["cluster", "service", "task_definition"])
    running = gauge("ecs_service_running", "running task count", ["cluster", "service", "task_definition"])
    pending = gauge("ecs_service_pending", "pending task count", ["cluster", "service", "task_definition"])
    deployments = gauge("ecs_service_deployments", "deployments in flight (more than 1 = rolling)", ["cluster", "service"])
    tasks = gauge("ecs_cluster_tasks", "tasks per cluster and status", ["cluster", "status"])
    for arn in ecs.list_clusters()["clusterArns"]:
        cluster = arn.rsplit("/", 1)[-1]
        svc_arns = ecs.list_services(cluster=cluster)["serviceArns"]
        if svc_arns:
            for s in ecs.describe_services(cluster=cluster, services=svc_arns[:10])["services"]:
                td = s["taskDefinition"].rsplit("/", 1)[-1]
                labels = [cluster, s["serviceName"], td]
                desired.add_metric(labels, s["desiredCount"])
                running.add_metric(labels, s["runningCount"])
                pending.add_metric(labels, s["pendingCount"])
                deployments.add_metric([cluster, s["serviceName"]], len(s.get("deployments", [])))
        for status in ("RUNNING", "STOPPED"):
            n = len(ecs.list_tasks(cluster=cluster, desiredStatus=status)["taskArns"])
            tasks.add_metric([cluster, status.lower()], n)
    return [desired, running, pending, deployments, tasks]


# ---------------------------------------------------------------- alb
def collect_elb():
    elb = aws("elbv2")
    health = gauge("alb_targets", "targets per target group and health state", ["target_group", "state"])
    for tg in elb.describe_target_groups()["TargetGroups"]:
        counts = {}
        for t in elb.describe_target_health(TargetGroupArn=tg["TargetGroupArn"])["TargetHealthDescriptions"]:
            state = t["TargetHealth"]["State"]
            counts[state] = counts.get(state, 0) + 1
        for state in ("healthy", "unhealthy", "initial", "draining", "unused"):
            health.add_metric([tg["TargetGroupName"], state], counts.get(state, 0))
    return [health]


# ---------------------------------------------------------------- asg
def collect_asg():
    asg = aws("autoscaling")
    desired = gauge("asg_desired", "desired capacity", ["group"])
    inst = gauge("asg_instances", "instances per group, lifecycle state and health", ["group", "state", "health"])
    for g in asg.describe_auto_scaling_groups()["AutoScalingGroups"]:
        desired.add_metric([g["AutoScalingGroupName"]], g["DesiredCapacity"])
        counts = {}
        for i in g["Instances"]:
            k = (i["LifecycleState"], i["HealthStatus"])
            counts[k] = counts.get(k, 0) + 1
        for (state, h), n in counts.items():
            inst.add_metric([g["AutoScalingGroupName"], state, h], n)
    return [desired, inst]


# ---------------------------------------------------------------- kubernetes (EKS = k3s containers)
def kubectl(container, *args):
    code, out = container.exec_run(["kubectl", *args, "-o", "json"], demux=False)
    if code != 0:
        raise RuntimeError(out.decode()[:200])
    return json.loads(out)


def collect_k8s(client):
    nodes_g = gauge("k8s_nodes", "nodes per cluster and readiness", ["cluster", "ready"])
    pods_g = gauge("k8s_pods", "pods per cluster, namespace and phase", ["cluster", "namespace", "phase"])
    pod_restarts = gauge("k8s_pod_restarts", "container restarts of a pod", ["cluster", "namespace", "pod"])
    dep_desired = gauge("k8s_deployment_desired", "desired replicas", ["cluster", "namespace", "deployment"])
    dep_ready = gauge("k8s_deployment_ready", "ready replicas", ["cluster", "namespace", "deployment"])
    clusters = [c for c in client.containers.list() if c.name.startswith("floci-eks-")]
    for c in clusters:
        cluster = c.name.removeprefix("floci-eks-")
        try:
            nodes = kubectl(c, "get", "nodes")["items"]
            ready = sum(1 for n in nodes for cond in n["status"]["conditions"] if cond["type"] == "Ready" and cond["status"] == "True")
            nodes_g.add_metric([cluster, "true"], ready)
            nodes_g.add_metric([cluster, "false"], len(nodes) - ready)
            counts = {}
            for p in kubectl(c, "get", "pods", "-A")["items"]:
                ns, phase = p["metadata"]["namespace"], p["status"].get("phase", "Unknown")
                counts[(ns, phase)] = counts.get((ns, phase), 0) + 1
                r = sum(cs.get("restartCount", 0) for cs in p["status"].get("containerStatuses", []))
                pod_restarts.add_metric([cluster, ns, p["metadata"]["name"]], r)
            for (ns, phase), n in counts.items():
                pods_g.add_metric([cluster, ns, phase], n)
            for d in kubectl(c, "get", "deployments", "-A")["items"]:
                labels = [cluster, d["metadata"]["namespace"], d["metadata"]["name"]]
                dep_desired.add_metric(labels, d["spec"].get("replicas", 0))
                dep_ready.add_metric(labels, d["status"].get("readyReplicas", 0))
        except Exception as e:  # a cluster that is still booting must not hide the others
            print(f"k8s {cluster}: {e}", flush=True)
    return [nodes_g, pods_g, pod_restarts, dep_desired, dep_ready]


# ---------------------------------------------------------------- the collector
class Snapshot:
    def __init__(self):
        self.families = []
        self.lock = threading.Lock()

    def collect(self):
        with self.lock:
            yield from self.families


def refresh(snap):
    client = docker.from_env()
    while True:
        families, source_up = [], gauge("observability_source_up", "1 if the source answered in the last scrape", ["source"])
        for name, fn in (
            ("docker", lambda: collect_docker(client)),
            ("ecs", collect_ecs),
            ("elbv2", collect_elb),
            ("autoscaling", collect_asg),
            ("kubernetes", lambda: collect_k8s(client)),
        ):
            try:
                families += fn()
                source_up.add_metric([name], 1)
            except Exception as e:
                source_up.add_metric([name], 0)
                print(f"{name}: {type(e).__name__}: {str(e)[:160]}", flush=True)
        with snap.lock:
            snap.families = families + [source_up]
        time.sleep(INTERVAL)


if __name__ == "__main__":
    snapshot = Snapshot()
    REGISTRY.register(snapshot)
    threading.Thread(target=refresh, args=(snapshot,), daemon=True).start()
    start_http_server(9100)
    print(f"exporter on :9100, Floci at {FLOCI}", flush=True)
    while True:
        time.sleep(3600)
