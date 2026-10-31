import pytest
from student_support.context import add_message, create_thread, select_context, ticket_context
from student_support.db import get_db, rows
from .conftest import login
from .helpers import ScriptedProvider, answer_response, tool_response


def test_only_relevant_recent_context_is_selected(app):
    with app.app_context():
        thread = create_thread("STU001", "Ticket")
        add_message(thread, "STU001", "user", "Create a ticket")
        add_message(thread, "STU001", "assistant", "What issue should I report?")
        assert len(select_context(thread, "Payment portal failed", 2)) == 2
        add_message(thread, "STU001", "user", "What are my fees?")
        add_message(thread, "STU001", "assistant", "Your balance is INR 60,000.")
        assert select_context(thread, "Explain the merit scholarship eligibility rules for my programme", 2) == []
        assert len(select_context(thread, "Create a ticket for that", 2)) == 4
        assert len(select_context(thread, "Create a ticket for that", 1)) == 2
        assert select_context(thread, "Create a ticket for that", 0) == []


def test_withheld_messages_never_reach_context_or_tickets(app):
    with app.app_context():
        thread = create_thread("STU001", "Mixed")
        add_message(thread, "STU001", "user", "[Withheld]", redacted=True)
        add_message(thread, "STU001", "assistant", "Please do not share that.")
        assert [m["role"] for m in select_context(thread, "yes", 2)] == ["assistant"]
        assert ticket_context(thread, "My OTP is 123456") == [{"role": "assistant", "content": "Please do not share that."}]


def test_threads_persist_and_follow_ups_use_same_thread(client, headers, app):
    provider = ScriptedProvider([answer_response("Which issue should I report?"), answer_response("Understood."), answer_response("Hello.")])
    app.extensions["provider"] = provider
    first = client.post("/api/chat", json={"message": "Create a support request"}, headers=headers).json
    thread_id = first["thread"]["id"]
    second = client.post("/api/chat", json={"message": "Payment portal failed", "thread_id": thread_id}, headers=headers).json
    assert second["trace"]["context"]["history_messages"] == 2
    third = client.post("/api/chat", json={"message": "What was that?"}, headers=headers).json
    assert third["trace"]["context"]["history_messages"] == 0 and third["thread"]["id"] != thread_id
    stored = client.get(f"/api/threads/{thread_id}").json["messages"]
    assert [m["role"] for m in stored] == ["user", "assistant", "user", "assistant"]
    assert len(client.get("/api/threads").json["items"]) == 2


def test_sensitive_chat_text_is_withheld_from_history(client, headers, app):
    result = client.post("/api/chat", json={"message": "My OTP is 123456"}, headers=headers).json
    messages = client.get(f"/api/threads/{result['thread']['id']}").json["messages"]
    assert messages[0]["redacted"] and "123456" not in messages[0]["content"]
    with app.app_context():
        assert "123456" not in "\n".join(get_db().iterdump())


def test_threads_are_owner_scoped_and_deletable(client, headers, app):
    app.extensions["provider"] = ScriptedProvider([answer_response("Hi.")])
    thread_id = client.post("/api/chat", json={"message": "Hello"}, headers=headers).json["thread"]["id"]
    other = app.test_client(); other_headers = login(other, "STU002")
    assert other.get(f"/api/threads/{thread_id}").status_code == 404
    assert other.post("/api/chat", json={"message": "Hello", "thread_id": thread_id}, headers=other_headers).status_code == 404
    assert other.delete(f"/api/threads/{thread_id}", headers=other_headers).status_code == 404
    assert client.patch(f"/api/threads/{thread_id}", json={"title": "Greeting"}, headers=headers).status_code == 200
    assert client.delete(f"/api/threads/{thread_id}", headers=headers).status_code == 200
    with app.app_context():
        assert rows("SELECT * FROM messages") == []


