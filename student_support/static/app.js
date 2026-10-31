"use strict";
const {api, json, el, icon, button, toast, time, date, relative, label, badge, markdown, empty, loading, failed, busy, confirmDialog, initials} = CD;
const $ = (id) => document.getElementById(id);
const MEMORY_LABELS = {programme: "Programme", response_language: "Response language", response_style: "Response style", hostel_room: "Hostel room"};
const CATEGORY_FOR_SOURCE = {Finance: "finance", Scholarship: "scholarship", Academics: "academic"};
const VIEW_TITLES = {chat: "Chat", tickets: "Support tickets", approvals: "Approvals", profile: "Profile", memory: "Remembered facts", activity: "Traces", audit: "Audit trail"};

const state = {session: null, threads: [], thread: null, sending: false, traces: new Map(), questions: new Map(), topics: [], ticketThread: null, shownTrace: null};

/* ---------- Session ---------- */
async function boot() {
  CD.hydrateIcons();
  try {
    state.session = await api("/api/session");
  } catch (error) {
    $("boot").replaceChildren(icon("alert", 28), el("p", error.message));
    return;
  }
  $("boot").hidden = true;
  if (state.session.staff) { location.replace("/admin"); return; }
  if (!state.session.student) return showLogin();
  await showWorkspace();
}

let loginReady = false;
function showLogin() {
  $("workspace").hidden = true; $("login-screen").hidden = false;
  if (!loginReady) {
    loginReady = true;
    CDLogin.enhance({password: $("password"), fields: [$("user-id"), $("password")], error: $("login-error")});
    CDLogin.showcase($("login-aside"), "student");
  }
  $("user-id").focus();
}

function handleAuthError(error) {
  if (error.status === 401) { toast("Your session ended. Please sign in again.", "error"); state.session.student = null; showLogin(); return true; }
  return false;
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("user-id").value.trim(), password = $("password").value;
  $("login-error").hidden = true;
  if (!id || !password) {
    $("login-error").textContent = `Enter your ${[!id && "ID", !password && "password"].filter(Boolean).join(" and ")}.`;
    $("login-error").hidden = false; (!id ? $("user-id") : $("password")).focus(); return;
  }
  await busy(event.submitter, async () => {
    try {
      state.session = await api("/api/login", json("POST", {student_id: id, password}));
      $("password").value = "";
      if (state.session.staff) { location.assign("/admin"); return; }
      $("login-screen").hidden = true;
      await showWorkspace();
    } catch (error) { $("login-error").textContent = error.message; $("login-error").hidden = false; }
  });
});
document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => {
  $("user-id").value = b.dataset.demo; $("password").value = b.dataset.password; $("login-form").requestSubmit();
}));

// Run from the Settings menu.
async function signOut() {
  if (state.sending) return toast("Please wait for the current answer first.");
  try { await api("/api/logout", json("POST")); } catch { /* signed out either way */ }
  location.hash = ""; location.reload();
}

async function showWorkspace() {
  const s = state.session, student = s.student;
  $("workspace").hidden = false;
  $("student-name").textContent = student.name;
  $("student-meta").textContent = `${student.id} · ${student.programme}`;
  $("avatar").textContent = initials(student.name);
  $("first-name").textContent = student.name.split(" ")[0];
  const hour = new Date().getHours();
  $("greeting-time").textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("config-banner").hidden = s.configured;
  if (s.announcement) { $("announcement").append(el("span", s.announcement)); $("announcement").hidden = false; }
  fillSelect($("ticket-category"), s.ticket_categories);
  fillSelect($("ticket-priority"), s.priorities);
  // The form offers only response preferences; programme and hostel room are remembered by asking in chat.
  const FORM_HIDDEN = ["programme", "hostel_room"];
  fillSelect($("memory-key"), Object.keys({...s.memory_options, ...s.memory_patterns}).filter(k => !FORM_HIDDEN.includes(k)), k => MEMORY_LABELS[k] || label(k));
  updateMemoryValue();
  if (!state.drawers) {
    // Closed off-canvas drawers must not take keyboard focus on small screens.
    state.drawers = [CD.drawer({panel: $("sidebar"), trigger: $("menu-toggle"), watch: $("workspace"), openClass: "nav-open", query: "(max-width: 900px)", hiddenClass: "sidebar-collapsed"}),
                     CD.drawer({panel: $("side-panel"), query: "(max-width: 1180px)", hiddenClass: "collapsed"})];
  }
  selectTab("trace");
  renderTraceIntro(); renderSources(null);
  await Promise.all([loadTopics(), loadThreads(), refreshCounts()]);
  route();
}

function fillSelect(select, values, text = label) {
  select.replaceChildren(...values.map(v => { const o = el("option", text(v)); o.value = v; return o; }));
}

/* ---------- Routing ---------- */
window.addEventListener("hashchange", route);
function route() {
  if (!state.session?.student) return;
  const [view = "chat", id] = location.hash.replace(/^#\/?/, "").split("/");
  showView(VIEW_TITLES[view] ? view : "chat", id ? decodeURIComponent(id) : null);
}
function go(view, id) { const hash = `#/${view}${id ? "/" + encodeURIComponent(id) : ""}`; if (location.hash === hash) route(); else location.hash = hash; }

async function showView(view, id) {
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== `view-${view}`; });
  document.querySelectorAll(".nav-item").forEach(b => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  // Remembered facts, Traces and Audit trail open from the Settings menu, so the gear shows when one is open.
  $("settings-btn").classList.toggle("is-current", ["profile", "memory", "activity", "audit"].includes(view));
  $("chat-actions").hidden = view !== "chat";
  $("title-menu-btn").hidden = view !== "chat" || !state.thread;
  $("workspace").classList.remove("nav-open");
  $("page-title").textContent = view === "chat" ? shortTitle(state.thread?.title || "New conversation") : VIEW_TITLES[view];
  document.title = `${$("page-title").textContent} · Yukti`;
  syncTitleVisibility();
  // After the first view, land keyboard and screen-reader users on the new page's heading.
  if (state.routed && view !== "chat") CD.focusHeading($("page-title"));
  state.routed = true;
  if (view === "chat") {
    if (id && id !== state.thread?.id) await openThread(id);
    else if (!id && state.thread) resetChat();
    else updateChatHeader();
    $("message").focus();
  }
  if (view === "tickets") await loadTickets(id);
  if (view === "approvals") await loadApprovals();
  if (view === "profile") await loadProfile();
  if (view === "memory") await loadMemory();
  if (view === "activity") await loadActivity();
  if (view === "audit") await loadAudit();
}
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
CD.resizableSidebar({app: $("workspace"), handle: $("sidebar-resizer"), storageKey: "campus-sidebar-width"});
/* Sidebar: hide/show on desktop, drawer on small screens. */
const sidebarCtl = CD.collapsible({watch: $("workspace"), hiddenClass: "sidebar-collapsed", hideButton: $("hide-sidebar"), showButton: $("menu-toggle"),
  storageKey: "campus-sidebar", query: "(max-width: 900px)", labels: {hide: "Hide sidebar", show: "Show sidebar", mobile: "Open navigation"}, icons: {desktop: "sidebar", mobile: "menu"}});
$("menu-toggle").addEventListener("click", () => sidebarCtl.isDesktop() ? sidebarCtl.show() : $("workspace").classList.toggle("nav-open"));
$("scrim").addEventListener("click", () => $("workspace").classList.remove("nav-open"));

