"""lab-operate's logic against a fake Mission Control."""
import pytest

from lab_mcp.operate.panel import Panel
from lab_mcp.operate.tools import Operate, OperateError


@pytest.fixture
def op(panel):
    return Operate(Panel(panel.url))


def test_looking_changes_nothing_and_sends_no_post(op, panel):
    op.list_stages(); op.stage_status("demo-ecs"); op.list_emulators(); op.ci_status(); op.pipeline_runs(); op.recent_activity()
    assert set(op.list_emulators()) == {"emulators"} and set(op.pipeline_runs()) == {"runs"} and set(op.recent_activity()) == {"activity"}
    op.job_log("9"); op.job_log("70", kind="pipeline")
    assert panel.posts == [] and panel.gets


def test_stage_status_explains_what_the_state_means(op, panel):
    panel.set_state("demo-ecs", "up", resources=12)
    r = op.stage_status("demo-ecs")
    assert r["state"] == "up" and "smoke_stage" in r["meaning"] and r["resources"] == 12
    assert r["containers"][0]["name"] == "c1"
    with pytest.raises(OperateError, match="Known stages: demo-ecs, demo-auth"):
        op.stage_status("nope")


def test_an_action_returns_a_job_id_at_once_and_says_how_to_follow_it(op, panel):
    r = op.deploy_stage("demo-ecs")
    assert panel.posts == ["/api/stages/demo-ecs/start"] and r["job_id"] == "job-1" and "job_log" in r["next"]


def test_smoke_and_rollout_need_a_stage_that_is_up(op, panel):
    with pytest.raises(OperateError, match="deploy_stage first"):
        op.smoke_stage("demo-ecs")
    panel.set_state("demo-ecs", "up")
    assert op.smoke_stage("demo-ecs")["job_id"] and op.rollout_stage("demo-ecs")["job_id"]
    assert panel.posts == ["/api/stages/demo-ecs/smoke", "/api/stages/demo-ecs/rollout"]


def test_run_pipeline_validates_the_workflow_name(op, panel):
    with pytest.raises(OperateError, match="Known: demo-ecs.yml, demo-auth.yml"):
        op.run_pipeline("typo.yml")
    assert panel.posts == []
    assert op.run_pipeline("demo-ecs.yml")["job_id"] and panel.posts == ["/api/ci/run/demo-ecs.yml"]


def test_the_panels_busy_refusal_becomes_actionable(op, panel):
    panel.busy_job = "1791"
    with pytest.raises(OperateError) as e:
        op.deploy_stage("demo-ecs")
    msg = str(e.value)
    assert "something else is running" in msg and "1791" in msg and "job_log" in msg and "cancel_job" in msg


def test_a_load_test_checks_the_profile_and_the_state(op, panel):
    with pytest.raises(OperateError, match="profile must be one of"):
        op.run_loadtest("demo-ecs", "huge")
    panel.set_state("demo-ecs", "up")
    op.run_loadtest("demo-ecs", "load")
    assert panel.posts == ["/api/loadtests/demo-ecs/load"]


def test_job_logs_are_cleaned_trimmed_and_resumable(op, panel):
    panel.job_lines = [f"\x1b[31mline {i}\x1b[0m" for i in range(300)]
    r = op.job_log("9", tail=50)
    assert r["state"] == "running" and r["lines"][-1] == "line 299" and len(r["lines"]) == 50 and r["dropped_lines"] == 250
    assert r["next_from_line"] == 300 and "\x1b" not in "".join(r["lines"])
    panel.job_rc = 2
    assert op.job_log("9")["state"] == "failed (exit 2)"
    op2 = op.job_log("70", kind="pipeline")
    assert "\x1b" not in op2["lines"][0] and op2["total_lines"] == 3
    with pytest.raises(OperateError):
        op.job_log("abc", kind="pipeline")


def test_when_mission_control_is_down_the_error_says_how_to_start_it():
    with pytest.raises(OperateError, match="make dashboard-up"):
        Operate(Panel("http://127.0.0.1:1", timeout=1)).list_stages()


def test_the_panel_client_sends_the_header_its_ui_sends(panel):
    # without X-Panel the fake (like Mission Control) answers 403; the client always sends it
    import urllib.error
    import urllib.request
    req = urllib.request.Request(panel.url + "/api/ci/up", method="POST", data=b"")
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req)
    assert e.value.code == 403
    assert Operate(Panel(panel.url)).start_ci()["job_id"]
