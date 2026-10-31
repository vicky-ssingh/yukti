"""Staff API: knowledge base, tickets, chat monitoring, users, permissions, settings and logs.

Every route is guarded by a permission checked in Python against the signed-in staff record.
"""
import json
import re

from flask import Blueprint, current_app, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from .auth import PASSWORD_RULE, PERMISSIONS, ROLES, permission_required, role_permissions, valid_password
from .context import get_thread, thread_messages
from .db import audit, get_db, now, rows
from .knowledge import CATEGORIES, create_document, delete_document, index_document, set_archived, update_document, validate_document
from .privacy import MEMORY_VALUES
from .settings import PRIORITIES, all_settings, validate
from .tickets import STATUSES, resolve, staff_update, ticket_detail
from .tools import staff_decide_approval
from . import usage

admin = Blueprint("admin", __name__, url_prefix="/api/admin")
USER_ID = re.compile(r"^[A-Z]{3}\d{3,6}$")
EMAIL = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")


def body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def error(message, code=400):
    return jsonify(error=message), code


def kb():
    return current_app.extensions["handbook"]


def page_args(default=50, maximum=200):
    try:
        limit = min(max(int(request.args.get("limit", default)), 1), maximum)
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        limit, offset = default, 0
    return limit, offset


@admin.get("/overview")
@permission_required(None)
def overview(staff):
    db = get_db()
    permissions = role_permissions(staff["role"])
    count = lambda sql, args=(): db.execute(sql, args).fetchone()[0]
    data = {"staff": staff, "permissions": sorted(permissions)}
    if "tickets.view" in permissions:
        data["tickets"] = {
            "open": count("SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed')"),
            "unassigned": count("SELECT COUNT(*) FROM tickets WHERE assigned_to IS NULL AND status NOT IN ('resolved','closed')"),
            "mine": count("SELECT COUNT(*) FROM tickets WHERE assigned_to=? AND status NOT IN ('resolved','closed')", (staff["id"],)),
            "urgent": count("SELECT COUNT(*) FROM tickets WHERE priority IN ('high','urgent') AND status NOT IN ('resolved','closed')"),
            "resolved": count("SELECT COUNT(*) FROM tickets WHERE status IN ('resolved','closed')"),
            "by_status": {s: count("SELECT COUNT(*) FROM tickets WHERE status=?", (s,)) for s in STATUSES},
            "recent": rows("""SELECT t.id, t.subject, t.status, t.priority, t.updated_at, st.name AS student_name
                              FROM tickets t JOIN students st ON st.id=t.student_id ORDER BY t.updated_at DESC LIMIT 6"""),
        }
    if "approvals.decide" in permissions:
        data["approvals"] = {"pending": count("SELECT COUNT(*) FROM approvals WHERE reviewer='staff' AND status='pending' AND expires_at>?", (now(),))}
    if "kb.manage" in permissions:
        data["knowledge"] = {s: count("SELECT COUNT(*) FROM kb_documents WHERE status=?", (s,)) for s in ("indexed", "failed", "archived", "pending", "processing")}
        data["knowledge"]["sections"] = count("SELECT COUNT(*) FROM kb_chunks")
    if "chats.view" in permissions:
        data["chats"] = {"threads": count("SELECT COUNT(*) FROM threads"), "messages": count("SELECT COUNT(*) FROM messages"),
                         "today": count("SELECT COUNT(*) FROM messages WHERE created_at>=date('now')")}
    if "users.manage" in permissions:
        data["users"] = {"students": count("SELECT COUNT(*) FROM students WHERE active=1"), "staff": count("SELECT COUNT(*) FROM staff WHERE active=1")}
    if "logs.view" in permissions:
        data["activity"] = rows("SELECT * FROM audit ORDER BY id DESC LIMIT 8")
    return jsonify(data)


@admin.get("/usage")
@permission_required("logs.view")
def usage_summary(staff):
    """Runs, tokens and latency across all students, with a per-student breakdown."""
    return jsonify(usage.summary(usage.parse_range(request.args.get("range")), usage.parse_offset(request.args.get("tz"))))