/* ---------- Topics and side panel ---------- */
async function loadTopics() {
  try { state.topics = (await api("/api/topics")).items; } catch { state.topics = []; }
  const make = (topic) => {
    const node = el("button", undefined, "topic", {type: "button"});
    const badgeIcon = el("span", undefined, "topic-icon"); badgeIcon.append(icon(topic.icon, 18));
    const text = el("span"); text.append(el("strong", topic.title), el("small", topic.subtitle));
    node.append(badgeIcon, text);
    node.addEventListener("click", () => { closePanel(); if (location.hash.startsWith("#/chat") || !location.hash) send(topic.prompt); else { go("chat"); setTimeout(() => send(topic.prompt), 0); } });
    return node;
  };
  // The welcome screen keeps to the first three topics; anything else is one question away in the composer.
  $("welcome-topics").replaceChildren(...state.topics.slice(0, 3).map(make));
}
const TABS = ["trace", "sources"];
function selectTab(name, focus = false) {
  for (const tab of TABS) {
    $(`tab-${tab}`).setAttribute("aria-selected", String(tab === name));
    $(`tab-${tab}`).tabIndex = tab === name ? 0 : -1;  // roving tabindex: only the selected tab is in the Tab order
    $(`panel-${tab}`).hidden = tab !== name;
  }
  if (focus) $(`tab-${name}`).focus();
  if (typeof syncPanelButtons === "function" && state.shownTrace) syncPanelButtons();
}
document.querySelectorAll(".panel-tab").forEach(t => t.addEventListener("click", () => selectTab(t.dataset.tab)));
/* ARIA tabs pattern: Left/Right move between tabs, Home/End jump to the ends. */
document.querySelector(".tab-row").addEventListener("keydown", (event) => {
  const current = TABS.indexOf(document.activeElement?.dataset?.tab);
  if (current < 0) return;
  const next = {ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: TABS.length - 1}[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectTab(TABS[(next + TABS.length) % TABS.length], true);
});
TABS.forEach(tab => { $(`panel-${tab}`).tabIndex = 0; });
/* Trace panel: hide/show on wide screens, drawer below 1180px. */
/* Focus returns to whatever opened the panel (a View trace button or a source chip). */
function focusPanelOpener() {
  const opener = state.panelOpener;
  if (opener?.isConnected && opener.offsetParent) opener.focus(); else $("message").focus();
}
const panelCtl = CD.collapsible({watch: $("side-panel"), hiddenClass: "collapsed", hideButton: $("close-panel"), fallbackFocus: focusPanelOpener,
  storageKey: "campus-panel", query: "(max-width: 1180px)", labels: {hide: "Hide panel", show: "Show trace and sources", mobile: "Show trace and sources"},
  defaultHidden: true, remember: false});
$("close-panel").addEventListener("click", () => { if (!panelCtl.isDesktop()) { closePanel(); focusPanelOpener(); } setTimeout(syncPanelButtons, 0); });
function closePanel() { $("side-panel").classList.remove("open"); }
// Asking for a trace (View trace, a citation) brings a hidden panel back.
function openPanel(tab) {
  const active = document.activeElement;
  if (active && active !== document.body && !$("side-panel").contains(active)) state.panelOpener = active;
  selectTab(tab); $("side-panel").classList.add("open");
  if (panelCtl.isDesktop() && panelCtl.hidden()) panelCtl.show(false);
}

/* ---------- Threads ---------- */
async function loadThreads() {
  try { state.threads = (await api("/api/threads")).items; }
  catch (error) { if (!handleAuthError(error)) state.threads = []; }
  renderThreads();
}
function shortTitle(text, limit = 48) {
  text = String(text || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text || "New conversation";
  const cut = text.slice(0, limit).replace(/\s+\S*$/, "").replace(/[,.;:-]+$/, "");
  return (cut || text.slice(0, limit)) + "…";
}
// Sidebar sections ("Pinned", "Chats") fold open and closed; the choice is remembered per browser.
const folded = new Set((() => { try { return JSON.parse(localStorage.getItem("campus-folded") || "[]"); } catch { return []; } })());
function threadSection(key, text, threads, searching) {
  const id = `threads-${key}`, open = searching || !folded.has(key);
  const head = el("button", undefined, "thread-section", {type: "button", "aria-expanded": String(open), "aria-controls": id});
  head.append(el("span", text), el("span", undefined, "thread-caret", {"aria-hidden": "true"}));
  head.lastChild.append(icon("chevron", 13));
  const body = el("div", undefined, "thread-section-body", {id, role: "list"}); body.hidden = !open;
  head.addEventListener("click", () => {
    const show = body.hidden; body.hidden = !show; head.setAttribute("aria-expanded", String(show));
    if (show) folded.delete(key); else folded.add(key);
    try { localStorage.setItem("campus-folded", JSON.stringify([...folded])); } catch { /* remembered for this page only */ }
  });
  for (const t of threads) {
    const row = el("div", undefined, "thread-row", {role: "listitem"});
    const item = el("button", undefined, "thread-item", {type: "button", "aria-current": String(t.id === state.thread?.id),
      title: `${t.title}
${relative(t.updated_at)} · ${t.message_count} messages`});
    const lead = el("span", undefined, t.pinned ? "thread-lead is-pin" : "thread-lead", {"aria-hidden": "true"});
    if (t.pinned) lead.append(icon("pin", 15));
    item.append(lead, el("span", t.title, "thread-title"), el("span", ` · ${relative(t.updated_at)}`, "sr-only"));
    item.addEventListener("click", () => go("chat", t.id));
    const more = el("button", undefined, "thread-menu-btn", {type: "button", "aria-label": `Options for “${shortTitle(t.title, 40)}”`,
                                                            "aria-haspopup": "menu", "aria-expanded": "false", title: "Pin, rename or delete"});
    more.append(icon("more", 16));
    more.addEventListener("click", (event) => { event.stopPropagation(); openThreadMenu(more, t); });
    row.append(item, more);
    body.append(row);
  }
  const section = el("section", undefined, "thread-block"); section.append(head, body);
  return section;
}
function renderThreads() {
  const list = $("thread-list");
  const query = $("thread-search").value.trim().toLowerCase();
  const threads = state.threads.filter(t => !query || t.title.toLowerCase().includes(query));
  if (!state.threads.length) { list.replaceChildren(el("p", "No conversations yet. Your chats are saved here.", "thread-empty")); return; }
  if (!threads.length) { list.replaceChildren(el("p", `No conversations match “${query}”.`, "thread-empty")); return; }
  const pinned = threads.filter(t => t.pinned), rest = threads.filter(t => !t.pinned);
  list.replaceChildren(...[pinned.length && threadSection("pinned", "Pinned", pinned, !!query),
                           rest.length && threadSection("chats", "Chats", rest, !!query)].filter(Boolean));
}
$("thread-search").addEventListener("input", renderThreads);
// Search row: opens an inline field in its place; Escape, the close button, or leaving it empty closes it again.
function openSearch() {
  $("search-open").hidden = true; $("search-box").hidden = false;
  $("search-open").setAttribute("aria-expanded", "true");
  $("thread-search").focus();
}
function closeSearch(returnFocus = true) {
  if ($("search-box").hidden) return;
  $("thread-search").value = ""; renderThreads();
  $("search-box").hidden = true; $("search-open").hidden = false;
  $("search-open").setAttribute("aria-expanded", "false");
  if (returnFocus) $("search-open").focus();
}
$("search-open").addEventListener("click", openSearch);
$("search-close").addEventListener("click", () => closeSearch());
$("thread-search").addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } });
$("search-box").addEventListener("focusout", (event) => {
  if (!$("search-box").contains(event.relatedTarget) && !$("thread-search").value.trim()) closeSearch(false);
});
/* An empty new chat shows no heading text in the top bar; screen readers still get it as the page heading. */
function syncTitleVisibility() {
  $("page-title").classList.toggle("sr-only", !$("view-chat").hidden && !state.thread);
}
function updateChatHeader() {
  $("page-title").textContent = shortTitle(state.thread?.title || "New conversation");
  $("page-title").title = state.thread?.title || "";
  if (!$("view-chat").hidden) document.title = `${$("page-title").textContent} · Yukti`;
  syncTitleVisibility();
  $("title-menu-btn").hidden = !state.thread || $("view-chat").hidden;
  renderThreads();
}
function resetChat() {
  if (typeof stopSpeaking === "function") stopSpeaking();
  state.thread = null; state.traces.clear();
  $("messages").replaceChildren($("welcome")); $("welcome").hidden = false;
  state.shownTrace = null; renderTraceIntro(); renderSources(null); updateChatHeader();
}
async function openThread(id) {
  resetChat();
  const container = $("messages");
  $("welcome").hidden = true;
  const holder = el("div"); container.append(holder); loading(holder, 3);
  try {
    const data = await api(`/api/threads/${encodeURIComponent(id)}`);
    state.thread = data.thread; holder.remove();
    let lastQuestion = "";
    for (const m of data.messages) {
      if (m.role === "user") { addUser(m.content, m.created_at, m.redacted); lastQuestion = m.content; }
      else addAssistant({answer: m.content, created_at: m.created_at, trace_id: m.trace_id, ...m.meta}, lastQuestion);
    }
    if (!data.messages.length) $("welcome").hidden = false;
    scrollDown(false);
    // Show how the latest answer was produced without the student having to ask for it.
    const latest = [...data.messages].reverse().find(m => m.role === "assistant" && m.trace_id);
    if (latest) showTrace(latest.trace_id, {open: false});
  } catch (error) {
    if (handleAuthError(error)) return;
    if (error.status === 404) { holder.remove(); toast("That conversation no longer exists.", "error"); go("chat"); return; }
    failed(holder, error, () => openThread(id));
  }
  updateChatHeader();
}
$("new-chat").addEventListener("click", () => { if (state.sending) return; go("chat"); resetChat(); $("message").focus(); });
/* Start a new conversation with the composer pre-filled (used by empty-state buttons); the student edits and sends it. */
function draftQuestion(text) {
  if (state.sending) return;
  go("chat"); resetChat();
  const box = $("message"); box.value = text; box.dispatchEvent(new Event("input", {bubbles: true}));
  box.focus(); box.setSelectionRange(text.length, text.length);
}
async function renameThread(thread) {
  const title = await CD.promptDialog("Rename conversation", "Conversation name", thread.title);
  if (!title || title === thread.title) return;
  try {
    await api(`/api/threads/${encodeURIComponent(thread.id)}`, json("PATCH", {title}));
    if (state.thread?.id === thread.id) state.thread.title = title;
    await loadThreads(); updateChatHeader(); toast("Conversation renamed.");
  } catch (error) { toast(error.message, "error"); }
}
async function deleteThread(thread) {
  if (!await confirmDialog(`Delete “${shortTitle(thread.title, 40)}”?`, "Its messages are removed from your account. Tickets raised from it keep their own copy of the conversation.", "Delete", true)) return;
  try {
    await api(`/api/threads/${encodeURIComponent(thread.id)}`, json("DELETE"));
    toast("Conversation deleted.");
    if (state.thread?.id === thread.id) { resetChat(); go("chat"); }
    await loadThreads();
  } catch (error) { toast(error.message, "error"); }
}
async function pinThread(thread) {
  const pinned = !thread.pinned;
  try {
    await api(`/api/threads/${encodeURIComponent(thread.id)}`, json("PATCH", {pinned}));
    if (state.thread?.id === thread.id) state.thread.pinned = pinned ? 1 : 0;
    await loadThreads(); toast(pinned ? "Conversation pinned." : "Conversation unpinned.");
  } catch (error) { toast(error.message, "error"); }
}
$("title-menu-btn").addEventListener("click", (event) => { event.stopPropagation(); if (state.thread) openThreadMenu($("title-menu-btn"), state.thread, "start"); });

