# Interface rules

Base design system: OKLCH tokens in `static/style.css` (layered: reset, base, components, shell,
responsive). System sans-serif typography, generous line height, bordered sections rather than
nested cards. Desktop: sidebar, flexible conversation, topics/evidence panel. Below 1180px the
panel becomes a drawer; below 900px navigation becomes a drawer too.
All forms have visible labels. Focus rings, status live regions, reduced motion support.
Chat content is rendered with a small Markdown subset built from DOM nodes, never as HTML.
No external fonts or CDNs. Strict CSP: no inline scripts or `style` attributes (setting values
through `element.style.setProperty` is fine). Shared helpers live in `static/common.js`; page rules
in `student.css` and `admin.css`.

Light and dark themes share one token set: dark values apply when the system prefers dark or the
student/staff member picks dark (saved per browser; `static/theme.js` applies it before paint).
Never hard-code colours in page CSS; add a token instead.

## Stylesheet order (both apps)

`style.css` → `student.css` or `admin.css` → `usage.css` → `login.css` → `motion.css` → `skin.css`.
`skin.css` is last and holds the theme tokens, so it wins over everything before it.

## Theme: teal & coral (`static/skin.css`)

- Light: mint-white page `#f3faf8`, white cards, ink `#10231f`, muted `#55706a`, field borders
  `#7b938d`, primary teal `#0f766e` (hover `#115e59`), soft teal `#e0f4f0`, coral `#f97362`.
- Dark: page `#0b1715`, cards `#11211e`, primary aqua `#2dd4bf`, focus `#5eead4`.
- Logo mark uses `--brand-gradient` (teal → emerald). "You are here" (current nav item and the open
  conversation) is a soft teal pill; hover is a lighter wash. "New" is a plain action row.
- Icon tiles on topic cards and KPI tiles cycle six tints: teal, coral, sky, violet, amber, rose.
- Status badges keep their own meaning colours (green, amber, red, violet).
- Charts (`usage.css`): input tokens teal, output tokens coral — light `#14b8a6`/`#e8573a`,
  dark `#22a094`/`#e0623a`. Both pairs pass the dataviz palette validator (CVD, lightness band,
  chroma, 3:1 against the surface). Re-run the validator if these change.
- Serif display headings (Iowan Old Style / Palatino from the system).
- Field focus: 2px ring in `--focus` (`input:focus` rule at the end of `skin.css`).

## Layout decisions

- Sign-in (both apps), "calm split" chosen 2026-10-30: form column on the left; on screens ≥1000px a
  solid teal panel on the right (`#login-aside`, `--story-*` tokens in `skin.css`, no gradient or
  glow), built by `CDLogin.showcase` in `login.js`: kicker, short headline, one example exchange
  (question bubble, answer, cited ID) switched by three dots with a topic label, then three check
  points. It must fit one screen without scrolling (short-screen spacing rule in `login.css`).
  Examples must quote real knowledge-base sections and cite real IDs (`LATE-07`, `MERIT-09`,
  `PAYMENT-02`). The rotation pauses on hover/focus and stops once a dot is clicked; the card is not
  a live region. Demo accounts are a 2 × 2 grid of one-click chips (name, role, ID).
- Student sidebar, top to bottom: brand, New, Search (opens an inline field), Chat, Support tickets,
  Approvals, then foldable "Pinned" and "Chats" sections (one line per conversation), all in one
  scroll area; footer with the user and a Settings gear.
- Settings menu (gear): Remembered facts (M), Traces (R), Audit trail (A), Dark/Light mode (T),
  Sign out (S). The gear is highlighted while one of those pages is open. Admin has the same menu
  with theme and sign out only.
- Page titles live in the top bar `<h1>`; pages do not repeat them as a second heading.
- Traces page: usage dashboard (range switch, KPI tiles, tokens-over-time chart, outcomes,
  conversations by tokens, tools) and agent run cards. Audit trail is its own page with decision
  filter chips. Admin has a Usage page with per-student consumption.
- Empty states use the illustrated `CD.empty` with next-step buttons.
- Motion lives in `motion.css`, entirely inside `prefers-reduced-motion: no-preference`; entrance
  animations use `backwards` fill so nothing keeps a transform after it finishes.


November 2026 update: violet primary, blue supporting accents, coral highlights and lavender surfaces replace the green theme. Login uses a left showcase and a right contained sign-in form, with stacked mobile layout. Current tokens and layout overrides are in static/skin.css.


Current theme (1 November 2026): reference-inspired white canvas, light-gray sidebar, charcoal text, gray selection states and restrained terracotta branding. This supersedes earlier green and violet palettes. Login retains the reference layout with neutral surfaces. Dark mode uses neutral charcoal surfaces. Semantic status colors remain distinct. Theme tokens are in static/skin.css.
