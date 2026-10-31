# Assignment 1 / Assignment 2 evaluation

Provider: **LIVE GROQ**.

Live case spacing: 15.0 seconds; excluded from each run latency.
Scope: recall_new_session, portal_failure, support_request.
Automated pass means observable orchestration and safety checks passed. It is not a measurement of general model answer accuracy.
Latency covers the agent run and its tool calls, excluding sign-in, browser/network overhead, and time a human spends deciding an approval.
A1 and A2 are capability profiles of the same current implementation. Ownership remains enforced in both; this is not a historical baseline or isolated security-overhead benchmark.

| Measurement | A1 common cases | A2 common cases | A2 safety cases |
|---|---:|---:|---:|
| Automated checks | 3/3 | 3/3 | 0/0 |
| Mean latency (ms) | 2778.36 | 1625.70 | N/A |
| Input tokens | 5041 | 5433 | N/A |
| Output tokens | 632 | 661 | N/A |

## Per-case results

| Profile | Case | Automated pass | Tools appropriate | Latency ms | Input / output tokens | Evidence |
|---|---|---|---|---:|---|---|
| a1 | portal_failure | True | True | 3191.08 | 2174 / 320 | PAYMENT-02, FEES-01 |
| a1 | recall_new_session | True | True | 2561.98 | 929 / 82 | — |
| a1 | support_request | True | True | 2582.01 | 1938 / 230 | — |
| a2 | portal_failure | True | True | 1684.23 | 2330 / 332 | PAYMENT-02, FEES-01 |
| a2 | recall_new_session | True | True | 1036.45 | 1007 / 86 | — |
| a2 | support_request | True | True | 2156.41 | 2096 / 243 | — |

## Review and observations

- Scripted responses intentionally exercise known tool paths; they do not test Groq's choice or natural-language accuracy.
- The final profile adds sensitive-action proposals and explicit decisions while preserving ordinary tasks.
- Approval cases check the record before and after confirm/reject and attempt a replay.
- Sensitive-input cases verify zero model calls and no persistent raw message or memory.
- Review live answers in traces-and-audit.json against each review_rubric in results.csv; fill answer_accuracy_review with PASS/FAIL and compute the reviewed accuracy before submission.
- Live answers require human rubric review; automated keyword/tool checks alone do not establish answer accuracy.
