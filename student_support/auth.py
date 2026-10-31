"""Roles, permissions and route guards. Enforced in Python, never delegated to the model."""
import re
from functools import wraps

from flask import jsonify, session

PERMISSIONS = {
    "kb.manage": "Manage knowledge base documents",
    "tickets.view": "View the ticket queue",
    "tickets.manage": "Assign, update and resolve tickets",
    "chats.view": "Read student chat history",
    "users.manage": "Manage users, roles and permissions",
    "settings.manage": "Change system settings",
    "logs.view": "View activity logs",
    "approvals.decide": "Approve or decline student record changes",
}
ROLES = {"admin": "Administrator", "support_agent": "Support agent"}
DEFAULT_PERMISSIONS = {"support_agent": ["tickets.view", "tickets.manage", "chats.view"]}
PASSWORD_RULE = "Passwords need at least 10 characters, including a letter and a number."


def seed_permissions(db):
    for role, permissions in DEFAULT_PERMISSIONS.items():
        if not db.execute("SELECT 1 FROM role_permissions WHERE role=?", (role,)).fetchone():
            db.executemany("INSERT INTO role_permissions VALUES (?,?)", [(role, p) for p in permissions])


def role_permissions(role):
    from .db import rows
    # The admin role always holds every permission so it can never lock itself out.
    if role == "admin":
        return set(PERMISSIONS)
    return {r["permission"] for r in rows("SELECT permission FROM role_permissions WHERE role=?", (role,))} & set(PERMISSIONS)


def current_staff():
    from .db import get_db
    staff_id = session.get("staff_id")
    if not staff_id:
        return None
    row = get_db().execute("SELECT id,name,email,role,active FROM staff WHERE id=?", (staff_id,)).fetchone()
    return dict(row) if row and row["active"] else None


def student_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("student_id"):
            return jsonify(error="This page is for students. Staff use the admin panel."), 403
        return view(*args, **kwargs)
    return wrapped


def permission_required(permission):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            staff = current_staff()
            if not staff:
                return jsonify(error="Staff sign-in required."), 403
            if permission and permission not in role_permissions(staff["role"]):
                from .db import audit, get_db
                audit(staff["id"], "permission_check", permission, "denied", "missing_permission")
                get_db().commit()
                return jsonify(error="Your role does not have permission for this action."), 403
            return view(staff, *args, **kwargs)
        return wrapped
    return decorator


def valid_password(password):
    return isinstance(password, str) and 10 <= len(password) <= 200 and re.search(r"[A-Za-z]", password) and re.search(r"\d", password)
