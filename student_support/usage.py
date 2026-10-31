"""Usage summaries built from recorded agent traces: runs, tokens, latency, tools and outcomes.

Traces hold identifiers and measurements only (never question text), so a summary is safe to show the
student who owns the runs, and to staff with logs.view across all students.
"""
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from .db import rows

RANGES = {"7d": 7, "30d": 30, "90d": 90, "all": None}
DEFAULT_RANGE = "30d"
WEEKLY_AFTER_DAYS = 62  # longer spans are grouped by week so the chart stays readable


def parse_range(value):
    return value if value in RANGES else DEFAULT_RANGE


def parse_offset(value):
    """The browser's UTC offset in minutes (east positive), so days split at the student's midnight."""
    try:
        return max(-840, min(840, int(value)))
    except (TypeError, ValueError):
        return 0


def load_traces(range_key, student_id=None):
    days = RANGES[range_key]
    where, args = [], []
    if student_id:
        where.append("student_id=?"); args.append(student_id)
    if days:
        where.append("created_at>=?"); args.append((datetime.now(timezone.utc) - timedelta(days=days)).isoformat())
    sql = "SELECT student_id, data FROM traces" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY created_at"
    return [{**json.loads(r["data"]), "student_id": r["student_id"]} for r in rows(sql, tuple(args))]


def thread_titles(trace_ids):
    """trace id -> {id, title} of the conversation the run answered in (absent when the conversation was deleted)."""
    found = {}
    ids = list(trace_ids)
    for start in range(0, len(ids), 500):
        chunk = ids[start:start + 500]
        marks = ",".join("?" * len(chunk))
        for r in rows(f"""SELECT m.trace_id, t.id, t.title FROM messages m JOIN threads t ON t.id=m.thread_id
                          WHERE m.trace_id IN ({marks})""", tuple(chunk)):
            found[r["trace_id"]] = {"id": r["id"], "title": r["title"]}
    return found


def _tokens(trace):
    return (trace.get("input_tokens") or 0), (trace.get("output_tokens") or 0)


def _p95(values):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(.95 * len(ordered)) - 1)]


def totals(traces):
    latencies = [t["latency_ms"] for t in traces if isinstance(t.get("latency_ms"), (int, float))]
    tokens_in = sum(_tokens(t)[0] for t in traces)
    tokens_out = sum(_tokens(t)[1] for t in traces)
    completed = sum(1 for t in traces if t.get("status") == "completed")
    model_runs = [t for t in traces if t.get("model_calls")]
    return {
        "runs": len(traces), "completed": completed,
        "success_rate": round(completed / len(traces), 4) if traces else None,
        "input_tokens": tokens_in, "output_tokens": tokens_out, "total_tokens": tokens_in + tokens_out,
        "avg_tokens_per_run": round((tokens_in + tokens_out) / len(model_runs)) if model_runs else None,
        "model_calls": sum(t.get("model_calls") or 0 for t in traces),
        "tool_calls": sum(len(t.get("tools") or []) for t in traces),
        "sources_cited": sum(len(t.get("retrieved_evidence") or []) for t in traces),
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "p95_latency_ms": _p95(latencies),
        # Runs where the provider did not report usage for every model call; their token counts are lower bounds.
        "partial_usage_runs": sum(1 for t in traces if t.get("model_calls") and not t.get("usage_complete", True)),
        "last_run": traces[-1]["created_at"] if traces else None,
    }