@admin.post("/me/password")
@permission_required(None)
def change_own_password(staff):
    data = body()
    record = get_db().execute("SELECT password_hash FROM staff WHERE id=?", (staff["id"],)).fetchone()
    if not isinstance(data.get("current"), str) or not check_password_hash(record["password_hash"], data["current"]):
        return error("Your current password is incorrect.", 403)
    if not valid_password(data.get("new")):
        return error(PASSWORD_RULE)
    get_db().execute("UPDATE staff SET password_hash=? WHERE id=?", (generate_password_hash(data["new"]), staff["id"]))
    audit(staff["id"], "change_password", staff["id"], "allowed", "password_changed")
    get_db().commit()
    return jsonify(ok=True)


# Knowledge base -------------------------------------------------------------

@admin.get("/kb")
@permission_required("kb.manage")
def kb_list(staff):
    docs = rows("SELECT id,title,category,status,error,chunk_count,version,source,created_by,created_at,updated_at,indexed_at FROM kb_documents ORDER BY category, title")
    return jsonify(items=docs, categories=CATEGORIES)


@admin.get("/kb/<int:document_id>")
@permission_required("kb.manage")
def kb_get(staff, document_id):
    doc = get_db().execute("SELECT * FROM kb_documents WHERE id=?", (document_id,)).fetchone()
    if not doc:
        return error("Document not found.", 404)
    return jsonify({**dict(doc), "questions": json.loads(doc["questions"]),
                    "chunks": rows("SELECT id,position,title,text FROM kb_chunks WHERE document_id=? ORDER BY position", (document_id,))})


def kb_saved(staff, doc, action):
    audit(staff["id"], action, f"kb:{doc['id']}", "allowed", doc["status"])
    get_db().commit()
    return jsonify({**doc, "questions": json.loads(doc["questions"])})


@admin.post("/kb")
@permission_required("kb.manage")
def kb_create(staff):
    try:
        title, category, content, questions = validate_document(body())
    except ValueError as exc:
        return error(str(exc))
    return kb_saved(staff, create_document(get_db(), title, category, content, questions, staff["id"]), "kb_create"), 201


@admin.put("/kb/<int:document_id>")
@permission_required("kb.manage")
def kb_update(staff, document_id):
    if not get_db().execute("SELECT 1 FROM kb_documents WHERE id=?", (document_id,)).fetchone():
        return error("Document not found.", 404)
    try:
        title, category, content, questions = validate_document(body())
    except ValueError as exc:
        return error(str(exc))
    return kb_saved(staff, update_document(get_db(), document_id, title, category, content, questions), "kb_update")


@admin.post("/kb/<int:document_id>/reindex")
@permission_required("kb.manage")
def kb_reindex(staff, document_id):
    doc = get_db().execute("SELECT status FROM kb_documents WHERE id=?", (document_id,)).fetchone()
    if not doc:
        return error("Document not found.", 404)
    if doc["status"] == "archived":
        return error("Restore the document before reindexing it.", 409)
    return kb_saved(staff, index_document(get_db(), document_id), "kb_reindex")


@admin.post("/kb/<int:document_id>/archive")
@permission_required("kb.manage")
def kb_archive(staff, document_id):
    archived = body().get("archived")
    if not isinstance(archived, bool):
        return error("Send archived: true or false.")
    if not get_db().execute("SELECT 1 FROM kb_documents WHERE id=?", (document_id,)).fetchone():
        return error("Document not found.", 404)
    return kb_saved(staff, set_archived(get_db(), document_id, archived), "kb_archive" if archived else "kb_restore")


@admin.delete("/kb/<int:document_id>")
@permission_required("kb.manage")
def kb_delete(staff, document_id):
    if not get_db().execute("SELECT 1 FROM kb_documents WHERE id=?", (document_id,)).fetchone():
        return error("Document not found.", 404)
    delete_document(get_db(), document_id)
    audit(staff["id"], "kb_delete", f"kb:{document_id}", "allowed", "deleted")
    get_db().commit()
    return jsonify(ok=True)


