# Verification record

Verified locally on 23 October 2026. The source PDFs remain unchanged.

## Automated execution

- `python -m pytest -q`: **97 passed** (including live-evaluator regression checks).
- `python scripts/evaluate.py`: **26/26 scripted scenarios passed**:
  10 Assignment 1 common cases, 10 Assignment 2 common cases, 6 Assignment 2 safety cases.
- JavaScript syntax checked with `node --check student_support/static/app.js`.
- Python modules compiled successfully.
- Exact installed dependency versions are captured in `requirements-lock.txt`.

Tests exercise real Flask requests, SQLite state and the tool dispatcher. The model adapter is
scripted for these tests; assertions cover actual tool result round trips, usage aggregation,
context selection, persistent memory, owner scoping, malformed input, unavailable tools,
API failure behavior, bounded loops, approval expiry/staleness/rejection/replay and CSRF.

## Browser verification

The app was run on loopback port 5001 and checked through the in-app browser.

- Sign in as STU001 with the documented demo password.
- Save the allowed `response_style=concise` preference with explicit consent.
- Restart the server and verify the same signed-in account and saved preference.
- Submit a fee question without a configured API key: visible setup error; trace records
  `provider_error`, no fabricated model answer or token counts.
- Submit a fictional OTP example: visible refusal, `privacy_filtered`, zero model calls.
- Inspect the mobile layout at a narrow viewport; no document-level horizontal overflow.
- Seed a fictional pending programme proposal through the actual tool service for UI testing
  (not through a model). The review screen shows old/new values and expiry.
- Reject that proposal in the UI: status becomes rejected, programme remains PGDM-AI,
  and the audit shows `decide_approval / not_executed / rejected`.
- Inspect Traces & audit and return to the chat view.
- Browser console showed no JavaScript errors or warnings during the checked flows.

The seeded UI test is explicitly a fixture, not evidence that Groq selected the change tool.
The generated offline trace/audit file includes confirmation as well as rejection cases.

## Live Groq verification

The user subsequently configured the key locally. The app was connected to
`openai/gpt-oss-20b` hosted by Groq after the original Llama model returned model_not_found.

The full paced run in `evaluation/live-20261023T063353Z/` passed 25/26 automatic checks:
A1 9/10, A2 common 10/10, A2 safety 6/6. A1's flagged recall answer was correct, but it
made an unnecessary record lookup. No provider failures occurred in this paced run.
Recorded mean latencies: A1 common 1,537.19 ms; A2 common 1,541.18 ms; A2 safety 1,122.52 ms.
The 15-second between-case spacing is excluded; safety averages include two local prefilters.

Assistant review passed 24/26 answers. Two A2 responses added an unsupported Finance portal
and a staff-follow-up promise for a local-only ticket. The model instructions and ticket tool's
result were corrected, along with instructions to recall preferences without a record lookup.
Focused live follow-up evidence is stored separately from the unchanged full-run measurements.
All six focused live checks and assistant answer reviews passed after the corrections.
These 23 October results are kept in `evaluation/earlier-20261023/`.

A 27 October 03:47 UTC run (`evaluation/live-20261027T034721Z/`, kept in
`evaluation/earlier-20261027-0347/`) passed 26/26 automatic checks: A1 10/10, A2 common 10/10, A2 safety 6/6.
Mean latencies: A1 common 1,978.61 ms (1,413.53 ms without one slow 7,064 ms run);
A2 common 1,535.93 ms; A2 safety 1,021.65 ms.

The final full run at 05:11 UTC, after the knowledge base, ticketing and admin panel were added
(`evaluation/live-20261027T051114Z/`, copied to `evaluation/final/`), passed 26/26 automatic checks.
Mean latencies: A1 common 1,678.84 ms; A2 common 1,716.53 ms; A2 safety 1,118.33 ms. Input tokens
were 18,395 / 20,746 / 7,889. Answer accuracy review is pending.
See `evaluation/final/REVIEW.md` and `docs/LIVE_EVALUATION_NOTES.md` for the review and run history.

The browser fee question returned the correct data through a real Groq tool round trip and
showed API token counts. The locally running server has been restarted with the final fixes.
Screenshots show the actual app: the original setup state and the later live fee answer.

These finite test results and assistant review are not independent human validation or a
guarantee of correctness on unseen questions. The CSV retains a separate human-review column.
