# Live evaluation notes — 23 October 2026

## Configuration check

The locally supplied key successfully authenticated with Groq. The original model,
`llama-3.3-70b-versatile`, returned HTTP 404 `model_not_found`. The account's available-model
list included `openai/gpt-oss-20b`, so the app, example environment and evaluation defaults
were updated to that model. It is hosted by Groq; no OpenAI API is used.

The unsuccessful configuration run is preserved in `evaluation/live-20261023T062814Z/`.
It is not evidence of working model behavior. Model-unavailable errors now include a specific
configuration remedy without exposing keys or raw provider exceptions.

## First working-model run

`evaluation/live-20261023T062929Z/` contains the first 26-case evaluation against the available model.

- 22/26 original automatic checks passed.
- Two support-request cases encountered Groq HTTP 429 rate limits. In A1 the ticket existed
  before the second model call failed; the response directed the user to check recorded requests.
  In A2 the first model call failed and no ticket was created. Both remain failed rows.
- Two privacy answers correctly refused another student's information. The original test
  matcher missed curly apostrophes and “don't have access” wording. The matcher was corrected
  with regression tests; the original results were not overwritten.
- Answer review found opportunities to avoid ungrounded offers of payment plans, invented
  contact channels, and escalation offers for another student's private data. The system
  instructions now explicitly disallow these suggestions and clarify that uploads happen
  outside the demo through Finance.

## Measurement rules

The final full run spaces cases by 15 seconds. These between-case waits are excluded from
per-case latency; API retries and any provider-imposed waiting during a run are included.
Results describe this account, model and test set, not general production performance.
Both profiles use the same current implementation; A1 excludes the sensitive-action tool.

Model answers are reviewed by the coding assistant against the supplied rubrics. Such review
is identified as assistant review, not independent human evaluation. The original CSV's human
review column remains available for the student's own review before submission.

## Browser integration

A live fee question returned the fictional STU001 balance of INR 60,000, INR 240,000 assessed,
INR 180,000 paid and 5 November 2026 due date. Its trace showed two model calls, 1,806 input
tokens, 122 output tokens, and 1,904.5 ms latency. These are one observed run, not
average-performance claims. The browser also showed the allowed `get_fee_status` call and the
selected `response_style=concise` preference.

## Full paced comparison and follow-up

The full run `evaluation/live-20261023T063353Z/` passed 25/26 automatic checks with no
provider errors: A1 common 9/10, A2 common 10/10, and A2 safety 6/6. The one automatic
failure was an unnecessary student-record lookup despite a correct memory-recall answer.
Assistant rubric review passed 24/26 answers; the two wording issues were an unsupported
Finance portal and a promise of real staff follow-up on a locally stored demonstration ticket.

The tool now returns explicit local-only delivery metadata and a no-notification notice;
the model instructions clarify the contact-channel limitation and memory-only recall path.
Only the three affected scenarios are rerun in both profiles after this change. Those focused
results are reported separately, rather than substituted into the full comparison.

The focused run `evaluation/live-20261023T064212Z/` passed all six automatic checks and
all six assistant answer reviews. The historical artifacts were removed when the repository was
streamlined; this document retains their summary.

## Final run (27 October 2026)

After narrowing the privacy filter, auditing cross-student refusals and adding memory items to
the evidence column, the full suite was rerun on 27 October 2026 at 03:47 UTC. It passed 26/26
automatic checks with no provider errors; the historical artifacts are no longer retained.

## Final run after the enhancements (27 October 2026, 05:11 UTC)

After the knowledge base, saved conversations, ticket management and admin panel were added,
the full suite was rerun in `evaluation/live-20261027T051114Z/`, copied to `evaluation/final/`.
It passed 26/26 automatic checks with no provider errors. Input tokens rose 20–25% because every
call carries two more tools and longer instructions. Answer accuracy review is pending the
student's own review. See `evaluation/final/REVIEW.md`.