@admin.post("/kb/search")
@permission_required("kb.manage")
def kb_test_search(staff):
    query = body().get("query")
    if not isinstance(query, str) or not 2 <= len(query) <= 300:
        return error("Enter a test question of 2 to 300 characters.")
    return jsonify(items=kb().search(query))


# Tickets --------------------------------------------------------------------

@admin.get("/tickets")
@permission_required("tickets.view")
def tickets_list(staff):
    clauses, args = [], []
    for field in ("status", "priority", "category"):
        if request.args.get(field):
            clauses.append(f"t.{field}=?")
            args.append(request.args[field])
    assigned = request.args.get("assigned")
    if assigned == "me":
        clauses.append("t.assigned_to=?")
        args.append(staff["id"])
    elif assigned == "none":
        clauses.append("t.assigned_to IS NULL")
    if request.args.get("open") == "1":
        clauses.append("t.status NOT IN ('resolved','closed')")
    if request.args.get("q"):
        clauses.append("(t.id LIKE ? OR t.subject LIKE ? OR t.description LIKE ? OR st.name LIKE ?)")
        args += [f"%{request.args['q'][:80]}%"] * 4
    limit, offset = page_args()
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    order = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC"
    items = rows(f"""SELECT t.id, t.subject, t.category, t.status, t.priority, t.assigned_to, s.name AS assigned_name,
                     t.student_id, st.name AS student_name, t.created_at, t.updated_at, t.source
                     FROM tickets t JOIN students st ON st.id=t.student_id LEFT JOIN staff s ON s.id=t.assigned_to
                     {where} ORDER BY {order} LIMIT ? OFFSET ?""", (*args, limit, offset))
    total = get_db().execute(f"SELECT COUNT(*) FROM tickets t JOIN students st ON st.id=t.student_id {where}", args).fetchone()[0]
    return jsonify(items=items, total=total, staff=rows("SELECT id,name,role FROM staff WHERE active=1 ORDER BY name"),
                   statuses=STATUSES, priorities=PRIORITIES)


@admin.get("/tickets/<ticket_id>")
@permission_required("tickets.view")
def ticket_get(staff, ticket_id):
    ticket = ticket_detail(ticket_id, include_internal=True)
    if not ticket:
        return error("Ticket not found.", 404)
    approval = get_db().execute("SELECT * FROM approvals WHERE ticket_id=?", (ticket_id,)).fetchone()
    ticket["approval"] = dict(approval) if approval else None
    return jsonify(ticket)


@admin.patch("/tickets/<ticket_id>")
@permission_required("tickets.manage")
def ticket_update(staff, ticket_id):
    data = body()
    if not data or not set(data) <= {"assigned_to", "status", "priority"}:
        return error("Change the assignee, status or priority.")
    try:
        staff_update(staff, ticket_id, data)
    except LookupError as exc:
        return error(str(exc), 404)
    except ValueError as exc:
        get_db().rollback()
        return error(str(exc))
    get_db().commit()
    return jsonify(ticket_detail(ticket_id, include_internal=True))


@admin.post("/tickets/<ticket_id>/comments")
@permission_required("tickets.manage")
def ticket_comment(staff, ticket_id):
    data = body()
    text, internal = data.get("body"), data.get("internal", False)
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000 or not isinstance(internal, bool):
        return error("Write a reply of 1 to 2000 characters.")
    if not get_db().execute("SELECT 1 FROM tickets WHERE id=?", (ticket_id,)).fetchone():
        return error("Ticket not found.", 404)
    from .tickets import add_event
    add_event(ticket_id, staff["id"], staff["role"], "note" if internal else "comment", text.strip(), internal)
    if not internal and data.get("await_student"):
        get_db().execute("UPDATE tickets SET status='waiting_on_student' WHERE id=? AND status NOT IN ('resolved','closed')", (ticket_id,))
    audit(staff["id"], "ticket_note" if internal else "ticket_reply", ticket_id, "allowed", "comment_added")
    get_db().commit()
    return jsonify(ticket_detail(ticket_id, include_internal=True))