/* Conversation options use the shared popover menu (common.js). */
function openThreadMenu(trigger, thread, align = "end") {
  CD.openMenu(trigger, "Conversation options", [
    {text: thread.pinned ? "Unpin" : "Pin", icon: "pin", key: "P", run: () => pinThread(thread)},
    {text: "Rename", icon: "edit", key: "R", run: () => renameThread(thread)},
    {text: "Delete", icon: "trash", key: "D", run: () => deleteThread(thread), cls: "danger-item", sep: true},
  ], {align});
}
CD.settingsMenu($("settings-btn"), signOut, [
  {text: "Profile", icon: "user", key: "P", run: () => go("profile")},
  {text: "Remembered facts", icon: "sparkle", key: "M", run: () => go("memory")},
  {text: "Traces", icon: "chart", key: "R", run: () => go("activity")},
  {text: "Audit trail", icon: "log", key: "A", run: () => go("audit")},
]);
document.querySelector(".sidebar-scroll").addEventListener("scroll", () => CD.closeMenu(false));

/* ---------- Messages ---------- */
function scrollDown(smooth = true) { const box = $("messages"); box.scrollTo({top: box.scrollHeight, behavior: smooth ? "smooth" : "auto"}); }
function addUser(text, created, withheld = false) {
  $("welcome").hidden = true;
  const node = el("div", undefined, "msg msg-user");
  const body = el("div", undefined, "msg-body");
  body.append(el("div", text, `bubble-user${withheld ? " withheld" : ""}`), el("span", time(created || new Date().toISOString()), "msg-time"));
  node.append(body); $("messages").append(node);
  return node;
}
function assistantShell() {
  const node = el("div", undefined, "msg msg-assistant");
  const avatar = el("span", undefined, "bot-avatar"); avatar.append(icon("bot", 18));
  const body = el("div", undefined, "msg-body");
  node.append(avatar, body); $("messages").append(node);
  return {node, body};
}
function addTyping() {
  const shell = assistantShell();
  const bubble = el("div", undefined, "bubble-assistant");
  const typing = el("span", undefined, "typing"); const dots = el("span", undefined, "dots"); dots.append(el("i"), el("i"), el("i"));
  typing.append(dots, el("span", "Checking your record and the knowledge base…"));
  bubble.append(typing); shell.body.append(bubble); scrollDown();
  return shell;
}

function addAssistant(data, question, shell = assistantShell()) {
  const {body} = shell; body.replaceChildren();
  const cite = (id) => showTrace(data.trace_id, {tab: "sources", highlight: id});
  shell.node.dataset.trace = data.trace_id || "";
  if (data.trace_id && question) state.questions.set(data.trace_id, question);
  const bubble = el("div", undefined, "bubble-assistant");
  bubble.append(markdown(data.answer, (data.sources || []).length ? cite : null, (data.sources || []).map(x => x.id)));
  body.append(bubble);
  if (data.account?.fees || data.account?.scholarship) body.append(accountCard(data.account));

  for (const ticket of data.tickets || []) body.append(ticketCard(ticket));
  if ((data.approvals || []).length) {
    const card = el("div", undefined, "ticket-card approval-card"); card.append(icon("shield", 22));
    const text = el("div"); text.append(el("strong", "A change is waiting for your confirmation"), el("small", "Nothing changes until you confirm it. Requests expire after 30 minutes."));
    const review = button("Review", "secondary"); review.addEventListener("click", () => go("approvals"));
    card.append(text, el("span", undefined, "spacer"), review); body.append(card);
  }
  if ((data.sources || []).length) {
    const row = el("div", undefined, "sources"); row.append(el("span", "Sources"));
    for (const source of data.sources) {
      const chip = el("button", undefined, "source-chip", {type: "button", title: source.source || "", "data-source": source.id, "aria-pressed": "false",
                                                          "aria-label": `${source.id}: ${source.title}`});
      chip.append(el("strong", source.id), el("span", source.title));
      chip.addEventListener("click", () => cite(source.id)); row.append(chip);
    }
    body.append(row);
  }
  if ((data.suggestions || []).length) {
    const row = el("div", undefined, "suggestions");
    for (const q of data.suggestions) { const chip = el("button", q, "suggestion", {type: "button"}); chip.addEventListener("click", () => send(q)); row.append(chip); }
    body.append(row);
  }
  // Icon actions under each answer: copy, read aloud, view trace. The time is in the row's tooltip.
  const meta = el("div", undefined, "msg-actions", {role: "group", "aria-label": "Answer actions", title: `Yukti · ${time(data.created_at || new Date().toISOString())}`});
  const action = (iconName, label, run) => {
    const b = el("button", undefined, "msg-action", {type: "button", "aria-label": label, title: label});
    b.append(icon(iconName, 16)); b.addEventListener("click", () => run(b)); meta.append(b); return b;
  };
  action("copy", "Copy", async (b) => {
    try {
      await copyText(data.answer);
      // The icon shows it; the status toast announces it (a label change on the focused button often isn't read out).
      b.replaceChildren(icon("check", 16)); b.title = "Copied"; toast("Copied to clipboard.");
      setTimeout(() => { b.replaceChildren(icon("copy", 16)); b.title = "Copy"; }, 1500);
    } catch { toast("Copying isn't available in this browser.", "error"); }
  });
  if ("speechSynthesis" in window) action("speaker", "Read aloud", (b) => readAloud(b, data.answer)).setAttribute("aria-pressed", "false");
  if (data.trace_id) {
    const traceButton = action("log", "View trace", () => showTrace(data.trace_id));
    traceButton.classList.add("trace-button");
    traceButton.setAttribute("aria-pressed", "false");
  }
  body.append(meta);
  return shell;
}

/* Fee and scholarship breakdown: figures come from the student record on the server, never from the model's text.
   Shown under fee or scholarship answers (only the parts the question looked up) and on the Profile page. */
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const dueDate = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {dateStyle: "medium"}) : "—";
function dueText(f) {
  if (f.status === "paid") return "Paid in full";
  if (f.days_to_due == null) return "Balance due";
  if (f.days_to_due < 0) return `Overdue by ${plural(-f.days_to_due, "day")}`;
  return f.days_to_due === 0 ? "Due today" : `Due in ${plural(f.days_to_due, "day")}`;
}
function figureTable(rows) {
  const table = el("table", undefined, "fee-table"), tbody = el("tbody");
  for (const [term, value, key] of rows) {
    const tr = el("tr", undefined, key ? "is-key" : ""), td = el("td");
    td.append(value instanceof Node ? value : document.createTextNode(value));
    tr.append(el("th", term, undefined, {scope: "row"}), td); tbody.append(tr);
  }
  table.append(tbody);
  return table;
}
function accountCard({fees: f, scholarship: s}) {
  const card = el("section", undefined, "account-card", {"aria-label": f ? "Fee breakdown" : "Scholarship"});
  if (f) {
    const head = el("div", undefined, "account-head");
    head.append(el("h3", "Fee breakdown"), el("span", dueText(f), `due-pill is-${f.status}`));
    const pct = f.total ? Math.round(f.paid / f.total * 100) : 0;
    const meter = el("div", undefined, "fee-meter", {role: "img", "aria-label": `${pct}% paid: ${inr(f.paid)} of ${inr(f.total)}`});
    if (f.paid) { const paid = el("span", undefined, "fee-paid"); paid.style.setProperty("--share", `${pct}%`); meter.append(paid); }
    if (f.outstanding) meter.append(el("span", undefined, "fee-left"));
    const legend = el("div", undefined, "fee-legend", {"aria-hidden": "true"});
    const key = (cls, text) => { const item = el("span"); item.append(el("i", undefined, cls), document.createTextNode(text)); legend.append(item); };
    key("is-paid", `Paid ${pct}%`);
    if (f.outstanding) key("is-left", `Outstanding ${100 - pct}%`);
    card.append(head, meter, legend, figureTable([
      ["Total fee", inr(f.total)], ["Paid", inr(f.paid)], ["Outstanding", inr(f.outstanding), true], ["Due date", dueDate(f.due)],
    ]));
  }
  if (s) {
    card.append(el(f ? "p" : "h3", "Scholarship", f ? "account-sub" : ""), figureTable([
      ["Award", s.name], ["Status", badge(s.status, String(s.status).replace(/\s+/g, "_"))], ["Amount", inr(s.amount), true],
    ]));
  }
  return card;
}

/* Clipboard API first; fall back to a temporary selection where it is blocked or unavailable. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* try the fallback */ }
  const area = el("textarea", undefined, "sr-only", {readonly: true, "aria-hidden": "true"});
  area.value = text; document.body.append(area); area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

/* Read aloud with the browser's own speech engine (nothing is sent to a server).
   One answer speaks at a time; pressing the same button again stops it. */