def series(traces, range_key, offset_minutes):
    """Tokens and runs per local day (or week for long spans), with empty buckets filled in."""
    shift = timedelta(minutes=offset_minutes)
    local = lambda stamp: (datetime.fromisoformat(stamp) + shift).date()
    today = (datetime.now(timezone.utc) + shift).date()
    days = RANGES[range_key]
    first = today - timedelta(days=days - 1) if days else (local(traces[0]["created_at"]) if traces else today)
    first = min(first, today)
    bucket = "week" if (today - first).days + 1 > WEEKLY_AFTER_DAYS else "day"
    start_of = (lambda d: d - timedelta(days=d.weekday())) if bucket == "week" else (lambda d: d)
    step = timedelta(days=7 if bucket == "week" else 1)
    points, cursor = {}, start_of(first)
    while cursor <= today:
        points[cursor] = {"date": cursor.isoformat(), "input_tokens": 0, "output_tokens": 0, "runs": 0}
        cursor += step
    for t in traces:
        key = start_of(local(t["created_at"]))
        if key in points:
            tokens_in, tokens_out = _tokens(t)
            points[key]["input_tokens"] += tokens_in; points[key]["output_tokens"] += tokens_out; points[key]["runs"] += 1
    return bucket, list(points.values())


def breakdowns(traces):
    tools, tool_failures = Counter(), Counter()
    for t in traces:
        for call in t.get("tools") or []:
            tools[call.get("name", "unknown_tool")] += 1
            if not call.get("ok", True):
                tool_failures[call.get("name", "unknown_tool")] += 1
    return {
        "statuses": [{"status": s, "runs": n} for s, n in Counter(t.get("status", "completed") for t in traces).most_common()],
        "tools": [{"name": n, "calls": c, "failed": tool_failures[n]} for n, c in tools.most_common()],
        "models": [{"model": m, "runs": n} for m, n in Counter(t.get("model") or t.get("provider") or "unknown" for t in traces if t.get("model_calls")).most_common()],
    }


def by_conversation(traces, limit=6):
    titles = thread_titles(t["id"] for t in traces)
    groups = defaultdict(lambda: {"runs": 0, "input_tokens": 0, "output_tokens": 0})
    for t in traces:
        thread = titles.get(t["id"])
        key = thread["id"] if thread else None
        group = groups[key]
        group.update(id=key, title=thread["title"] if thread else "Deleted or unsaved conversations")
        tokens_in, tokens_out = _tokens(t)
        group["runs"] += 1; group["input_tokens"] += tokens_in; group["output_tokens"] += tokens_out
    ranked = sorted(groups.values(), key=lambda g: g["input_tokens"] + g["output_tokens"], reverse=True)
    for g in ranked:
        g["total_tokens"] = g["input_tokens"] + g["output_tokens"]
    return {"items": ranked[:limit], "count": len(ranked)}


def by_student(traces):
    names = {r["id"]: r for r in rows("SELECT id, name, programme FROM students")}
    groups = defaultdict(list)
    for t in traces:
        groups[t["student_id"]].append(t)
    grand = sum(sum(_tokens(t)) for t in traces) or 1
    result = []
    for student_id, runs in groups.items():
        summary = totals(runs)
        person = names.get(student_id, {})
        result.append({"id": student_id, "name": person.get("name", student_id), "programme": person.get("programme"),
                       "runs": summary["runs"], "success_rate": summary["success_rate"],
                       "input_tokens": summary["input_tokens"], "output_tokens": summary["output_tokens"],
                       "total_tokens": summary["total_tokens"], "share": round(summary["total_tokens"] / grand, 4),
                       "avg_tokens_per_run": summary["avg_tokens_per_run"], "avg_latency_ms": summary["avg_latency_ms"],
                       "tool_calls": summary["tool_calls"], "last_run": summary["last_run"]})
    return sorted(result, key=lambda s: (s["total_tokens"], s["runs"]), reverse=True)


def summary(range_key, offset_minutes, student_id=None):
    traces = load_traces(range_key, student_id)
    bucket, points = series(traces, range_key, offset_minutes)
    data = {"range": range_key, "bucket": bucket, "totals": totals(traces), "series": points, **breakdowns(traces)}
    if student_id:
        data["conversations"] = by_conversation(traces)
    else:
        data["students"] = by_student(traces)
        data["active_students"] = len(data["students"])
        data["total_students"] = rows("SELECT COUNT(*) AS n FROM students WHERE active=1")[0]["n"]
    return data
