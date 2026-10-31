import json
import os
import secrets
import threading
import time
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash

from .agent import follow_ups, run_agent, sources
from .auth import PERMISSIONS, ROLES, current_staff, role_permissions, student_required
from .context import WITHHELD, add_message, create_thread, get_thread, list_threads, purge_expired, select_context, smart_title, thread_messages, ticket_context
from .db import audit, close_db, get_db, init_db, now, rows
from .knowledge import KnowledgeBase
from .privacy import MEMORY_PATTERNS, MEMORY_VALUES, memory_value_allowed, sensitive
from .provider import GroqProvider
from .settings import PRIORITIES, get_setting
from . import usage
from .tickets import CATEGORIES, create_ticket, student_comment, student_tickets, ticket_detail
from .tools import account_summary, decide_approval

TOPICS = json.loads((Path(__file__).resolve().parent.parent / "data/quick_topics.json").read_text(encoding="utf-8"))


def create_app(test_config=None):
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env")
    app = Flask(__name__, instance_path=str(root / "instance"))
    Path(app.instance_path).mkdir(exist_ok=True)
    secret = os.getenv("SECRET_KEY")
    if not secret:
        secret_file = Path(app.instance_path) / "session.key"
        try:
            with secret_file.open("x", encoding="utf-8") as f:
                f.write(secrets.token_hex(32))
        except FileExistsError:
            pass
        secret = secret_file.read_text(encoding="utf-8").strip()
    app.config.update(SECRET_KEY=secret, DATABASE=os.getenv("DATABASE_PATH") or str(root / "instance/campus.db"),
                      GROQ_API_KEY=os.getenv("GROQ_API_KEY", ""),
                      GROQ_MODEL=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=2), MAX_CONTENT_LENGTH=262_144,
                      # Serve edited templates without a restart, so HTML never lags behind the static scripts.
                      TEMPLATES_AUTO_RELOAD=True)
    if test_config:
        app.config.update(test_config)
    app.teardown_appcontext(close_db)
    app.extensions["handbook"] = KnowledgeBase()
    app.extensions["provider"] = app.config.get("PROVIDER") or GroqProvider(app.config["GROQ_API_KEY"], app.config["GROQ_MODEL"])
    app.extensions["chat_locks"] = {}
    app.extensions["login_attempts"] = {}
    with app.app_context():
        init_db()

    from .admin import admin
    app.register_blueprint(admin)

    @app.before_request
    def protect():
        if request.path.startswith("/api/"):
            session.setdefault("csrf", secrets.token_urlsafe(32))
            if request.method in ("POST", "PUT", "PATCH", "DELETE"):
                if not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), session["csrf"]):
                    return jsonify(error="Your session token expired. Refresh the page and try again."), 403
            if request.path in ("/api/session", "/api/login"):
                return None
            # Deactivated accounts lose access on their next request, not at session expiry.
            if session.get("student_id"):
                if not get_db().execute("SELECT 1 FROM students WHERE id=? AND active=1", (session["student_id"],)).fetchone():
                    session.clear()
                    return jsonify(error="Please sign in first."), 401
            elif session.get("staff_id"):
                if not current_staff():
                    session.clear()
                    return jsonify(error="Please sign in first."), 401
            else:
                return jsonify(error="Please sign in first."), 401

    @app.after_request
    def security_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(500)
    def internal_error(_error):
        return jsonify(error="The request could not be completed. Please try again."), 500

    def body():
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else {}

    def actor():
        return session["student_id"]

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/admin")
    def admin_page():
        return render_template("admin.html")

    @app.get("/api/session")
    def session_info():
        student = staff = None
        if session.get("student_id"):
            record = get_db().execute("SELECT id,name,programme,email FROM students WHERE id=? AND active=1", (session["student_id"],)).fetchone()
            student = dict(record) if record else None
        elif session.get("staff_id"):
            staff = current_staff()
            if staff:
                staff = {**staff, "role_label": ROLES.get(staff["role"], staff["role"]), "permissions": sorted(role_permissions(staff["role"]))}
        return jsonify(student=student, staff=staff, csrf_token=session["csrf"], configured=bool(app.config["GROQ_API_KEY"]),
                       model=app.config["GROQ_MODEL"], memory_options=MEMORY_VALUES, memory_patterns=MEMORY_PATTERNS,
                       ticket_categories=CATEGORIES, priorities=PRIORITIES, permissions=PERMISSIONS,
                       announcement=get_setting("announcement"), student_can_close_tickets=get_setting("student_can_close_tickets"))

    @app.post("/api/login")
    def login():
        data = body()
        user_id, password = data.get("student_id") or data.get("user_id"), data.get("password")
        if not isinstance(user_id, str) or not isinstance(password, str) or len(password) > 200 or len(user_id) > 20:
            return jsonify(error="Enter your ID and password."), 400
        identity = request.remote_addr or "local"
        attempts = app.extensions["login_attempts"]
        recent = [t for t in attempts.get(identity, []) if time.monotonic() - t < 60]
        attempts[identity] = recent
        if len(recent) >= 10:
            return jsonify(error="Too many sign-in attempts. Try again in a minute."), 429
        recent.append(time.monotonic())
        user_id = user_id.strip().upper()
        db = get_db()
        student = db.execute("SELECT id,password_hash,active FROM students WHERE id=?", (user_id,)).fetchone()
        staff = None if student else db.execute("SELECT id,password_hash,active,role FROM staff WHERE id=?", (user_id,)).fetchone()
        account = student or staff
        if not account or not check_password_hash(account["password_hash"], password) or not account["active"]:
            audit("anonymous", "login", "user_account", "denied", "inactive_account" if account and account["active"] == 0 else "invalid_credentials")
            db.commit()
            return jsonify(error="ID or password is incorrect, or the account is inactive."), 401
        session.clear()
        session.update(csrf=secrets.token_urlsafe(32))
        if student:
            session["student_id"] = student["id"]
            purge_expired(get_setting("chat_retention_days"))
        else:
            session["staff_id"] = staff["id"]
        session.permanent = True
        audit(account["id"], "login", account["id"], "allowed", "signed_in" if student else f"signed_in_{staff['role']}")
        db.commit()
        return session_info()

    @app.post("/api/logout")
    def logout():
        user = session.get("student_id") or session.get("staff_id")
        audit(user, "logout", user, "allowed", "signed_out")
        get_db().commit()
        session.clear()
        return jsonify(ok=True)

    @app.get("/api/topics")
    @student_required
    def topics():
        return jsonify(items=TOPICS)

    @app.get("/api/threads")
    @student_required
    def threads_list():
        return jsonify(items=list_threads(actor()))

    @app.get("/api/threads/<thread_id>")
    @student_required
    def thread_get(thread_id):
        thread = get_thread(actor(), thread_id)
        if not thread:
            return jsonify(error="Conversation not found."), 404
        return jsonify(thread=thread, messages=thread_messages(thread_id))

    @app.patch("/api/threads/<thread_id>")
    @student_required
    def thread_rename(thread_id):
        """Rename and/or pin a conversation. Pinning does not change when it was last updated."""
        data = body()
        if not data or not set(data) <= {"title", "pinned"}:
            return jsonify(error="Send a new title or a pinned value."), 400
        title, pinned = data.get("title"), data.get("pinned")
        if "title" in data and (not isinstance(title, str) or not 1 <= len(title.strip()) <= 80 or sensitive(title)):
            return jsonify(error="Use a title of 1 to 80 characters without sensitive information."), 400
        if "pinned" in data and not isinstance(pinned, bool):
            return jsonify(error="Pinned must be true or false."), 400
        if not get_thread(actor(), thread_id):
            return jsonify(error="Conversation not found."), 404
        if "title" in data:
            get_db().execute("UPDATE threads SET title=? WHERE id=? AND student_id=?", (title.strip(), thread_id, actor()))
        if "pinned" in data:
            get_db().execute("UPDATE threads SET pinned=? WHERE id=? AND student_id=?", (int(pinned), thread_id, actor()))
        get_db().commit()
        return jsonify(get_thread(actor(), thread_id))

    @app.delete("/api/threads/<thread_id>")
    @student_required
    def thread_delete(thread_id):
        if not get_thread(actor(), thread_id):
            return jsonify(error="Conversation not found."), 404
        db = get_db()
        db.execute("DELETE FROM messages WHERE thread_id=? AND student_id=?", (thread_id, actor()))
        db.execute("DELETE FROM threads WHERE id=? AND student_id=?", (thread_id, actor()))
        audit(actor(), "delete_conversation", actor(), "allowed", "conversation_deleted")
        db.commit()
        return jsonify(ok=True)

    @app.post("/api/chat")
    @student_required
    def chat():
        data = body()
        question = data.get("message")
        if not isinstance(question, str) or not question.strip() or len(question) > 2000:
            return jsonify(error="Enter a question between 1 and 2000 characters."), 400
        if not set(data) <= {"message", "thread_id"} or (data.get("thread_id") is not None and not isinstance(data["thread_id"], str)):
            return jsonify(error="Unexpected request fields. Identity is set by your signed-in session."), 400
        lock = app.extensions["chat_locks"].setdefault(actor(), threading.Lock())
        if not lock.acquire(blocking=False):
            return jsonify(error="A response is already in progress. Please wait."), 409
        try:
            question = question.strip()
            thread_id = data.get("thread_id")
            if thread_id and not get_thread(actor(), thread_id):
                return jsonify(error="Conversation not found."), 404
            withheld = sensitive(question)
            if not thread_id:
                thread_id = create_thread(actor(), "Sensitive message withheld" if withheld else smart_title(question))
            recent = select_context(thread_id, question, get_setting("context_exchanges"))
            result = run_agent(actor(), question, app.extensions["provider"], app.extensions["handbook"], recent_context=recent,
                               thread_id=thread_id, conversation=ticket_context(thread_id, question))
            trace = result["trace"]
            add_message(thread_id, actor(), "user", WITHHELD if withheld else question, trace["id"], redacted=withheld)
            tickets = [t["ticket_id"] for t in trace["tools"] if t.get("ticket_id")]
            meta = {"sources": sources(trace), "suggestions": follow_ups(question, trace, app.extensions["handbook"]) if trace["status"] in ("completed", "out_of_scope") else [],
                    "tickets": [ticket_detail(t, actor()) for t in dict.fromkeys(tickets)],
                    # Only changes the student confirms themself get the "waiting for you" card; staff-reviewed ones show their ticket.
                    "approvals": [a["id"] for a in result["approvals"] if a.get("reviewer", "student") == "student"], "status": trace["status"]}
            # A fee or scholarship answer gets a breakdown card built from the record, matching what the question asked about.
            used = {t["name"] for t in trace["tools"] if t.get("ok")}
            if used & {"get_fee_status", "get_scholarship_status"}:
                meta["account"] = account_summary(actor(), "get_fee_status" in used, "get_scholarship_status" in used)
            for ticket in meta["tickets"]:
                ticket.pop("context", None)
                ticket.pop("events", None)
            message_id = add_message(thread_id, actor(), "assistant", result["answer"], trace["id"], meta)
            get_db().commit()
            return jsonify({**result, **meta, "thread": get_thread(actor(), thread_id), "message_id": message_id})
        finally:
            lock.release()

    @app.get("/api/profile")
    @student_required
    def profile():
        student = get_db().execute("SELECT id,name,programme,email FROM students WHERE id=?", (actor(),)).fetchone()
        return jsonify(student=dict(student), **account_summary(actor()))

    @app.get("/api/memory")
    @student_required
    def memory_list():
        return jsonify(items=rows("SELECT key,value,updated_at FROM memory WHERE student_id=? ORDER BY key", (actor(),)))

    @app.post("/api/memory")
    @student_required
    def memory_save():
        data = body()
        key, value = data.get("key"), data.get("value")
        if not isinstance(key, str) or not memory_value_allowed(key, value) or data.get("consent") is not True or set(data) != {"key", "value", "consent"}:
            return jsonify(error="Select an allowed preference and explicitly agree to remember it."), 400
        get_db().execute("INSERT INTO memory VALUES (?,?,?,?) ON CONFLICT(student_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", (actor(), key, value, now()))
        audit(actor(), "save_memory", actor(), "allowed", "explicit_preference_saved")
        get_db().commit()
        return memory_list()

    @app.delete("/api/memory/<key>")
    @student_required
    def memory_delete(key):
        get_db().execute("DELETE FROM memory WHERE student_id=? AND key=?", (actor(), key))
        audit(actor(), "delete_memory", actor(), "allowed", "preference_deleted")
        get_db().commit()
        return jsonify(ok=True)

    @app.get("/api/approvals")
    @student_required
    def approvals_list():
        return jsonify(items=rows("SELECT * FROM approvals WHERE student_id=? ORDER BY created_at DESC LIMIT 50", (actor(),)))

    @app.post("/api/approvals/<approval_id>/decision")
    @student_required
    def approval_decision(approval_id):
        data = body()
        if data.get("decision") not in ("confirm", "reject") or set(data) != {"decision"}:
            return jsonify(error="Choose confirm or reject."), 400
        result, status = decide_approval(actor(), approval_id, data["decision"])
        return jsonify(result), status

    @app.get("/api/tickets")
    @student_required
    def ticket_list():
        return jsonify(items=student_tickets(actor()))

    @app.post("/api/tickets")
    @student_required
    def ticket_create():
        """Raise a ticket from a chat message; the conversation is captured on the server, not sent by the client."""
        data = body()
        category, description = data.get("category"), data.get("description")
        subject, priority, thread_id = data.get("subject"), data.get("priority"), data.get("thread_id")
        if not set(data) <= {"category", "description", "subject", "priority", "thread_id"}:
            return jsonify(error="Unexpected request fields."), 400
        if category not in CATEGORIES or (priority is not None and priority not in PRIORITIES):
            return jsonify(error="Choose a category and priority from the list."), 400
        if not isinstance(description, str) or not 5 <= len(description.strip()) <= 2000 or (subject is not None and (not isinstance(subject, str) or len(subject) > 120)):
            return jsonify(error="Describe the issue in 5 to 2000 characters; keep the subject under 120."), 400
        if sensitive(description) or (subject and sensitive(subject)):
            return jsonify(error="Remove passwords, OTPs, card or account numbers before raising a ticket."), 400
        if thread_id is not None and (not isinstance(thread_id, str) or not get_thread(actor(), thread_id)):
            return jsonify(error="Conversation not found."), 404
        ticket_id = create_ticket(actor(), category, description.strip(), "manual-" + secrets.token_hex(8), (subject or "").strip() or None,
                                  priority, thread_id, ticket_context(thread_id), "chat_button")
        audit(actor(), "create_support_request", actor(), "allowed", "success")
        get_db().commit()
        return jsonify(ticket_detail(ticket_id, actor())), 201

    @app.get("/api/tickets/<ticket_id>")
    @student_required
    def ticket_get(ticket_id):
        ticket = ticket_detail(ticket_id, actor())
        if not ticket:
            return jsonify(error="Ticket not found."), 404
        return jsonify(ticket)

    @app.post("/api/tickets/<ticket_id>/comments")
    @student_required
    def ticket_comment(ticket_id):
        text = body().get("body")
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            return jsonify(error="Write a reply of 1 to 2000 characters."), 400
        if sensitive(text):
            return jsonify(error="Remove passwords, OTPs, card or account numbers from your reply."), 400
        try:
            student_comment(actor(), ticket_id, text.strip())
        except LookupError as exc:
            return jsonify(error=str(exc)), 404
        except ValueError as exc:
            return jsonify(error=str(exc)), 409
        get_db().commit()
        return jsonify(ticket_detail(ticket_id, actor()))

    @app.post("/api/tickets/<ticket_id>/close")
    @student_required
    def ticket_close(ticket_id):
        if not get_setting("student_can_close_tickets"):
            return jsonify(error="Closing tickets is handled by support staff."), 403
        ticket = ticket_detail(ticket_id, actor())
        if not ticket:
            return jsonify(error="Ticket not found."), 404
        if ticket["status"] == "closed":
            return jsonify(error="This ticket is already closed."), 409
        get_db().execute("UPDATE tickets SET status='closed', resolved_at=COALESCE(resolved_at, ?) WHERE id=?", (now(), ticket_id))
        from .tickets import add_event
        add_event(ticket_id, actor(), "student", "closed", "Closed by the student.")
        audit(actor(), "ticket_close", ticket_id, "allowed", "closed")
        get_db().commit()
        return jsonify(ticket_detail(ticket_id, actor()))

    @app.get("/api/audit")
    @student_required
    def audit_list():
        return jsonify(items=rows("SELECT * FROM audit WHERE actor=? ORDER BY id DESC LIMIT 200", (actor(),)))

    @app.get("/api/traces")
    @student_required
    def trace_list():
        range_key = usage.parse_range(request.args.get("range", "all"))
        traces = list(reversed(usage.load_traces(range_key, actor())))[:50]
        threads = usage.thread_titles(t["id"] for t in traces)
        return jsonify(items=[{**{k: v for k, v in t.items() if k != "student_id"}, "thread": threads.get(t["id"])} for t in traces])

    @app.get("/api/usage")
    @student_required
    def usage_summary():
        """The signed-in student's own runs, tokens and latency for the chosen range."""
        return jsonify(usage.summary(usage.parse_range(request.args.get("range")), usage.parse_offset(request.args.get("tz")), actor()))

    @app.get("/api/traces/<trace_id>")
    @student_required
    def trace_get(trace_id):
        record = get_db().execute("SELECT data FROM traces WHERE id=? AND student_id=?", (trace_id, actor())).fetchone()
        if not record:
            return jsonify(error="Trace not found."), 404
        return jsonify(json.loads(record["data"]))

    @app.get("/api/export")
    @student_required
    def export():
        payload = {"student_id": actor(), "exported_at": now(),
                   "traces": [json.loads(r["data"]) for r in rows("SELECT data FROM traces WHERE student_id=? ORDER BY created_at", (actor(),))],
                   "audit": rows("SELECT * FROM audit WHERE actor=? ORDER BY id", (actor(),))}
        response = jsonify(payload)
        response.headers["Content-Disposition"] = 'attachment; filename="campus-desk-evidence.json"'
        return response

    return app
