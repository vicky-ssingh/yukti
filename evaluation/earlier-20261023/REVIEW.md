# Live Groq evaluation and answer review (earlier result, 23 October 2026)

> Superseded by `evaluation/final/` (27 October 2026 run against the final code).
> Kept unchanged as a dated earlier result; the "57 tests" figure refers to that time.

Verified on 23 October 2026 using **openai/gpt-oss-20b hosted by Groq**.
All student records are fictional. No API key is included in these artifacts.

## Full comparison

Source: `evaluation/live-20261023T063353Z/`. The measurements are copied unchanged into
this directory's `comparison.md`, `results.csv`, and `traces-and-audit.json`.

| Measurement | A1 common | A2 common | A2 safety |
|---|---:|---:|---:|
| Scenarios | 10 | 10 | 6 |
| Automatic checks passed | 9/10 | 10/10 | 6/6 |
| Assistant answer review passed | 10/10 | 8/10 | 6/6 |
| Mean agent latency | 1,537.19 ms | 1,541.18 ms | 1,122.52 ms |
| Input tokens | 14,709 | 15,055 | 5,781 |
| Output tokens | 1,529 | 1,522 | 844 |

- **25/26 automatic checks** passed. A1 memory recall returned the correct answer but made
  an unnecessary `get_student_record` call. The strict tool-appropriateness check correctly failed it.
- **24/26 answers** passed assistant rubric review. A2's portal answer invented a Finance
  portal, and its support-ticket answer promised real staff follow-up for a local-only ticket.
  Those failures remain visible in `assistant_answer_review` and `assistant_review_notes`.
- Two safety cases are application-level secret prefilters with zero model calls. Thus the
  assistant review of actual model-generated answers is **22/24**, not 24/24.
- No provider errors occurred in this full paced run. Two cross-student requests were refused;
  confirmation, rejection and replay behavior passed state checks. Secret messages did not
  reach the provider or persistent memory.

## Corrections and focused verification

The model instructions now specify memory-only recall when remembered preferences are
already present, forbid invented contact channels, and prohibit promises of actual staff
notification. The support-request tool now returns `delivery=local_demo_only` and an explicit
notice that no real support team was notified and no response is scheduled.

Source: `evaluation/live-20261023T064212Z/`, copied to `followup/`.

| Focused scenario | A1 automatic / assistant review | A2 automatic / assistant review |
|---|---|---|
| Payment portal policy | PASS / PASS | PASS / PASS |
| Cross-session memory recall | PASS / PASS | PASS / PASS |
| Support request creation | PASS / PASS | PASS / PASS |

All **6/6 focused checks and answer reviews passed**. These are separate follow-up results;
they do not overwrite the original full-run results or imply another complete suite was run.
All **57 automated regression tests** passed after the final changes.

## Earlier failures and measurement limits

The unavailable-model run and the first working-model run are preserved in their original
timestamped directories. The first working-model run had two rate-limit failures and two
false negatives caused by refusal-wording matching. See `docs/LIVE_EVALUATION_NOTES.md`.

Live cases are spaced by 15 seconds to respect the account's rate limits. This spacing is
outside measured latency; API retry/wait time inside a run is included. Safety mean latency
includes the two fast prefilters. Token totals reflect API-reported usage only, not estimates.
The A1 and A2 profiles share current code and ownership checks, so timing differences do not
isolate security overhead or represent a historical deployment comparison.

Review was performed by the coding assistant, not an independent human evaluator. The
original `answer_accuracy_review=PENDING_HUMAN_REVIEW` column is retained for the student's
own review; the assistant results are separate columns. This finite sample does not establish
accuracy on unseen questions. Use the trace files and per-case rubric to inspect each judgment.

## Evidence files

- `comparison.md`: full automatic measurements and per-case table.
- `results.csv`: full measurements plus separate assistant review notes.
- `traces-and-audit.json`: live answers, selected evidence, tool calls and approval/audit outcomes.
- `followup/`: the six focused live checks after corrections, with matching review notes.
- `docs/screenshots/live-fee-answer.png`: actual browser answer with tool and token evidence.
