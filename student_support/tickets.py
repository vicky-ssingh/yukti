"""Support tickets: creation from chat, status and priority tracking, assignment and history."""
import json
import sqlite3
import uuid

from .db import audit, get_db, now, rows
from .settings import PRIORITIES, get_setting

CATEGORIES = ["finance", "scholarship", "academic", "general"]
STATUSES = ["open", "in_progress", "waiting_on_student", "resolved", "closed"]
CLOSED = {"resolved", "closed"}
SUMMARY = """t.id, t.student_id, t.subject, t.category, t.description, t.status, t.priority, t.assigned_to,
             s.name AS assigned_name, t.created_at, t.updated_at, t.resolved_at, t.resolution, t.thread_id, t.source"""


def add_event(ticket_id, actor, actor_role, event, detail="", internal=False):
    get_db().execute("INSERT INTO ticket_events (ticket_id,actor,actor_role,event,detail,internal,created_at) VALUES (?,?,?,?,?,?,?)",
                     (ticket_id, actor, actor_role, event, detail[:2000], int(internal), now()))
    get_db().execute("UPDATE tickets SET updated_at=? WHERE id=?", (now(), ticket_id))


def create_ticket(student_id, category, description, run_id, subject=None, priority=None, thread_id=None, context=None, source="chat_agent"):
    db = get_db()
    priority = priority or get_setting("default_ticket_priority")
    subject = (subject or description.split(".")[0])[:120]
    for _ in range(5):
        ticket_id = "TKT-" + uuid.uuid4().hex[:8].upper()
        try:
            db.execute("""INSERT INTO tickets (id,student_id,category,description,status,created_at,run_id,subject,priority,updated_at,thread_id,context,source)
                          VALUES (?,?,?,?, 'open',?,?,?,?,?,?,?,?)""",
                       (ticket_id, student_id, category, description, now(), run_id, subject, priority, now(), thread_id, json.dumps(context or []), source))
            break
        except sqlite3.IntegrityError as exc:
            if "tickets.id" not in str(exc):
                raise
    add_event(ticket_id, student_id, "student", "created", f"Priority {priority}. Raised from {'the chat assistant' if source == 'chat_agent' else 'a chat message'}.")
    return ticket_id


def student_tickets(student_id, limit=100):
    return rows(f"SELECT {SUMMARY} FROM tickets t LEFT JOIN staff s ON s.id=t.assigned_to WHERE t.student_id=? ORDER BY t.updated_at DESC LIMIT ?", (student_id, limit))


def ticket_detail(ticket_id, student_id=None, include_internal=False):
    """Owner-scoped when student_id is given. Internal staff notes are never returned to students."""
    sql = f"SELECT {SUMMARY}, t.context, st.name AS student_name FROM tickets t LEFT JOIN staff s ON s.id=t.assigned_to JOIN students st ON st.id=t.student_id WHERE t.id=?"
    args = [ticket_id]
    if student_id is not None:
        sql += " AND t.student_id=?"
        args.append(student_id)
    row = get_db().execute(sql, args).fetchone()
    if not row:
        return None
    ticket = dict(row)
    ticket["context"] = json.loads(ticket["context"] or "[]")
    events = rows("""SELECT e.id, e.actor, e.actor_role, e.event, e.detail, e.internal, e.created_at,
                     COALESCE(s.name, st.name, e.actor) AS actor_name
                     FROM ticket_events e LEFT JOIN staff s ON s.id=e.actor LEFT JOIN students st ON st.id=e.actor
                     WHERE e.ticket_id=? ORDER BY e.id""", (ticket_id,))
    ticket["events"] = [{**e, "internal": bool(e["internal"])} for e in events if include_internal or not e["internal"]]
    return ticket


def staff_update(staff, ticket_id, changes):
    """Apply validated assignment, status and priority changes, one event and audit row each."""
    db = get_db()
    ticket = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not ticket:
        raise LookupError("Ticket not found.")
    if "assigned_to" in changes:
        assignee = changes["assigned_to"]
        if assignee is not None and not db.execute("SELECT 1 FROM staff WHERE id=? AND active=1", (assignee,)).fetchone():
            raise ValueError("Choose an active staff member.")
        if assignee != ticket["assigned_to"]:
            db.execute("UPDATE tickets SET assigned_to=? WHERE id=?", (assignee, ticket_id))
            name = db.execute("SELECT name FROM staff WHERE id=?", (assignee,)).fetchone() if assignee else None
            add_event(ticket_id, staff["id"], staff["role"], "assigned", f"Assigned to {name['name']}." if name else "Unassigned.")
            audit(staff["id"], "ticket_assign", ticket_id, "allowed", "assigned" if assignee else "unassigned")
    if "priority" in changes and changes["priority"] != ticket["priority"]:
        if changes["priority"] not in PRIORITIES:
            raise ValueError("Choose a valid priority.")
        db.execute("UPDATE tickets SET priority=? WHERE id=?", (changes["priority"], ticket_id))
        add_event(ticket_id, staff["id"], staff["role"], "priority_changed", f"Priority {ticket['priority']} → {changes['priority']}.")
        audit(staff["id"], "ticket_priority", ticket_id, "allowed", changes["priority"])
    if "status" in changes and changes["status"] != ticket["status"]:
        status = changes["status"]
        if status not in STATUSES or status == "resolved":
            raise ValueError("Choose a valid status. Use Resolve to add a resolution.")
        db.execute("UPDATE tickets SET status=?, resolved_at=CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, ?) ELSE NULL END WHERE id=?",
                   (status, status, now(), ticket_id))
        add_event(ticket_id, staff["id"], staff["role"], "status_changed", f"Status {ticket['status'].replace('_', ' ')} → {status.replace('_', ' ')}.")
        audit(staff["id"], "ticket_status", ticket_id, "allowed", status)


def resolve(staff, ticket_id, resolution):
    db = get_db()
    if not db.execute("SELECT 1 FROM tickets WHERE id=?", (ticket_id,)).fetchone():
        raise LookupError("Ticket not found.")
    db.execute("UPDATE tickets SET status='resolved', resolution=?, resolved_at=? WHERE id=?", (resolution, now(), ticket_id))
    add_event(ticket_id, staff["id"], staff["role"], "resolved", resolution)
    audit(staff["id"], "ticket_resolve", ticket_id, "allowed", "resolved")


def student_comment(student_id, ticket_id, body):
    db = get_db()
    ticket = db.execute("SELECT status FROM tickets WHERE id=? AND student_id=?", (ticket_id, student_id)).fetchone()
    if not ticket:
        raise LookupError("Ticket not found.")
    if ticket["status"] == "closed":
        raise ValueError("This ticket is closed. Raise a new ticket instead.")
    add_event(ticket_id, student_id, "student", "comment", body)
    if ticket["status"] in ("waiting_on_student", "resolved"):
        db.execute("UPDATE tickets SET status='open', resolved_at=NULL WHERE id=?", (ticket_id,))
        add_event(ticket_id, student_id, "student", "status_changed", f"Status {ticket['status'].replace('_', ' ')} → open after a student reply.")
    audit(student_id, "ticket_comment", ticket_id, "allowed", "comment_added")
