"""Conservative, explainable demo privacy controls; not a universal DLP classifier."""
import re

MEMORY_VALUES = {
    "programme": ["PGDM-AI", "PGDM-BDA"],
    "response_language": ["English", "Hindi"],
    "response_style": ["concise", "detailed"],
}
# Free-format but strictly shaped values, e.g. a hostel room "B-204".
MEMORY_PATTERNS = {"hostel_room": {"pattern": r"[A-Z]{1,2}-?\d{1,4}", "example": "B-204"}}
MEMORY_KEYS = [*MEMORY_VALUES, *MEMORY_PATTERNS]


def memory_value_allowed(key, value):
    if not isinstance(value, str):
        return False
    if key in MEMORY_VALUES:
        return value in MEMORY_VALUES[key]
    return key in MEMORY_PATTERNS and bool(re.fullmatch(MEMORY_PATTERNS[key]["pattern"], value))


# Match a disclosed value, not a topic: "my OTP is 123456" is blocked, while
# "Can I pay by bank transfer?" or "my transaction reference is 98765432" is not.
SECRET_MARKERS = re.compile(
    # A credential followed by its value ("password is x", "OTP: 123456", "PIN 4821").
    r"\b(?:otp|one[ -]?time (?:password|passcode|code|pin)|password|passcode|pin|cvv|"
    r"(?:verification|security|login) code|api[ _-]?key|secret key)\b"
    r"(?:\s+(?:number|code))?\s*(?:(?:is|was|=|:)\s*\S+|\d{3,})"
    # A financial or government identifier followed by digits.
    r"|\b(?:bank|account|card|debit|credit|aadhaar|aadhar|ssn|pan|upi|ifsc)\b[^.\n]{0,25}?\d{4,}"
    # Card or Aadhaar shaped numbers (4-4-4 or 4-4-4-4 groups).
    r"|\b\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]\d{4})?\b"
    # A personal health disclosure.
    r"|\b(?:my|i have|i've|i was|i am|i'm)\b[^.\n]{0,30}?\b(?:diagnos\w*|medication|prescri\w*|illness|"
    r"disease|disorder|medical condition|health (?:condition|issue|problem))"
    # Provider key shapes.
    r"|\bgsk_[A-Za-z0-9]+|\bsk-[A-Za-z0-9]{16,}",
    re.I,
)
STUDENT_ID = re.compile(r"\bSTU\d{3,}\b", re.I)


def sensitive(text):
    return bool(SECRET_MARKERS.search(text))


def mentions_other_student(student_id, question):
    """Code-level detection of a request naming another student by ID or full name."""
    from .db import rows
    if any(m.upper() != student_id for m in STUDENT_ID.findall(question)):
        return True
    text = question.casefold()
    return any(s["name"].casefold() in text for s in rows("SELECT name FROM students WHERE id<>?", (student_id,)))


def memory_consent(question, key, value):
    """The model cannot manufacture consent or arbitrary free-text memory."""
    if sensitive(question) or not re.search(r"\b(remember|save)\b", question, re.I):
        return False
    if re.search(r"\b(don't|do not|never|forget|temporary|temporarily|today|tomorrow|tonight|this week|this session|for now)\b", question, re.I):
        return False
    return memory_value_allowed(key, value) and value.casefold() in question.casefold()


def selected_memory(student_id, question):
    from .db import rows
    keys = ["response_language", "response_style"]
    if re.search(r"programme|program|course|study|studying|remember|recall", question, re.I):
        keys.append("programme")
    if re.search(r"room|hostel|stay|staying|remember|recall", question, re.I):
        keys.append("hostel_room")
    return [m for m in rows("SELECT key,value FROM memory WHERE student_id=?", (student_id,)) if m["key"] in keys]