let speaking = null;
function stopSpeaking() {
  if (!speaking) return;
  const b = speaking; speaking = null;
  speechSynthesis.cancel();
  b.replaceChildren(icon("speaker", 16)); b.title = "Read aloud"; b.classList.remove("is-active");
  b.setAttribute("aria-pressed", "false");
}
function readAloud(button, text) {
  const same = speaking === button;
  stopSpeaking();
  if (same) return;
  const plain = String(text).replace(/\*\*|__|`/g, "").replace(/^#{1,4}\s+/gm, "").replace(/^[-*•]\s+/gm, "")
    .replace(/[\[【]([A-Z][A-Z0-9]{1,15}-\d{2,3})[\]】]/g, "$1");
  const utterance = new SpeechSynthesisUtterance(plain);
  utterance.lang = document.documentElement.lang || "en";
  utterance.onend = utterance.onerror = () => { if (speaking === button) stopSpeaking(); };
  speaking = button;
  // The name stays "Read aloud"; aria-pressed carries the state (changing both would read "Stop reading, pressed").
  button.replaceChildren(icon("stop", 16)); button.title = "Stop reading";
  button.classList.add("is-active"); button.setAttribute("aria-pressed", "true");
  speechSynthesis.speak(utterance);
}

function ticketCard(ticket) {
  const card = el("div", undefined, "ticket-card"); card.append(icon("ticket", 22));
  const text = el("div");
  text.append(el("span", "Support ticket raised", "eyebrow"), el("div", ticket.id, "ticket-id"),
              el("small", `${label(ticket.priority)} priority · ${label(ticket.status)} · Support staff review it in the admin panel; no email is sent.`));
  const view = button("View", "secondary"); view.addEventListener("click", () => go("tickets", ticket.id));
  card.append(text, el("span", undefined, "spacer"), view);
  return card;
}

async function send(question) {
  question = (question ?? $("message").value).trim();
  if (!question || state.sending) return;
  state.sending = true;
  $("send").disabled = true; $("message").value = ""; autosize();
  addUser(question);
  const shell = addTyping();
  renderLiveTrace(question);
  try {
    const data = await api("/api/chat", json("POST", {message: question, thread_id: state.thread?.id || null}));
    state.traces.set(data.trace.id, data.trace);
    addAssistant({...data, trace_id: data.trace.id, created_at: new Date().toISOString(), status: data.trace.status}, question, shell);
    const isNew = !state.thread;
    state.thread = data.thread;
    if (isNew) history.replaceState(null, "", `#/chat/${encodeURIComponent(data.thread.id)}`);
    showTrace(data.trace.id, {open: false});
    await loadThreads(); updateChatHeader();
    if (data.tickets?.length || data.approvals?.length) refreshCounts();
  } catch (error) {
    if (handleAuthError(error)) return;
    shell.body.replaceChildren();
    const bubble = el("div", undefined, "bubble-assistant is-error");
    bubble.append(el("p", error.message));
    const retry = button("Try again", "secondary", "refresh");
    retry.addEventListener("click", () => { shell.node.previousElementSibling?.remove(); shell.node.remove(); send(question); });
    shell.body.append(bubble, retry);
    renderTraceError(question, error);
  } finally {
    state.sending = false; $("send").disabled = false; scrollDown(); $("message").focus();
  }
}
$("chat-form").addEventListener("submit", (event) => { event.preventDefault(); send(); });
$("message").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } });
function autosize() {
  const t = $("message"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 180) + "px";
  const left = 2000 - t.value.length;
  $("char-count").hidden = left > 300; $("char-count").textContent = `${left} characters left`;
}
$("message").addEventListener("input", autosize);
document.addEventListener("keydown", (event) => {
  if (!state.session?.student) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("new-chat").click(); }
  else if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) { event.preventDefault(); go("chat"); $("message").focus(); }
  else if (event.key === "Escape") { closePanel(); $("workspace").classList.remove("nav-open"); }
});
/* "Jump to latest" appears when the student scrolls up away from the newest message. */
$("messages").addEventListener("scroll", () => {
  const box = $("messages");
  $("jump-latest").hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
});
$("jump-latest").addEventListener("click", () => scrollDown());

/* ---------- Side panel: trace, sources, requests, memory ---------- */
const ENFORCED_BY = {tool_ownership_check: "Blocked by the tool's ownership check", model_refusal_no_tool_call: "Model refused; no private data was read"};
const STATUS_TEXT = {completed: "Answered", privacy_filtered: "Blocked: sensitive content", out_of_scope: "Declined: out of scope",
                     provider_error: "Model unavailable", budget_exceeded: "Stopped at step limit"};
const ms = (value) => value == null ? null : value < 1 ? "<1 ms" : `${value < 100 ? value.toFixed(1) : Math.round(value)} ms`;
const fmt = (n) => n == null ? "—" : Number(n).toLocaleString();

function statCards(items) {
  const row = el("dl", undefined, "trace-stats");
  for (const [value, caption] of items) { const card = el("div"); card.append(el("dt", caption), el("dd", value)); row.append(card); }
  return row;
}
function flowItem({title, lines = [], kind = "done", badgeText, cites, onCite}) {
  const item = el("li", undefined, `flow-item is-${kind}`);
  item.append(el("span", undefined, "flow-dot", {"aria-hidden": "true"}));
  const body = el("div", undefined, "flow-text");
  const head = el("div", undefined, "flow-title"); head.append(el("span", title));
  if (badgeText) head.append(badge(badgeText));
  body.append(head);
  if (cites?.length) {
    const chips = el("div", undefined, "flow-cites");
    for (const id of cites) { const chip = el("button", id, "cite", {type: "button", title: `Open ${id} in Sources`, "aria-label": `Open source ${id}`}); chip.addEventListener("click", () => onCite(id)); chips.append(chip); }
    body.append(chips);
  }
  for (const line of lines.filter(Boolean)) body.append(el("code", line, "flow-line"));
  item.append(body);
  return item;
}
function traceHeader(question, statusText, statusKey) {
  const head = el("div", undefined, "trace-head");
  head.append(el("span", "Trace for", "eyebrow"));
  if (question) head.append(el("p", `“${question.length > 110 ? question.slice(0, 110) + "…" : question}”`, "trace-question"));
  if (statusText) { const row = el("div", undefined, "row"); row.append(badge(statusKey || "completed"), el("span", statusText, "small muted")); head.append(row); }
  return head;
}

/* Before any answer: explain what the trace shows instead of an empty panel. */
function renderTraceIntro() {
  const root = $("panel-trace"); root.replaceChildren();
  const intro = el("div", undefined, "trace-intro");
  intro.append(el("span", undefined, "trace-intro-mark"), el("h2", "See how each answer is made", "panel-heading"),
               el("p", "Every time you ask something, this panel shows the steps the assistant took: what context it used, each model call, the tools and policy sections it checked, and how long it took.", "muted"));
  intro.querySelector(".trace-intro-mark").append(icon("log", 22));
  const sample = el("ol", undefined, "trace-flow is-sample");
  for (const [title, line] of [["Your question", ""], ["Context selected", "earlier messages · remembered facts"], ["Model call", "decides what it needs"],
                               ["Tool or policy search", "your record · knowledge base"], ["Final answer", "with sources"]]) sample.append(flowItem({title, lines: [line], kind: "sample"}));
  const tryRow = el("div", undefined, "trace-try"); tryRow.append(el("span", "Try one:", "small muted"));
  for (const q of ["What is my fee balance?", "What are the merit scholarship criteria?"]) {
    const chip = el("button", q, "suggestion", {type: "button"}); chip.addEventListener("click", () => send(q)); tryRow.append(chip);
  }
  intro.append(sample, tryRow);
  root.append(intro);
}

/* While the agent works: show the steps that are known, then a pending model step. */
function renderLiveTrace(question) {
  selectTab("trace");
  const root = $("panel-trace"); root.replaceChildren(traceHeader(question, "Working on it…", "processing"));
  const list = el("ol", undefined, "trace-flow");
  list.append(flowItem({title: "Read your question"}),
              flowItem({title: "Choosing what context to use", kind: "running"}),
              flowItem({title: "Checking records and policies as needed", kind: "pending"}),
              flowItem({title: "Writing the answer", kind: "pending"}));
  root.append(list);
  document.querySelectorAll(".msg-assistant.is-traced").forEach(n => n.classList.remove("is-traced"));
}
function renderTraceError(question, error) {
  const root = $("panel-trace"); root.replaceChildren(traceHeader(question, "The request did not complete", "error"));
  const list = el("ol", undefined, "trace-flow");
  list.append(flowItem({title: "User query", lines: [`${question.length} characters`]}), flowItem({title: "Request failed", lines: [error.message], kind: "error"}));
  root.append(list);
}

function panelIsOpen() { return panelCtl.isDesktop() ? !panelCtl.hidden() : $("side-panel").classList.contains("open"); }
function selectedTab() { return TABS.find(t => $(`tab-${t}`).getAttribute("aria-selected") === "true"); }
function hidePanel() { if (panelCtl.isDesktop()) panelCtl.hide(false); else closePanel(); syncPanelButtons(); }
/* Source chips and View trace buttons report whether their content is what the open panel shows. */
function syncPanelButtons() {
  const open = panelIsOpen(), traceId = state.shownTrace?.id, tab = selectedTab();
  document.querySelectorAll(".msg-assistant").forEach(msg => {
    const mine = open && msg.dataset.trace === traceId;
    msg.querySelectorAll(".source-chip").forEach(chip => chip.setAttribute("aria-pressed", String(mine && tab === "sources" && state.sourceHighlight === chip.dataset.source)));
    msg.querySelector(".msg-action.trace-button")?.setAttribute("aria-pressed", String(mine && tab === "trace"));
  });
}
async function showTrace(traceId, {tab = "trace", highlight = null, open = true} = {}) {
  if (!traceId) return;
  // Pressing the same View trace / source again while it is on screen closes the panel.
  const sameContent = state.shownTrace?.id === traceId && selectedTab() === tab && (tab !== "sources" || state.sourceHighlight === highlight);
  if (open && panelIsOpen() && sameContent) return hidePanel();
  if (open) openPanel(tab); else selectTab(tab);
  let trace = state.traces.get(traceId);
  if (!trace) {
    loading($("panel-trace"), 5);
    try { trace = await api(`/api/traces/${encodeURIComponent(traceId)}`); state.traces.set(traceId, trace); }
    catch (error) { return failed($("panel-trace"), error, () => showTrace(traceId, {tab, highlight, open})); }
  }
  state.shownTrace = trace;
  renderTrace(trace);
  renderSources(trace, highlight);
  document.querySelectorAll(".msg-assistant").forEach(n => n.classList.toggle("is-traced", n.dataset.trace === traceId));
  syncPanelButtons();
}

