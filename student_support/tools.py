import json
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from .db import audit, get_db, now
from .privacy import MEMORY_KEYS, MEMORY_VALUES, memory_consent, sensitive
from .settings import PRIORITIES
from .tickets import CATEGORIES, create_ticket, student_tickets, ticket_detail

EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
SENSITIVE_TOOLS = ("request_programme_change", "request_email_change")
# Who decides each change, and how long the request stays open for that reviewer.
REVIEW = {"programme": ("student", timedelta(minutes=30)), "email": ("staff", timedelta(days=7))}


def definition(name, description, properties=None, required=None, private=False):
    properties = dict(properties or {})
    if private:
        properties["student_id"] = {"type": "string", "description": "Optional requested student ID. Only the signed-in student's ID is allowed."}
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": required or [], "additionalProperties": False}}}


TEXT = {"type": "string"}
DEFINITIONS = [
    definition("get_student_record", "Read the signed-in student's name, programme and email.", private=True),
    definition("get_fee_status", "Read actual fees, payments, outstanding balance and due date. Always use for personal fee questions.", private=True),
    definition("get_scholarship_status", "Read the signed-in student's recorded scholarship status and amount.", private=True),
    definition("search_policy", "Retrieve relevant handbook excerpts. Use for policy questions; cite chunk IDs. Empty results mean the handbook does not answer the question.", {"query": TEXT}, ["query"]),
    definition("create_support_request", "Create a support ticket when the student explicitly asks for one. Support staff see it in the Yukti admin panel; no email is sent. The recent conversation is attached automatically. Ask for a missing category or description. Never include secrets.",
               {"category": {"type": "string", "enum": CATEGORIES}, "description": TEXT,
                "subject": {"type": "string", "description": "Optional short title."},
                "priority": {"type": "string", "enum": PRIORITIES, "description": "Optional. Use high only for due-date or blocking issues."}},
               ["category", "description"], True),
    definition("list_support_requests", "List the signed-in student's support tickets with status, priority, assignee and latest update.", private=True),
    definition("get_ticket_details", "Read one of the signed-in student's tickets with its public history and resolution.", {"ticket_id": TEXT}, ["ticket_id"], True),
    definition("remember_preference", "Remember an explicitly requested safe fact only. The user must say remember/save and provide the exact allowed value. hostel_room values look like B-204.",
               {"key": {"type": "string", "enum": MEMORY_KEYS}, "value": TEXT}, ["key", "value"], True),
    definition("request_programme_change", "Propose a sensitive programme change. Returns pending approval; does NOT change the record. Student must confirm using the app button.",
               {"programme": {"type": "string", "enum": MEMORY_VALUES["programme"]}}, ["programme"], True),
    definition("request_email_change", "Request a change of the registered email to an address the student has given. Only call it with the exact new address; if none was given, ask for it first. Creates a ticket for support staff, who approve or decline it in the admin panel. Does NOT change the record.",
               {"email": TEXT}, ["email"], True),
]


class ToolError(Exception):
    pass


