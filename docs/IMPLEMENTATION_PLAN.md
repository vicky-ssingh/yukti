# Detailed implementation and acceptance plan

## Source and scope

Both two-page assignment PDFs in the repository were reviewed in full. Assignment 2
explicitly extends the same agent. This repository is one implementation, not two projects.
Fictional sample data was approved by the user. Flask + Groq + SQLite keep the demo explainable.

## Architecture

Browser → Flask session + CSRF validation → bounded agent loop → Groq tool calls
→ validated tool dispatcher → scoped SQLite queries / handbook retrieval → Groq answer.
Traces capture timing, API token counts, tool decisions, policy chunks and memory selection.
Confirmation is a separate authenticated HTTP action; the model cannot approve its own actions.

## Work packages and acceptance criteria

| Stage | Deliverable | Acceptance criterion |
|---|---|---|
| 1. Foundations | App factory, config, SQLite schema, fictional records, handbook | Two independent student accounts; repeatable initialization; no secrets in source |
| 2. Agent | Groq adapter, tool definitions, bounded multi-step loop | Actual model tool calls executed and results returned before final answer; failures bounded |
| 3. Useful tools | Own record, fees, scholarship, support request, request listing | At least two useful tools, real stored results, validated inputs |
| 4. Retrieval/context | Chunked handbook, ranked retrieval, selected memory | Only top relevant chunks sent; citations and selected memory recorded; unknown answer acknowledged |
| 5. Memory | Explicit consent, allowlisted fields/values, deletion | Useful facts survive new login; secrets/temporary free text cannot be stored as memory |
| 6. Identity/privacy | Password hashing, sessions, server-side ownership | Own data allowed; forged targets and cross-user resources denied by Python code |
| 7. Sensitive action | Programme-change proposal, confirm/reject, expiry | No mutation before authenticated confirmation; rejection/replay/foreign approval cannot mutate |
| 8. Audit | Actor, action, permission, approval, result, timestamp/run ID | Tool attempts and decisions inspectable without recording secret chat text |
| 9. Interface | Chat, evidence, memory, approvals, requests, audit | Responsive keyboard-operable UI; useful empty, loading and error states |
| 10. Evaluation | Deterministic tests and optional live Groq runner | Accuracy/success, tool appropriateness, latency, tokens, retrieval, privacy and unsafe-action results |
| 11. Handoff | README, safety explanation, comparison report, demo script | Every brief item mapped; offline evidence never presented as live model accuracy |

## Complete requirement mapping

| Brief requirement | Implementation | Verification |
|---|---|---|
| A1 working agent loop | `agent.py`, `provider.py` | Multi-step provider contract tests; live evaluation runner |
| At least two useful tools | `tools.py`: record, fee, scholarship, support and more | Tool results and database assertions |
| Persistent useful memory across sessions | `memory` table; explicit remember tool / form | Restart/session isolation tests |
| No temporary/sensitive long-term memory | Enumerated memory fields and values; no transcript storage | OTP/password/temporary content tests |
| Retrieve from one policy document | `data/student_handbook.md`, `retrieval.py` | Portal-failure chunk retrieval, unknown-query test |
| Select current question + relevant context | No full transcript; selected memory; at most one volatile clarification exchange; retrieved chunks via tool | Captured provider message inspection |
| Missing information, errors, unanswerable questions | Strict schemas, error tool results, API failure messages, policy fallback | Invalid input, provider failure, tool budget tests |
| Per-run traces | `traces` table and evidence panel/export | Trace structure and student scoping tests |
| Accuracy/success | Evaluation checks plus manual live answer review | Evaluation CSV/Markdown |
| Tools/appropriateness | Expected vs actual tool fields | Evaluation report |
| End-to-end latency | `perf_counter`, milliseconds | Every trace/report row |
| API input/output tokens | Sum of Groq usage across loop | Scripted usage aggregation test; live report |
| Retrieved evidence | Chunk IDs/text and selected memory | Trace evidence |
| Fee scenario | `get_fee_status` | Own-fee evaluation case |
| Failed portal / next working day | Policy retrieval with conditions | Portal evaluation case |
| New-session remembered fact | Allowlisted programme/preference memory | Save then new-session recall |
| Sensitive/temporary statement | No raw transcript; secret-marked message blocked pre-provider | Persistence and provider-spy tests |
| Unknown policy | Retrieval can return no evidence; escalation instructions | Unsupported hostel/refund case |
| A2 same project | Final app and baseline evaluation profile use same core | No separate application |
| Signed-in student | Session subject from password-verified account | Auth/CSRF tests |
| Own private data allowed | Queries scoped to session owner | Own-record tests |
| Others' data blocked | Dispatcher target guard, scoped HTTP reads | Cross-student tools, trace, memory, approval tests |
| Authorization in application code | `tools.py`, `__init__.py` | Malicious scripted-model tool calls |
| Sensitive action approval | Pending programme-change record + human confirm/reject | No pre-approval change; atomic confirmation |
| Rejected action never executes | Terminal rejected status, replay protection | Reject then confirm test |
| Auditability | Append-only application audit API | Actor/attempt/decision/result fields |
| A1 tracing survives A2 | Shared run tracing | Comparison report |
| Final measurable comparison | Same common cases in baseline/final profiles + final safety cases | Offline report now, live report once key configured |

## Evaluation protocol

Run common cases against the same agent with an A1 capability profile and the final A2
profile in isolated temporary databases. A1 excludes the sensitive-change tool; ownership
checks remain enabled in both profiles. This is a capability comparison, not a fabricated
historical deployment or a claim that privacy overhead has been isolated experimentally.
Use a scripted provider for deterministic orchestration regression tests, with tokens N/A.
Use `--live` for actual Groq measurements. Automatically check observable tool choices and
database effects; human-review answer correctness and mark it explicitly in the CSV.

## Completion gates and external dependency

- Run automated tests covering authorization, approvals, persistence, retrieval and loop failures.
- Exercise login/chat/error/navigation in a browser at desktop and mobile widths.
- Generate sample trace/audit records and evaluation comparison artifacts from executed tests.
- Live model correctness, latency and API token measurements require a valid local GROQ_API_KEY.
- This is a production-aware educational demo, not an institution-ready identity or records system.

## Implementation status

Stages 1–9 are implemented. Stage 10 has 97 passing automated tests, 26 passing scripted
cases, a full live Groq comparison with 25/26 automatic checks passing, and an explicitly
labelled assistant answer review. The A1 recall tool-choice issue and two answer-wording
issues led to focused follow-up fixes and verification; original results are preserved.
Stage 11 includes the README, privacy explanation, demo guide, offline and live comparisons,
sample trace/audit records and live browser evidence. See `docs/VERIFICATION.md` for limits.
The student can complete the separate human-review column before submission.