function stepView(step, trace) {
  const cite = (id) => { renderSources(trace, id); selectTab("sources"); };
  switch (step.type) {
    case "query": return {title: "User query", lines: [state.questions.get(trace.id) ? null : `${step.characters} characters`]};
    case "context": return {title: "Context selected", lines: [`history ${step.history_messages} msg · memory ${step.memory_keys.length ? step.memory_keys.map(k => MEMORY_LABELS[k] || k).join(", ") : "none"}`]};
    case "model": return {title: `Model call ${step.n}`, kind: step.outcome === "error" ? "error" : "model",
                          lines: [`${ms(step.latency_ms) || "—"} · ${step.model}`, step.input_tokens != null ? `${fmt(step.input_tokens)} in / ${fmt(step.output_tokens)} out tokens` : null,
                                  {tool_calls: "requested a tool", answer: "final answer", error: "failed"}[step.outcome]]};
    case "tool": return {title: `Tool: ${step.name}`, kind: step.ok ? "done" : "error", badgeText: step.decision || (step.ok ? "allowed" : "error"),
                         lines: [`${ms(step.latency_ms)} · ${step.ok ? "ok" : "not completed"}`, step.ticket_id && `ticket ${step.ticket_id}`,
                                 step.approval_status && `approval ${step.approval_status}`, step.error]};
    case "retrieval": return {title: step.chunk_ids.length ? "Retrieval" : "Retrieval: nothing matched", cites: step.chunk_ids, onCite: cite,
                              lines: [step.chunk_ids.length ? step.titles.join(" · ") : "the knowledge base does not cover this"]};
    case "permission": return {title: "Permission check", kind: "blocked", badgeText: step.decision, lines: [ENFORCED_BY[step.enforced_by] || step.enforced_by]};
    case "scope_guard": return {title: "Scope guardrail", kind: "blocked", badgeText: step.decision, lines: [`out of scope: ${step.category}`, "declined before the model · 0 tokens"]};
    case "privacy_filter": return {title: "Privacy filter", kind: "blocked", badgeText: step.decision, lines: [step.detail]};
    case "answer": return {title: `Finished: ${step.status === "completed" ? "final_answer" : step.status}`, kind: step.status === "completed" ? "done" : "blocked",
                           lines: [`${fmt(step.characters)} characters`]};
    default: return {title: label(step.type)};
  }
}

const TOOL_WORDS = {get_fee_status: "Checked your fee record", get_scholarship_status: "Checked your scholarship record",
  get_student_record: "Checked your student record", search_policy: "Searched the knowledge base", create_support_request: "Raised a support ticket",
  list_support_requests: "Looked up your tickets", get_ticket_details: "Looked up your ticket", remember_preference: "Saved something you asked me to remember",
  request_programme_change: "Started a programme change request", request_email_change: "Sent an email change request to support staff"};
/* The student view: what happened, in plain words, without tokens or model names. */
function plainSteps(trace) {
  const lines = [];
  for (const step of trace.steps || []) {
    if (step.type === "context") {
      const parts = [];
      if (step.history_messages) parts.push("earlier messages in this conversation");
      if (step.memory_keys.length) parts.push(`what you asked me to remember (${step.memory_keys.map(k => (MEMORY_LABELS[k] || k).toLowerCase()).join(", ")})`);
      if (parts.length) lines.push({text: `Used ${parts.join(" and ")}`, icon: "sparkle"});
    } else if (step.type === "tool") {
      const base = TOOL_WORDS[step.name] || "Used a tool";
      lines.push(step.ok ? {text: base + (step.ticket_id ? ` (${step.ticket_id})` : ""), icon: "check"}
                         : {text: `${base}: ${step.decision === "denied" ? "not allowed" : "didn't work"}`, icon: "alert", tone: "warn"});
    } else if (step.type === "retrieval") {
      lines.push(step.chunk_ids.length ? {text: `Found ${step.chunk_ids.length} policy section${step.chunk_ids.length === 1 ? "" : "s"}: ${step.titles.join(", ")}`, icon: "book", cites: step.chunk_ids}
                                       : {text: "The knowledge base doesn't cover this", icon: "book", tone: "warn"});
    } else if (step.type === "permission") {
      lines.push({text: "Blocked: you can only see your own records", icon: "shield", tone: "warn"});
    } else if (step.type === "scope_guard") {
      lines.push({text: "Declined: this is outside what Yukti supports", icon: "shield", tone: "warn"});
    } else if (step.type === "privacy_filter") {
      lines.push({text: "Stopped: your message had sensitive information, so it wasn't sent or saved", icon: "lock", tone: "warn"});
    }
  }
  if (!lines.some(l => l.icon === "check" || l.icon === "book") && trace.status === "completed") lines.push({text: "Answered from the conversation, no records needed", icon: "chat"});
  return lines;
}
function renderTrace(trace) {
  const root = $("panel-trace"); root.replaceChildren();
  root.append(traceHeader(state.questions.get(trace.id), STATUS_TEXT[trace.status] || label(trace.status), trace.status));
  const summary = el("section", undefined, "plain-trace");
  summary.append(el("h2", "How this answer was made", "panel-subhead"));
  const list = el("ul", undefined, "plain-steps");
  for (const line of plainSteps(trace)) {
    const item = el("li", undefined, line.tone ? `is-${line.tone}` : "");
    const mark = el("span", undefined, "plain-icon"); mark.append(icon(line.icon, 14));
    const body = el("span"); body.append(el("span", line.text));
    if (line.cites?.length) for (const id of line.cites) { const chip = el("button", id, "cite", {type: "button", "aria-label": `Open source ${id}`}); chip.addEventListener("click", () => { renderSources(trace, id); selectTab("sources"); }); body.append(chip); }
    item.append(mark, body); list.append(item);
  }
  summary.append(list, el("p", `Answered in ${(trace.latency_ms / 1000).toFixed(1)} seconds.`, "small muted"));
  root.append(summary);
  // Reviewers can open the full technical trace; the choice is remembered in this browser.
  const tech = el("details", undefined, "tech-trace");
  try { tech.open = localStorage.getItem("campus-trace-details") === "open"; } catch { /* default closed */ }
  tech.addEventListener("toggle", () => { try { localStorage.setItem("campus-trace-details", tech.open ? "open" : "closed"); } catch { /* not persisted */ } });
  tech.append(el("summary", "Technical details (model calls, tokens, timings)"));
  root.append(tech);
  const techRoot = tech;
  techRoot.append(statCards([[ms(trace.latency_ms), "latency"],
                         [trace.input_tokens == null ? "0/0" : `${trace.input_tokens}/${trace.output_tokens ?? 0}`, "tokens in/out"],
                         [trace.provider === "groq" ? "groq" : trace.provider, trace.model || "provider"]]));
  const flow = el("ol", undefined, "trace-flow");
  if (trace.steps?.length) for (const step of trace.steps) flow.append(flowItem(stepView(step, trace)));
  else flow.append(flowItem({title: "Step details not recorded", lines: ["this answer predates step-by-step tracing"], kind: "pending"}));
  techRoot.append(flow);
  const foot = el("p", undefined, "trace-foot");
  foot.append(el("span", `${trace.model_calls} model call${trace.model_calls === 1 ? "" : "s"} · ${trace.tools.length} tool call${trace.tools.length === 1 ? "" : "s"} · ${trace.memory_used.length} remembered fact${trace.memory_used.length === 1 ? "" : "s"}`));
  const raw = el("details", undefined, "trace-raw"); raw.append(el("summary", "Raw trace JSON"), el("pre", JSON.stringify(trace, null, 2), "trace-json"));
  techRoot.append(foot, raw);
}

function renderSources(trace, highlight) {
  state.sourceHighlight = highlight || null;
  const root = $("panel-sources"); root.replaceChildren();
  const chunks = trace?.retrieved_evidence || [];
  $("sources-count").textContent = chunks.length; $("sources-count").hidden = !chunks.length;
  if (!trace) return empty(root, "No sources yet", "When an answer uses the knowledge base, the exact policy sections appear here.", "book", {compact: true});
  if (!chunks.length) return empty(root, "No policy sections used", trace.tools.length ? "This answer came from your own record, not the knowledge base." : "This answer didn't need the knowledge base.", "book", {compact: true});
  root.append(el("p", "Knowledge base sections the assistant read for this answer.", "small muted"));
  for (const chunk of chunks) {
    const details = el("details", undefined, `chunk${chunk.id === highlight ? " highlight" : ""}`);
    const summary = el("summary"); summary.append(el("span", chunk.id, "cite"), el("span", chunk.title), el("small", `${chunk.source || ""}${chunk.category ? " · " + chunk.category : ""}`));
    details.append(summary, el("p", chunk.text));
    if (chunk.id === highlight || chunks.length === 1) details.open = true;
    root.append(details);
  }
  root.querySelector(".highlight")?.scrollIntoView({block: "nearest"});
}