@admin.post("/tickets/<ticket_id>/resolve")
@permission_required("tickets.manage")
def ticket_resolve(staff, ticket_id):
    resolution = body().get("resolution")
    if not isinstance(resolution, str) or not 5 <= len(resolution.strip()) <= 2000:
        return error("Describe the resolution in 5 to 2000 characters.")
    if get_db().execute("SELECT 1 FROM approvals WHERE ticket_id=? AND status='pending'", (ticket_id,)).fetchone():
        return error("Approve or decline the requested change first; that resolves the ticket.", 409)
    try:
        resolve(staff, ticket_id, resolution.strip())
    except LookupError as exc:
        return error(str(exc), 404)
    get_db().commit()
    return jsonify(ticket_detail(ticket_id, include_internal=True))


@admin.get("/approvals")
@permission_required("approvals.decide")
def approvals_list(staff):
    status = request.args.get("status", "pending")
    return jsonify(items=rows("""SELECT a.*, st.name AS student_name FROM approvals a JOIN students st ON st.id=a.student_id
                                 WHERE a.reviewer='staff' AND (?='all' OR a.status=?) ORDER BY a.created_at DESC LIMIT 100""", (status, status)))


@admin.post("/approvals/<approval_id>/decision")
@permission_required("approvals.decide")
def approval_decide(staff, approval_id):
    data = body()
    decision, note = data.get("decision"), data.get("note", "")
    if decision not in ("approve", "reject") or not isinstance(note, str) or len(note) > 500 or not set(data) <= {"decision", "note"}:
        return error("Choose approve or reject; keep the note under 500 characters.")
    if decision == "reject" and not note.strip():
        return error("Give the student a reason for declining.")
    result, code = staff_decide_approval(staff, approval_id, "confirm" if decision == "approve" else "reject", note.strip())
    return jsonify(result), code


# Chat monitoring ------------------------------------------------------------

@admin.get("/threads")
@permission_required("chats.view")
def threads_list(staff):
    clauses, args = [], []
    if request.args.get("student"):
        clauses.append("t.student_id=?")
        args.append(request.args["student"].upper())
    if request.args.get("q"):
        clauses.append("(t.title LIKE ? OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.thread_id=t.id AND m2.content LIKE ?))")
        args += [f"%{request.args['q'][:80]}%"] * 2
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    limit, offset = page_args()
    items = rows(f"""SELECT t.id, t.title, t.student_id, st.name AS student_name, t.created_at, t.updated_at,
                     (SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.id) AS message_count,
                     (SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.id AND m.redacted=1) AS withheld_count
                     FROM threads t JOIN students st ON st.id=t.student_id {where}
                     ORDER BY t.updated_at DESC LIMIT ? OFFSET ?""", (*args, limit, offset))
    return jsonify(items=items, students=rows("SELECT id,name FROM students ORDER BY name"))


@admin.get("/threads/<thread_id>")
@permission_required("chats.view")
def thread_get(staff, thread_id):
    owner = get_db().execute("SELECT student_id FROM threads WHERE id=?", (thread_id,)).fetchone()
    if not owner:
        return error("Conversation not found.", 404)
    # Reading a student's conversation is itself an audited, privacy-relevant action.
    audit(staff["id"], "view_chat_thread", owner["student_id"], "allowed", "thread_viewed")
    get_db().commit()
    thread = get_thread(owner["student_id"], thread_id)
    student = get_db().execute("SELECT id,name,programme FROM students WHERE id=?", (owner["student_id"],)).fetchone()
    return jsonify(thread=thread, student=dict(student), messages=thread_messages(thread_id),
                   tickets=rows("SELECT id,subject,status,priority FROM tickets WHERE thread_id=?", (thread_id,)))


# Users and permissions ------------------------------------------------------

