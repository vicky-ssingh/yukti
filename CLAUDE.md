# Yukti — notes for Claude

Read this first in any new session. Product overview and setup: `README.md`. Interface rules,
theme and layout decisions: `DESIGN.md`. Assignment briefs: the two PDFs in the root.

## What this is

Flask + SQLite student support agent (Groq LLM) with a student app (`/`) and a role-based admin
panel (`/admin`). Plain JavaScript, no build step. All student records and policies are fictional.

- Python: `student_support/` (`__init__.py` routes, `agent.py`, `tools.py`, `admin.py`, `usage.py`
  usage summaries, `db.py`, `auth.py`, `knowledge.py`, `privacy.py`, `guardrails.py`).
- Front end: `student_support/static/` — `common.js` (shared `CD` helpers: api, el, icon, empty
  states, menus, `settingsMenu`, `countUp`, theme), `app.js` (student), `admin.js`, `usage.js`
  (`CDUsage` dashboard pieces), `login.js` (`CDLogin` sign-in helpers and showcase panel).
  CSS order and the theme are described in `DESIGN.md`.
- Templates: `student_support/templates/index.html` and `admin.html`.
- Knowledge base: `data/student_handbook.md`, `data/knowledge_base/*.md` (section IDs like
  `PAYMENT-02`, `MERIT-09`).

## Commands (Windows, from the project root)

- Run: `.\.venv\Scripts\python.exe app.py` → http://127.0.0.1:5000 (restart after Python changes;
  static/template changes need only a refresh, Ctrl+F5 after CSS changes).
- Tests: `.venv/Scripts/python.exe -m pytest -q` (137 tests, all passing as of 2026-10-30).
- Browser checks: preview server `campus-desk-e2e` in `.claude/launch.json` (port 5055) uses a
  scratch database via `DATABASE_PATH`, so `instance/campus.db` stays untouched. That path points
  into one session's scratchpad; on a new machine or session, change it to any throwaway path.

## Demo accounts

STU001 Anshika Sharma / STU002 Ankit Raj Singh (password `CampusDemo!2026`);
ADM001 Vicky Singh, administrator / SUP001 Ayush Kumar, support agent (password `StaffDemo!2026`).

## Rules

- Never print, log or commit `GROQ_API_KEY` from `.env`. Don't send the user's email anywhere.
- Fictional demo data only. Test in the browser against the scratch DB, not `instance/campus.db`.
- `answer_accuracy_review` in the evaluation results stays `PENDING_HUMAN_REVIEW` until a person
  reviews it; never fill it in automatically.
- Strict CSP: no inline `<script>` or `style=""`; use classes or `style.setProperty`.
- Never hard-code colours in page CSS; add or use a token in `skin.css`. Check WCAG AA contrast
  (4.5:1 text, 3:1 borders/icons/focus) whenever colours change, and re-run the dataviz palette
  validator for chart colours.
- Keep accessibility work intact: labels, focus rings, keyboard menus (arrows, Home/End, letter
  shortcuts, Escape), live regions, reduced motion, 320px reflow.
- Marketing/example copy (e.g. the sign-in panel) must match the real knowledge base.

## Working with this user

- For taste decisions (colours, layout direction), offer 3–4 concrete options with short previews
  and let them pick; they decide quickly. Theme history: green "Paper & Ink" → black & white →
  indigo → **teal & coral (final, approved 2026-10-29)**.
- They prefer clean, minimal designs that still feel lively — "too empty and dull" and "looks
  AI-generated" (glows, glass cards, floating badges) were both rejected.
- Verify changes in the preview browser and run the tests before reporting; say plainly what was
  and wasn't checked. Close with a short, plain summary of what changed and which files.

## Current state (2026-10-29)

Done and verified: knowledge base, tickets, approvals, admin panel, traces with usage dashboard,
admin Usage page, separate Audit trail page, illustrated empty states, app-wide motion, minimal
sign-in with showcase panel, sidebar redesign (New/Search rows, Pinned/Chats sections, one scroll
area, Settings menu), WCAG 2.1 AA audits of all pages and the sign-in page (all findings fixed),
design critique (top 5 recommendations applied), teal & coral theme.
2026-10-30: student Profile page (Settings → Profile, `/api/profile`) with a fee breakdown card;
fee/scholarship answers carry the same card (`meta.account`, built from the record by
`tools.account_summary`, never from model text); Markdown pipe tables in answers.

No open tasks. Possible follow-ups if asked: admin empty-state buttons; a full screen-reader pass
(NVDA) — so far accessibility was checked from markup and computed styles only.

## Preview-pane quirks (for browser testing)

- The pane runs at devicePixelRatio 1.25 and screenshots can crop; emulating 1100×720 and setting
  `document.documentElement.style.zoom = 0.72` gives a full-page view (remove it afterwards).
- When the pane is in the background, CSS transitions and animations freeze; measure focus styles
  with `transition: none`, and real `:focus` needs a real click (the document must have focus).