/* ---------- Tickets ---------- */
function openTicketDialog({question = "", sources = [], threadId = null} = {}) {
  const category = CATEGORY_FOR_SOURCE[sources[0]?.category] || "general";
  state.ticketThread = threadId;
  $("ticket-subject").value = ((threadId && state.thread?.title) || question).slice(0, 120);
  $("ticket-description").value = question;
  $("ticket-category").value = category;
  $("ticket-priority").value = "normal";
  $("ticket-dialog-note").textContent = threadId
    ? "The recent messages in this conversation are attached automatically. Support staff review tickets in the admin panel; no email is sent."
    : "Support staff review tickets in the admin panel. Updates appear under Support tickets; no email is sent.";
  $("ticket-error").hidden = true;
  $("ticket-dialog").showModal(); $("ticket-subject").focus();
}
$("new-ticket").addEventListener("click", () => openTicketDialog());
$("ticket-cancel").addEventListener("click", () => $("ticket-dialog").close());
$("ticket-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {subject: $("ticket-subject").value.trim(), category: $("ticket-category").value, priority: $("ticket-priority").value,
                   description: $("ticket-description").value.trim(), thread_id: state.ticketThread};
  if (!payload.subject || payload.description.length < 5) { $("ticket-error").textContent = "Add a subject and a description of at least 5 characters."; $("ticket-error").hidden = false; return; }
  await busy($("ticket-submit"), async () => {
    try {
      const ticket = await api("/api/tickets", json("POST", payload));
      $("ticket-dialog").close();
      toast(`Ticket ${ticket.id} raised.`);
      refreshCounts();
      if (state.ticketThread && state.ticketThread === state.thread?.id && !$("view-chat").hidden) { const shell = assistantShell(); shell.body.append(ticketCard(ticket)); scrollDown(); }
      else go("tickets", ticket.id);
    } catch (error) { $("ticket-error").textContent = error.message; $("ticket-error").hidden = false; }
  });
});

async function loadTickets(selected) {
  const list = $("tickets-list"); loading(list, 3);
  try {
    const {items} = await api("/api/tickets");
    if (!items.length) {
      empty(list, "No tickets yet", "Ask the assistant to raise one, choose Raise ticket under an answer, or use New ticket.", "ticket", {actions: [
        {text: "New ticket", icon: "plus", primary: true, run: () => openTicketDialog()},
        {text: "Ask the assistant", icon: "chat", run: () => draftQuestion("I need help with ")},
      ]});
      $("ticket-detail").hidden = true; $("view-tickets").querySelector(".tickets-layout").classList.remove("has-detail");
      return;
    }
    // Tickets that need the student come first, then open ones, then finished ones; newest first within each.
    const rank = (t) => t.status === "waiting_on_student" ? 0 : ["resolved", "closed"].includes(t.status) ? 2 : 1;
    const ordered = items.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t);
    list.replaceChildren(...ordered.map(t => {
      const row = el("button", undefined, "card ticket-row", {type: "button", "aria-current": String(t.id === selected)});
      const top = el("div", undefined, "row"); top.append(badge(t.status), badge(t.priority), el("span", t.id, "small muted"));
      row.append(top, el("strong", t.subject || t.description), el("small", `${label(t.category)} · updated ${relative(t.updated_at)}${t.assigned_name ? " · " + t.assigned_name : ""}`));
      row.addEventListener("click", () => go("tickets", t.id));
      return row;
    }));
    if (selected) await showTicket(selected); else { $("ticket-detail").hidden = true; $("view-tickets").querySelector(".tickets-layout").classList.remove("has-detail"); }
  } catch (error) { if (!handleAuthError(error)) failed(list, error, () => loadTickets(selected)); }
}

async function showTicket(id) {
  const panel = $("ticket-detail"); panel.hidden = false;
  $("view-tickets").querySelector(".tickets-layout").classList.add("has-detail");
  loading(panel, 4);
  try { renderTicket(await api(`/api/tickets/${encodeURIComponent(id)}`)); }
  catch (error) { failed(panel, error, () => showTicket(id)); }
}

function renderTicket(t) {
  const panel = $("ticket-detail"); panel.replaceChildren();
  const head = el("header");
  const top = el("div", undefined, "row"); top.append(badge(t.status), badge(t.priority), el("span", t.id, "small muted"), el("span", undefined, "spacer"));
  const back = button("All tickets", "ghost", "back"); back.addEventListener("click", () => go("tickets")); top.append(back);
  head.append(top, el("h3", t.subject || t.description));
  panel.append(head);
  // The support loop breaks when a student misses a staff question, so put it first.
  const staffReply = [...t.events].reverse().find(e => e.event === "comment" && e.actor_role !== "student");
  if (t.status === "waiting_on_student") {
    const banner = el("div", undefined, "reply-needed", {role: "status"});
    const text = el("div");
    text.append(el("strong", "Support needs your reply"));
    if (staffReply) text.append(el("blockquote", staffReply.detail), el("small", `${staffReply.actor_name} · ${relative(staffReply.created_at)}`));
    const now = button("Reply now", "primary", "send");
    now.addEventListener("click", () => { $("ticket-reply")?.focus(); $("ticket-reply")?.scrollIntoView({block: "center", behavior: "smooth"}); });
    banner.append(icon("alert", 20), text, now);
    panel.append(banner);
  }
  const facts = el("dl", undefined, "facts");
  for (const [k, v] of [["Category", label(t.category)], ["Assigned to", t.assigned_name || "Not yet assigned"], ["Raised", date(t.created_at)], ["Last update", relative(t.updated_at)]]) {
    const d = el("div"); d.append(el("dt", k), el("dd", v)); facts.append(d);
  }
  panel.append(facts, el("p", t.description));
  if (t.resolution) { const r = el("div", undefined, "resolution"); r.append(el("strong", "Resolution"), el("p", t.resolution)); panel.append(r); }
  if (t.thread_id) { const link = el("button", "Open the conversation this came from", "link-button", {type: "button"}); link.addEventListener("click", () => go("chat", t.thread_id)); panel.append(link); }

  const history = el("section"); history.append(el("h4", "History"));
  const timeline = el("ol", undefined, "timeline");
  // Priority changes are internal triage; students see replies, assignment and status.
  for (const e of t.events.filter(ev => ev.event !== "priority_changed")) {
    const item = el("li");
    item.append(el("div", `${e.actor_name}${e.actor_role !== "student" ? " · " + label(e.actor_role) : ""} · ${date(e.created_at)}`, "who"));
    item.append(e.event === "comment" ? el("div", e.detail, "what comment") : el("div", e.detail || label(e.event), "what"));
    timeline.append(item);
  }
  history.append(timeline); panel.append(history);

  if (t.status !== "closed") {
    const form = el("form", undefined, "stack");
    const area = el("textarea", undefined, undefined, {id: "ticket-reply", maxlength: "2000", placeholder: "Add details or reply to support staff…", rows: "3"});
    const labelNode = el("label", "Reply", undefined, {for: "ticket-reply"});
    const actions = el("div", undefined, "row");
    const sendReply = el("button", undefined, "primary", {type: "submit"}); sendReply.append(el("span", "Send reply"));
    actions.append(sendReply);
    if (state.session.student_can_close_tickets) {
      const close = button("Close ticket", "secondary");
      close.addEventListener("click", async () => {
        if (!await confirmDialog("Close this ticket?", "Support staff will see that you closed it. You can raise a new ticket later.", "Close ticket")) return;
        await busy(close, async () => { try { renderTicket(await api(`/api/tickets/${t.id}/close`, json("POST"))); toast("Ticket closed."); loadTicketsQuiet(t.id); refreshCounts(); } catch (error) { toast(error.message, "error"); } });
      });
      actions.append(close);
    }
    form.append(labelNode, area, actions);
    if (t.status === "waiting_on_student") area.placeholder = "Answer support staff's question here…";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!area.value.trim()) return area.focus();
      await busy(sendReply, async () => { try { renderTicket(await api(`/api/tickets/${t.id}/comments`, json("POST", {body: area.value.trim()}))); toast("Reply added."); loadTicketsQuiet(t.id); } catch (error) { toast(error.message, "error"); } });
    });
    // When staff are waiting on the student, the reply box comes straight after the banner.
    if (t.status === "waiting_on_student") panel.querySelector(".reply-needed").after(form); else panel.append(form);
  }
}
async function loadTicketsQuiet(selected) { try { const {items} = await api("/api/tickets"); if (items.length) await loadTickets(selected); } catch { /* list refresh is best effort */ } }

/* ---------- Counts ---------- */
async function refreshCounts() {
  try {
    const [tickets, approvals] = await Promise.all([api("/api/tickets"), api("/api/approvals")]);
    const open = tickets.items.filter(t => !["resolved", "closed"].includes(t.status)).length;
    const needReply = tickets.items.filter(t => t.status === "waiting_on_student").length;
    // The badge counts only changes the student has to decide; staff-reviewed requests show on their ticket.
    const pending = approvals.items.filter(a => a.reviewer !== "staff" && a.status === "pending" && new Date(a.expires_at) > new Date()).length;
    // A reply from the student outranks the open count, and says so in words for screen readers.
    const badgeNode = $("ticket-count");
    badgeNode.textContent = needReply ? `${needReply} reply` : open; badgeNode.hidden = !open;
    badgeNode.classList.toggle("is-alert", needReply > 0);
    badgeNode.title = needReply ? `${needReply} ticket${needReply === 1 ? "" : "s"} need${needReply === 1 ? "s" : ""} your reply` : `${open} open`;
    $("approval-count").textContent = pending; $("approval-count").hidden = !pending;
  } catch { /* counts are decorative */ }
}

