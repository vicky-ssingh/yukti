from .conftest import login
from .helpers import ScriptedProvider, answer_response, tool_response


def test_profile_returns_own_record_with_fee_breakdown(client, headers):
    data = client.get("/api/profile").json
    assert data["student"]["id"] == "STU001" and "password_hash" not in data["student"]
    fees = data["fees"]
    assert (fees["total"], fees["paid"], fees["outstanding"], fees["due"]) == (240000, 180000, 60000, "2026-11-05")
    assert fees["status"] in ("due", "overdue") and isinstance(fees["days_to_due"], int)
    assert data["scholarship"] == {"name": "Merit scholarship", "status": "approved", "amount": 30000}


def test_profile_marks_a_fully_paid_balance(client):
    login(client, "STU002")
    fees = client.get("/api/profile").json["fees"]
    assert fees["outstanding"] == 0 and fees["status"] == "paid"


def test_profile_requires_a_student_session(client):
    assert client.get("/api/profile").status_code == 401


def test_fee_answer_carries_breakdown_from_the_record(app, client, headers):
    app.extensions["provider"] = ScriptedProvider([tool_response("get_fee_status"), answer_response("Your balance is **₹60,000**.")])
    result = client.post("/api/chat", json={"message": "What is my fee balance?"}, headers=headers).json
    assert result["account"]["fees"]["outstanding"] == 60000 and "scholarship" not in result["account"]
    # Stored with the message, so the card is still there when the conversation is reopened.
    messages = client.get(f"/api/threads/{result['thread']['id']}").json["messages"]
    assert messages[-1]["meta"]["account"]["fees"]["total"] == 240000


def test_scholarship_answer_shows_only_scholarship(app, client, headers):
    app.extensions["provider"] = ScriptedProvider([tool_response("get_scholarship_status"), answer_response("Approved.")])
    result = client.post("/api/chat", json={"message": "What is my scholarship status?"}, headers=headers).json
    assert set(result["account"]) == {"currency", "scholarship"}


def test_policy_answer_has_no_breakdown(app, client, headers):
    app.extensions["provider"] = ScriptedProvider([tool_response("search_policy", {"query": "late fee"}), answer_response("INR 500 a day [LATE-07].")])
    result = client.post("/api/chat", json={"message": "What is the late fee?"}, headers=headers).json
    assert "account" not in result


def test_prompt_asks_for_tables_without_repeating_the_card():
    from student_support.agent import SYSTEM
    assert "Markdown table" in SYSTEM and "breakdown card" in SYSTEM