@admin.get("/users")
@permission_required("users.manage")
def users_list(staff):
    students = rows("SELECT id,name,email,programme,active,'student' AS role FROM students ORDER BY id")
    members = rows("SELECT id,name,email,NULL AS programme,active,role,created_at FROM staff ORDER BY id")
    return jsonify(items=students + members, roles={"student": "Student", **ROLES}, programmes=MEMORY_VALUES["programme"])


@admin.post("/users")
@permission_required("users.manage")
def users_create(staff):
    data = body()
    user_id, name, email, password, role = (data.get(k) for k in ("id", "name", "email", "password", "role"))
    user_id = user_id.strip().upper() if isinstance(user_id, str) else ""
    if not USER_ID.match(user_id):
        return error("IDs are three capital letters and 3 to 6 digits, e.g. STU003 or SUP002.")
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80:
        return error("Enter a name of 2 to 80 characters.")
    if not isinstance(email, str) or not EMAIL.match(email.strip()):
        return error("Enter a valid email address.")
    if not valid_password(password):
        return error(PASSWORD_RULE)
    db = get_db()
    if db.execute("SELECT 1 FROM students WHERE id=? UNION SELECT 1 FROM staff WHERE id=?", (user_id, user_id)).fetchone():
        return error("That ID is already in use.", 409)
    if role == "student":
        programme = data.get("programme")
        if programme not in MEMORY_VALUES["programme"]:
            return error("Choose a programme.")
        db.execute("""INSERT INTO students (id,name,programme,email,password_hash,fee_total,fee_paid,fee_due,scholarship,scholarship_status,scholarship_amount,active)
                      VALUES (?,?,?,?,?,0,0,NULL,'None','not applied',0,1)""",
                   (user_id, name.strip(), programme, email.strip().lower(), generate_password_hash(password)))
    elif role in ROLES:
        db.execute("INSERT INTO staff (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,1,?)",
                   (user_id, name.strip(), email.strip().lower(), generate_password_hash(password), role, now()))
    else:
        return error("Choose a role.")
    audit(staff["id"], "user_create", user_id, "allowed", role)
    db.commit()
    return jsonify(ok=True, id=user_id), 201


def active_admins(db):
    return db.execute("SELECT COUNT(*) FROM staff WHERE role='admin' AND active=1").fetchone()[0]


@admin.patch("/users/<user_id>")
@permission_required("users.manage")
def users_update(staff, user_id):
    data = body()
    if not data or not set(data) <= {"active", "role"}:
        return error("Change the account status or role.")
    if "active" in data and not isinstance(data["active"], bool):
        return error("Send active: true or false.")
    db = get_db()
    student = db.execute("SELECT id FROM students WHERE id=?", (user_id,)).fetchone()
    member = db.execute("SELECT id,role,active FROM staff WHERE id=?", (user_id,)).fetchone()
    if not student and not member:
        return error("User not found.", 404)
    if student:
        if "role" in data:
            return error("Student accounts cannot be given a staff role. Create a staff account instead.")
        db.execute("UPDATE students SET active=? WHERE id=?", (int(data["active"]), user_id))
        audit(staff["id"], "user_activate" if data["active"] else "user_deactivate", user_id, "allowed", "student")
    else:
        if user_id == staff["id"]:
            return error("You cannot change your own role or deactivate yourself.", 409)
        role = data.get("role", member["role"])
        if role not in ROLES:
            return error("Choose a staff role.")
        active = int(data.get("active", bool(member["active"])))
        if member["role"] == "admin" and member["active"] and (role != "admin" or not active) and active_admins(db) <= 1:
            return error("At least one active administrator is required.", 409)
        db.execute("UPDATE staff SET role=?, active=? WHERE id=?", (role, active, user_id))
        if not active:
            # Return open work to the queue so nothing stays with someone who can no longer sign in.
            from .tickets import add_event
            for ticket in rows("SELECT id FROM tickets WHERE assigned_to=? AND status NOT IN ('resolved','closed')", (user_id,)):
                db.execute("UPDATE tickets SET assigned_to=NULL WHERE id=?", (ticket["id"],))
                add_event(ticket["id"], staff["id"], staff["role"], "assigned", "Unassigned because the assignee's account was deactivated.")
        audit(staff["id"], "user_update", user_id, "allowed", f"{role}:{'active' if active else 'inactive'}")
    db.commit()
    return jsonify(ok=True)


