"""SQLite persistence. Every private read is explicitly scoped by its owner."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from flask import current_app, g
from werkzeug.security import generate_password_hash

DEMO_PASSWORD = "CampusDemo!2026"
STAFF_DEMO_PASSWORD = "StaffDemo!2026"
STAFF_SEED = [
    {"id": "ADM001", "name": "Vicky Singh", "email": "priya.nair@example.edu", "role": "admin"},
    {"id": "SUP001", "name": "Ayush Kumar", "email": "arjun.rao@example.edu", "role": "support_agent"},
]


def now():
    return datetime.now(timezone.utc).isoformat()


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"], timeout=15)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


def close_db(_error=None):
    db = g.pop("db", None)
    if db:
        db.close()


def add_columns(db, table, columns):
    """Additive migration for databases created by earlier versions."""
    existing = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    for name, ddl in columns:
        if name not in existing:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def init_db():
    db = get_db()
    db.executescript("""
    CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, programme TEXT NOT NULL,
        email TEXT NOT NULL, password_hash TEXT NOT NULL,
        fee_total INTEGER, fee_paid INTEGER, fee_due TEXT,
        scholarship TEXT, scholarship_status TEXT, scholarship_amount INTEGER
    );
    CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
        role TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(role, permission)
    );
    CREATE TABLE IF NOT EXISTS memory (
        student_id TEXT NOT NULL REFERENCES students(id), key TEXT NOT NULL,
        value TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(student_id,key)
    );
    CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
        category TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, run_id TEXT NOT NULL,
        UNIQUE(student_id,run_id,category,description)
    );
    CREATE TABLE IF NOT EXISTS ticket_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL REFERENCES tickets(id),
        actor TEXT NOT NULL, actor_role TEXT NOT NULL, event TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '', internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
        field TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        decided_at TEXT, run_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
        actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
        decision TEXT NOT NULL, approval_status TEXT, result TEXT NOT NULL, run_id TEXT
    );
    CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
        created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
        title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
        redacted INTEGER NOT NULL DEFAULT 0, trace_id TEXT, meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
        content TEXT NOT NULL, questions TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
        error TEXT, chunk_count INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, indexed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
    CREATE INDEX IF NOT EXISTS events_ticket ON ticket_events(ticket_id, id);
    """)
    add_columns(db, "students", [("active", "INTEGER NOT NULL DEFAULT 1")])
    add_columns(db, "threads", [("pinned", "INTEGER NOT NULL DEFAULT 0")])
    add_columns(db, "tickets", [("subject", "TEXT"), ("priority", "TEXT NOT NULL DEFAULT 'normal'"),
                                ("assigned_to", "TEXT"), ("updated_at", "TEXT"), ("resolved_at", "TEXT"),
                                ("resolution", "TEXT"), ("thread_id", "TEXT"), ("context", "TEXT NOT NULL DEFAULT '[]'"),
                                ("source", "TEXT NOT NULL DEFAULT 'chat_agent'")])
    # reviewer: who may decide. 'student' confirms their own programme change; 'staff' approve email changes.
    add_columns(db, "approvals", [("reviewer", "TEXT NOT NULL DEFAULT 'student'"), ("ticket_id", "TEXT"),
                                  ("decided_by", "TEXT"), ("decision_note", "TEXT")])
    seed = json.loads((Path(current_app.root_path).parent / "data/students.json").read_text())
    for student in seed:
        db.execute("""INSERT OR IGNORE INTO students
            (id,name,programme,email,password_hash,fee_total,fee_paid,fee_due,scholarship,scholarship_status,scholarship_amount)
            VALUES (:id,:name,:programme,:email,:password_hash,:fee_total,:fee_paid,:fee_due,
             :scholarship,:scholarship_status,:scholarship_amount)""",
            {**student, "password_hash": generate_password_hash(DEMO_PASSWORD)})
    staff_password = os.getenv("SEED_STAFF_PASSWORD") or STAFF_DEMO_PASSWORD
    for member in STAFF_SEED:
        db.execute("INSERT OR IGNORE INTO staff (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,1,?)",
                   (member["id"], member["name"], member["email"], generate_password_hash(staff_password), member["role"], now()))
    from .auth import seed_permissions
    from .knowledge import seed_documents
    from .settings import seed_settings
    seed_permissions(db)
    seed_settings(db)
    db.commit()
    seed_documents(db)
    from .context import retitle_auto_threads
    retitle_auto_threads(db)
    db.commit()


def audit(actor, action, target, decision, result, run_id=None, approval_status=None):
    # Metadata only. Never pass arbitrary model arguments, chat text or provider exceptions.
    get_db().execute("""INSERT INTO audit
        (timestamp,actor,action,target,decision,approval_status,result,run_id)
        VALUES (?,?,?,?,?,?,?,?)""",
        (now(), actor, action, target, decision, approval_status, result, run_id))


def rows(sql, args=()):
    return [dict(row) for row in get_db().execute(sql, args).fetchall()]
