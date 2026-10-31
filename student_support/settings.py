"""Admin-editable system settings with typed validation."""
import json

PRIORITIES = ["low", "normal", "high", "urgent"]
SETTINGS = {
    "retrieval_top_k": {"label": "Policy sections per search", "type": "int", "min": 1, "max": 4, "default": 2},
    "context_exchanges": {"label": "Recent exchanges used for follow-ups", "type": "int", "min": 0, "max": 4, "default": 2},
    "default_ticket_priority": {"label": "Default ticket priority", "type": "choice", "choices": PRIORITIES, "default": "normal"},
    "student_can_close_tickets": {"label": "Students can close their own tickets", "type": "bool", "default": True},
    "chat_retention_days": {"label": "Keep chat history for (days)", "type": "int", "min": 1, "max": 365, "default": 90},
    "scope_guard": {"label": "Decline clearly off-topic requests before the model", "type": "bool", "default": True},
    "announcement": {"label": "Announcement shown to students", "type": "text", "max": 200, "default": ""},
}


def seed_settings(db):
    for key, spec in SETTINGS.items():
        db.execute("INSERT OR IGNORE INTO settings VALUES (?,?)", (key, json.dumps(spec["default"])))
    db.execute("INSERT OR IGNORE INTO settings VALUES ('kb_revision', '0')")


def get_setting(key):
    from .db import get_db
    row = get_db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else SETTINGS[key]["default"]


def all_settings():
    return {key: {**spec, "value": get_setting(key)} for key, spec in SETTINGS.items()}


def validate(key, value):
    """Return the cleaned value or raise ValueError with a readable message."""
    spec = SETTINGS.get(key)
    if not spec:
        raise ValueError(f"Unknown setting: {key}.")
    kind = spec["type"]
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, int) or not spec["min"] <= value <= spec["max"]:
            raise ValueError(f"{spec['label']} must be a whole number from {spec['min']} to {spec['max']}.")
    elif kind == "bool":
        if not isinstance(value, bool):
            raise ValueError(f"{spec['label']} must be on or off.")
    elif kind == "choice":
        if value not in spec["choices"]:
            raise ValueError(f"{spec['label']} must be one of: {', '.join(spec['choices'])}.")
    elif kind == "text":
        if not isinstance(value, str) or len(value) > spec["max"]:
            raise ValueError(f"{spec['label']} must be text of at most {spec['max']} characters.")
        value = value.strip()
    return value
