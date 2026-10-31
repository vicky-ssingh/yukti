import json
from datetime import datetime, timedelta, timezone

from student_support.db import get_db
from .conftest import login
from .helpers import ScriptedProvider, answer_response, tool_response
from .test_admin import staff_login


def with_usage(response, prompt, completion):
    return {**response, "usage": {"prompt_tokens": prompt, "completion_tokens": completion}}


def ask(app, client, headers, message, *responses):
    app.extensions["provider"] = ScriptedProvider(list(responses))
    result = client.post("/api/chat", json={"message": message}, headers=headers)
    assert result.status_code == 200, result.json
    return result.json


def test_student_usage_totals_series_and_conversations(app, client, headers):
    ask(app, client, headers, "What is my fee balance?",
        with_usage(tool_response("get_fee_status"), 1000, 40), with_usage(answer_response("Your balance is due."), 1200, 60))
    ask(app, client, headers, "What are the merit scholarship criteria?", with_usage(answer_response("Criteria."), 800, 100))
    usage = client.get("/api/usage?range=7d&tz=330").json
    t = usage["totals"]
    assert (t["runs"], t["completed"], t["model_calls"], t["tool_calls"]) == (2, 2, 3, 1)
    assert (t["input_tokens"], t["output_tokens"], t["total_tokens"]) == (3000, 200, 3200)
    assert t["avg_tokens_per_run"] == 1600 and t["success_rate"] == 1 and t["partial_usage_runs"] == 0
    assert t["p95_latency_ms"] is not None and t["avg_latency_ms"] is not None
    assert usage["bucket"] == "day" and len(usage["series"]) == 7
    assert sum(p["input_tokens"] + p["output_tokens"] for p in usage["series"]) == 3200
    assert sum(p["runs"] for p in usage["series"]) == 2
    assert usage["tools"] == [{"name": "get_fee_status", "calls": 1, "failed": 0}]
    assert usage["statuses"] == [{"status": "completed", "runs": 2}]
    assert usage["models"] == [{"model": "deterministic-fixture", "runs": 2}]
    conversations = usage["conversations"]["items"]
    assert [c["total_tokens"] for c in conversations] == [2300, 900]
    assert all(c["id"] and c["title"] for c in conversations)
    # The run list names the conversation each run answered in, and never exposes the owner field.
    runs = client.get("/api/traces?range=7d").json["items"]
    assert {r["thread"]["id"] for r in runs} == {c["id"] for c in conversations}
    assert all("student_id" not in r for r in runs)


def test_usage_ranges_and_partial_usage(app, client, headers):
    ask(app, client, headers, "Hello", answer_response("Hi."))  # the provider reported no usage
    old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    trace = {"id": "old-run", "created_at": old, "status": "completed", "model_calls": 1, "input_tokens": 500, "output_tokens": 50,
             "usage_complete": True, "tools": [], "retrieved_evidence": [], "latency_ms": 900.0, "model": "deterministic-fixture"}
    with app.app_context():
        get_db().execute("INSERT INTO traces VALUES (?,?,?,?)", ("old-run", "STU001", old, json.dumps(trace)))
        get_db().commit()
    recent = client.get("/api/usage?range=30d").json["totals"]
    assert recent["runs"] == 1 and recent["partial_usage_runs"] == 1 and recent["total_tokens"] == 0
    everything = client.get("/api/usage?range=all").json
    assert everything["totals"]["runs"] == 2 and everything["totals"]["total_tokens"] == 550
    assert everything["bucket"] == "day" and len(everything["series"]) >= 40
    assert everything["conversations"]["items"][0]["title"] == "Deleted or unsaved conversations"
    assert client.get("/api/usage?range=bogus&tz=nonsense").json["range"] == "30d"
    assert len(client.get("/api/traces?range=30d").json["items"]) == 1


def test_usage_is_owner_scoped(app, client, headers):
    ask(app, client, headers, "What is my fee balance?", with_usage(answer_response("Due."), 700, 30))
    other = app.test_client(); login(other, "STU002")
    assert other.get("/api/usage?range=all").json["totals"]["runs"] == 0
    assert other.get("/api/traces").json["items"] == []


def test_admin_usage_by_student_and_permissions(app, client, headers):
    ask(app, client, headers, "What is my fee balance?", with_usage(answer_response("Due."), 3000, 100))
    second = app.test_client(); second_headers = login(second, "STU002")
    ask(app, second, second_headers, "Scholarship criteria?", with_usage(answer_response("Criteria."), 800, 100))
    admin = app.test_client(); staff_login(admin)
    data = admin.get("/api/admin/usage?range=7d").json
    assert data["totals"]["runs"] == 2 and data["totals"]["total_tokens"] == 4000
    assert data["active_students"] == 2 and data["total_students"] >= 2
    students = data["students"]
    assert [s["id"] for s in students] == ["STU001", "STU002"]
    assert students[0]["total_tokens"] == 3100 and students[0]["share"] == 0.775 and students[0]["name"]
    assert "conversations" not in data
    agent = app.test_client(); staff_login(agent, "SUP001")
    assert agent.get("/api/admin/usage").status_code == 403
    assert client.get("/api/admin/usage").status_code in (401, 403)
    assert admin.get("/api/usage").status_code in (401, 403)
