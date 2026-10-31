import pytest
from student_support.db import get_db, rows
from student_support.tools import ToolService
from .conftest import login
from .helpers import ScriptedProvider, answer_response, tool_response

STAFF_PASSWORD = "StaffDemo!2026"


def staff_login(client, staff_id="ADM001", password=STAFF_PASSWORD):
    csrf = client.get("/api/session").json["csrf_token"]
    response = client.post("/api/login", json={"student_id": staff_id, "password": password}, headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200, response.json
    return {"X-CSRF-Token": response.json["csrf_token"]}


@pytest.fixture
def admin(app):
    client = app.test_client()
    return client, staff_login(client)


@pytest.fixture
def agent(app):
    client = app.test_client()
    return client, staff_login(client, "SUP001")


def raise_ticket(client, headers, **extra):
    payload = {"category": "finance", "description": "Payment portal crashed while paying", "subject": "Portal crash", **extra}
    response = client.post("/api/tickets", json=payload, headers=headers)
    assert response.status_code == 201, response.json
    return response.json


# Roles and access -------------------------------------------------------------

def test_staff_session_reports_role_and_permissions(admin, agent):
    assert admin[0].get("/api/session").json["staff"]["role"] == "admin"
    staff = agent[0].get("/api/session").json["staff"]
    assert staff["role"] == "support_agent" and "kb.manage" not in staff["permissions"]


def test_students_cannot_use_admin_api(client, headers):
    for path in ("/api/admin/overview", "/api/admin/kb", "/api/admin/tickets", "/api/admin/users", "/api/admin/audit"):
        assert client.get(path).status_code == 403
    assert client.post("/api/admin/kb", json={}, headers=headers).status_code == 403


def test_staff_cannot_use_student_routes(admin):
    client, headers = admin
    assert client.get("/api/memory").status_code == 403
    assert client.post("/api/chat", json={"message": "What is my fee status?"}, headers=headers).status_code == 403


def test_support_agent_permissions_are_enforced_and_audited(app, agent):
    client, headers = agent
    assert client.get("/api/admin/tickets").status_code == 200
    assert client.get("/api/admin/kb").status_code == 403
    assert client.put("/api/admin/settings", json={"retrieval_top_k": 3}, headers=headers).status_code == 403
    with app.app_context():
        assert rows("SELECT actor,decision FROM audit WHERE action='permission_check'")[-1] == {"actor": "SUP001", "decision": "denied"}


def test_admin_can_grant_and_revoke_agent_permissions(admin, agent):
    client, headers = admin
    assert client.put("/api/admin/permissions/support_agent", json={"permissions": ["tickets.view", "kb.manage"]}, headers=headers).status_code == 200
    assert agent[0].get("/api/admin/kb").status_code == 200
    assert agent[0].patch("/api/admin/tickets/TKT-NONE", json={"status": "open"}, headers=agent[1]).status_code == 403
    assert client.put("/api/admin/permissions/admin", json={"permissions": []}, headers=headers).status_code == 409
    assert client.put("/api/admin/permissions/support_agent", json={"permissions": ["root"]}, headers=headers).status_code == 400


def test_deactivated_user_loses_access_immediately(app, admin, client, headers):
    assert client.get("/api/memory").status_code == 200
    assert admin[0].patch("/api/admin/users/STU001", json={"active": False}, headers=admin[1]).status_code == 200
    assert client.get("/api/memory").status_code == 401
    fresh = app.test_client(); csrf = fresh.get("/api/session").json["csrf_token"]
    assert fresh.post("/api/login", json={"student_id": "STU001", "password": "CampusDemo!2026"}, headers={"X-CSRF-Token": csrf}).status_code == 401


def test_deactivating_staff_returns_their_tickets_to_the_queue(admin, client, headers):
    ticket = raise_ticket(client, headers)
    staff, staff_headers = admin
    staff.patch(f"/api/admin/tickets/{ticket['id']}", json={"assigned_to": "SUP001"}, headers=staff_headers)
    assert staff.patch("/api/admin/users/SUP001", json={"active": False}, headers=staff_headers).status_code == 200
    detail = staff.get(f"/api/admin/tickets/{ticket['id']}").json
    assert detail["assigned_to"] is None and detail["events"][-1]["detail"].startswith("Unassigned")
    closed = staff.patch(f"/api/admin/tickets/{ticket['id']}", json={"status": "closed"}, headers=staff_headers).json
    assert closed["resolved_at"]


def test_last_admin_and_self_changes_are_blocked(admin):
    client, headers = admin
    assert client.patch("/api/admin/users/ADM001", json={"active": False}, headers=headers).status_code == 409
    assert client.patch("/api/admin/users/SUP001", json={"role": "admin"}, headers=headers).status_code == 200
    assert client.patch("/api/admin/users/SUP001", json={"role": "support_agent"}, headers=headers).status_code == 200


def test_admin_creates_users_with_password_rules(app, admin):
    client, headers = admin
    base = {"id": "SUP002", "name": "Meera Iyer", "email": "meera@example.edu", "role": "support_agent"}
    assert client.post("/api/admin/users", json={**base, "password": "short"}, headers=headers).status_code == 400
    assert client.post("/api/admin/users", json={**base, "password": "LongEnough2026"}, headers=headers).status_code == 201
    assert client.post("/api/admin/users", json={**base, "password": "LongEnough2026"}, headers=headers).status_code == 409
    student = {"id": "STU003", "name": "Kabir Das", "email": "kabir@example.edu", "role": "student", "programme": "PGDM-AI", "password": "LongEnough2026"}
    assert client.post("/api/admin/users", json=student, headers=headers).status_code == 201
    staff_login(app.test_client(), "SUP002", "LongEnough2026")
    login_client = app.test_client(); csrf = login_client.get("/api/session").json["csrf_token"]
    assert login_client.post("/api/login", json={"student_id": "STU003", "password": "LongEnough2026"}, headers={"X-CSRF-Token": csrf}).json["student"]["id"] == "STU003"


def test_staff_can_change_own_password(app, agent):
    client, headers = agent
    assert client.post("/api/admin/me/password", json={"current": "wrong", "new": "NewPassword2026"}, headers=headers).status_code == 403
    assert client.post("/api/admin/me/password", json={"current": STAFF_PASSWORD, "new": "NewPassword2026"}, headers=headers).status_code == 200
    staff_login(app.test_client(), "SUP001", "NewPassword2026")


# Tickets ----------------------------------------------------------------------

def test_ticket_raised_from_chat_captures_conversation(app, client, headers):
    app.extensions["provider"] = ScriptedProvider([answer_response("Which portal step failed?"),
                                                   tool_response("create_support_request", {"category": "finance", "description": "Portal crashed at payment", "priority": "high"}), "echo_tool"])
    thread = client.post("/api/chat", json={"message": "The payment portal crashed"}, headers=headers).json["thread"]["id"]
    result = client.post("/api/chat", json={"message": "Please create a support ticket for it", "thread_id": thread}, headers=headers).json
    ticket = result["tickets"][0]
    assert ticket["priority"] == "high" and ticket["status"] == "open" and ticket["id"].startswith("TKT-")
    detail = client.get(f"/api/tickets/{ticket['id']}").json
    assert [m["content"] for m in detail["context"]] == ["The payment portal crashed", "Which portal step failed?", "Please create a support ticket for it"]
    assert detail["thread_id"] == thread


def test_ticket_button_validates_and_captures_thread(app, client, headers):
    app.extensions["provider"] = ScriptedProvider([answer_response("Here is the late fee policy.")])
    thread = client.post("/api/chat", json={"message": "What is the late fee?"}, headers=headers).json["thread"]["id"]
    assert client.post("/api/tickets", json={"category": "finance", "description": "My card number is 4111 1111 1111 1111"}, headers=headers).status_code == 400
    assert client.post("/api/tickets", json={"category": "finance", "description": "Help", "student_id": "STU002"}, headers=headers).status_code == 400
    ticket = raise_ticket(client, headers, thread_id=thread)
    assert ticket["source"] == "chat_button" and len(ticket["context"]) == 2


def test_full_ticket_lifecycle_with_history(app, client, headers, admin):
    ticket = raise_ticket(client, headers)
    staff, staff_headers = admin
    queue = staff.get("/api/admin/tickets?open=1").json
    assert queue["items"][0]["id"] == ticket["id"] and queue["items"][0]["student_name"] == "Anshika Sharma"
    staff.patch(f"/api/admin/tickets/{ticket['id']}", json={"assigned_to": "SUP001", "priority": "urgent", "status": "in_progress"}, headers=staff_headers)
    staff.post(f"/api/admin/tickets/{ticket['id']}/comments", json={"body": "Checked the gateway log.", "internal": True}, headers=staff_headers)
    staff.post(f"/api/admin/tickets/{ticket['id']}/comments", json={"body": "Please share the transaction reference.", "await_student": True}, headers=staff_headers)
    student_view = client.get(f"/api/tickets/{ticket['id']}").json
    assert student_view["status"] == "waiting_on_student" and student_view["assigned_name"] == "Ayush Kumar"
    assert "Checked the gateway log." not in str(student_view["events"])
    assert client.post(f"/api/tickets/{ticket['id']}/comments", json={"body": "Reference TXN-48213."}, headers=headers).json["status"] == "open"
    resolved = staff.post(f"/api/admin/tickets/{ticket['id']}/resolve", json={"resolution": "Late charge waived after review."}, headers=staff_headers).json
    assert resolved["status"] == "resolved" and resolved["resolution"].startswith("Late charge")
    events = [e["event"] for e in resolved["events"]]
    assert events == ["created", "assigned", "priority_changed", "status_changed", "note", "comment", "comment", "status_changed", "resolved"]
    assert client.post(f"/api/tickets/{ticket['id']}/close", headers=headers).json["status"] == "closed"
    with app.app_context():
        assert {r["action"] for r in rows("SELECT action FROM audit WHERE target=?", (ticket["id"],))} >= {"ticket_assign", "ticket_resolve", "ticket_close"}


def test_tickets_are_owner_scoped_for_students_and_tools(app, client, headers):
    ticket = raise_ticket(client, headers)
    other = app.test_client(); other_headers = login(other, "STU002")
    assert other.get(f"/api/tickets/{ticket['id']}").status_code == 404
    assert other.post(f"/api/tickets/{ticket['id']}/comments", json={"body": "hi"}, headers=other_headers).status_code == 404
    with app.app_context():
        result = ToolService("STU002", "run", "my ticket", app.extensions["handbook"]).execute("get_ticket_details", {"ticket_id": ticket["id"]})
        assert not result["ok"]
        mine = ToolService("STU001", "run", "my ticket", app.extensions["handbook"]).execute("get_ticket_details", {"ticket_id": ticket["id"]})
        assert mine["ok"] and mine["ticket"]["subject"] == "Portal crash" and "context" not in mine["ticket"]


def test_invalid_ticket_updates_are_rejected(admin, client, headers):
    ticket = raise_ticket(client, headers)
    staff, staff_headers = admin
    assert staff.patch(f"/api/admin/tickets/{ticket['id']}", json={"assigned_to": "STU001"}, headers=staff_headers).status_code == 400
    assert staff.patch(f"/api/admin/tickets/{ticket['id']}", json={"status": "resolved"}, headers=staff_headers).status_code == 400
    assert staff.patch(f"/api/admin/tickets/{ticket['id']}", json={"priority": "critical"}, headers=staff_headers).status_code == 400


# Knowledge base ---------------------------------------------------------------

def test_seeded_knowledge_base_is_indexed_and_cited(app):
    with app.app_context():
        docs = rows("SELECT title,status,chunk_count FROM kb_documents")
        assert len(docs) == 5 and all(d["status"] == "indexed" for d in docs)
        result = app.extensions["handbook"].search("merit scholarship criteria")
        assert result[0]["id"] == "MERIT-09" and result[0]["source"] == "Scholarship criteria" and result[0]["category"] == "Scholarship"
        assert app.extensions["handbook"].search("hostel refund percentage") == []


def test_kb_crud_reindex_archive_and_retrieval(app, admin):
    client, headers = admin
    content = "## LAB-01 | Laboratory access\nLaboratory access cards are issued by the IT office within three working days.\n\n## Untitled section\nLost laboratory cards cost INR 200 to replace."
    doc = client.post("/api/admin/kb", json={"title": "Lab guide", "category": "Academics", "content": content, "questions": ["How do I get a laboratory card?"]}, headers=headers).json
    assert doc["status"] == "indexed" and doc["chunk_count"] == 2
    chunks = client.get(f"/api/admin/kb/{doc['id']}").json["chunks"]
    assert [c["id"] for c in chunks] == ["LAB-01", f"DOC{doc['id']}-02"]
    with app.app_context():
        assert app.extensions["handbook"].search("laboratory access card")[0]["id"] == "LAB-01"
    client.post(f"/api/admin/kb/{doc['id']}/archive", json={"archived": True}, headers=headers)
    with app.app_context():
        assert "LAB-01" not in [c["id"] for c in app.extensions["handbook"].search("laboratory access card")]
    assert client.post(f"/api/admin/kb/{doc['id']}/archive", json={"archived": False}, headers=headers).json["status"] == "indexed"
    updated = client.put(f"/api/admin/kb/{doc['id']}", json={"title": "Lab guide", "category": "Academics", "content": "## LAB-01 | Laboratory access\nCards now take five working days."}, headers=headers).json
    assert updated["version"] == 2 and updated["chunk_count"] == 1
    assert client.delete(f"/api/admin/kb/{doc['id']}", headers=headers).status_code == 200
    with app.app_context():
        assert rows("SELECT * FROM kb_chunks WHERE document_id=?", (doc["id"],)) == []


def test_kb_rejects_bad_documents_and_duplicate_section_ids(admin):
    client, headers = admin
    assert client.post("/api/admin/kb", json={"title": "x", "category": "Finance", "content": "text"}, headers=headers).status_code == 400
    assert client.post("/api/admin/kb", json={"title": "Bad category", "category": "Misc", "content": "text"}, headers=headers).status_code == 400
    clash = client.post("/api/admin/kb", json={"title": "Clash", "category": "Finance", "content": "## PAYMENT-02 | Copy\nDuplicate."}, headers=headers).json
    assert clash["status"] == "failed" and "already used" in clash["error"]
    bad_id = client.post("/api/admin/kb", json={"title": "Bad id", "category": "Finance", "content": "## lower-1 | Bad\nText."}, headers=headers).json
    assert bad_id["status"] == "failed"
    assert client.post(f"/api/admin/kb/{clash['id']}/reindex", headers=headers).json["status"] == "failed"


# Monitoring, settings and logs ------------------------------------------------

def test_chat_monitoring_is_permissioned_and_audited(app, client, headers, agent):
    app.extensions["provider"] = ScriptedProvider([answer_response("Hello!")])
    thread = client.post("/api/chat", json={"message": "Hello"}, headers=headers).json["thread"]["id"]
    staff, _ = agent
    listing = staff.get("/api/admin/threads").json["items"]
    assert listing[0]["id"] == thread and listing[0]["student_name"] == "Anshika Sharma"
    assert [m["content"] for m in staff.get(f"/api/admin/threads/{thread}").json["messages"]] == ["Hello", "Hello!"]
    with app.app_context():
        assert rows("SELECT actor,target FROM audit WHERE action='view_chat_thread'") == [{"actor": "SUP001", "target": "STU001"}]


def test_settings_validation_and_effect(app, admin, client, headers):
    staff, staff_headers = admin
    assert staff.put("/api/admin/settings", json={"retrieval_top_k": 9}, headers=staff_headers).status_code == 400
    assert staff.put("/api/admin/settings", json={"unknown": 1}, headers=staff_headers).status_code == 400
    assert staff.put("/api/admin/settings", json={"retrieval_top_k": 1, "default_ticket_priority": "high", "student_can_close_tickets": False}, headers=staff_headers).status_code == 200
    with app.app_context():
        assert len(app.extensions["handbook"].search("payment portal failure next working day")) == 1
    ticket = client.post("/api/tickets", json={"category": "general", "description": "General question here"}, headers=headers).json
    assert ticket["priority"] == "high"
    assert client.post(f"/api/tickets/{ticket['id']}/close", headers=headers).status_code == 403


def test_activity_log_filters_and_export(admin, client, headers):
    raise_ticket(client, headers)
    staff, _ = admin
    log = staff.get("/api/admin/audit?action=create_support&limit=5").json
    assert log["total"] >= 1 and all(item["action"].startswith("create_support") for item in log["items"])
    assert "attachment" in staff.get("/api/admin/audit/export").headers["Content-Disposition"]


def test_overview_respects_permissions(admin, agent):
    full = admin[0].get("/api/admin/overview").json
    assert {"tickets", "knowledge", "chats", "users", "activity"} <= set(full)
    limited = agent[0].get("/api/admin/overview").json
    assert "tickets" in limited and "knowledge" not in limited and "users" not in limited


# Email change approval --------------------------------------------------------

def email_request(app, address="aanya.new@example.edu"):
    with app.app_context():
        result = ToolService("STU001", "run", "Change my email", app.extensions["handbook"]).execute("request_email_change", {"email": address})
        assert result["ok"], result
        return result


def student_email(app):
    with app.app_context():
        return get_db().execute("SELECT email FROM students WHERE id='STU001'").fetchone()[0]


def test_email_change_creates_ticket_for_staff_review(app, client, headers):
    with app.app_context():
        service = ToolService("STU001", "run", "Change my email", app.extensions["handbook"])
        assert not service.execute("request_email_change", {"email": "rohan@example.edu"})["ok"]
        assert not service.execute("request_email_change", {"email": "not-an-email"})["ok"]
    result = email_request(app)
    assert result["approval"]["reviewer"] == "staff" and result["ticket_id"] == result["approval"]["ticket_id"]
    assert "support staff" in result["message"] and student_email(app) == "aanya@example.edu"
    ticket = client.get(f"/api/tickets/{result['ticket_id']}").json
    assert ticket["subject"] == "Registered email change request" and ticket["source"] == "approval_request"
    assert email_request(app)["approval"]["id"] == result["approval"]["id"]  # a repeated request reuses the pending one


def test_student_cannot_approve_own_email_change(app, client, headers):
    approval = email_request(app)["approval"]
    response = client.post(f"/api/approvals/{approval['id']}/decision", json={"decision": "confirm"}, headers=headers)
    assert response.status_code == 403 and response.json["ticket_id"] == approval["ticket_id"]
    assert student_email(app) == "aanya@example.edu"


def test_staff_approve_email_change_and_ticket_resolves(app, client, headers, admin):
    result = email_request(app)
    staff, staff_headers = admin
    detail = staff.get(f"/api/admin/tickets/{result['ticket_id']}").json
    assert detail["approval"]["status"] == "pending" and detail["approval"]["new_value"] == "aanya.new@example.edu"
    assert staff.post(f"/api/admin/tickets/{result['ticket_id']}/resolve", json={"resolution": "Done already"}, headers=staff_headers).status_code == 409
    decided = staff.post(f"/api/admin/approvals/{result['approval']['id']}/decision", json={"decision": "approve", "note": "Verified with the student."}, headers=staff_headers)
    assert decided.status_code == 200 and decided.json["executed"]
    assert student_email(app) == "aanya.new@example.edu"
    ticket = client.get(f"/api/tickets/{result['ticket_id']}").json
    assert ticket["status"] == "resolved" and "Verified with the student." in ticket["resolution"]
    assert staff.post(f"/api/admin/approvals/{result['approval']['id']}/decision", json={"decision": "approve"}, headers=staff_headers).status_code == 409
    with app.app_context():
        last = rows("SELECT actor,target,decision,result FROM audit WHERE action='decide_approval'")[-1]
        assert last == {"actor": "ADM001", "target": "STU001", "decision": "denied", "result": "already_decided"}
        assert {"actor": "ADM001", "target": "STU001", "decision": "approved", "result": "email_updated"} in rows("SELECT actor,target,decision,result FROM audit WHERE action='decide_approval'")


def test_staff_decline_needs_reason_and_never_executes(app, client, headers, admin):
    result = email_request(app)
    staff, staff_headers = admin
    url = f"/api/admin/approvals/{result['approval']['id']}/decision"
    assert staff.post(url, json={"decision": "reject"}, headers=staff_headers).status_code == 400
    assert staff.post(url, json={"decision": "reject", "note": "Use your institute address."}, headers=staff_headers).json["status"] == "rejected"
    assert student_email(app) == "aanya@example.edu"
    assert "Use your institute address." in client.get(f"/api/tickets/{result['ticket_id']}").json["resolution"]


def test_email_approval_requires_permission(app, agent, admin):
    result = email_request(app)
    staff, staff_headers = agent
    url = f"/api/admin/approvals/{result['approval']['id']}/decision"
    assert staff.post(url, json={"decision": "approve"}, headers=staff_headers).status_code == 403
    assert student_email(app) == "aanya@example.edu"
    admin[0].put("/api/admin/permissions/support_agent", json={"permissions": ["tickets.view", "approvals.decide"]}, headers=admin[1])
    assert staff.post(url, json={"decision": "approve"}, headers=staff_headers).json["executed"]


def test_email_approval_rechecks_conflicts_at_decision_time(app, admin):
    result = email_request(app, "shared@example.edu")
    with app.app_context():
        get_db().execute("UPDATE students SET email='shared@example.edu' WHERE id='STU002'")
        get_db().commit()
    decided = admin[0].post(f"/api/admin/approvals/{result['approval']['id']}/decision", json={"decision": "approve"}, headers=admin[1])
    assert decided.status_code == 409 and decided.json["status"] == "conflict"
    assert student_email(app) == "aanya@example.edu"


def test_chat_shows_ticket_not_student_approval_for_email_change(app, client, headers):
    app.extensions["provider"] = ScriptedProvider([tool_response("request_email_change", {"email": "aanya.new@example.edu"}), "echo_tool"])
    result = client.post("/api/chat", json={"message": "Please change my email to aanya.new@example.edu"}, headers=headers).json
    assert result["approvals"] == [] and result["tickets"][0]["subject"] == "Registered email change request"


def test_hostel_room_memory_is_pattern_validated(app, client, headers):
    with app.app_context():
        service = ToolService("STU001", "run", "Remember my hostel room is B-204", app.extensions["handbook"])
        assert service.execute("remember_preference", {"key": "hostel_room", "value": "B-204"})["ok"]
        bad = ToolService("STU001", "run", "Remember my hostel room is near the gate", app.extensions["handbook"])
        assert not bad.execute("remember_preference", {"key": "hostel_room", "value": "near the gate"})["ok"]
    assert client.post("/api/memory", json={"key": "hostel_room", "value": "drop table", "consent": True}, headers=headers).status_code == 400
    assert client.post("/api/memory", json={"key": "hostel_room", "value": "C12", "consent": True}, headers=headers).status_code == 200


def test_admin_page_and_student_page_render(client):
    assert client.get("/admin").status_code == 200
    assert client.get("/").status_code == 200