/* ---------- Approvals ---------- */
async function loadApprovals() {
  const list = $("approvals-list"); loading(list, 2);
  try {
    const {items} = await api("/api/approvals");
    if (!items.length) return empty(list, "Nothing waiting for you", "Ask the assistant to change your programme or registered email to start a request.", "shield", {actions: [
      {text: "Change my programme", icon: "award", run: () => draftQuestion("Please change my programme to ")},
      {text: "Update my email", icon: "edit", run: () => draftQuestion("Please update my registered email to ")},
    ]});
    list.replaceChildren(...items.map(item => {
      const card = el("article", undefined, "card record");
      const main = el("div", undefined, "record-main");
      const expired = item.status === "pending" && new Date(item.expires_at) <= new Date();
      const byStaff = item.reviewer === "staff";
      main.append(el("h3", item.field === "email" ? "Registered email change" : "Programme change"), el("p", `${item.old_value} → ${item.new_value}`),
                  el("small", `Requested ${date(item.created_at)} · ${item.status === "pending" ? (byStaff ? "reviewed by support staff · expires " : "expires ") + date(item.expires_at) : "decided " + date(item.decided_at)}`));
      if (item.decision_note) main.append(el("small", `Note from staff: ${item.decision_note}`));
      const actions = el("div", undefined, "record-actions");
      if (byStaff) {
        actions.append(badge(item.status === "pending" ? (expired ? "expired" : "waiting_for_staff") : item.status));
        if (item.ticket_id) { const view = button(`Ticket ${item.ticket_id}`, "secondary", "ticket"); view.addEventListener("click", () => go("tickets", item.ticket_id)); actions.append(view); }
      } else if (item.status === "pending" && !expired) {
        for (const [decision, text, cls] of [["reject", "Reject", "secondary"], ["confirm", "Confirm change", "primary"]]) {
          const b = button(text, cls);
          b.addEventListener("click", () => busy(b, async () => {
            try {
              const result = await api(`/api/approvals/${item.id}/decision`, json("POST", {decision}));
              toast(result.executed ? "Your record was updated." : "Request rejected. Your record is unchanged.");
              if (result.executed) { state.session = await api("/api/session"); $("student-meta").textContent = `${state.session.student.id} · ${state.session.student.programme}`; }
            } catch (error) { toast(error.message, "error"); }
            await loadApprovals(); refreshCounts();
          }));
          actions.append(b);
        }
      } else actions.append(badge(expired ? "expired" : item.status));
      card.append(main, actions);
      return card;
    }));
  } catch (error) { if (!handleAuthError(error)) failed(list, error, loadApprovals); }
}

/* ---------- Memory ---------- */
function updateMemoryValue() {
  const key = $("memory-key").value, options = state.session.memory_options[key], field = $("memory-value-field");
  const labelNode = el("label", "Value", undefined, {for: "memory-value"});
  let input;
  if (options) { input = el("select", undefined, undefined, {id: "memory-value"}); fillSelect(input, options, v => v); }
  else {
    const pattern = state.session.memory_patterns[key];
    input = el("input", undefined, undefined, {id: "memory-value", placeholder: pattern.example, pattern: pattern.pattern, required: true, maxlength: "12"});
  }
  field.replaceChildren(labelNode, input);
  if (!options) field.append(el("p", `Format like ${state.session.memory_patterns[key].example}.`, "field-hint"));
}
$("memory-key").addEventListener("change", updateMemoryValue);
/* Profile: fetched fresh each time so an approved change or a new payment shows up.
   Tiles and actions only navigate or pre-fill a question; nothing is sent until the student presses send. */
function profileTile({label: text, value, sub, iconName, run, hint}) {
  const node = el("button", undefined, "kpi kpi-link", {type: "button", title: hint, "aria-label": `${text}: ${value}. ${sub}. ${hint}`});
  const top = el("span", undefined, "kpi-top"), badgeIcon = el("span", undefined, "kpi-icon");
  badgeIcon.append(icon(iconName, 15));
  top.append(el("span", text, "kpi-label"), badgeIcon);
  node.append(top, el("strong", value, "kpi-value"), el("span", sub, "kpi-sub"));
  node.addEventListener("click", run);
  return node;
}
function renderProfileDashboard({fees: f, scholarship: s}, tickets, approvals) {
  const open = tickets.filter(t => !["resolved", "closed"].includes(t.status));
  const needReply = open.filter(t => t.status === "waiting_on_student").length;
  const pending = approvals.filter(a => a.status === "pending" && new Date(a.expires_at) > new Date());
  const tiles = [];
  if (f) {
    const pct = f.total ? Math.round(f.paid / f.total * 100) : 0;
    tiles.push({label: "Outstanding", value: inr(f.outstanding), sub: `${pct}% of ${inr(f.total)} paid`, iconName: "wallet", hint: "Show the fee breakdown",
                run: () => { const card = $("profile-account").firstElementChild; card?.scrollIntoView({behavior: CD.reducedMotion() ? "auto" : "smooth", block: "center"}); card?.classList.remove("is-flash"); void card?.offsetWidth; card?.classList.add("is-flash"); }},
               {label: f.status === "overdue" ? "Overdue by" : f.status === "paid" ? "Fees" : "Due in", value: f.status === "paid" ? "Paid" : f.days_to_due == null ? "—" : f.days_to_due < 0 ? plural(-f.days_to_due, "day") : f.days_to_due === 0 ? "Today" : `${plural(f.days_to_due, "day")}`,
                sub: f.status === "paid" ? "Nothing left to pay" : `${f.status === "overdue" ? "Was due" : "Due"} ${dueDate(f.due)}`, iconName: "calendar", hint: "Ask about late payment charges",
                run: () => draftQuestion("What is the late fee if I pay after the due date?")});
  }
  if (s) tiles.push({label: "Scholarship", value: label(s.status), sub: `${s.name} · ${inr(s.amount)}`, iconName: "award", hint: "Ask when it is credited",
                     run: () => draftQuestion("When is my scholarship credited to my fees?")});
  tiles.push({label: "Open tickets", value: String(open.length), sub: needReply ? `${plural(needReply, "ticket")} need${needReply === 1 ? "s" : ""} your reply` : pending.length ? `${plural(pending.length, "request")} pending` : "Nothing waiting on you",
              iconName: "ticket", hint: "Open Support tickets", run: () => go("tickets")});
  $("profile-stats").replaceChildren(...tiles.map(profileTile));

  const actions = [
    {text: "Ask about my fees", icon: "chat", run: () => draftQuestion("Explain my fee breakdown and what I still owe.")},
    f?.outstanding && {text: "Request instalments", icon: "calendar", run: () => draftQuestion("Please create a finance support ticket asking to pay my outstanding balance in two instalments.")},
    {text: "Raise a ticket", icon: "ticket", run: () => openTicketDialog()},
    {text: "Change programme", icon: "award", run: () => draftQuestion("Please change my programme to ")},
    {text: "Change email", icon: "shield", run: () => draftQuestion("Please change my registered email to ")},
  ].filter(Boolean);
  $("profile-actions").replaceChildren(...actions.map(a => { const b = button(a.text, "secondary", a.icon); b.addEventListener("click", a.run); return b; }));

  // Newest five things that happened on the account: tickets and change requests.
  const items = [
    ...tickets.map(t => ({when: t.updated_at, iconName: "ticket", title: `${t.id} · ${t.subject || label(t.category)}`, status: t.status, run: () => go("tickets", t.id)})),
    // Staff-reviewed requests already appear as their ticket.
    ...approvals.filter(a => !a.ticket_id).map(a => ({when: a.decided_at || a.created_at, iconName: a.field === "email" ? "shield" : "award",
                            title: `${a.field === "email" ? "Email" : "Programme"} change → ${a.new_value}`, status: a.status,
                            run: () => go("approvals")})),
  ].sort((x, y) => String(y.when).localeCompare(String(x.when))).slice(0, 5);
  const list = $("profile-activity");
  if (!items.length) return empty(list, "No activity yet", "Tickets and change requests will show up here.", "inbox", {compact: true});
  list.replaceChildren(...items.map(item => {
    const row = el("button", undefined, "activity-row", {type: "button"});
    const ic = el("span", undefined, "activity-icon"); ic.append(icon(item.iconName, 15));
    const text = el("span", undefined, "activity-text"); text.append(el("strong", item.title), el("small", relative(item.when)));
    row.append(ic, text, badge(item.status));
    row.addEventListener("click", item.run);
    return row;
  }));
}
$("activity-all").addEventListener("click", () => go("tickets"));
async function loadProfile() {
  const account = $("profile-account");
  if (!account.children.length) loading(account, 1);
  try {
    const [data, tickets, approvals] = await Promise.all([api("/api/profile"), api("/api/tickets"), api("/api/approvals")]), student = data.student;
    state.session.student = {...state.session.student, ...student};
    account.replaceChildren(...(data.fees || data.scholarship ? [accountCard(data)] : []));
    renderProfileDashboard(data, tickets.items, approvals.items);
    $("profile-avatar").textContent = initials(student.name);
    $("profile-name").textContent = student.name;
    $("profile-list").replaceChildren(...[["Student ID", student.id], ["Programme", student.programme], ["Registered email", student.email]]
      .flatMap(([term, value]) => [el("dt", term), el("dd", value)]));
    $("student-meta").textContent = `${student.id} · ${student.programme}`;
  } catch (error) { if (!handleAuthError(error)) failed(account, error, loadProfile); }
}
async function loadMemory() {
  const list = $("memory-list"); loading(list, 2);
  try {
    const {items} = await api("/api/memory");
    if (!items.length) return empty(list, "Nothing remembered yet", "Save a preference below, or ask the assistant to remember your programme or hostel room.", "sparkle", {actions: [
      {text: "Add a fact", icon: "plus", primary: true, run: () => $("memory-key").focus()},
      {text: "Remember my hostel room", icon: "chat", run: () => draftQuestion("Remember that my hostel room is ")},
    ]});
    list.replaceChildren(...items.map(item => {
      const card = el("article", undefined, "card record");
      const main = el("div", undefined, "record-main");
      main.append(el("h3", MEMORY_LABELS[item.key] || label(item.key)), el("p", item.value), el("small", `Saved ${date(item.updated_at)}`));
      const forget = button("Forget", "secondary", "trash", {"aria-label": `Forget ${MEMORY_LABELS[item.key] || item.key}`});
      forget.addEventListener("click", () => busy(forget, async () => {
        try { await api(`/api/memory/${encodeURIComponent(item.key)}`, json("DELETE")); toast("Preference removed."); await loadMemory(); } catch (error) { toast(error.message, "error"); }
      }));
      card.append(main, forget);
      return card;
    }));
  } catch (error) { if (!handleAuthError(error)) failed(list, error, loadMemory); }
}
$("memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = $("memory-key").value, raw = $("memory-value").value.trim();
  const value = state.session.memory_options[key] ? raw : raw.toUpperCase();
  await busy(event.submitter, async () => {
    try {
      await api("/api/memory", json("POST", {key, value, consent: $("memory-consent").checked}));
      $("memory-consent").checked = false; toast("Saved for future conversations."); await loadMemory();
    } catch (error) { toast(error.message, "error"); }
  });
});

