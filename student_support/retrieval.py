"""Local ranked retrieval over policy sections; no embedding API needed."""
import math
import re
from collections import Counter
from pathlib import Path

STOP = set("a an the my i is are can do does what how for of on in to and it me you please about if when this that have has with may would could should tell policy handbook information".split())
ALIASES = {"fees": "fee", "payments": "payment", "pay": "payment", "paying": "payment",
           "failed": "failure", "fails": "failure", "scholarships": "scholarship",
           "courses": "course", "program": "programme", "programs": "programme",
           "crash": "failure", "crashed": "failure", "crashes": "failure", "installment": "instalment",
           "installments": "instalment", "instalments": "instalment", "penalty": "charge",
           "penalties": "charge", "charges": "charge", "escalate": "escalation",
           "escalating": "escalation", "emails": "email", "attend": "attendance", "days": "day"}


def words(text):
    return [ALIASES.get(w, w) for w in re.findall(r"[a-z]+", text.lower()) if w not in STOP]


def index_tokens(chunks):
    return [Counter(words(c["title"] + " " + c["text"])) for c in chunks]


def rank(chunks, tokens, query, limit=2):
    terms = set(words(query))
    scored = []
    for chunk, counts in zip(chunks, tokens):
        overlap = terms & counts.keys()
        score = sum((1 + math.log(counts[t])) * math.log(1 + len(chunks) /
                    (1 + sum(t in c for c in tokens))) for t in overlap)
        # Generic incidental matches are not evidence for an unsupported policy question.
        if score >= 1.0 and overlap:
            scored.append({**chunk, "score": round(score, 3)})
    return sorted(scored, key=lambda x: x["score"], reverse=True)[:limit]


def split_sections(text):
    """Return (front matter dict, [(heading, body)]) for a Markdown policy document."""
    meta = {}
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            for line in text[4:end].splitlines():
                if ":" in line:
                    key, value = line.split(":", 1)
                    meta[key.strip().lower()] = value.strip()
            text = text[end + 4:]
    sections = []
    for section in ("\n" + text).split("\n## ")[1:]:
        heading, _, body = section.partition("\n")
        sections.append((heading.strip(), body.strip()))
    return meta, sections


class Handbook:
    """The original single-file handbook, kept for file-based tests and tools."""

    def __init__(self, path=None):
        path = path or Path(__file__).resolve().parent.parent / "data/student_handbook.md"
        self.chunks = []
        for heading, body in split_sections(Path(path).read_text(encoding="utf-8"))[1]:
            chunk_id, title = heading.split(" | ", 1)
            self.chunks.append({"id": chunk_id, "title": title, "text": body,
                                "source": "Fictional student handbook"})
        self.tokens = index_tokens(self.chunks)

    def search(self, query, limit=2):
        return rank(self.chunks, self.tokens, query, limit)