@admin.post("/users/<user_id>/password")
@permission_required("users.manage")
def users_reset_password(staff, user_id):
    password = body().get("password")
    if not valid_password(password):
        return error(PASSWORD_RULE)
    db = get_db()
    table = "students" if db.execute("SELECT 1 FROM students WHERE id=?", (user_id,)).fetchone() else "staff"
    if not db.execute(f"SELECT 1 FROM {table} WHERE id=?", (user_id,)).fetchone():
        return error("User not found.", 404)
    db.execute(f"UPDATE {table} SET password_hash=? WHERE id=?", (generate_password_hash(password), user_id))
    audit(staff["id"], "user_password_reset", user_id, "allowed", "password_reset")
    db.commit()
    return jsonify(ok=True)


@admin.get("/permissions")
@permission_required("users.manage")
def permissions_get(staff):
    return jsonify(permissions=PERMISSIONS, roles=ROLES, matrix={role: sorted(role_permissions(role)) for role in ROLES},
                   locked=["admin"])


@admin.put("/permissions/<role>")
@permission_required("users.manage")
def permissions_set(staff, role):
    granted = body().get("permissions")
    if role == "admin":
        return error("The administrator role always has every permission.", 409)
    if role not in ROLES:
        return error("Role not found.", 404)
    if not isinstance(granted, list) or not set(granted) <= set(PERMISSIONS):
        return error("Choose permissions from the list.")
    db = get_db()
    db.execute("DELETE FROM role_permissions WHERE role=?", (role,))
    db.executemany("INSERT INTO role_permissions VALUES (?,?)", [(role, p) for p in sorted(set(granted))])
    audit(staff["id"], "permissions_update", role, "allowed", ",".join(sorted(set(granted))) or "none")
    db.commit()
    return jsonify(matrix={r: sorted(role_permissions(r)) for r in ROLES})


# Settings and logs ----------------------------------------------------------

@admin.get("/settings")
@permission_required("settings.manage")
def settings_get(staff):
    return jsonify(items=all_settings(), model=current_app.config["GROQ_MODEL"], configured=bool(current_app.config["GROQ_API_KEY"]))


@admin.put("/settings")
@permission_required("settings.manage")
def settings_put(staff):
    data = body()
    if not data:
        return error("Send at least one setting.")
    try:
        cleaned = {key: validate(key, value) for key, value in data.items()}
    except ValueError as exc:
        return error(str(exc))
    db = get_db()
    for key, value in cleaned.items():
        db.execute("UPDATE settings SET value=? WHERE key=?", (json.dumps(value), key))
    audit(staff["id"], "settings_update", ",".join(sorted(cleaned)), "allowed", "saved")
    db.commit()
    return jsonify(items=all_settings())


@admin.get("/audit")
@permission_required("logs.view")
def audit_log(staff):
    clauses, args = [], []
    for field in ("actor", "action", "decision"):
        if request.args.get(field):
            clauses.append(f"{field} LIKE ?")
            args.append(request.args[field][:60] + "%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    limit, offset = page_args(100, 500)
    items = rows(f"SELECT * FROM audit {where} ORDER BY id DESC LIMIT ? OFFSET ?", (*args, limit, offset))
    total = get_db().execute(f"SELECT COUNT(*) FROM audit {where}", args).fetchone()[0]
    return jsonify(items=items, total=total)


@admin.get("/audit/export")
@permission_required("logs.view")
def audit_export(staff):
    audit(staff["id"], "audit_export", "audit", "allowed", "exported")
    get_db().commit()
    response = jsonify(exported_at=now(), exported_by=staff["id"], items=rows("SELECT * FROM audit ORDER BY id"))
    response.headers["Content-Disposition"] = 'attachment; filename="campus-desk-activity-log.json"'
    return response
