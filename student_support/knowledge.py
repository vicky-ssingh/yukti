"""Indexed knowledge base: documents in SQLite, split into cited sections, ranked lexically."""
import json
import re
from pathlib import Path
from threading import Lock

from .db import get_db, now, rows
from .retrieval import index_tokens, rank, split_sections
from .settings import get_setting

CATEGORIES = ["General", "Finance", "Scholarship", "Academics", "Support", "Privacy", "Calendar", "Account"]
CHUNK_ID = re.compile(r"^[A-Z][A-Z0-9]{1,15}-\d{2,3}$")
MAX_CONTENT = 200_000
MAX_SECTIONS = 60


class KnowledgeError(ValueError):
    pass


def parse(document_id, title, content):
    """Split content into sections. Headings 'ID | Title' keep their ID; others get DOC<id>-NN."""
    _, sections = split_sections(content)
    if not sections:
        body = re.sub(r"^#.*$", "", content, flags=re.M).strip()
        sections = [(title, body)] if body else []
    if not sections:
        raise KnowledgeError("The document has no text to index.")
    if len(sections) > MAX_SECTIONS:
        raise KnowledgeError(f"The document has more than {MAX_SECTIONS} sections. Split it into smaller documents.")
    chunks, seen = [], set()
    for position, (heading, body) in enumerate(sections, 1):
        chunk_id, _, chunk_title = heading.partition(" | ")
        if not chunk_title:
            chunk_id, chunk_title = f"DOC{document_id}-{position:02d}", heading
        chunk_id = chunk_id.strip().upper()
        if not CHUNK_ID.match(chunk_id):
            raise KnowledgeError(f"Section ID '{chunk_id}' must look like LATE-07 (capital letters, a dash and two digits).")
        if chunk_id in seen:
            raise KnowledgeError(f"Section ID {chunk_id} appears twice in this document.")
        if not body:
            raise KnowledgeError(f"Section {chunk_id} has a heading but no text.")
        seen.add(chunk_id)
        chunks.append({"id": chunk_id, "position": position, "title": chunk_title.strip()[:200], "text": body})
    return chunks


def bump_revision(db):
    db.execute("UPDATE settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='kb_revision'")


def index_document(db, document_id):
    """Rebuild one document's sections. Leaves status 'indexed' or 'failed' with a readable error."""
    doc = db.execute("SELECT * FROM kb_documents WHERE id=?", (document_id,)).fetchone()
    db.execute("UPDATE kb_documents SET status='processing', error=NULL WHERE id=?", (document_id,))
    try:
        chunks = parse(document_id, doc["title"], doc["content"])
        clash = db.execute(f"SELECT id FROM kb_chunks WHERE document_id<>? AND id IN ({','.join('?' * len(chunks))})",
                           (document_id, *[c["id"] for c in chunks])).fetchone()
        if clash:
            raise KnowledgeError(f"Section ID {clash['id']} is already used by another document.")
        db.execute("DELETE FROM kb_chunks WHERE document_id=?", (document_id,))
        db.executemany("INSERT INTO kb_chunks VALUES (?,?,?,?,?)",
                       [(c["id"], document_id, c["position"], c["title"], c["text"]) for c in chunks])
        db.execute("UPDATE kb_documents SET status='indexed', chunk_count=?, indexed_at=? WHERE id=?", (len(chunks), now(), document_id))
    except KnowledgeError as exc:
        db.execute("DELETE FROM kb_chunks WHERE document_id=?", (document_id,))
        db.execute("UPDATE kb_documents SET status='failed', chunk_count=0, error=? WHERE id=?", (str(exc), document_id))
    bump_revision(db)
    return dict(db.execute("SELECT * FROM kb_documents WHERE id=?", (document_id,)).fetchone())


def create_document(db, title, category, content, questions, actor, source="admin"):
    stamp = now()
    cursor = db.execute("""INSERT INTO kb_documents (title,category,content,questions,status,source,created_by,created_at,updated_at)
                           VALUES (?,?,?,?, 'pending',?,?,?,?)""", (title, category, content, json.dumps(questions), source, actor, stamp, stamp))
    return index_document(db, cursor.lastrowid)


def update_document(db, document_id, title, category, content, questions):
    db.execute("UPDATE kb_documents SET title=?, category=?, content=?, questions=?, status='pending', version=version+1, updated_at=? WHERE id=?",
               (title, category, content, json.dumps(questions), now(), document_id))
    return index_document(db, document_id)