def test_answers_carry_sources_and_follow_up_suggestions(client, headers, app):
    app.extensions["provider"] = ScriptedProvider([tool_response("search_policy", {"query": "late fee after due date"}), "echo_tool"])
    result = client.post("/api/chat", json={"message": "What is the late fee if I pay late?"}, headers=headers).json
    assert result["sources"][0]["id"] == "LATE-07" and result["sources"][0]["source"] == "Fees and payments guide"
    assert "What should I do if the payment portal crashes?" in result["suggestions"]
    assert "What is the late fee if I pay after the due date?" not in result["suggestions"]  # repeats the question
    stored = client.get(f"/api/threads/{result['thread']['id']}").json["messages"][-1]
    assert stored["meta"]["sources"][0]["id"] == "LATE-07"


def test_conversation_titles_are_cut_at_word_boundaries(client, headers, app):
    from student_support.context import short_title
    assert short_title("What is my fee balance?") == "What is my fee balance?"
    assert short_title("What is my outstanding fee balance and the late fee if I miss the due date?") == "What is my outstanding fee balance and the late…"
    assert short_title("  many   spaces\nand lines ") == "many spaces and lines"
    app.extensions["provider"] = ScriptedProvider([answer_response("Hi.")])
    title = client.post("/api/chat", json={"message": "x" * 70}, headers=headers).json["thread"]["title"]
    assert len(title) <= 61 and title.endswith("…")


@pytest.mark.parametrize("question,title", [
    ("What is my outstanding fee balance and the late fee if I miss the due date?", "Outstanding fee balance and late fee"),
    ("The payment portal failed. Can I pay on the next working day?", "Payment portal failed"),
    ("Hi, could you please tell me what is the attendance requirement for my programme?", "Attendance requirement for programme"),
    ("My ticket was not answered, who do I escalate to?", "Ticket was not answered"),
    ("How do I update my registered email?", "Update registered email"),
    ("hello", "Greeting"),
])
def test_smart_titles_are_short_and_meaningful(question, title):
    from student_support.context import smart_title
    assert smart_title(question) == title
    assert len(smart_title(question).split()) <= 7


def test_old_auto_titles_are_upgraded_once_and_renamed_titles_kept(app):
    from student_support.context import retitle_auto_threads
    with app.app_context():
        db = get_db()
        auto = create_thread("STU001", "x"); add_message(auto, "STU001", "user", "What is my fee balance?")
        db.execute("UPDATE threads SET title='What is my fee balance?' WHERE id=?", (auto,))
        renamed = create_thread("STU001", "x"); add_message(renamed, "STU001", "user", "What is my fee balance?")
        db.execute("UPDATE threads SET title='My fees' WHERE id=?", (renamed,))
        db.execute("DELETE FROM settings WHERE key='titles_v2'")
        retitle_auto_threads(db)
        titles = {r["id"]: r["title"] for r in rows("SELECT id,title FROM threads")}
        assert titles[auto] == "Fee balance" and titles[renamed] == "My fees"


def test_pinned_conversations_list_first_and_patch_validates(client, headers, app):
    app.extensions["provider"] = ScriptedProvider([answer_response("One."), answer_response("Two.")])
    first = client.post("/api/chat", json={"message": "First question"}, headers=headers).json["thread"]["id"]
    second = client.post("/api/chat", json={"message": "Second question"}, headers=headers).json["thread"]["id"]
    assert [t["id"] for t in client.get("/api/threads").json["items"]] == [second, first]
    pinned = client.patch(f"/api/threads/{first}", json={"pinned": True}, headers=headers)
    assert pinned.status_code == 200 and pinned.json["pinned"] == 1
    items = client.get("/api/threads").json["items"]
    assert [t["id"] for t in items] == [first, second] and items[0]["pinned"] == 1
    assert client.patch(f"/api/threads/{first}", json={"pinned": "yes"}, headers=headers).status_code == 400
    assert client.patch(f"/api/threads/{first}", json={"colour": "red"}, headers=headers).status_code == 400
    assert client.patch(f"/api/threads/{first}", json={"title": "Renamed", "pinned": False}, headers=headers).json == {**client.get(f"/api/threads/{first}").json["thread"], "title": "Renamed", "pinned": 0}
    other = app.test_client(); other_headers = login(other, "STU002")
    assert other.patch(f"/api/threads/{first}", json={"pinned": True}, headers=other_headers).status_code == 404
