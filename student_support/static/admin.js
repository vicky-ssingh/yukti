"use strict";
const sectionCount = (n) => `${n} section${n === 1 ? "" : "s"}`;
/* Yukti admin panel. Hash routes: #/overview, #/kb, #/kb/new, #/kb/3, #/kb/3/edit, #/tickets,
   #/tickets/TKT-XXXX, #/conversations, #/conversations/<id>, #/usage, #/users, #/settings, #/activity, #/account.
   The server enforces every permission; hiding navigation here is only a convenience. */
(() => {
  const {el, icon, api, json} = CD;
  const $ = (id) => document.getElementById(id);
  let session = null;
  let perms = new Set();

  const NAV = [
    {route: "overview", label: "Overview", icon: "grid"},
    {route: "kb", label: "Knowledge base", icon: "book", perm: "kb.manage"},
    {route: "tickets", label: "Tickets", icon: "ticket", perm: "tickets.view"},
    {route: "conversations", label: "Conversations", icon: "chat", perm: "chats.view"},
    {route: "usage", label: "Usage", icon: "chart", perm: "logs.view"},
    {route: "users", label: "Users & roles", icon: "users", perm: "users.manage"},
    {route: "settings", label: "Settings", icon: "settings", perm: "settings.manage"},
    {route: "activity", label: "Activity log", icon: "log", perm: "logs.view"},
    {route: "account", label: "My account", icon: "user"},
  ];
  const SOURCES = {chat_agent: "Chat assistant", chat_button: "Chat message"};
  const EVENTS = {created: "Created", assigned: "Assignment", priority_changed: "Priority", status_changed: "Status",
                  comment: "Reply", note: "Internal note", resolved: "Resolved", closed: "Closed",
                  approval_approved: "Change approved", approval_declined: "Change not applied"};

  /* ---------- Small builders ---------- */
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const qs = (params) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== "" && v !== null && v !== undefined && v !== false) q.set(k, v === true ? "1" : v); return q.toString(); };
  let uid = 0;
  function field(text, control, hint) {
    if (!control.id) control.id = `f${++uid}`;
    const wrap = el("div", undefined, "field");
    wrap.append(el("label", text, undefined, {for: control.id}), control);
    if (hint) wrap.append(el("p", hint, "field-hint"));
    return wrap;
  }
  const input = (attrs) => el("input", undefined, undefined, attrs);
  function select(options, value, attrs) {
    const node = el("select", undefined, undefined, attrs);
    for (const option of options) {
      const [v, text, disabled] = Array.isArray(option) ? option : [option, CD.label(option)];
      const opt = el("option", text, undefined, {value: v, disabled});
      if (String(v) === String(value ?? "")) opt.selected = true;
      node.append(opt);
    }
    return node;
  }
  function check(text, checked, attrs) {
    const box = input({type: "checkbox", ...attrs}); box.checked = !!checked;
    const wrap = el("label", undefined, "checkbox"); wrap.append(box, el("span", text));
    return [wrap, box];
  }
  function head(title, text, ...actions) {
    const node = el("div", undefined, "section-head");
    // The top bar already shows the page name as the <h1>; repeat it here only when it says something different.
    const left = el("div"); if (title !== $("page-title").textContent) left.append(el("h2", title)); if (text) left.append(el("p", text));
    const right = el("div", undefined, "row"); right.append(...actions.filter(Boolean));
    node.append(left, right); return node;
  }
  function card(title, ...children) {
    const node = el("section", undefined, "card card-pad panel");
    if (title) node.append(el("h3", title, "panel-title"));
    node.append(...children.filter(Boolean)); return node;
  }
  function table(headers, items, cells, onOpen, selected) {
    const wrap = el("div", undefined, "table-wrap");
    const tableNode = el("table"), headRow = el("tr"), body = el("tbody");
    headers.forEach(h => headRow.append(el("th", h, undefined, {scope: "col"})));
    for (const item of items) {
      const row = el("tr");
      for (const cell of cells(item)) {
        const td = el("td");
        if (cell instanceof Node) td.append(cell); else td.textContent = cell ?? "—";
        row.append(td);
      }
      if (onOpen) {
        // The whole row is clickable with a mouse; keyboard and screen-reader users get a real
        // button in the first cell, so the action is announced and reachable with Tab.
        row.className = "clickable";
        if (selected && selected(item)) row.setAttribute("aria-current", "true");
        // Use the row's main label (the bold subject/title) so the button says which item it opens.
        const primary = [...row.children].find(td => td.querySelector(".cell-stack strong, strong")) || row.firstElementChild;
        const open = el("button", undefined, "row-link", {type: "button"});
        open.append(...primary.childNodes);
        open.addEventListener("click", () => onOpen(item));
        primary.replaceChildren(open);
        // Rows can share a label (e.g. the same student), so the accessible name summarises the whole row.
        const cellText = (td) => { const parts = [], walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT); while (walk.nextNode()) if (walk.currentNode.textContent.trim()) parts.push(walk.currentNode.textContent.trim()); return parts.join(" "); };
        open.setAttribute("aria-label", "Open: " + [...row.children].map(cellText).filter(Boolean).join(", ").slice(0, 140));
        row.addEventListener("click", (e) => { if (!e.target.closest("button, a, select, input")) onOpen(item); });
      }
      body.append(row);
    }
    const thead = el("thead"); thead.append(headRow); tableNode.append(thead, body); wrap.append(tableNode);
    return wrap;
  }
  function stack(primary, secondary) { const node = el("div", undefined, "cell-stack"); node.append(el("strong", primary), el("small", secondary, "muted")); return node; }
  function back(hash, text) { const link = el("a", undefined, "link-button back-link", {href: hash}); link.append(icon("chevron", 14), el("span", text)); return link; }
  function debounce(fn, wait = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
  function bubble(message) {
    const node = el("div", undefined, `bubble bubble-${message.role}${message.redacted ? " bubble-redacted" : ""}`);
    const meta = el("div", undefined, "bubble-meta");
    meta.append(el("span", message.role === "user" ? "Student" : "Assistant"));
    if (message.created_at) meta.append(el("span", CD.time(message.created_at)));
    if (message.redacted) node.append(el("p", "Sensitive message withheld — the original text was never stored.", "muted"));
    else if (message.role === "assistant") node.append(CD.markdown(message.content));
    else node.append(el("p", message.content));
    const extra = message.meta || {};
    if ((extra.sources || []).length) {
      const chips = el("div", undefined, "chips");
      for (const s of extra.sources) chips.append(el("span", `${s.id} · ${s.title}`, "cite", {title: s.source || ""}));
      node.append(chips);
    }
    if ((extra.tickets || []).length) {
      const chips = el("div", undefined, "chips");
      for (const t of extra.tickets) {
        const chip = el(perms.has("tickets.view") ? "a" : "span", t.id, "cite cite-ticket", perms.has("tickets.view") ? {href: `#/tickets/${t.id}`} : undefined);
        chips.append(chip);
      }
      node.append(chips);
    }
    const wrap = el("div", undefined, `bubble-row bubble-row-${message.role}`); wrap.append(meta, node);
    return wrap;
  }

  /* ---------- Error handling ---------- */
  function handle(error, container, retry) {
    if (error.status === 401) { boot(); return; }
    if (error.status === 403) { CD.empty(container, "Your role does not have permission", "Ask an administrator if you need access to this area.", "lock"); return; }
    CD.failed(container, error, retry);
  }
  async function load(container, loader) {
    CD.loading(container);
    try { await loader(); } catch (error) { handle(error, container, () => load(container, loader)); }
  }
  async function action(buttonNode, fn, success) {
    try { const result = await CD.busy(buttonNode, fn); if (buttonNode) CD.clearFieldError(buttonNode); if (success) CD.toast(success); return result; }
    catch (error) { if (error.status === 401) boot(); else CD.fieldError(buttonNode, error.message); throw error; }
  }
  const quiet = (promise) => promise.catch(() => {});

  /* ---------- Session and shell ---------- */
  function show(id) { for (const s of ["boot", "login", "student-notice", "app"]) $(s).hidden = s !== id; }
  async function boot() {
    try { session = await api("/api/session"); }
    catch (error) { show("login"); $("login-error").textContent = error.message; $("login-error").hidden = false; return; }
    if (session.staff) return startApp();
    show(session.student ? "student-notice" : "login");
    if (!session.student) $("login-id").focus();
  }
  function startApp() {
    perms = new Set(session.staff.permissions);
    $("staff-name").textContent = session.staff.name;
    $("staff-role").textContent = `${session.staff.role_label} · ${session.staff.id}`;
    $("staff-avatar").textContent = CD.initials(session.staff.name);
    const pill = $("model-status");
    pill.textContent = session.configured ? `Groq · ${session.model}` : "Groq not configured";
    pill.classList.toggle("off", !session.configured);
    const nav = $("nav"); nav.replaceChildren();
    for (const item of NAV) {
      if (item.perm && !perms.has(item.perm)) continue;
      const link = el("a", undefined, "nav-item", {href: `#/${item.route}`, "data-route": item.route});
      link.append(icon(item.icon), el("span", item.label));
      link.addEventListener("click", closeNav);
      nav.append(link);
    }
    show("app");
    route();
  }
  function closeNav() { $("app").classList.remove("nav-open"); $("menu").setAttribute("aria-expanded", "false"); }
  async function logout() {
    try { await api("/api/logout", json("POST")); } catch { /* signed out either way */ }
    session = null; location.hash = ""; boot();
  }

  let routed = false;
  async function route() {
    if (!session || !session.staff) return;
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const item = NAV.find(n => n.route === parts[0]) || NAV[0];
    document.querySelectorAll("#nav .nav-item").forEach(a => {
      if (a.dataset.route === item.route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("page-title").textContent = item.label;
    document.title = `${item.label} · Yukti Admin`;
    closeNav();
    // After the first page, move focus to the new page's heading instead of leaving it on the body.
    if (routed) CD.focusHeading($("page-title"));
    routed = true;
    const content = $("content");
    const page = el("div", undefined, "page");
    content.replaceChildren(page);
    if (item.perm && !perms.has(item.perm)) return CD.empty(page, "Your role does not have permission", "Ask an administrator if you need access to this area.", "lock");
    await VIEWS[item.route](page, parts.slice(1));
  }

  /* ---------- Overview ---------- */
  function stat(label, value, iconName, hash, tone) {
    const node = el(hash ? "a" : "div", undefined, `stat${tone ? " stat-" + tone : ""}`, hash ? {href: hash} : undefined);
    const top = el("div", undefined, "stat-icon"); top.append(icon(iconName, 18));
    const number = el("strong", String(value ?? 0));
    node.append(top, number, el("span", label));
    if (typeof value === "number") CD.countUp(number, value);
    return node;
  }
  async function overview(page) {
    page.append(head(`Welcome, ${session.staff.name.split(" ")[0]}`, "A summary of the areas your role can access."));
    const body = el("div"); page.append(body);
    await load(body, async () => {
      const data = await api("/api/admin/overview");
      body.replaceChildren();
      // What needs action comes first; reference numbers sit in a compact strip below.
      const attention = [];
      if (data.tickets) attention.push(
        ["Unassigned tickets", data.tickets.unassigned, "inbox", "#/tickets", "warn"],
        ["High or urgent", data.tickets.urgent, "alert", "#/tickets", "danger"],
        ["Assigned to me", data.tickets.mine, "user", "#/tickets", "info"]);
      if (data.approvals) attention.push(["Changes awaiting approval", data.approvals.pending, "shield", "#/tickets", "warn"]);
      if (data.knowledge) attention.push(["Documents failed to index", data.knowledge.failed, "alert", "#/kb", "danger"]);
      if (attention.length) {
        const section = el("section", undefined, "attention");
        const live = attention.filter(([, value]) => value > 0);
        section.append(el("h2", live.length ? "Needs attention" : "Nothing needs attention right now", "section-title"));
        if (live.length) {
          const grid = el("div", undefined, "stat-grid attention-grid");
          live.forEach(([label, value, iconName, hash, tone]) => grid.append(stat(label, value, iconName, hash, tone)));
          section.append(grid);
        }
        const clear = attention.filter(([, value]) => !value).map(([label]) => label.toLowerCase());
        if (clear.length && live.length) section.append(el("p", `Nothing waiting in: ${clear.join(", ")}.`, "muted small"));
        body.append(section);
      }
      const glance = [];
      if (data.tickets) glance.push(["Open tickets", data.tickets.open, "#/tickets"]);
      if (data.knowledge) glance.push(["Indexed documents", data.knowledge.indexed, "#/kb"], ["Policy sections", data.knowledge.sections, "#/kb"]);
      if (data.chats) glance.push(["Conversations", data.chats.threads, "#/conversations"], ["Messages today", data.chats.today, "#/conversations"]);
      if (data.users) glance.push(["Active students", data.users.students, "#/users"], ["Active staff", data.users.staff, "#/users"]);
      if (glance.length) {
        const strip = el("dl", undefined, "glance", {"aria-label": "At a glance"});
        for (const [label, value, hash] of glance) {
          const item = el("div"); const link = el("a", undefined, undefined, {href: hash});
          link.append(el("dt", label), el("dd", String(value ?? 0))); item.append(link); strip.append(item);
        }
        body.append(strip);
      }
      const grid = el("div", undefined, "panel-grid");
      if (data.tickets) {
        const total = Object.values(data.tickets.by_status).reduce((a, b) => a + b, 0) || 1;
        const list = el("div", undefined, "breakdown");
        for (const [status, count] of Object.entries(data.tickets.by_status)) {
          const row = el("div", undefined, "breakdown-row");
          const bar = el("progress", undefined, `bar bar-${status}`, {value: count, max: total, "aria-label": `${CD.label(status)}: ${count}`});
          row.append(CD.badge(status), bar, el("strong", String(count)));
          list.append(row);
        }
        grid.append(card("Tickets by status", list));
        const recent = el("div");
        if (data.tickets.recent.length) recent.append(table(["Ticket", "Student", "Priority", "Status", "Updated"], data.tickets.recent,
          t => [stack(t.subject || t.id, t.id), t.student_name, CD.badge(t.priority), CD.badge(t.status), CD.relative(t.updated_at)], t => go(`#/tickets/${t.id}`)));
        else CD.empty(recent, "No tickets yet", "Tickets raised from the student chat appear here.", "ticket");
        // Full-width row so the ticket table has room; status and activity share the row below.
        const recentCard = card("Recently updated tickets", recent);
        recentCard.classList.add("panel-full");
        grid.prepend(recentCard);
      }
      if (data.activity) {
        const recent = el("div");
        if (data.activity.length) recent.append(table(["Time", "Actor", "Action", "Decision"], data.activity,
          a => [CD.relative(a.timestamp), a.actor, CD.label(a.action), CD.badge(a.decision)]));
        else CD.empty(recent, "No activity yet");
        const more = el("a", "Open activity log", "link-button", {href: "#/activity"});
        grid.append(card("Recent activity", recent, more));
      }
      if (grid.children.length) body.append(grid);
      if (!body.querySelector(".attention, .glance") && !grid.children.length) CD.empty(body, "Nothing to show", "Your role has no dashboard areas yet. Use My account to manage your password.", "grid");
    });
  }

  /* ---------- Knowledge base ---------- */
  const kbFilters = {q: "", category: "", status: ""};
  async function kb(page, [id, mode]) {
    if (id === "new") return kbForm(page, null);
    if (id && mode === "edit") return kbForm(page, Number(id));
    if (id) return kbDetail(page, Number(id));
    const newButton = CD.button("New document", "primary", "plus"); newButton.addEventListener("click", () => go("#/kb/new"));
    page.append(head("Knowledge base", "Policy documents the assistant searches. Each section is indexed and cited by its ID.", newButton));
    const body = el("div", undefined, "stack"); page.append(body);
    await load(body, async () => {
      const data = await api("/api/admin/kb");
      body.replaceChildren();
      const q = input({type: "search", placeholder: "Filter by title", value: kbFilters.q});
      const category = select([["", "All categories"], ...data.categories.map(c => [c, c])], kbFilters.category);
      const status = select([["", "All statuses"], "indexed", "failed", "archived", "pending", "processing"], kbFilters.status);
      const bar = el("div", undefined, "filter-bar");
      bar.append(field("Search", q), field("Category", category), field("Status", status));
      const list = el("div");
      const render = () => {
        Object.assign(kbFilters, {q: q.value.trim(), category: category.value, status: status.value});
        const items = data.items.filter(d => (!kbFilters.category || d.category === kbFilters.category) && (!kbFilters.status || d.status === kbFilters.status) &&
          (!kbFilters.q || d.title.toLowerCase().includes(kbFilters.q.toLowerCase())));
        if (!items.length) return CD.empty(list, data.items.length ? "No documents match" : "No documents yet", data.items.length ? "Change the filters to see more." : "Create a document to start the knowledge base.", "book");
        list.replaceChildren(table(["Title", "Category", "Status", "Sections", "Version", "Updated"], items,
          d => [stack(d.title, d.source.startsWith("seed:") ? `Bundled · ${d.source.slice(5)}` : `Added by ${d.created_by}`), d.category, CD.badge(d.status), String(d.chunk_count), `v${d.version}`, CD.relative(d.updated_at)],
          d => go(`#/kb/${d.id}`)));
      };
      q.addEventListener("input", debounce(render, 150)); category.addEventListener("change", render); status.addEventListener("change", render);
      render();
      body.append(bar, list, retrievalTester());
    });
  }
  function retrievalTester() {
    const form = el("form", undefined, "tester");
    const query = input({type: "search", placeholder: "e.g. What is the late fee?", maxlength: 300, required: true});
    const run = el("button", undefined, "secondary", {type: "submit"}); run.append(icon("search", 16), el("span", "Search"));
    const row = el("div", undefined, "tester-row"); row.append(field("Test question", query), run);
    const results = el("div", undefined, "tester-results");
    form.append(row, results);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (query.value.trim().length < 2) return CD.fieldError(query, "Enter at least two characters.", query);
      const data = await quiet(action(run, () => api("/api/admin/kb/search", json("POST", {query: query.value.trim()}))));
      if (!data) return;
      if (!data.items.length) return CD.empty(results, "No section matched", "The assistant would say the knowledge base does not answer this.", "search");
      results.replaceChildren(...data.items.map(c => {
        const item = el("div", undefined, "match");
        item.append(el("span", c.id, "cite"), stack(c.title, `${c.source} · ${c.category}`), el("span", `score ${c.score}`, "muted small"));
        return item;
      }));
    });
    return card("Test retrieval", el("p", "Shows which sections the assistant would receive for a question, using the current top-k setting.", "muted small"), form);
  }
  async function kbDetail(page, id) {
    page.append(back("#/kb", "All documents"));
    const body = el("div", undefined, "stack"); page.append(body);
    await load(body, async () => {
      const doc = await api(`/api/admin/kb/${id}`);
      body.replaceChildren();
      const edit = CD.button("Edit", "secondary", "edit"); edit.addEventListener("click", () => go(`#/kb/${id}/edit`));
      const archived = doc.status === "archived";
      const reindex = CD.button("Reindex", "secondary", "refresh", {disabled: archived});
      reindex.addEventListener("click", () => quiet(action(reindex, () => api(`/api/admin/kb/${id}/reindex`, json("POST")))).then(r => r && (CD.toast(r.status === "indexed" ? `Indexed ${sectionCount(r.chunk_count)}.` : "Indexing failed.", r.status === "indexed" ? "info" : "error"), route())));
      const archive = CD.button(archived ? "Restore" : "Archive", "secondary", "archive");
      archive.addEventListener("click", () => quiet(action(archive, () => api(`/api/admin/kb/${id}/archive`, json("POST", {archived: !archived})), archived ? "Document restored." : "Document archived. The assistant no longer uses it.")).then(r => r && route()));
      const remove = CD.button("Delete", "ghost danger-text", "trash");
      remove.addEventListener("click", async () => {
        if (!await CD.confirmDialog("Delete this document?", `“${doc.title}” and its ${sectionCount(doc.chunk_count)} will be removed permanently. Archive it instead to keep a copy.`, "Delete", true)) return;
        await quiet(action(remove, () => api(`/api/admin/kb/${id}`, json("DELETE")), "Document deleted."));
        go("#/kb");
      });
      body.append(head(doc.title, `${doc.category} · version ${doc.version} · ${doc.source.startsWith("seed:") ? "bundled file " + doc.source.slice(5) : "added by " + doc.created_by}`, edit, reindex, archive, remove));
      const status = el("div", undefined, "row doc-status");
      status.append(CD.badge(doc.status), el("span", `${sectionCount(doc.chunk_count)}`, "muted"), el("span", doc.indexed_at ? `Indexed ${CD.date(doc.indexed_at)}` : "Not indexed", "muted"), el("span", `Updated ${CD.date(doc.updated_at)}`, "muted"));
      body.append(status);
      if (doc.status === "failed" && doc.error) {
        const banner = el("div", undefined, "banner", {role: "alert"}); banner.append(icon("alert"), el("span", `Indexing failed: ${doc.error} Edit the document to fix it, then save.`));
        body.append(banner);
      }
      if (archived) { const banner = el("div", undefined, "banner info"); banner.append(icon("archive"), el("span", "Archived documents are not searched. Restore to index it again.")); body.append(banner); }
      if (doc.questions.length) {
        const list = el("ul", undefined, "question-list"); doc.questions.forEach(q => list.append(el("li", q)));
        body.append(card("Suggested follow-up questions", list));
      }
      const sections = el("div", undefined, "sections");
      if (!doc.chunks.length) CD.empty(sections, "No indexed sections", archived ? "Restore the document to index it." : "Reindex or fix the document to create sections.", "file");
      for (const chunk of doc.chunks) {
        const details = el("details", undefined, "section-item");
        const summary = el("summary"); summary.append(el("span", chunk.id, "cite"), el("span", chunk.title));
        details.append(summary, CD.markdown(chunk.text)); sections.append(details);
      }
      body.append(card("Indexed sections", sections));
    });
  }
  function titleFromText(text, fileName) {
    const front = text.match(/^---\n[\s\S]*?^title:\s*(.+)$/m);
    const heading = text.match(/^#\s+(.+)$/m);
    return (front && front[1].trim()) || (heading && heading[1].replace(/—.*$/, "").trim()) || fileName.replace(/\.(md|txt)$/i, "").replace(/[_-]+/g, " ");
  }
  async function kbForm(page, id) {
    page.append(back(id ? `#/kb/${id}` : "#/kb", id ? "Back to document" : "All documents"));
    const body = el("div"); page.append(body);
    await load(body, async () => {
      const [doc, meta] = await Promise.all([id ? api(`/api/admin/kb/${id}`) : Promise.resolve(null), api("/api/admin/kb")]);
      body.replaceChildren();
      const form = el("form", undefined, "card card-pad kb-form", {novalidate: true});
      const title = input({maxlength: 120, required: true, value: doc?.title || "", placeholder: "Fees and payments guide"});
      const category = select(meta.categories.map(c => [c, c]), doc?.category || "General");
      const questions = el("textarea", undefined, undefined, {rows: 3, placeholder: "What is the late fee if I pay after the due date?"});
      questions.value = (doc?.questions || []).join("\n");
      const content = el("textarea", undefined, "mono", {rows: 18, required: true, spellcheck: "false"});
      content.value = doc?.content || "";
      const file = input({type: "file", accept: ".md,.txt,text/markdown,text/plain"});
      file.addEventListener("change", () => {
        const chosen = file.files[0]; if (!chosen) return;
        if (chosen.size > 800_000) { CD.fieldError(file, "That file is too large. Keep documents under 200,000 characters.", file); file.value = ""; return; }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          const text = String(reader.result).replace(/\r\n/g, "\n");
          if (text.length > 200_000) { CD.fieldError(file, "That file has more than 200,000 characters.", file); file.value = ""; return; }
          content.value = text;
          if (!title.value.trim()) title.value = titleFromText(text, chosen.name).slice(0, 120);
          CD.toast(`Loaded ${chosen.name}. Review it, then save to index.`);
        });
        reader.addEventListener("error", () => CD.fieldError(file, "The file could not be read.", file));
        reader.readAsText(chosen);
      });
      const hint = el("div", undefined, "format-hint");
      hint.append(el("strong", "Format"), el("p", "Start each section with a heading like “## LATE-07 | Late payment penalties”. Headings without an ID are numbered automatically (DOC<n>-01). Text before the first section is ignored. Plain text with no headings becomes one section."));
      const error = el("p", undefined, "error-text", {role: "alert", hidden: true});
      const save = el("button", undefined, "primary", {type: "submit"}); save.append(el("span", id ? "Save and reindex" : "Create and index"));
      const cancel = el("a", "Cancel", "secondary", {href: id ? `#/kb/${id}` : "#/kb"});
      const grid = el("div", undefined, "form-grid"); grid.append(field("Title", title), field("Category", category));
      const actions = el("div", undefined, "row form-actions"); actions.append(save, cancel);
      form.append(el("h2", id ? `Edit “${doc.title}”` : "New document"), grid,
        field("Suggested follow-up questions", questions, "One per line, up to six. Shown to students after answers that cite this document."),
        field("Load from a .md or .txt file", file, "Optional. Replaces the text below."),
        hint, field("Document text", content, "Up to 200,000 characters."), error, actions);
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); error.hidden = true;
        const payload = {title: title.value.trim(), category: category.value, content: content.value,
                         questions: questions.value.split("\n").map(q => q.trim()).filter(Boolean)};
        try {
          const result = await CD.busy(save, () => api(id ? `/api/admin/kb/${id}` : "/api/admin/kb", json(id ? "PUT" : "POST", payload)));
          if (result.status === "failed") CD.toast(`Saved, but indexing failed: ${result.error}`, "error");
          else CD.toast(`Saved and indexed ${sectionCount(result.chunk_count)}.`);
          go(`#/kb/${result.id}`);
        } catch (err) {
          if (err.status === 401) return boot();
          error.textContent = err.message; error.hidden = false;
        }
      });
      body.append(form);
    });
  }

  /* ---------- Tickets ---------- */
  const ticketFilters = {open: true, status: "", priority: "", category: "", assigned: "", q: ""};
  async function tickets(page, [id]) {
    page.append(head("Tickets", "Requests raised by students from chat, with the conversation captured at creation."));
    const split = el("div", undefined, `split${id ? " has-detail" : ""}`);
    const listPane = el("div", undefined, "split-list"), detailPane = el("div", undefined, "split-detail");
    split.append(listPane, detailPane); page.append(split);
    let meta = null;
    const listBody = el("div");
    const reloadList = () => load(listBody, async () => {
      const data = await api(`/api/admin/tickets?${qs({...ticketFilters, limit: 100})}`);
      meta = data;
      if (!data.items.length) return CD.empty(listBody, "No tickets match", ticketFilters.open ? "Turn off “Open only” to include resolved tickets." : "Tickets raised from chat appear here.", "ticket");
      listBody.replaceChildren(el("p", `${data.total} ticket${data.total === 1 ? "" : "s"}`, "muted small list-count"),
        table(["Priority", "Ticket", "Student", "Status", "Assignee", "Updated"], data.items,
          t => [CD.badge(t.priority), stack(t.subject || t.id, `${t.id} · ${CD.label(t.category)}`), t.student_name, CD.badge(t.status), t.assigned_name || el("span", "Unassigned", "muted"), CD.relative(t.updated_at)],
          t => go(`#/tickets/${t.id}`), t => t.id === id));
      return data;
    });
    listPane.append(ticketFilterBar(reloadList), listBody);
    await reloadList();
    if (id) {
      detailPane.append(back("#/tickets", "All tickets"));
      const detail = el("div"); detailPane.append(detail);
      await load(detail, async () => renderTicket(detail, await api(`/api/admin/tickets/${encodeURIComponent(id)}`), meta));
    } else {
      const hint = el("div", undefined, "card split-placeholder"); CD.empty(hint, "Select a ticket", "Open a ticket to assign it, reply, change its priority or resolve it.", "ticket");
      detailPane.append(hint);
    }
  }
  function ticketFilterBar(reload) {
    const bar = el("div", undefined, "filter-bar");
    const [openWrap, open] = check("Open only", ticketFilters.open);
    const status = select([["", "Any status"], ...["open", "in_progress", "waiting_on_student", "resolved", "closed"]], ticketFilters.status);
    const priority = select([["", "Any priority"], ...(session.priorities || ["low", "normal", "high", "urgent"])], ticketFilters.priority);
    const category = select([["", "Any category"], ...(session.ticket_categories || [])], ticketFilters.category);
    const assigned = select([["", "Anyone"], ["me", "Assigned to me"], ["none", "Unassigned"]], ticketFilters.assigned);
    const q = input({type: "search", placeholder: "ID, subject or student", value: ticketFilters.q, maxlength: 80});
    const apply = () => { Object.assign(ticketFilters, {open: open.checked, status: status.value, priority: priority.value, category: category.value, assigned: assigned.value, q: q.value.trim()}); reload(); };
    [open, status, priority, category, assigned].forEach(c => c.addEventListener("change", apply));
    q.addEventListener("input", debounce(apply));
    bar.append(field("Search", q), field("Status", status), field("Priority", priority), field("Category", category), field("Assignee", assigned), openWrap);
    return bar;
  }
  function renderTicket(container, t, meta) {
    container.replaceChildren();
    const manage = perms.has("tickets.manage");
    const closed = t.status === "resolved" || t.status === "closed";
    let manageCard;
    const top = el("div", undefined, "ticket-head");
    const badges = el("div", undefined, "row"); badges.append(CD.badge(t.priority), CD.badge(t.status), el("span", t.id, "ticket-id"));
    top.append(badges, el("h2", t.subject || t.id),
      el("p", `${t.student_name} (${t.student_id}) · ${CD.label(t.category)} · ${SOURCES[t.source] || CD.label(t.source)} · opened ${CD.date(t.created_at)}`, "muted small"));
    container.append(top);
    const description = card("Description", el("p", t.description, "pre-wrap"));
    container.append(description);
    if (t.approval) container.append(approvalCard(t, () => refresh()));
    if (t.resolution) {
      const banner = el("div", undefined, "banner info resolution"); banner.append(icon("check"), el("div"));
      banner.lastChild.append(el("strong", `Resolution${t.resolved_at ? " · " + CD.date(t.resolved_at) : ""}`), el("p", t.resolution, "pre-wrap"));
      container.append(banner);
    }
    const refresh = async () => { const fresh = await api(`/api/admin/tickets/${encodeURIComponent(t.id)}`); renderTicket(container, fresh, meta); };
    if (manage) {
      const staff = meta?.staff || [];
      const statuses = (meta?.statuses || ["open", "in_progress", "waiting_on_student", "resolved", "closed"]).map(s => s === "resolved" ? [s, "Resolved (use Resolve)", true] : s);
      const assignee = select([["", "Unassigned"], ...staff.map(s => [s.id, `${s.name} · ${CD.label(s.role)}`])], t.assigned_to || "");
      const status = select(statuses, t.status);
      const priority = select(meta?.priorities || session.priorities, t.priority);
      const patch = async (control, body, message) => {
        control.disabled = true;
        try { await api(`/api/admin/tickets/${encodeURIComponent(t.id)}`, json("PATCH", body)); CD.toast(message); await refresh(); }
        catch (error) { if (error.status === 401) return boot(); CD.fieldError(control, error.message, control); control.disabled = false; }
      };
      assignee.addEventListener("change", () => patch(assignee, {assigned_to: assignee.value || null}, assignee.value ? "Ticket assigned." : "Ticket unassigned."));
      status.addEventListener("change", () => patch(status, {status: status.value}, "Status updated."));
      priority.addEventListener("change", () => patch(priority, {priority: priority.value}, "Priority updated."));
      const quick = el("div", undefined, "form-grid ticket-controls");
      quick.append(field("Assignee", assignee), field("Status", status), field("Priority", priority));
      if (!t.assigned_to || t.assigned_to !== session.staff.id) {
        const mine = CD.button("Assign to me", "link-button");
        mine.addEventListener("click", () => patch(assignee, {assigned_to: session.staff.id}, "Assigned to you."));
        quick.append(mine);
      }
      manageCard = card("Manage", quick);
      container.append(manageCard);
    } else {
      manageCard = card("Assignment", el("p", t.assigned_name ? `Assigned to ${t.assigned_name}` : "Unassigned", "muted"));
      container.append(manageCard);
    }
    // Show the last two messages; the rest is one click away.
    const conversation = el("div", undefined, "bubbles");
    if (t.context.length) {
      const hiddenCount = Math.max(0, t.context.length - 2);
      t.context.forEach((m, i) => { const node = bubble(m); if (i < hiddenCount) node.hidden = true; conversation.append(node); });
      if (hiddenCount) {
        const more = CD.button(`Show all ${t.context.length} messages`, "link-button", "chevron");
        more.addEventListener("click", () => { conversation.querySelectorAll("[hidden]").forEach(n => { n.hidden = false; }); more.remove(); });
        conversation.prepend(more);
      }
    } else conversation.append(el("p", "No conversation was attached to this ticket.", "muted small"));
    const convoCard = card("Conversation captured at creation", conversation);
    if (t.thread_id && perms.has("chats.view")) convoCard.append(el("a", "Open the full conversation", "link-button", {href: `#/conversations/${t.thread_id}`}));
    container.append(convoCard);
    const timeline = el("ol", undefined, "timeline");
    for (const e of t.events) {
      const item = el("li", undefined, `timeline-item${e.internal ? " internal" : ""} event-${e.event}`);
      const line = el("div", undefined, "timeline-head");
      line.append(el("strong", e.internal ? "Internal note" : (EVENTS[e.event] || CD.label(e.event))), el("span", `${e.actor_name} · ${CD.label(e.actor_role)}`, "muted"), el("time", CD.relative(e.created_at), "muted", {datetime: e.created_at, title: CD.date(e.created_at)}));
      item.append(line, el("p", e.detail, "pre-wrap"));
      timeline.append(item);
    }
    const historyCard = card("History", timeline);
    container.append(historyCard);
    if (!manage) return;
    const reply = el("form", undefined, "reply-form");
    const text = el("textarea", undefined, undefined, {rows: 3, maxlength: 2000, required: true, placeholder: "Write a reply the student can see, or an internal note."});
    const [internalWrap, internal] = check("Internal note (hidden from the student)", false);
    const [awaitWrap, awaitStudent] = check("Ask the student to reply", false);
    internal.addEventListener("change", () => { awaitStudent.disabled = internal.checked; if (internal.checked) awaitStudent.checked = false; });
    const send = el("button", undefined, "primary", {type: "submit"}); send.append(icon("send", 16), el("span", "Add"));
    const options = el("div", undefined, "row"); options.append(internalWrap, awaitWrap, el("span", undefined, "spacer"), send);
    reply.append(field("Reply", text), options);
    reply.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return CD.fieldError(text, "Write a reply first.", text);
      const ok = await quiet(action(send, () => api(`/api/admin/tickets/${encodeURIComponent(t.id)}/comments`, json("POST", {body: text.value.trim(), internal: internal.checked, await_student: awaitStudent.checked})), internal.checked ? "Internal note added." : "Reply sent to the student."));
      if (ok) renderTicket(container, ok, meta);
    });
    const respondCard = card("Respond", reply);
    let resolveCard = null;
    if (!closed) {
      const resolveForm = el("form", undefined, "reply-form");
      const resolution = el("textarea", undefined, undefined, {rows: 3, maxlength: 2000, required: true, placeholder: "What was done to resolve this request?"});
      const resolveButton = el("button", undefined, "primary", {type: "submit"}); resolveButton.append(icon("check", 16), el("span", "Resolve ticket"));
      const row = el("div", undefined, "row"); row.append(el("span", "The student sees the resolution on their ticket.", "muted small"), el("span", undefined, "spacer"), resolveButton);
      resolveForm.append(field("Resolution", resolution), row);
      resolveForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (resolution.value.trim().length < 5) return CD.fieldError(resolution, "Describe the resolution in at least 5 characters.", resolution);
        const ok = await quiet(action(resolveButton, () => api(`/api/admin/tickets/${encodeURIComponent(t.id)}/resolve`, json("POST", {resolution: resolution.value.trim()})), "Ticket resolved."));
        if (ok) route();
      });
      resolveCard = card("Resolve", resolveForm);
    }
    // Staff actions first, then assignment, the captured conversation and the history.
    container.append(...[respondCard, resolveCard, manageCard, convoCard, historyCard].filter(Boolean));
  }

  /* A student record change that staff must approve or decline. Deciding it also resolves the ticket. */
  function approvalCard(t, refresh) {
    const a = t.approval;
    const body = el("div", undefined, "stack");
    const change = el("p", undefined, "approval-change");
    change.append(el("span", a.old_value, "muted"), el("span", " → "), el("strong", a.new_value));
    const what = a.field === "email" ? "Registered email change" : CD.label(a.field) + " change";
    const head = el("div", undefined, "row"); head.append(el("strong", what), CD.badge(a.status));
    body.append(head, change);
    if (a.status !== "pending") {
      body.append(el("p", `Decided ${CD.date(a.decided_at)}${a.decided_by ? " by " + a.decided_by : ""}${a.decision_note ? " · " + a.decision_note : ""}`, "muted small"));
      return card("Requested change", body);
    }
    if (new Date(a.expires_at) <= new Date()) { body.append(el("p", "This request has expired. Decide it to close the ticket.", "muted small")); }
    if (!perms.has("approvals.decide")) {
      body.append(el("p", "Waiting for an administrator to approve or decline. Your role cannot decide record changes.", "muted small"));
      return card("Requested change", body);
    }
    body.append(el("p", `The student's record changes only if you approve. Expires ${CD.date(a.expires_at)}.`, "muted small"));
    const note = el("textarea", undefined, undefined, {rows: 2, maxlength: 500, placeholder: "Note for the student (required when declining)"});
    const approve = el("button", undefined, "primary", {type: "button"}); approve.append(icon("check", 16), el("span", "Approve change"));
    const decline = el("button", undefined, "secondary", {type: "button"}); decline.append(icon("x", 16), el("span", "Decline"));
    const decide = async (decision, buttonNode) => {
      if (decision === "reject" && !note.value.trim()) return CD.fieldError(note, "Give the student a reason for declining.", note);
      if (decision === "approve" && !await CD.confirmDialog("Approve this change?", `${what}: ${a.old_value} → ${a.new_value}. The student's record is updated immediately.`, "Approve")) return;
      const result = await quiet(action(buttonNode, () => api(`/api/admin/approvals/${encodeURIComponent(a.id)}/decision`, json("POST", {decision, note: note.value.trim()}))));
      if (result) { CD.toast(result.executed ? "Change approved and applied." : `Request ${CD.label(result.status).toLowerCase()}. The record is unchanged.`); refresh(); }
      else refresh();
    };
    approve.addEventListener("click", () => decide("approve", approve));
    decline.addEventListener("click", () => decide("reject", decline));
    const actions = el("div", undefined, "row"); actions.append(el("span", undefined, "spacer"), decline, approve);
    body.append(field("Note", note), actions);
    const box = card("Requested change", body);
    box.classList.add("approval-pending");
    return box;
  }

  /* ---------- Conversations ---------- */
  const threadFilters = {student: "", q: ""};
  async function conversations(page, [id]) {
    if (id) return conversation(page, id);
    page.append(head("Conversations", "Read-only student chat history. Opening a conversation is recorded in the activity log."));
    const body = el("div", undefined, "stack"); page.append(body);
    const list = el("div");
    const reload = () => load(list, async () => {
      const data = await api(`/api/admin/threads?${qs({...threadFilters, limit: 100})}`);
      if (!body.querySelector(".filter-bar")) body.prepend(threadFilterBar(data.students, reload));
      if (!data.items.length) return CD.empty(list, "No conversations", threadFilters.q || threadFilters.student ? "Change the filters to see more." : "Student conversations appear here once they chat.", "chat");
      list.replaceChildren(table(["Student", "Conversation", "Messages", "Withheld", "Updated"], data.items,
        t => [stack(t.student_name, t.student_id), t.title, String(t.message_count), t.withheld_count ? CD.badge(`${t.withheld_count} withheld`, "high") : "0", CD.relative(t.updated_at)],
        t => go(`#/conversations/${t.id}`)));
    });
    body.append(list);
    await reload();
  }
  function threadFilterBar(students, reload) {
    const bar = el("div", undefined, "filter-bar");
    const student = select([["", "All students"], ...students.map(s => [s.id, `${s.name} · ${s.id}`])], threadFilters.student);
    const q = input({type: "search", placeholder: "Title or message text", value: threadFilters.q, maxlength: 80});
    const apply = () => { threadFilters.student = student.value; threadFilters.q = q.value.trim(); reload(); };
    student.addEventListener("change", apply); q.addEventListener("input", debounce(apply));
    bar.append(field("Student", student), field("Search", q));
    return bar;
  }
  async function conversation(page, id) {
    page.append(back("#/conversations", "All conversations"));
    const body = el("div", undefined, "stack"); page.append(body);
    await load(body, async () => {
      const data = await api(`/api/admin/threads/${encodeURIComponent(id)}`);
      body.replaceChildren();
      const notice = el("div", undefined, "banner info"); notice.append(icon("shield"), el("span", "Opening this conversation was recorded in the activity log."));
      body.append(notice, head(data.thread.title, `${data.student.name} · ${data.student.id} · ${data.student.programme} · started ${CD.date(data.thread.created_at)}`));
      if (data.tickets.length) {
        const chips = el("div", undefined, "chips");
        for (const t of data.tickets) {
          const chip = el(perms.has("tickets.view") ? "a" : "span", undefined, "ticket-chip", perms.has("tickets.view") ? {href: `#/tickets/${t.id}`} : undefined);
          chip.append(icon("ticket", 14), el("span", `${t.id} · ${t.subject || ""}`), CD.badge(t.status));
          chips.append(chip);
        }
        body.append(card("Linked tickets", chips));
      }
      const bubbles = el("div", undefined, "bubbles transcript");
      if (!data.messages.length) bubbles.append(el("p", "This conversation has no messages.", "muted"));
      data.messages.forEach(m => bubbles.append(bubble(m)));
      body.append(card("Messages", bubbles));
    });
  }

  /* ---------- Users and roles ---------- */
  async function users(page) {
    page.append(head("Users & roles", "Manage student and staff accounts and what each staff role can do."));
    const body = el("div", undefined, "stack"); page.append(body);
    await load(body, async () => {
      const [data, permissions] = await Promise.all([api("/api/admin/users"), api("/api/admin/permissions")]);
      body.replaceChildren();
      const staffRoles = Object.entries(data.roles).filter(([r]) => r !== "student");
      body.append(card("Accounts", table(["ID", "Name", "Email", "Role", "Programme", "Status", ""], data.items, u => {
        const self = u.id === session.staff.id;
        let role = CD.badge(data.roles[u.role] || u.role, u.role === "admin" ? "in_progress" : u.role === "student" ? "closed" : "open");
        if (u.role !== "student" && !self) {
          role = select(staffRoles, u.role, {"aria-label": `Role for ${u.name}`});
          role.addEventListener("change", async () => {
            role.disabled = true;
            try { await api(`/api/admin/users/${u.id}`, json("PATCH", {role: role.value})); CD.toast(`${u.name} is now ${data.roles[role.value]}.`); }
            catch (error) { CD.fieldError(role, error.message, role); role.value = u.role; }
            finally { role.disabled = false; }
          });
        }
        const actions = el("div", undefined, "row row-tight");
        if (!self) {
          const toggle = CD.button(u.active ? "Deactivate" : "Activate", "secondary");
          toggle.addEventListener("click", async () => {
            if (u.active && !await CD.confirmDialog(`Deactivate ${u.name}?`, "They are signed out on their next request and cannot sign in until reactivated.", "Deactivate", true)) return;
            await quiet(action(toggle, () => api(`/api/admin/users/${u.id}`, json("PATCH", {active: !u.active})), u.active ? "Account deactivated." : "Account activated."));
            route();
          });
          actions.append(toggle);
        }
        const reset = CD.button("Reset password", "ghost", "lock"); reset.addEventListener("click", () => resetPassword(u));
        actions.append(reset);
        return [u.id, self ? `${u.name} (you)` : u.name, u.email, role, u.programme || "—", CD.badge(u.active ? "active" : "inactive"), actions];
      })));
      body.append(createUserForm(data), permissionMatrix(permissions));
    });
  }
  function resetPassword(user) {
    const dialog = el("dialog", undefined, "dialog");
    const form = el("form");
    const password = input({type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200});
    const error = el("p", undefined, "error-text", {role: "alert", hidden: true});
    const cancel = el("button", "Cancel", "secondary", {type: "button"});
    const save = el("button", undefined, "primary", {type: "submit"}); save.append(el("span", "Set password"));
    const actions = el("div", undefined, "dialog-actions"); actions.append(cancel, save);
    form.append(el("h3", `Reset password for ${user.name}`), el("p", "Share the new password with them through a secure channel.", "muted small"),
      field("New password", password, "At least 10 characters with a letter and a number."), error, actions);
    dialog.append(form); document.body.append(dialog);
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); error.hidden = true;
      try { await CD.busy(save, () => api(`/api/admin/users/${user.id}/password`, json("POST", {password: password.value}))); CD.toast("Password updated."); dialog.close(); }
      catch (err) { error.textContent = err.message; error.hidden = false; }
    });
    dialog.showModal(); password.focus();
  }
  function createUserForm(data) {
    const form = el("form", undefined, "create-user", {novalidate: true});
    const role = select(Object.entries(data.roles), "student");
    const id = input({required: true, maxlength: 9, placeholder: "STU003", autocomplete: "off"});
    const name = input({required: true, maxlength: 80, autocomplete: "off"});
    const email = input({type: "email", required: true, maxlength: 120, autocomplete: "off"});
    const password = input({type: "password", required: true, maxlength: 200, autocomplete: "new-password"});
    const programme = select(data.programmes, data.programmes[0]);
    const programmeField = field("Programme", programme);
    const error = el("p", undefined, "error-text", {role: "alert", hidden: true});
    role.addEventListener("change", () => { programmeField.hidden = role.value !== "student"; id.placeholder = role.value === "student" ? "STU003" : role.value === "admin" ? "ADM002" : "SUP002"; });
    const grid = el("div", undefined, "form-grid");
    grid.append(field("Role", role), field("ID", id, "Three capital letters and 3–6 digits."), field("Name", name), field("Email", email),
      field("Initial password", password, "At least 10 characters with a letter and a number."), programmeField);
    const submit = el("button", undefined, "primary", {type: "submit"}); submit.append(icon("plus", 16), el("span", "Create account"));
    form.append(grid, error, submit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); error.hidden = true;
      const payload = {role: role.value, id: id.value.trim().toUpperCase(), name: name.value.trim(), email: email.value.trim(), password: password.value};
      if (role.value === "student") payload.programme = programme.value;
      try { await CD.busy(submit, () => api("/api/admin/users", json("POST", payload))); CD.toast(`Account ${payload.id} created.`); route(); }
      catch (err) { if (err.status === 401) return boot(); error.textContent = err.message; error.hidden = false; }
    });
    return card("Create an account", form);
  }
  function permissionMatrix(data) {
    const roles = Object.keys(data.roles);
    const boxes = {};
    const wrap = el("div", undefined, "table-wrap matrix");
    const tableNode = el("table"), headRow = el("tr");
    headRow.append(el("th", "Permission", undefined, {scope: "col"}));
    roles.forEach(r => headRow.append(el("th", data.roles[r], undefined, {scope: "col"})));
    const body = el("tbody");
    for (const [key, description] of Object.entries(data.permissions)) {
      const row = el("tr"); const name = el("td"); name.append(stack(description, key)); row.append(name);
      for (const r of roles) {
        const locked = data.locked.includes(r);
        const box = input({type: "checkbox", "aria-label": `${data.roles[r]}: ${description}`, disabled: locked});
        box.checked = locked || data.matrix[r].includes(key);
        (boxes[r] ||= []).push([key, box]);
        const td = el("td", undefined, "matrix-cell"); td.append(box); row.append(td);
      }
      body.append(row);
    }
    const thead = el("thead"); thead.append(headRow); tableNode.append(thead, body); wrap.append(tableNode);
    const actions = el("div", undefined, "row form-actions");
    for (const r of roles.filter(r => !data.locked.includes(r))) {
      const save = CD.button(`Save ${data.roles[r]} permissions`, "primary", "check");
      save.addEventListener("click", () => quiet(action(save, () => api(`/api/admin/permissions/${r}`, json("PUT", {permissions: boxes[r].filter(([, b]) => b.checked).map(([k]) => k)})), `${data.roles[r]} permissions saved. They apply on the next request.`)));
      actions.append(save);
    }
    return card("Role permissions", el("p", "Administrators always hold every permission. Changes apply immediately to signed-in staff.", "muted small"), wrap, actions);
  }

  /* ---------- Settings ---------- */
  async function settings(page) {
    page.append(head("Settings", "System behaviour for retrieval, follow-up context, tickets and chat retention."));
    const body = el("div", undefined, "stack"); page.append(body);
    await load(body, async () => {
      const data = await api("/api/admin/settings");
      body.replaceChildren();
      const form = el("form", undefined, "settings-form", {novalidate: true});
      const controls = {};
      for (const [key, spec] of Object.entries(data.items)) {
        let control;
        if (spec.type === "bool") {
          const [wrap, box] = check(spec.label, spec.value); controls[key] = box;
          const holder = el("div", undefined, "field"); holder.append(wrap); form.append(holder); continue;
        }
        if (spec.type === "int") { control = input({type: "number", min: spec.min, max: spec.max, step: 1, required: true}); control.value = spec.value; }
        else if (spec.type === "choice") control = select(spec.choices, spec.value);
        else { control = input({maxlength: spec.max}); control.value = spec.value; }
        controls[key] = control;
        form.append(field(spec.label, control, spec.type === "int" ? `${spec.min}–${spec.max}. Default ${spec.default}.` : spec.type === "text" ? `Up to ${spec.max} characters. Leave empty to hide.` : `Default ${CD.label(spec.default)}.`));
      }
      const error = el("p", undefined, "error-text", {role: "alert", hidden: true});
      const save = el("button", undefined, "primary", {type: "submit"}); save.append(icon("check", 16), el("span", "Save settings"));
      form.append(error, save);
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); error.hidden = true;
        const payload = {};
        for (const [key, spec] of Object.entries(data.items)) {
          const c = controls[key];
          payload[key] = spec.type === "bool" ? c.checked : spec.type === "int" ? Number(c.value) : c.value;
          if (spec.type === "int" && (!Number.isInteger(payload[key]) || payload[key] < spec.min || payload[key] > spec.max)) {
            error.textContent = `${spec.label} must be a whole number from ${spec.min} to ${spec.max}.`; error.hidden = false; c.focus(); return;
          }
        }
        try { await CD.busy(save, () => api("/api/admin/settings", json("PUT", payload))); CD.toast("Settings saved."); }
        catch (err) { if (err.status === 401) return boot(); error.textContent = err.message; error.hidden = false; }
      });
      const model = el("dl", undefined, "facts");
      for (const [term, value] of [["Model", data.model], ["Groq API key", data.configured ? "Configured on the server" : "Not configured — chat answers are unavailable"]]) {
        const row = el("div"); row.append(el("dt", term), el("dd", value)); model.append(row);
      }
      body.append(card("System settings", form), card("Language model", model, el("p", "The model and API key are set in the server's .env file and are not editable here.", "muted small")));
    });
  }

  /* ---------- Usage: runs and token consumption per student ---------- */
  let usageRange = "30d";
  const usageSort = {key: "total_tokens", dir: -1};
  const USAGE_COLUMNS = [
    {key: "name", text: "Student"},
    {key: "runs", text: "Runs", num: true, cell: s => CDUsage.full(s.runs)},
    {key: "input_tokens", text: "Input", num: true, cell: s => CDUsage.full(s.input_tokens)},
    {key: "output_tokens", text: "Output", num: true, cell: s => CDUsage.full(s.output_tokens)},
    {key: "total_tokens", text: "Total tokens", num: true},
    {key: "avg_tokens_per_run", text: "Avg / run", num: true, cell: s => CDUsage.full(s.avg_tokens_per_run)},
    {key: "avg_latency_ms", text: "Avg response", num: true, cell: s => CDUsage.seconds(s.avg_latency_ms)},
    {key: "success_rate", text: "Completed", num: true, cell: s => CDUsage.percent(s.success_rate)},
    {key: "last_run", text: "Last run", cell: s => CD.relative(s.last_run)},
  ];
  function usageCsv(students) {
    // Quote every field; a leading = + - @ is neutralised so spreadsheets never treat a value as a formula.
    const cell = (v) => {
      let text = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const headers = ["student_id", "name", "programme", "runs", "input_tokens", "output_tokens", "total_tokens", "share", "avg_tokens_per_run", "avg_latency_ms", "success_rate", "tool_calls", "last_run"];
    const lines = [headers.join(","), ...students.map(s => [s.id, s.name, s.programme, s.runs, s.input_tokens, s.output_tokens, s.total_tokens, s.share,
      s.avg_tokens_per_run, s.avg_latency_ms, s.success_rate, s.tool_calls, s.last_run].map(cell).join(","))];
    const link = el("a", undefined, undefined, {href: URL.createObjectURL(new Blob([lines.join("\r\n")], {type: "text/csv"})), download: `campus-desk-usage-${usageRange}.csv`});
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function usageTable(container, students) {
    if (!students.length) return CD.empty(container, "No agent runs in this range", "Choose a longer time range to see consumption per student.", "chart", {compact: true});
    const value = (s, key) => key === "name" ? s.name.toLowerCase() : key === "last_run" ? s.last_run || "" : s[key] ?? -1;
    const sorted = [...students].sort((a, b) => { const x = value(a, usageSort.key), y = value(b, usageSort.key); return (x < y ? -1 : x > y ? 1 : 0) * usageSort.dir; });
    const maxShare = Math.max(...students.map(s => s.share), .0001);
    const wrap = el("div", undefined, "table-wrap"), tableNode = el("table", undefined, "usage-table"), headRow = el("tr"), body = el("tbody");
    for (const col of USAGE_COLUMNS) {
      const th = el("th", undefined, col.num ? "num" : "", {scope: "col"});
      if (usageSort.key === col.key) th.setAttribute("aria-sort", usageSort.dir > 0 ? "ascending" : "descending");
      const sortButton = el("button", col.text, undefined, {type: "button", title: `Sort by ${col.text.toLowerCase()}`});
      sortButton.addEventListener("click", () => {
        usageSort.dir = usageSort.key === col.key ? -usageSort.dir : (col.key === "name" ? 1 : -1);
        usageSort.key = col.key;
        usageTable(container, students);
        container.querySelector("th[aria-sort] button")?.focus();
      });
      th.append(sortButton); headRow.append(th);
    }
    // With chat access, a row opens that student's conversations (the first cell is the keyboard button).
    const canOpen = perms.has("chats.view");
    for (const s of sorted) {
      const row = el("tr", undefined, canOpen ? "clickable" : "");
      const open = () => { threadFilters.student = s.id; threadFilters.q = ""; go("#/conversations"); };
      for (const col of USAGE_COLUMNS) {
        const td = el("td", undefined, col.num ? "num" : "");
        if (col.key === "name") {
          const who = el(canOpen ? "button" : "div", undefined, canOpen ? "row-link who" : "who", canOpen ? {type: "button", "aria-label": `Open ${s.name}'s conversations`} : undefined);
          who.append(el("strong", s.name), el("small", [s.id, s.programme].filter(Boolean).join(" · ")));
          if (canOpen) who.addEventListener("click", open);
          td.append(who);
        } else if (col.key === "total_tokens") {
          const share = el("div", undefined, "share", {title: `${CDUsage.full(s.input_tokens)} input, ${CDUsage.full(s.output_tokens)} output · ${CDUsage.percent(s.share)} of all tokens`});
          const track = el("span", undefined, "share-track", {"aria-hidden": "true"});
          const bar = CDUsage.splitBar(s.input_tokens, s.output_tokens); bar.style.setProperty("--w", String(Math.max(3, s.share / maxShare * 100)));
          track.append(bar);
          const text = el("span"); text.append(el("strong", CDUsage.full(s.total_tokens)), el("small", ` ${CDUsage.percent(s.share)}`, "muted"));
          share.append(track, text); td.append(share);
        } else td.textContent = col.cell(s);
        row.append(td);
      }
      if (canOpen) row.addEventListener("click", (e) => { if (!e.target.closest("button")) open(); });
      body.append(row);
    }
    const thead = el("thead"); thead.append(headRow); tableNode.append(thead, body); wrap.append(tableNode);
    container.replaceChildren(wrap);
  }
  async function usage(page) {
    const csv = el("button", undefined, "secondary", {type: "button", disabled: true}); csv.append(icon("download", 16), el("span", "Download CSV"));
    page.append(head("Usage", "Agent runs, token consumption and response times across all students. Traces store measurements only, never question text.", csv));
    const note = el("span", undefined, "usage-note"), toolbar = el("div", undefined, "usage-toolbar");
    const body = el("div");
    const usageCard = (title, side, ...children) => {
      const node = el("section", undefined, "card usage-card"), top = el("div", undefined, "usage-card-head");
      top.append(el("h3", title), side); node.append(top, ...children); return node;
    };
    const kpiRow = el("div", undefined, "kpi-grid", {role: "group", "aria-label": "Usage totals"});
    const chart = el("div"), outcomesBox = el("div"), studentsBox = el("div"), toolsBox = el("div", undefined, "bar-list"), modelsBox = el("div", undefined, "bar-list");
    const bucketNote = el("span"), studentsNote = el("span");
    const top = el("div", undefined, "usage-grid");
    top.append(usageCard("Tokens over time", bucketNote, chart), usageCard("Outcomes", el("span", "Share of runs"), outcomesBox));
    const lower = el("div", undefined, "usage-grid even");
    lower.append(usageCard("Tools used", el("span", "Calls"), toolsBox), usageCard("Models", el("span", "Runs"), modelsBox));
    const studentsCard = usageCard("Consumption by student", studentsNote, studentsBox);
    let data = null, built = false;
    // Range changes keep the current frame (dimmed) while the new numbers load.
    const reload = async () => {
      if (!built) CD.loading(body); else body.classList.add("is-refreshing");
      try {
        data = await api(`/api/admin/usage?range=${usageRange}&tz=${CDUsage.tzOffset()}`);
        if (!built) { body.replaceChildren(kpiRow, top, studentsCard, lower); built = true; }
        const t = data.totals;
        note.textContent = `${data.active_students} of ${data.total_students} students used the assistant in ${CDUsage.rangeText(usageRange)}`;
        CDUsage.kpis(kpiRow, t, [{text: "Active students", value: CDUsage.full(data.active_students), iconName: "users", sub: `of ${data.total_students} student accounts`}]);
        bucketNote.textContent = data.bucket === "week" ? "Per week" : "Per day";
        CDUsage.tokenChart(chart, data.series, data.bucket);
        CDUsage.outcomes(outcomesBox, data.statuses, t.runs);
        studentsNote.textContent = perms.has("chats.view") ? "Select a student to read their conversations" : "Select a column to sort";
        usageTable(studentsBox, data.students);
        CDUsage.tools(toolsBox, data.tools);
        CDUsage.barList(modelsBox, data.models, {value: m => m.runs, name: m => m.model, emptyText: "No model calls in this range."});
        csv.disabled = !data.students.length;
      } catch (error) { built = false; handle(error, body, reload); }
      finally { body.classList.remove("is-refreshing"); }
    };
    csv.addEventListener("click", () => data && usageCsv(data.students));
    toolbar.append(CDUsage.rangeSwitch(usageRange, (key) => { usageRange = key; reload(); }), note);
    page.append(toolbar, body);
    await reload();
  }

  /* ---------- Activity log ---------- */
  const auditFilters = {actor: "", action: "", decision: "", offset: 0};
  const AUDIT_PAGE = 50;
  async function activity(page) {
    const exportLink = el("a", undefined, "secondary", {href: "/api/admin/audit/export", download: "campus-desk-activity-log.json"});
    exportLink.append(icon("download", 16), el("span", "Export"));
    page.append(head("Activity log", "Every sign-in, tool call, permission decision and staff action, newest first.", exportLink));
    const form = el("form", undefined, "filter-bar");
    const actor = input({type: "search", value: auditFilters.actor, placeholder: "STU001 or ADM001", maxlength: 60});
    const actionInput = input({type: "search", value: auditFilters.action, placeholder: "ticket_, login…", maxlength: 60});
    const decision = select([["", "Any decision"], "allowed", "denied", "approved", "not_executed", "completed", "blocked", "error"], auditFilters.decision);
    const apply = el("button", "Apply", "primary", {type: "submit"});
    const reset = el("button", "Reset", "ghost", {type: "button"});
    const buttons = el("div", undefined, "row filter-actions"); buttons.append(apply, reset);
    form.append(field("Actor", actor), field("Action starts with", actionInput), field("Decision", decision), buttons);
    const list = el("div");
    page.append(form, list);
    const reload = () => load(list, async () => {
      const data = await api(`/api/admin/audit?${qs({actor: auditFilters.actor, action: auditFilters.action, decision: auditFilters.decision, limit: AUDIT_PAGE, offset: auditFilters.offset})}`);
      if (!data.items.length) return CD.empty(list, "No matching activity", "Change or reset the filters.", "log");
      const pager = el("div", undefined, "pager");
      const prev = CD.button("Previous", "secondary", undefined, {disabled: auditFilters.offset === 0});
      const next = CD.button("Next", "secondary", undefined, {disabled: auditFilters.offset + AUDIT_PAGE >= data.total});
      prev.addEventListener("click", () => { auditFilters.offset = Math.max(0, auditFilters.offset - AUDIT_PAGE); reload(); });
      next.addEventListener("click", () => { auditFilters.offset += AUDIT_PAGE; reload(); });
      pager.append(el("span", `${auditFilters.offset + 1}–${auditFilters.offset + data.items.length} of ${data.total}`, "muted small"), el("span", undefined, "spacer"), prev, next);
      list.replaceChildren(table(["Time", "Actor", "Action", "Target", "Decision", "Result"], data.items,
        a => [el("time", CD.date(a.timestamp), undefined, {datetime: a.timestamp}), a.actor, CD.label(a.action), a.target, CD.badge(a.decision), CD.label(a.result)]), pager);
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); Object.assign(auditFilters, {actor: actor.value.trim(), action: actionInput.value.trim(), decision: decision.value, offset: 0}); reload(); });
    reset.addEventListener("click", () => { Object.assign(auditFilters, {actor: "", action: "", decision: "", offset: 0}); actor.value = actionInput.value = decision.value = ""; reload(); });
    await reload();
  }

  /* ---------- My account ---------- */
  async function account(page) {
    const s = session.staff;
    page.append(head("My account", "Your staff profile and password."));
    const facts = el("dl", undefined, "facts");
    for (const [term, value] of [["Name", s.name], ["Staff ID", s.id], ["Email", s.email], ["Role", s.role_label]]) {
      const row = el("div"); row.append(el("dt", term), el("dd", value)); facts.append(row);
    }
    const permissionsList = el("ul", undefined, "question-list");
    s.permissions.forEach(p => permissionsList.append(el("li", (session.permissions || {})[p] || p)));
    if (!s.permissions.length) permissionsList.append(el("li", "No permissions assigned."));
    const form = el("form", undefined, "password-form", {novalidate: true});
    const current = input({type: "password", autocomplete: "current-password", required: true, maxlength: 200});
    const fresh = input({type: "password", autocomplete: "new-password", required: true, maxlength: 200});
    const confirm = input({type: "password", autocomplete: "new-password", required: true, maxlength: 200});
    const error = el("p", undefined, "error-text", {role: "alert", hidden: true});
    const save = el("button", undefined, "primary", {type: "submit"}); save.append(el("span", "Change password"));
    form.append(field("Current password", current), field("New password", fresh, "At least 10 characters with a letter and a number."), field("Confirm new password", confirm), error, save);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); error.hidden = true;
      if (fresh.value !== confirm.value) { error.textContent = "The new passwords do not match."; error.hidden = false; return; }
      try { await CD.busy(save, () => api("/api/admin/me/password", json("POST", {current: current.value, new: fresh.value}))); CD.toast("Password changed."); form.reset(); }
      catch (err) { if (err.status === 401) return boot(); error.textContent = err.message; error.hidden = false; }
    });
    const grid = el("div", undefined, "panel-grid");
    grid.append(card("Profile", facts, el("h4", "Your permissions", "facts-title"), permissionsList), card("Change password", form));
    page.append(grid);
  }

  const VIEWS = {overview, kb, tickets, conversations, usage, users, settings, activity, account};

  /* ---------- Wiring ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    CD.hydrateIcons();
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorNode = $("login-error"); errorNode.hidden = true;
      const id = $("login-id").value.trim(), password = $("login-password").value;
      if (!id || !password) {
        errorNode.textContent = `Enter your ${[!id && "staff ID", !password && "password"].filter(Boolean).join(" and ")}.`;
        errorNode.hidden = false; (!id ? $("login-id") : $("login-password")).focus(); return;
      }
      try {
        session = await CD.busy($("login-submit"), () => api("/api/login", json("POST", {student_id: id, password})));
        $("login-password").value = "";
        if (session.staff) { if (!location.hash) location.hash = "#/overview"; startApp(); }
        else show("student-notice");
      } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
    });
    document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => {
      $("login-id").value = b.dataset.demo; $("login-password").value = "StaffDemo!2026"; $("login-form").requestSubmit();
    }));
    CDLogin.enhance({password: $("login-password"), fields: [$("login-id"), $("login-password")], error: $("login-error")});
    CDLogin.showcase($("login-aside"), "staff");
    CD.settingsMenu($("settings-btn"), logout);
    $("notice-logout").addEventListener("click", logout);
    CD.resizableSidebar({app: $("app"), handle: $("sidebar-resizer"), storageKey: "campus-admin-sidebar-width"});
    const sidebarCtl = CD.collapsible({watch: $("app"), hiddenClass: "sidebar-collapsed", hideButton: $("hide-sidebar"), showButton: $("menu"),
      storageKey: "campus-admin-sidebar", query: "(max-width: 900px)", labels: {hide: "Hide sidebar", show: "Show sidebar", mobile: "Open navigation"}, icons: {desktop: "sidebar", mobile: "menu"}});
    $("menu").addEventListener("click", () => {
      if (sidebarCtl.isDesktop()) return sidebarCtl.show();
      const open = $("app").classList.toggle("nav-open"); $("menu").setAttribute("aria-expanded", String(open));
    });
    $("scrim").addEventListener("click", closeNav);
    CD.drawer({panel: $("sidebar"), trigger: $("menu"), watch: $("app"), openClass: "nav-open", query: "(max-width: 900px)", hiddenClass: "sidebar-collapsed"});
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("app").classList.contains("nav-open")) closeNav(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });
    window.addEventListener("hashchange", route);
    boot();
  });
})();
