"""Persistent, owner-scoped conversation threads and bounded follow-up context selection."""
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

from .db import get_db, now, rows
from .privacy import sensitive

WITHHELD = "[Withheld: this message contained sensitive information and was not saved.]"
FOLLOWUP = re.compile(r"\b(that|it|its|those|this|these|they|them|yes|no|also|instead|same|more|again|why|then|what about|and)\b", re.I)


def short_title(text, limit=48):
    """A readable conversation title: one line, cut at a word boundary with an ellipsis."""
    text = " ".join(str(text).split())
    if len(text) <= limit:
        return text or "New conversation"
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",.;:-")
    return (cut or text[:limit]) + "…"


# Conversation names: the meaningful part of the first question, at most seven words.
TITLE_OPENERS = [re.compile(p, re.I) for p in (
    r"^(hi|hello|hey|good (morning|afternoon|evening))\b[\s,!.]*",
    r"^(please|kindly|pls)\s+",
    r"^(can|could|would|will) you\s+(please\s+)?",
    r"^(tell me|let me know|explain|show me|help me( with| to)?|check)\s+(about\s+)?",
    r"^i\s+(want|need|would like|'d like|wanted)\s+(to\s+)?(know\s+)?",
    r"^(what|how|when|where|why|which|who)('s|\s+(is|are|was|were|do|does|did|can|should|will|would))\s+(i\s+|we\s+)?",
    r"^(can|could|do|does|should|may|is|are|am)\s+(i|there|we)\s+",
)]
CLAUSE_BREAK = re.compile(r"[.?!;]|\s(?:if|when|because|since|so that|but|while|although)\s", re.I)
ALWAYS_DROP = {"my", "your", "please", "kindly", "just", "actually", "really"}
ARTICLES = {"a", "an", "the"}
TRAILING = {"and", "or", "of", "to", "for", "with", "on", "in", "at", "is", "are", "if", "about", "a", "an", "the"}
GREETING = re.compile(r"^\s*(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you)[\s!.,]*$", re.I)


def smart_title(question, max_words=7):
    """'What is my outstanding fee balance and the late fee if I miss the due date?'
    -> 'Outstanding fee balance and the late fee'. Deterministic; no model call."""
    text = " ".join(str(question).split())
    if not text:
        return "New conversation"
    if GREETING.match(text):
        return "Greeting"
    changed = True
    while changed:  # openers can stack: "Hi, could you please tell me what is ..."
        changed = False
        for pattern in TITLE_OPENERS:
            stripped = pattern.sub("", text, count=1)
            if stripped != text and stripped.strip():
                text, changed = stripped.strip(), True
    first = CLAUSE_BREAK.split(text, maxsplit=1)[0].strip()
    if len(first.split()) >= 2:
        text = first
    before_comma = text.split(",", 1)[0].strip()
    if before_comma != text and len(before_comma.split()) >= 3:  # "Ticket was not answered, who do I escalate to"
        text = before_comma
    words = [w.strip("\"'“”‘’()[]") for w in text.split()]
    words = [w for w in words if w and w.lower() not in ALWAYS_DROP | ARTICLES]
    words = words[:max_words]
    while len(words) > 1 and words[-1].lower().strip(",.:;?!") in TRAILING:
        words.pop()
    title = " ".join(words).strip(" ,.;:?!-")
    if not title:
        return "New conversation"
    return short_title(title[0].upper() + title[1:], 60)


def retitle_auto_threads(db):
    """One-time upgrade: conversations still named by the old rule (raw first question, cut by length)
    get a smart title. Conversations the student renamed are left alone."""
    if db.execute("SELECT 1 FROM settings WHERE key='titles_v2'").fetchone():
        return
    for thread in db.execute("SELECT id, title FROM threads").fetchall():
        first = db.execute("SELECT content FROM messages WHERE thread_id=? AND role='user' AND redacted=0 ORDER BY id LIMIT 1", (thread["id"],)).fetchone()
        if not first:
            continue
        question = first["content"]
        if thread["title"] in {short_title(question), question[:60], question[:60].strip(), short_title(question[:60])}:
            db.execute("UPDATE threads SET title=? WHERE id=?", (smart_title(question), thread["id"]))
    db.execute("INSERT OR IGNORE INTO settings VALUES ('titles_v2', '1')")


def create_thread(student_id, title):
    thread_id = uuid.uuid4().hex
    stamp = now()
    get_db().execute("INSERT INTO threads (id,student_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
                     (thread_id, student_id, short_title(title), stamp, stamp))
    return thread_id


def get_thread(student_id, thread_id):
    row = get_db().execute("SELECT * FROM threads WHERE id=? AND student_id=?", (thread_id, student_id)).fetchone()
    return dict(row) if row else None


def list_threads(student_id):
    return rows("""SELECT t.id, t.title, t.pinned, t.created_at, t.updated_at, COUNT(m.id) AS message_count
                   FROM threads t LEFT JOIN messages m ON m.thread_id=t.id
                   WHERE t.student_id=? GROUP BY t.id ORDER BY t.pinned DESC, t.updated_at DESC LIMIT 100""", (student_id,))


def add_message(thread_id, student_id, role, content, trace_id=None, meta=None, redacted=False):
    db = get_db()
    stamp = now()
    cursor = db.execute("INSERT INTO messages (thread_id,student_id,role,content,redacted,trace_id,meta,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (thread_id, student_id, role, content, int(redacted), trace_id, json.dumps(meta or {}), stamp))
    db.execute("UPDATE threads SET updated_at=? WHERE id=?", (stamp, thread_id))
    return cursor.lastrowid


def thread_messages(thread_id):
    return [{**m, "meta": json.loads(m["meta"]), "redacted": bool(m["redacted"])}
            for m in rows("SELECT id,role,content,redacted,trace_id,meta,created_at FROM messages WHERE thread_id=? ORDER BY id", (thread_id,))]


def recent_exchanges(thread_id, exchanges):
    """The last N user/assistant pairs, excluding withheld messages, oldest first."""
    if exchanges <= 0:
        return []
    recent = rows("SELECT role,content FROM messages WHERE thread_id=? AND redacted=0 ORDER BY id DESC LIMIT ?", (thread_id, exchanges * 2))
    return [{"role": m["role"], "content": m["content"][:2000]} for m in reversed(recent)]


def select_context(thread_id, question, exchanges):
    """Include earlier turns only for a follow-up, a short reply or an answer to a clarifying question."""
    history = recent_exchanges(thread_id, exchanges)
    if not history:
        return []
    last_answer = next((m["content"] for m in reversed(history) if m["role"] == "assistant"), "")
    followup = FOLLOWUP.search(question) or len(question.split()) <= 6 or last_answer.rstrip().endswith("?")
    return history if followup else []


def ticket_context(thread_id, question=None, limit=6):
    """A bounded, filtered copy of the conversation attached to a ticket at creation time."""
    captured = [{"role": m["role"], "content": m["content"][:1000]}
                for m in reversed(rows("SELECT role,content FROM messages WHERE thread_id=? AND redacted=0 ORDER BY id DESC LIMIT ?", (thread_id, limit)))] if thread_id else []
    if question and not sensitive(question):
        captured.append({"role": "user", "content": question[:1000]})
    return captured[-limit:]


def purge_expired(days):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    db = get_db()
    db.execute("DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE updated_at<?)", (cutoff,))
    db.execute("DELETE FROM threads WHERE updated_at<?", (cutoff,))