def set_archived(db, document_id, archived):
    if archived:
        db.execute("DELETE FROM kb_chunks WHERE document_id=?", (document_id,))
        db.execute("UPDATE kb_documents SET status='archived', chunk_count=0, updated_at=? WHERE id=?", (now(), document_id))
        bump_revision(db)
        return dict(db.execute("SELECT * FROM kb_documents WHERE id=?", (document_id,)).fetchone())
    return index_document(db, document_id)


def delete_document(db, document_id):
    db.execute("DELETE FROM kb_chunks WHERE document_id=?", (document_id,))
    db.execute("DELETE FROM kb_documents WHERE id=?", (document_id,))
    bump_revision(db)


def validate_document(data):
    title, category, content = data.get("title"), data.get("category"), data.get("content")
    questions = data.get("questions", [])
    if not isinstance(title, str) or not 3 <= len(title.strip()) <= 120:
        raise ValueError("Give the document a title of 3 to 120 characters.")
    if category not in CATEGORIES:
        raise ValueError("Choose a category from the list.")
    if not isinstance(content, str) or not content.strip() or len(content) > MAX_CONTENT:
        raise ValueError(f"Add document text of at most {MAX_CONTENT:,} characters.")
    if not isinstance(questions, list) or len(questions) > 6 or not all(isinstance(q, str) and 5 <= len(q.strip()) <= 160 for q in questions):
        raise ValueError("Suggested questions must be up to six lines of 5 to 160 characters.")
    return title.strip(), category, content.replace("\r\n", "\n"), [q.strip() for q in questions]


def seed_documents(db):
    """Import the bundled Markdown files. A bundled file that changed refreshes its document,
    unless an administrator has edited that document (version > 1) or deleted it."""
    first_run = not db.execute("SELECT 1 FROM kb_documents LIMIT 1").fetchone()
    data = Path(__file__).resolve().parent.parent / "data"
    for path in [data / "student_handbook.md", *sorted((data / "knowledge_base").glob("*.md"))]:
        text = path.read_text(encoding="utf-8")
        meta, _ = split_sections(text)
        questions = [q.strip() for q in meta.get("questions", "").split("|") if q.strip()]
        category = meta.get("category") if meta.get("category") in CATEGORIES else "General"
        title = meta.get("title") or path.stem.replace("_", " ").title()
        existing = db.execute("SELECT id, content, version, created_by FROM kb_documents WHERE source=?", ("seed:" + path.name,)).fetchone()
        if first_run:
            create_document(db, title, category, text, questions, "system", "seed:" + path.name)
        elif existing and existing["version"] == 1 and existing["created_by"] == "system" and existing["content"] != text:
            db.execute("UPDATE kb_documents SET title=?, category=?, content=?, questions=?, updated_at=? WHERE id=?",
                       (title, category, text, json.dumps(questions), now(), existing["id"]))
            index_document(db, existing["id"])


class KnowledgeBase:
    """Search over indexed sections. Reloads when any process bumps the stored revision."""

    def __init__(self):
        self.revision = None
        self.chunks, self.tokens, self.questions = [], [], {}
        self.lock = Lock()

    def _refresh(self):
        revision = get_db().execute("SELECT value FROM settings WHERE key='kb_revision'").fetchone()["value"]
        with self.lock:
            if revision == self.revision:
                return
            records = rows("""SELECT c.id, c.title, c.text, d.id AS document_id, d.title AS source, d.category, d.questions
                              FROM kb_chunks c JOIN kb_documents d ON d.id=c.document_id
                              WHERE d.status='indexed' ORDER BY d.id, c.position""")
            self.questions = {r["document_id"]: json.loads(r["questions"]) for r in records}
            self.chunks = [{k: r[k] for k in ("id", "title", "text", "document_id", "source", "category")} for r in records]
            self.tokens = index_tokens(self.chunks)
            self.revision = revision

    def search(self, query, limit=None):
        self._refresh()
        return rank(self.chunks, self.tokens, query, limit or get_setting("retrieval_top_k"))

    def suggested_questions(self, document_ids):
        self._refresh()
        return [q for d in dict.fromkeys(document_ids) for q in self.questions.get(d, [])]