class ToolService:
    def __init__(self, actor, run_id, question, handbook, profile="a2", thread_id=None, conversation=None):
        self.actor, self.run_id, self.question = actor, run_id, question
        self.handbook = handbook
        self.thread_id, self.conversation = thread_id, conversation or []
        self.ownership_denied = False
        self.definitions = [d for d in DEFINITIONS if profile == "a2" or d["function"]["name"] not in SENSITIVE_TOOLS]

    def execute(self, name, arguments):
        db = get_db()
        schema = next((d["function"]["parameters"] for d in self.definitions if d["function"]["name"] == name), None)
        if not schema:
            return self._fail("unknown_tool", "Unknown or unavailable tool.", "unknown_tool")
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else arguments
            if not isinstance(args, dict):
                raise ToolError("Tool arguments must be an object.")
            if set(args) - set(schema["properties"]) or set(schema["required"]) - set(args):
                raise ToolError("Missing or unexpected tool arguments.")
            for key, value in args.items():
                field = schema["properties"][key]
                if not isinstance(value, str) or not value.strip() or len(value) > 2000:
                    raise ToolError("Arguments must be nonempty text of at most 2000 characters.")
                if "enum" in field and value not in field["enum"]:
                    raise ToolError("Unsupported option. Ask the student to select an available option.")
            target = args.get("student_id", self.actor)
            if target != self.actor:
                self.ownership_denied = True
                audit(self.actor, name, "another_student", "denied", "ownership_mismatch", self.run_id)
                db.commit()
                return {"ok": False, "error": "Access denied. You may only access your own private student data.", "decision": "denied"}
            if any(sensitive(v) for k, v in args.items() if k not in ("student_id", "key")):
                raise ToolError("Sensitive content cannot be submitted to this tool.")
            result = self._dispatch(name, args)
            status = "pending" if result.get("approval") else None
            audit(self.actor, name, self.actor, "allowed", "pending_confirmation" if status else "success", self.run_id, status)
            db.commit()
            return {"ok": True, "decision": "allowed", **result}
        except (ValueError, TypeError, ToolError) as exc:
            db.rollback()
            message = str(exc) if isinstance(exc, ToolError) else "Malformed tool arguments. Please provide the missing information."
            return self._fail(name, message, "invalid_arguments")
        except Exception:
            db.rollback()
            # No raw exception text or arbitrary arguments in the audit trail.
            return self._fail(name, "The tool is temporarily unavailable. No successful change is confirmed.", "tool_error")

    def _fail(self, name, message, result):
        audit(self.actor, name, self.actor, "denied" if result != "tool_error" else "error", result, self.run_id)
        get_db().commit()
        return {"ok": False, "error": message, "decision": "error" if result == "tool_error" else "denied"}

    def _dispatch(self, name, args):
        db = get_db()
        if name == "search_policy":
            return {"chunks": self.handbook.search(args["query"]), "notice": "Use only matching evidence. If insufficient, say so and offer escalation."}
        if name in ("get_student_record", "get_fee_status", "get_scholarship_status"):
            columns = {"get_student_record": "id,name,programme,email", "get_fee_status": "fee_total,fee_paid,fee_due",
                       "get_scholarship_status": "scholarship,scholarship_status,scholarship_amount"}[name]
            record = db.execute(f"SELECT {columns} FROM students WHERE id=?", (self.actor,)).fetchone()
            if not record:
                raise ToolError("Your record was not found. Contact student services.")
            data = dict(record)
            if name == "get_fee_status":
                data.update(outstanding=data["fee_total"] - data["fee_paid"], currency="INR")
            if name == "get_scholarship_status":
                data["currency"] = "INR"
            return {"record": data}
        if name == "list_support_requests":
            tickets = student_tickets(self.actor, 20)
            for ticket in tickets:
                events = ticket_detail(ticket["id"], self.actor)["events"]
                ticket["latest_update"] = events[-1]["detail"] if events else None
                ticket.pop("thread_id", None)
            return {"tickets": tickets}
        if name == "get_ticket_details":
            ticket = ticket_detail(args["ticket_id"].strip().upper(), self.actor)
            if not ticket:
                raise ToolError("No ticket with that ID belongs to you.")
            ticket.pop("context", None)
            return {"ticket": ticket}
        if name == "create_support_request":
            # Deduplicate retries within this run without silently discarding future requests.
            existing = db.execute("SELECT id FROM tickets WHERE student_id=? AND run_id=? AND category=? AND description=?",
                                  (self.actor, self.run_id, args["category"], args["description"])).fetchone()
            ticket_id = existing["id"] if existing else create_ticket(
                self.actor, args["category"], args["description"], self.run_id, args.get("subject"),
                args.get("priority"), self.thread_id, self.conversation, "chat_agent")
            priority = db.execute("SELECT priority FROM tickets WHERE id=?", (ticket_id,)).fetchone()["priority"]
            return {"ticket_id": ticket_id, "status": "open", "priority": priority, "delivery": "campus_desk_queue",
                    "notice": "Saved in the Yukti ticket queue with the recent conversation attached. Support staff review it in the admin panel and updates appear under Support tickets. No email is sent and no response time is guaranteed."}
        if name == "remember_preference":
            if not memory_consent(self.question, args["key"], args["value"]):
                raise ToolError("Memory was not saved. Explicitly ask to remember an allowed preference; temporary or sensitive facts are never saved.")
            db.execute("INSERT INTO memory VALUES (?,?,?,?) ON CONFLICT(student_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                       (self.actor, args["key"], args["value"], now()))
            return {"remembered": {"key": args["key"], "value": args["value"]}}
        if name in SENSITIVE_TOOLS:
            field = "programme" if name == "request_programme_change" else "email"
            value = args[field].strip()
            if field == "email":
                value = value.lower()
                if not EMAIL.fullmatch(value):
                    raise ToolError("That does not look like a valid email address.")
                if db.execute("SELECT 1 FROM students WHERE lower(email)=? AND id<>?", (value, self.actor)).fetchone():
                    raise ToolError("That email address cannot be used. Choose a different address.")
            current = db.execute(f"SELECT {field} FROM students WHERE id=?", (self.actor,)).fetchone()[0]
            if current.lower() == value.lower():
                raise ToolError(f"Your {field} is already {value}; no change is needed.")
            reviewer, lifetime = REVIEW[field]
            waiting = ("Awaiting student confirmation in Approvals." if reviewer == "student"
                       else "Sent to support staff for approval; they approve or decline it in the admin panel.") + " No record has changed."
            existing = db.execute("SELECT * FROM approvals WHERE student_id=? AND field=? AND status='pending' AND new_value=? AND expires_at>?",
                                  (self.actor, field, value, now())).fetchone()
            if existing:
                result = {"approval": dict(existing), "message": waiting}
                if existing["ticket_id"]:
                    result["ticket_id"] = existing["ticket_id"]
                return result
            ticket_id = None
            if reviewer == "staff":
                ticket_id = create_ticket(self.actor, "general", f"Registered email change requested: {current} → {value}. "
                                          "The record changes only after support staff approve this request.", self.run_id,
                                          "Registered email change request", None, self.thread_id, self.conversation, "approval_request")
            approval_id = uuid.uuid4().hex
            expiry = (datetime.now(timezone.utc) + lifetime).isoformat()
            db.execute("""INSERT INTO approvals (id,student_id,field,old_value,new_value,status,created_at,expires_at,decided_at,run_id,reviewer,ticket_id)
                          VALUES (?,?,?,?,?, 'pending',?,?,NULL,?,?,?)""",
                       (approval_id, self.actor, field, current, value, now(), expiry, self.run_id, reviewer, ticket_id))
            result = {"approval": dict(db.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()), "message": waiting}
            if ticket_id:
                result["ticket_id"] = ticket_id
            return result
        raise ToolError("Unavailable tool.")


def account_summary(student_id, fees=True, scholarship=True):
    """Fee and scholarship figures read straight from the record (never from the model) for the
    profile page and the breakdown card shown under an answer."""
    row = get_db().execute("SELECT fee_total,fee_paid,fee_due,scholarship,scholarship_status,scholarship_amount FROM students WHERE id=?",
                           (student_id,)).fetchone()
    if not row:
        return {}
    summary = {"currency": "INR"}
    if fees:
        outstanding = max((row["fee_total"] or 0) - (row["fee_paid"] or 0), 0)
        try:
            days = (date.fromisoformat(row["fee_due"]) - date.today()).days
        except (TypeError, ValueError):
            days = None
        summary["fees"] = {"total": row["fee_total"], "paid": row["fee_paid"], "outstanding": outstanding, "due": row["fee_due"],
                           "days_to_due": days, "status": "paid" if not outstanding else "overdue" if days is not None and days < 0 else "due"}
    if scholarship and row["scholarship"]:
        summary["scholarship"] = {"name": row["scholarship"], "status": row["scholarship_status"], "amount": row["scholarship_amount"]}
    return summary


def _apply_decision(db, row, decision):
    """Shared atomic check-and-update for one pending approval row. Returns (status, http code)."""
    if row["expires_at"] <= now():
        return "expired", 409
    if decision == "reject":
        return "rejected", 200
    field = {"programme": "programme", "email": "email"}[row["field"]]
    student = row["student_id"]
    current = db.execute(f"SELECT {field} FROM students WHERE id=?", (student,)).fetchone()[0]
    if current != row["old_value"]:
        return "stale", 409
    if field == "email" and db.execute("SELECT 1 FROM students WHERE lower(email)=? AND id<>?", (row["new_value"].lower(), student)).fetchone():
        return "conflict", 409
    db.execute(f"UPDATE students SET {field}=? WHERE id=?", (row["new_value"], student))
    if field == "programme":
        db.execute("DELETE FROM memory WHERE student_id=? AND key='programme'", (student,))
    return "approved", 200


def decide_approval(actor, approval_id, decision):
    """The student's own decision. Not registered as an LLM tool."""
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT * FROM approvals WHERE id=? AND student_id=?", (approval_id, actor)).fetchone()
        if not row:
            audit(actor, "decide_approval", "unavailable_approval", "denied", "not_found")
            db.commit()
            return {"error": "Approval not found."}, 404
        if row["reviewer"] != "student":
            audit(actor, "decide_approval", actor, "denied", "staff_review_required", row["run_id"], row["status"])
            db.commit()
            return {"error": f"Support staff review this request. Track it on ticket {row['ticket_id']}.", "ticket_id": row["ticket_id"]}, 403
        if row["status"] != "pending":
            audit(actor, "decide_approval", actor, "denied", "already_decided", row["run_id"], row["status"])
            db.commit()
            return {"error": "This request has already been decided.", "status": row["status"]}, 409
        status, code = _apply_decision(db, row, decision)
        db.execute("UPDATE approvals SET status=?,decided_at=?,decided_by=? WHERE id=? AND student_id=?", (status, now(), actor, approval_id, actor))
        audit(actor, "decide_approval", actor, "approved" if status == "approved" else "not_executed",
              f"{row['field']}_updated" if status == "approved" else status, row["run_id"], status)
        db.commit()
        return {"status": status, "executed": status == "approved", "new_value": row["new_value"]}, code
    except Exception:
        db.rollback()
        raise


def staff_decide_approval(staff, approval_id, decision, note):
    """A staff member approves or declines a staff-reviewed change and closes out its ticket."""
    from .tickets import add_event
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()
        if not row or row["reviewer"] != "staff":
            db.rollback()
            return {"error": "Approval not found."}, 404
        if row["status"] != "pending":
            audit(staff["id"], "decide_approval", row["student_id"], "denied", "already_decided", row["run_id"], row["status"])
            db.commit()
            return {"error": "This request has already been decided.", "status": row["status"]}, 409
        status, code = _apply_decision(db, row, decision)
        db.execute("UPDATE approvals SET status=?,decided_at=?,decided_by=?,decision_note=? WHERE id=?", (status, now(), staff["id"], note, approval_id))
        audit(staff["id"], "decide_approval", row["student_id"], "approved" if status == "approved" else "not_executed",
              f"{row['field']}_updated" if status == "approved" else status, row["run_id"], status)
        if row["ticket_id"]:
            outcome = {"approved": f"Approved. Registered email changed to {row['new_value']}.",
                       "rejected": "Declined. The registered email was not changed.",
                       "expired": "The request expired before a decision. The registered email was not changed.",
                       "stale": "The record changed after this request was made, so it was not applied.",
                       "conflict": "That address now belongs to another account, so it was not applied."}[status]
            resolution = outcome + (f" Note: {note}" if note else "")
            add_event(row["ticket_id"], staff["id"], staff["role"], "approval_" + ("approved" if status == "approved" else "declined"), resolution)
            db.execute("UPDATE tickets SET status='resolved', resolution=?, resolved_at=? WHERE id=?", (resolution, now(), row["ticket_id"]))
        db.commit()
        return {"status": status, "executed": status == "approved", "new_value": row["new_value"]}, code
    except Exception:
        db.rollback()
        raise
