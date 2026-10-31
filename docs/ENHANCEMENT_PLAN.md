# Knowledge assistant enhancement plan

Extends the existing Yukti app (Assignments 1 and 2). Everything already working is kept:
Groq agent loop, ownership checks in code, approval flow, privacy filter, traces, audit and the
evaluation runner. All data stays fictional.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Stack | Keep Flask, SQLite and plain JavaScript; no build step | Matches the project; strict CSP (`script-src 'self'`) stays |
| Reference UI | Match its layout and components (bubbles, source chips, follow-up chips, ticket card, topic list) | Requested |
| Reference wording | Do not copy "The support team will follow up" or "Official" ticket text | Tickets are handled by staff in the admin panel; no email is sent, so the app says exactly that |
| Chat history | Now persisted per student in threads; student can rename and delete | Requested. Replaces the earlier "transcripts are not saved" rule; docs and handbook updated |
| Sensitive chat text | Still never sent to Groq or stored; a placeholder is stored instead | Assignment 2 requirement unchanged |
| Follow-up context | Only the last N exchanges of the same thread, and only for follow-up style questions | Keeps Assignment 1 context selection |
| Follow-up suggestions | Taken from the cited documents' listed questions and from the tools used, not from the model | No extra tokens; never invents topics |
| Staff access to chats | `chats.view` permission; every view is audited; students are told staff can read conversations | Monitoring is required but privacy-sensitive |
| Roles | `student`, `support_agent`, `admin`; admin always has every permission; agent permissions are editable | Role-based access enforced in Python, not by the model |
| Knowledge base | Documents in SQLite, split into cited sections, indexed on save; status pending/processing/indexed/failed/archived | Easy updates without editing files |
| New sensitive action | Registered email change uses the same approval flow as programme change | "Update registered email" topic in the reference |

## Work items

1. **Knowledge base**: `kb_documents`, `kb_chunks`; seed from `data/student_handbook.md` and
   `data/knowledge_base/*.md`; front matter for title, category and suggested questions;
   section IDs (`LATE-07`) become citations; revision-based cache; top-k from settings.
2. **Threads and follow-up chat**: `threads`, `messages`; chat accepts `thread_id`; stored answers
   keep sources, suggestions, ticket and approval IDs; thread list, rename, delete.
3. **Tickets**: subject, priority, status, assignee, captured conversation, resolution;
   `ticket_events` timeline (public or internal); raise from chat (agent tool or button);
   student detail, comments and close; ticket lookup tool for the agent.
4. **Admin panel** (`/admin`): overview, knowledge base CRUD and reindex, ticket queue and
   resolution, chat monitoring, users and role permissions, system settings, activity log.
5. **UI**: rebuilt student workspace matching the reference; responsive; loading, empty and
   error states; safe Markdown rendering (no `innerHTML`).
6. **Verification**: tests for every new rule (RBAC, isolation, KB indexing, threads, tickets,
   settings), existing 69 tests kept passing, offline evaluation rerun, browser check of both UIs.

## Out of scope

Real email or SMS delivery, SSO, file attachments, deployment to a server, PDF/Word parsing
(documents are Markdown or plain text), and a historical Assignment 1 build.
