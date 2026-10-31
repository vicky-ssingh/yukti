# Privacy and approval rules

## Identity and authorization

The browser signs in with a student ID and password. Werkzeug stores password hashes; Flask's
signed, HttpOnly, SameSite session carries only the verified student ID, CSRF token, conversation
ID and expiry metadata. Neither a model instruction nor an HTTP body can change the acting student.
Every private SQL read/write uses the session subject. Optional tool targets that name another
student are denied in `ToolService.execute` before the query. A denied audit event is recorded.
Unknown targets and unavailable approval/trace IDs reveal no existence information.

Authenticated APIs expose only that student's memory, support requests, approval proposals,
traces and audit events. CSRF is checked on all mutating routes, including login. Login attempts
are rate-limited in process. The application has no unauthenticated private-record endpoint.

## Storage boundaries

| Information | Treatment |
|---|---|
| Conversations | Saved per student in `threads`/`messages`; owner-scoped; student can delete; purged after the retention setting (90 days by default); readable by staff with `chats.view`, and every staff view is audited |
| Disclosed secrets: a credential with its value ("OTP is 123456", "password: x"), bank/card/Aadhaar identifiers with digits, card-shaped numbers, personal health disclosures, API key patterns | Whole-message filter before the provider; no raw trace question or memory. Topic words alone ("bank transfer", "medical leave policy", a fee amount or transaction reference) are allowed |
| Useful durable preferences | Only programme, response language or response style, with enumerated values and explicit consent |
| Temporary information | Never accepted as durable memory; may be temporary context until new conversation/sign-out/expiry |
| Tool arguments | Validated; never copied wholesale to traces/audit |
| Support tickets | Persist after sensitive-content filtering; owner-scoped for students; a bounded copy of the recent conversation (withheld messages excluded) is attached; internal staff notes are never returned to students |
| Withheld messages | A message the filter blocks is stored only as a placeholder, never as text |
| Trace/audit | Metadata, fixed policy evidence, allowlisted memory, tool/approval identifiers; no raw chat, provider exceptions or API keys |
| API key | Local `.env` or process environment only; not returned to browser |

Memory consent must come from the current student request containing `remember` or `save` plus
the selected value, without negation or temporary markers, or from the explicit UI checkbox.
No free-text memory field exists. Preference deletion is available to its owner.

## Sensitive-action state machine

```text
request_programme_change
  └─ pending (original record unchanged; expires in 30 minutes)
       ├─ authenticated Confirm → approved + atomic record update
       ├─ authenticated Reject  → rejected, no update
       ├─ decision after expiry → expired, no update
       └─ original value changed → stale, no update
```

The programme and old/new values are stored in the pending proposal. The decision endpoint
accepts only `confirm` or `reject`, never a replacement value. It uses `BEGIN IMMEDIATE`, checks
owner/status/expiry/current record, then updates the programme and decision in one transaction.
Confirmed changes clear a possibly stale remembered programme preference. All terminal states
reject replay. The LLM has no tool to decide an approval. Student self-confirmation satisfies
the brief's “confirmation or human approval” option. A real institute would require academic staff.

## Audit interpretation

Each event identifies timestamp, actor, action, target, decision, approval status, result and
agent run ID when applicable. A proposal's `allowed/pending_confirmation` event is not an
executed change. Only `decide_approval → approved → programme_updated` records execution.
Rejected, expired, stale and foreign requests record a non-execution/denial outcome.
The audit API is read-only; SQLite remains locally editable by the machine owner, so these
records are application audit evidence, not cryptographically tamper-proof records.

## Required scenario coverage

- Own fee/scholarship: allowed; actual owner-scoped tool result returned.
- Other student's data: denied before private query, even under malicious model tool arguments.
  A request naming another student ID or full name is always audited as `denied`: by the tool
  (`ownership_mismatch`) or, when the model refuses without a tool call, as
  `cross_student_request / refused_no_private_data_accessed`. The trace records `permission.enforced_by`.
- Own sensitive change: pending only; no automatic update.
- Rejected change: record unchanged; a later confirm attempt returns a conflict.
- OTP/password: filtered before model use and absent from database memory/transcripts.
- Email change: staff approval, not self-confirmation. The agent asks for the new address if it is
  missing, then creates a pending approval (`reviewer=staff`, 7-day expiry) and a linked ticket.
  The student cannot decide it (403). A staff member with `approvals.decide` (admin by default)
  approves or declines it on the ticket; declining needs a reason. At decision time the record is
  rechecked (expired, changed since the request, address now used by someone else), the change and
  ticket resolution happen in one transaction, and the audit row records the staff member as actor.
  Programme changes keep the student-confirmation flow tested by the evaluation scenarios.

## Staff roles and permissions

| Permission | Admin | Support agent (default) |
|---|---|---|
| `tickets.view`, `tickets.manage` | Yes | Yes |
| `chats.view` | Yes | Yes |
| `kb.manage`, `users.manage`, `settings.manage`, `logs.view` | Yes | No (admin can grant) |

Checks run in Python on every admin route (`auth.permission_required`); a denied check is audited.
The admin role always has every permission, an admin cannot deactivate or demote themself, and the
last active admin cannot be removed. Deactivating an account ends its access on the next request
and returns that person's open tickets to the queue. Staff cannot use student routes and students
cannot use admin routes.
- Traces, latency and tokens: same instrumentation remains active after final safety controls.

## Response guardrails (scope)

Yukti only handles student support for the institute. Out-of-scope requests are declined
politely and redirected to supported services, in two layers:

1. **Pre-check in code** (`student_support/guardrails.py`): a request with no campus topic that
   clearly asks for code, entertainment, creative writing or general knowledge (for example
   "write a python program", "top 10 movies") is declined before any model call. The answer lists
   supported services and offers follow-up chips; the trace shows a `scope_guard` step and status
   `out_of_scope`, and an audit row `scope_guard / declined / <category>` is written. Any request
   that mentions a campus topic ("Python elective", "a program to calculate my fee") goes to the
   model instead, so the pre-check cannot block legitimate questions about the institute.
2. **Model instruction**: the system prompt limits the assistant to student-support topics and tells
   it to decline anything else in one sentence and list what it can help with. This covers
   off-topic requests the pre-check does not recognise.

Admins can switch the pre-check off in **Settings** ("Decline clearly off-topic requests before
the model"); the model instruction always applies.