/* ---------- Activity: usage dashboard, agent runs and audit trail ---------- */
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
let usageRange = "30d";
try { usageRange = localStorage.getItem("campus-usage-range") || usageRange; } catch { /* default range */ }
$("usage-range").append(CDUsage.rangeSwitch(usageRange, (key) => {
  usageRange = key;
  try { localStorage.setItem("campus-usage-range", key); } catch { /* remembered for this page only */ }
  loadActivity();
}));
function runCard(run, maxTokens) {
  const card = el("article", undefined, "card run-card");
  const top = el("div", undefined, "run-top");
  top.append(badge(run.status), el("time", date(run.created_at), undefined, {datetime: run.created_at}));
  if (run.thread) {
    const link = el("button", run.thread.title, "link-button run-thread", {type: "button", title: `Open “${run.thread.title}”`});
    link.addEventListener("click", () => go("chat", run.thread.id));
    top.append(link);
  } else top.append(el("span", "Conversation deleted", "run-thread is-missing"));
  const took = el("span", undefined, "run-time", {title: "Total response time"}); took.append(icon("clock", 14), el("span", CDUsage.seconds(run.latency_ms)));
  top.append(took);
  const metrics = el("div", undefined, "run-metrics");
  const chip = (iconName, text) => { const node = el("span", undefined, "run-chip"); node.append(icon(iconName, 13), el("span", text)); metrics.append(node); };
  chip("bot", plural(run.model_calls, "model call"));
  if (run.tools.length) chip("settings", plural(run.tools.length, "tool call"));
  if ((run.retrieved_evidence || []).length) chip("book", plural(run.retrieved_evidence.length, "section") + " read");
  if ((run.memory_used || []).length) chip("sparkle", plural(run.memory_used.length, "remembered fact"));
  if (run.model && run.model_calls) chip("chat", run.model);
  card.append(top, metrics);
  const tokens = el("div", undefined, "run-tokens");
  if (run.model_calls) {
    const inTok = run.input_tokens ?? 0, outTok = run.output_tokens ?? 0;
    const text = el("span"); text.append(el("strong", inTok.toLocaleString()), " input · ", el("strong", outTok.toLocaleString()), " output tokens");
    if (!run.usage_complete) text.append(" (partial)");
    const track = el("span", undefined, "run-token-track", {"aria-hidden": "true"});
    const bar = CDUsage.splitBar(inTok, outTok); bar.style.setProperty("--w", String(Math.max(1, (inTok + outTok) / maxTokens * 100)));
    track.append(bar); tokens.append(text, track);
  } else tokens.append(el("span", {privacy_filtered: "Not sent to the model: sensitive content was filtered.",
                                  out_of_scope: "Declined by the scope guard before calling the model."}[run.status] || "Answered without calling the model."));
  card.append(tokens);
  if (run.tools.length) {
    const toolRow = el("div", undefined, "run-tools", {"aria-label": "Tools called", role: "list"});
    for (const t of run.tools) {
      const node = el("span", t.name, t.ok ? "tool-chip" : "tool-chip is-failed", {role: "listitem", title: t.ok ? label(t.decision || "ok") : `Failed${t.error ? ": " + t.error : ""}`});
      if (!t.ok) node.prepend(icon("alert", 12));
      toolRow.append(node);
    }
    card.append(toolRow);
  }
  const details = el("details"); details.append(el("summary", "Inspect structured trace", "link-button"), el("pre", JSON.stringify(run, null, 2), "trace-json"));
  card.append(details);
  return card;
}
async function loadActivity() {
  const list = $("traces-list"); loading(list, 3);
  const dash = document.querySelectorAll("#view-activity .usage-grid, #usage-kpis");
  dash.forEach(node => node.classList.add("is-refreshing"));
  try {
    const [usage, runs] = await Promise.all([api(`/api/usage?range=${usageRange}&tz=${CDUsage.tzOffset()}`), api(`/api/traces?range=${usageRange}`)]);
    const t = usage.totals;
    $("usage-note").textContent = t.runs ? `${plural(t.runs, "run")} in ${CDUsage.rangeText(usageRange)} · last run ${relative(t.last_run)}` : `No runs in ${CDUsage.rangeText(usageRange)}`;
    CDUsage.kpis($("usage-kpis"), t);
    $("usage-bucket").textContent = usage.bucket === "week" ? "Per week" : "Per day";
    CDUsage.tokenChart($("usage-chart"), usage.series, usage.bucket);
    CDUsage.outcomes($("usage-outcomes"), usage.statuses, t.runs);
    CDUsage.tools($("usage-tools"), usage.tools);
    const threads = usage.conversations;
    $("usage-threads-note").textContent = threads.count > threads.items.length ? `Top ${threads.items.length} of ${threads.count}` : "Tokens";
    CDUsage.barList($("usage-threads"), threads.items, {value: c => c.total_tokens, name: c => c.title, format: CDUsage.compact,
      detail: c => plural(c.runs, "run"), split: c => [c.input_tokens, c.output_tokens], onOpen: c => c.id && go("chat", c.id), emptyText: "No conversations in this range."});
    $("usage-threads").querySelectorAll("button.bar-row").forEach((row, i) => {
      const c = threads.items[i];
      row.setAttribute("aria-label", `${c.title}: ${c.total_tokens.toLocaleString()} tokens over ${plural(c.runs, "run")}${c.id ? ". Open conversation" : ""}`);
      if (!c.id) row.disabled = true;
    });
    $("runs-note").hidden = runs.items.length < 50;
    $("runs-note").textContent = "Showing the 50 most recent runs. Export evidence for the full record.";
    if (!runs.items.length) empty(list, t.runs || usageRange === "all" ? "No agent runs yet" : "No runs in this range", usageRange === "all" ? "Ask a question to record a trace." : "Choose a longer time range, or ask a question to record a trace.", "log", {actions: [
      {text: "Ask a question", icon: "chat", primary: true, run: () => draftQuestion("")},
    ]});
    else {
      const maxTokens = Math.max(1, ...runs.items.map(r => (r.input_tokens ?? 0) + (r.output_tokens ?? 0)));
      list.replaceChildren(...runs.items.map(run => runCard(run, maxTokens)));
    }
  } catch (error) { if (!handleAuthError(error)) failed(list, error, loadActivity); }
  finally { dash.forEach(node => node.classList.remove("is-refreshing")); }
}

/* ---------- Audit trail (Settings → Audit trail) ---------- */
let auditDecision = "";
async function loadAudit() {
  const tbody = $("audit-list"), filters = $("audit-filters");
  const message = (text) => { const r = el("tr"); r.append(el("td", text, "muted", {colspan: "4"})); tbody.replaceChildren(r); };
  message("Loading…");
  try {
    const {items} = await api("/api/audit");
    // One chip per decision present, with its count; "All" first.
    const counts = new Map();
    for (const a of items) counts.set(a.decision, (counts.get(a.decision) || 0) + 1);
    if (auditDecision && !counts.has(auditDecision)) auditDecision = "";
    const render = () => {
      filters.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.decision === auditDecision)));
      const shown = auditDecision ? items.filter(a => a.decision === auditDecision) : items;
      $("audit-caption").textContent = `${shown.length} audit event${shown.length === 1 ? "" : "s"}${auditDecision ? ", decision " + label(auditDecision) : ""}`;
      if (!shown.length) return message(items.length ? "No events with this decision." : "No audit events yet.");
      tbody.replaceChildren(...shown.map(a => {
        const row = el("tr");
        row.append(el("td", undefined, undefined), el("td", label(a.action)));
        row.firstChild.append(el("time", date(a.timestamp), undefined, {datetime: a.timestamp, title: relative(a.timestamp)}));
        const decision = el("td"); decision.append(badge(a.decision)); row.append(decision, el("td", label(a.result)));
        return row;
      }));
    };
    filters.replaceChildren(...[["", "All", items.length], ...[...counts].sort((x, y) => y[1] - x[1]).map(([d, n]) => [d, label(d), n])].map(([d, text, n]) => {
      const chip = el("button", undefined, "audit-chip", {type: "button", "data-decision": d});
      chip.append(el("span", text), el("span", String(n), "audit-chip-count"));
      chip.addEventListener("click", () => { auditDecision = d; render(); });
      return chip;
    }));
    render();
  } catch (error) { if (!handleAuthError(error)) message(error.message || "Could not load the audit trail."); }
}

boot();
