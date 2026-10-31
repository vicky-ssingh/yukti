"use strict";
/* Shared helpers for the student app and the admin panel. Content is always built with DOM
   APIs and textContent; nothing from the server or the model is ever parsed as HTML. */
const CD = (() => {
  let csrf = "";
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    wallet: "M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7.5A2.5 2.5 0 0 0 5.5 10H20v5h-3.5a2.5 2.5 0 0 1 0-5",
    calendar: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
    award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8.5 13.5 7 21l5-3 5 3-1.5-7.5",
    book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5",
    alert: "M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    ticket: "M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8ZM13 6v2M13 11v2M13 16v2",
    check: "M5 12.5 10 17.5 19 7",
    shield: "M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6L12 3Z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14.5a6.5 6.5 0 0 1 4 6.5",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z",
    chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12Z",
    plus: "M12 5v14M5 12h14",
    send: "M5 12h14M13 6l6 6-6 6",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    edit: "M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4",
    menu: "M4 6h16M4 12h16M4 18h16",
    x: "M6 6l12 12M18 6 6 18",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
    inbox: "M4 13h4l1.5 3h5L16 13h4M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2.5-8Z",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
    log: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5ZM14 3v5h5M9 13h6M9 17h6",
    refresh: "M20 11a8 8 0 0 0-14.8-4M4 5v4h4M4 13a8 8 0 0 0 14.8 4M20 19v-4h-4",
    archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
    bot: "M12 4V2M7 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3ZM9 14h.01M15 14h.01M2 13v3M22 13v3",
    logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10",
    chevron: "M9 6l6 6-6 6",
    back: "M15 6l-6 6 6 6",
    chevronDown: "M6 9l6 6 6-6",
    speaker: "M4 9v6h4l5 4V5L8 9H4ZM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10",
    stop: "M7 7h10v10H7z",
    pin: "M9 4h6M10 4l-1 6-3 3v1h12v-1l-3-3-1-6M12 14v6",
    sidebar: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 4v16",
    panelRight: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM15 4v16",
    more: "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
    lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8 11V7a4 4 0 0 1 8 0v4",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    chart: "M3 3v18h18M8 17v-4M13 17V8M18 17v-7",
    upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
    download: "M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
    sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
    copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
    arrowDown: "M12 5v14M6 13l6 6 6-6",
    arrowRight: "M5 12h14M13 6l6 6-6 6",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  };

  function el(tag, text, className, attrs) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
    return node;
  }
  function icon(name, size = 18) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "icon");
    const path = document.createElementNS(SVG, "path"); path.setAttribute("d", ICONS[name] || ICONS.file);
    svg.append(path); return svg;
  }
  function button(label, className = "secondary", iconName, attrs) {
    const node = el("button", undefined, className, {type: "button", ...attrs});
    if (iconName) node.append(icon(iconName, 16));
    if (label) node.append(el("span", label));
    return node;
  }
  /* Fill elements with [data-icon] placeholders from the static HTML. */
  function hydrateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach(n => { if (!n.querySelector("svg")) n.prepend(icon(n.dataset.icon, Number(n.dataset.size) || 18)); });
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {...options, headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf, ...(options.headers || {})}});
    } catch {
      throw Object.assign(new Error("Can't reach Yukti. Check your connection and try again."), {status: 0});
    }
    let data = {};
    try { data = await response.json(); } catch { /* empty or non-JSON body */ }
    if (!response.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), {status: response.status, data});
    if (data && data.csrf_token) csrf = data.csrf_token;
    return data;
  }
  const json = (method, body) => ({method, body: JSON.stringify(body ?? {})});

  let toastTimer;
  /* The status region exists from page load and is never display:none, so screen readers
     announce the first message too. It is hidden visually by emptying it. */
  function toastRegion() {
    let node = document.getElementById("toast");
    if (!node) { node = el("div", undefined, "toast", {id: "toast", role: "status", "aria-live": "polite", "aria-atomic": "true"}); document.body.append(node); }
    return node;
  }
  function toast(message, kind = "info") {
    const node = toastRegion();
    node.replaceChildren(icon(kind === "error" ? "alert" : "check", 16), el("span", message));
    node.dataset.kind = kind; node.classList.add("is-visible");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.classList.remove("is-visible"); node.replaceChildren(); }, 5000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", toastRegion); else toastRegion();

  const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  /* An off-canvas drawer: while closed on a small screen it is inert (out of the tab order and
     hidden from screen readers). Opening moves focus into it; closing returns focus to the trigger. */
  function drawer({panel, trigger, watch = panel, openClass = "open", query, hiddenClass}) {
    const media = matchMedia(query);
    let wasOpen = false;
    const sync = () => {
      const open = watch.classList.contains(openClass);
      const hiddenOnDesktop = !media.matches && hiddenClass && watch.classList.contains(hiddenClass);
      const off = (media.matches && !open) || hiddenOnDesktop;
      panel.inert = off;
      if (off) panel.setAttribute("aria-hidden", "true"); else panel.removeAttribute("aria-hidden");
      if (trigger) trigger.setAttribute("aria-expanded", String(media.matches ? open : !hiddenOnDesktop));
      if (media.matches && open && !wasOpen) panel.querySelector(FOCUSABLE)?.focus();
      if (media.matches && !open && wasOpen && trigger && (!document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement))) trigger.focus();
      wasOpen = open;
    };
    new MutationObserver(sync).observe(watch, {attributes: true, attributeFilter: ["class"]});
    media.addEventListener("change", sync);
    window.addEventListener("resize", sync);  // some browsers report the media change late
    sync();
    return sync;
  }
  /* Persistent inline error for a form or control (WCAG 3.3.1): stays until fixed, is announced,
     and is linked to the field with aria-describedby / aria-invalid. */
  let errorCount = 0;
  function errorBox(anchor) {
    const container = anchor.closest("form") || anchor.closest(".card") || anchor.parentElement;
    let box = [...container.children].find(c => c.classList.contains("form-error"));
    if (!box) { box = el("p", undefined, "form-error", {role: "alert", id: `form-error-${++errorCount}`}); container.append(box); }
    return box;
  }
  function fieldError(anchor, message, field) {
    if (!anchor) return toast(message, "error");
    const box = errorBox(anchor);
    box.replaceChildren(icon("alert", 15), el("span", message));
    box.hidden = false;
    if (field) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", box.id);
      field.addEventListener("input", () => clearFieldError(field), {once: true});
      field.focus();
    }
  }
  function clearFieldError(anchor) {
    const container = anchor?.closest("form") || anchor?.closest(".card") || anchor?.parentElement;
    const box = container && [...container.children].find(c => c.classList.contains("form-error"));
    if (box) box.hidden = true;
    container?.querySelectorAll("[aria-invalid=true]").forEach(f => f.removeAttribute("aria-invalid"));
  }
  /* A labelled text prompt in a native dialog, replacing window.prompt. Resolves to the text or null. */
  function promptDialog(title, labelText, value = "", maxLength = 80) {
    return new Promise(resolve => {
      const dialog = el("dialog", undefined, "dialog");
      const form = el("form");
      const inputId = `prompt-${++errorCount}`;
      const input = el("input", undefined, undefined, {id: inputId, maxlength: String(maxLength), required: true});
      input.value = value;
      const ok = el("button", "Save", "primary", {type: "submit"});
      const cancel = el("button", "Cancel", "secondary", {type: "button"});
      const actions = el("div", undefined, "dialog-actions"); actions.append(cancel, ok);
      const field = el("div", undefined, "field"); field.append(el("label", labelText, undefined, {for: inputId}), input);
      form.append(el("h2", title, "dialog-title"), field, actions); dialog.append(form);
      let done = false;
      const finish = (result) => { if (done) return; done = true; if (dialog.open) dialog.close(); dialog.remove(); resolve(result); };
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!input.value.trim()) return fieldError(input, `${labelText} can't be empty.`, input);
        finish(input.value.trim());
      });
      cancel.addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
      document.body.append(dialog); dialog.showModal(); input.select();
    });
  }
  /* Skip links move focus without touching location.hash, which both apps use for routing. */
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(".skip-link");
    if (!link) return;
    event.preventDefault();
    const target = document.getElementById(link.getAttribute("href").slice(1));
    const heading = target?.querySelector("h1");
    focusHeading(heading || target);
  });
  /* Desktop show/hide for a side region (the sidebar or the trace panel). Small screens keep their
     drawer behaviour; this only applies above the drawer breakpoint. The choice is remembered. */
  function collapsible({watch, hiddenClass, hideButton, showButton, storageKey, query, labels, icons, defaultHidden = false, remember = true, fallbackFocus}) {
    const small = matchMedia(query);
    const set = (hidden, moveFocus) => {
      watch.classList.toggle(hiddenClass, hidden);
      if (remember) try { localStorage.setItem(storageKey, hidden ? "hidden" : "shown"); } catch { /* not persisted */ }
      hideButton.setAttribute("aria-label", labels.hide);
      hideButton.setAttribute("aria-expanded", String(!hidden));  // the show button's state is kept by drawer()
      if (showButton) {
        showButton.setAttribute("aria-label", small.matches ? labels.mobile : labels.show);
        showButton.title = small.matches ? labels.mobile : labels.show;
        // The same icon hides and shows on desktop; phones keep their own drawer icon.
        if (icons) showButton.replaceChildren(icon(small.matches ? icons.mobile : icons.desktop, 18));
      }
      // Wait a tick: the drawer helper removes inert in a mutation callback, and inert elements can't take focus.
      if (moveFocus) setTimeout(() => {
        if (!hidden) return hideButton.focus();
        if (showButton?.offsetParent) return showButton.focus();
        fallbackFocus?.();
      }, 0);
    };
    let saved = null;
    if (remember) try { saved = localStorage.getItem(storageKey); } catch { /* use the default */ }
    if (saved === "hidden" || (saved === null && defaultHidden)) watch.classList.add(hiddenClass);
    set(watch.classList.contains(hiddenClass), false);
    small.addEventListener("change", () => set(watch.classList.contains(hiddenClass), false));
    hideButton.addEventListener("click", () => { if (!small.matches) set(true, true); });
    return {isDesktop: () => !small.matches, show: (moveFocus = true) => set(false, moveFocus), hide: (moveFocus = false) => set(true, moveFocus),
            hidden: () => watch.classList.contains(hiddenClass)};
  }
  /* Drag the sidebar's right edge to resize it (desktop). Keyboard: arrows, Home/End; double-click resets.
     The width is a CSS variable on the app grid and is remembered in this browser. */
  function resizableSidebar({app, handle, storageKey, min = 220, max = 400, initial = 248}) {
    const clamp = (w) => Math.round(Math.min(max, Math.max(min, w)));
    const apply = (w, save) => {
      w = clamp(w);
      app.style.setProperty("--sidebar-w", `${w}px`);
      handle.setAttribute("aria-valuenow", String(w));
      handle.setAttribute("aria-valuetext", `${w} pixels`);
      if (save) try { localStorage.setItem(storageKey, String(w)); } catch { /* not persisted */ }
    };
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    let saved = initial;
    try { saved = Number(localStorage.getItem(storageKey)) || initial; } catch { /* default width */ }
    apply(saved, false);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { handle.setPointerCapture(event.pointerId); } catch { /* capture is a nicety; dragging still works */ }
      app.classList.add("is-resizing");
      const left = app.getBoundingClientRect().left;
      const move = (e) => apply(e.clientX - left, false);
      const up = (e) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        app.classList.remove("is-resizing");
        apply(e.clientX - left, true);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", () => apply(initial, true));
    handle.addEventListener("keydown", (event) => {
      const now = Number(handle.getAttribute("aria-valuenow"));
      const next = {ArrowLeft: now - 16, ArrowRight: now + 16, Home: min, End: max}[event.key];
      if (next === undefined) return;
      event.preventDefault();
      apply(next, true);
    });
  }
  /* Move focus to a page heading after navigation so keyboard and screen-reader users land on the new view. */
  function focusHeading(node) {
    if (!node) return;
    node.setAttribute("tabindex", "-1");
    node.focus({preventScroll: true});
  }

  function time(value) { return value ? new Date(value).toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit"}) : ""; }
  function date(value) { return value ? new Date(value).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"}) : "—"; }
  function relative(value) {
    if (!value) return "";
    const seconds = (Date.now() - new Date(value).getTime()) / 1000;
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} d ago`;
    return new Date(value).toLocaleDateString(undefined, {dateStyle: "medium"});
  }
  const label = (value) => String(value ?? "").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
  function badge(value, kind) { return el("span", label(value), `badge badge-${kind || String(value).replace(/[^a-z_]/gi, "")}`); }

  /* Minimal Markdown: paragraphs, bullet and numbered lists, pipe tables, **bold**, *italic*, `code` and
     [SECTION-01] citations. Citations become buttons when onCite is given. */
  function inline(text, parent, onCite) {
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[A-Z][A-Z0-9]{1,15}-\d{2,3}\])/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
      const token = match[0];
      if (token.startsWith("**")) parent.append(el("strong", token.slice(2, -2)));
      else if (token.startsWith("`")) parent.append(el("code", token.slice(1, -1)));
      else if (token.startsWith("[")) {
        const id = token.slice(1, -1);
        const cite = el(onCite ? "button" : "span", id, "cite", onCite ? {type: "button", title: `Open source ${id}`, "aria-label": `Open source ${id}`} : undefined);
        if (onCite) cite.addEventListener("click", () => onCite(id));
        parent.append(cite);
      } else parent.append(el("em", token.slice(1, -1)));
      last = match.index + token.length;
    }
    if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
  }
  /* Turn the ways models cite a section into [ID]: "[Source: X]", "【X】", "**X**" or a bare ID.
     Bare and bold IDs are converted only for sections that were actually retrieved (knownIds). */
  function normaliseCitations(text, knownIds = []) {
    let out = String(text || "").replace(/‑/g, "-").replace(/【\s*/g, "[").replace(/\s*】/g, "]")
      .replace(/\[\s*(?:sources?|ref(?:erence)?|see)\s*:?\s*([A-Z][A-Z0-9]{1,15}-\d{2,3})\s*\]/gi, "[$1]");
    for (const id of knownIds) {
      out = out.split(`**${id}**`).join(`[${id}]`)
               .replace(new RegExp(`(^|[^\\[A-Z0-9-])${id}(?![\\]A-Z0-9-])`, "g"), `$1[${id}]`);
    }
    return out;
  }
  /* GitHub-style pipe table. Numbers and amounts are right-aligned (or as the "---:" row says).
     The wrapper scrolls sideways on narrow screens instead of widening the page. */
  function mdTable(lines, onCite) {
    const cells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    const rule = lines.length > 1 && cells(lines[1]).every(c => /^:?-{2,}:?$/.test(c)) ? cells(lines[1]) : null;
    const head = rule ? cells(lines[0]) : null, body = lines.slice(rule ? 2 : 0).map(cells);
    const numeric = (col) => body.length > 0 && body.every(r => !r[col] || /^[-+]?(?:₹|INR|Rs\.?)?\s?[\d,.]+%?(?:\s*(?:days?|%))?$|^\*\*[^*]*\d[^*]*\*\*$/i.test(r[col]));
    const width = Math.max(head?.length || 0, ...body.map(r => r.length));
    const align = Array.from({length: width}, (_, i) => (rule?.[i] || "").endsWith(":") && !(rule[i] || "").startsWith(":") || numeric(i) ? "num" : "");
    const table = el("table");
    if (head) {
      const tr = el("tr");
      head.forEach((c, i) => { const th = el("th", undefined, align[i], {scope: "col"}); inline(c, th, onCite); tr.append(th); });
      const thead = el("thead"); thead.append(tr); table.append(thead);
    }
    const tbody = el("tbody");
    for (const r of body) {
      const tr = el("tr");
      for (let i = 0; i < width; i++) { const td = el("td", undefined, align[i]); inline(r[i] || "", td, onCite); tr.append(td); }
      tbody.append(tr);
    }
    table.append(tbody);
    const wrap = el("div", undefined, "md-table", {role: "region", "aria-label": head ? `Table: ${head.join(", ")}` : "Table", tabindex: "0"});
    wrap.append(table);
    return wrap;
  }
  function markdown(text, onCite, knownIds) {
    const root = el("div", undefined, "md");
    let list = null, paragraph = [], table = [];
    const flush = () => { if (paragraph.length) { const p = el("p"); inline(paragraph.join(" "), p, onCite); root.append(p); paragraph = []; } };
    const flushTable = () => { if (table.length) { root.append(mdTable(table, onCite)); table = []; } };
    for (const raw of normaliseCitations(text, knownIds).split("\n")) {
      const line = raw.trim();
      if (line.startsWith("|") && line.length > 1) { flush(); list = null; table.push(line); continue; }
      flushTable();
      const bullet = line.match(/^[-*•]\s+(.*)/), numbered = line.match(/^(\d+)[.)]\s+(.*)/), heading = line.match(/^#{1,4}\s+(.*)/);
      if (bullet || numbered) {
        flush();
        const tag = bullet ? "ul" : "ol";
        if (!list || list.tagName.toLowerCase() !== tag) { list = el(tag); root.append(list); }
        const item = el("li"); inline((bullet || numbered)[bullet ? 1 : 2], item, onCite); list.append(item);
      } else if (heading) {
        flush(); list = null; const h = el("p", undefined, "md-heading"); inline(heading[1], h, onCite); root.append(h);
      } else if (!line) { flush(); list = null; }
      else { if (list) list = null; paragraph.push(line); }
    }
    flush(); flushTable();
    return root;
  }

  /* Empty state: a small illustration (the icon on a tile with ghost cards and orbiting dots) that leans
     toward the pointer and pops when clicked, then the message and optional next-step buttons.
     actions: [{text, icon?, run, primary?}]. compact: smaller art for narrow panels. */
  function empty(container, title, text, iconName = "inbox", {actions = [], compact = false} = {}) {
    const box = el("div", undefined, compact ? "empty-state is-compact" : "empty-state");
    const art = el("div", undefined, "empty-art", {"aria-hidden": "true"});
    const tile = el("span", undefined, "ea-tile"); tile.append(icon(iconName, compact ? 20 : 24));
    art.append(el("span", undefined, "ea-ring"), el("span", undefined, "ea-card ea-back"), el("span", undefined, "ea-card ea-mid"), tile,
               el("span", undefined, "ea-dot ea-d1"), el("span", undefined, "ea-dot ea-d2"), el("span", undefined, "ea-dot ea-d3"));
    art.addEventListener("pointermove", (event) => {
      const r = art.getBoundingClientRect();
      art.style.setProperty("--mx", ((event.clientX - r.left) / r.width - .5).toFixed(3));
      art.style.setProperty("--my", ((event.clientY - r.top) / r.height - .5).toFixed(3));
    });
    art.addEventListener("pointerleave", () => { art.style.setProperty("--mx", 0); art.style.setProperty("--my", 0); });
    art.addEventListener("click", () => {
      art.classList.remove("is-pop"); void art.offsetWidth; art.classList.add("is-pop");
    });
    art.addEventListener("animationend", (event) => { if (event.animationName === "ea-pop") art.classList.remove("is-pop"); });
    box.append(art, el("strong", title));
    if (text) box.append(el("p", text));
    if (actions.length) {
      const row = el("div", undefined, "empty-actions");
      for (const {text: label, icon: actionIcon, run, primary} of actions) {
        const node = el("button", undefined, primary ? "empty-action is-primary" : "empty-action", {type: "button"});
        if (actionIcon) node.append(icon(actionIcon, 15));
        node.append(el("span", label));
        node.addEventListener("click", run);
        row.append(node);
      }
      box.append(row);
    }
    container.replaceChildren(box);
  }
  function loading(container, rows = 3) {
    const box = el("div", undefined, "skeleton-list", {"aria-busy": "true", "aria-label": "Loading"});
    for (let i = 0; i < rows; i++) box.append(el("div", undefined, "skeleton"));
    container.replaceChildren(box);
  }
  function failed(container, error, retry) {
    const box = el("div", undefined, "error-state", {role: "alert"});
    box.append(icon("alert", 22), el("p", error.message || "Something went wrong."));
    if (retry) { const again = button("Try again", "secondary", "refresh"); again.addEventListener("click", retry); box.append(again); }
    container.replaceChildren(box);
  }
  /* Run an async action with the button disabled and a spinner shown. */
  async function busy(buttonNode, action) {
    if (buttonNode) { buttonNode.disabled = true; buttonNode.classList.add("is-busy"); }
    try { return await action(); } finally { if (buttonNode) { buttonNode.disabled = false; buttonNode.classList.remove("is-busy"); } }
  }
  function confirmDialog(title, text, confirmLabel = "Confirm", danger = false) {
    return new Promise(resolve => {
      const dialog = el("dialog", undefined, "dialog");
      const form = el("form", undefined, undefined, {method: "dialog"});
      const ok = el("button", confirmLabel, danger ? "danger" : "primary", {value: "ok"});
      const cancel = el("button", "Cancel", "secondary", {value: "cancel"});
      const actions = el("div", undefined, "dialog-actions"); actions.append(cancel, ok);
      form.append(el("h2", title, "dialog-title"), el("p", text, "muted"), actions); dialog.append(form);
      // Resolve from the buttons themselves; the dialog's own close event can be delayed when the page is not drawing.
      let done = false;
      const finish = (ok) => { if (done) return; done = true; if (dialog.open) dialog.close(); dialog.remove(); resolve(ok); };
      ok.addEventListener("click", (e) => { e.preventDefault(); finish(true); });
      cancel.addEventListener("click", (e) => { e.preventDefault(); finish(false); });
      dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
      dialog.addEventListener("close", () => finish(dialog.returnValue === "ok"));
      document.body.append(dialog); dialog.showModal(); cancel.focus();
    });
  }
  /* Light/dark switch. Without a saved choice the system setting applies. */
  function currentTheme() {
    const chosen = document.documentElement.dataset.theme;
    return chosen || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* Count a number up from zero (KPI tiles, overview stats). format turns the running value into text. */
  function countUp(node, target, format = (v) => Math.round(v).toLocaleString(), duration = 700) {
    if (typeof target !== "number" || !isFinite(target) || reducedMotion() || target === 0) { node.textContent = format(target); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3;
      node.textContent = format(t < 1 ? target * eased : target);
      if (t < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function setTheme(next) {
    // Cross-fade colours for a moment so the switch doesn't flash.
    const root = document.documentElement;
    if (!reducedMotion()) { root.classList.add("theme-fade"); clearTimeout(setTheme.timer); setTheme.timer = setTimeout(() => root.classList.remove("theme-fade"), 450); }
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("campus-theme", next); } catch { /* choice lasts for this page only */ }
  }
  function themeToggle() {
    const node = el("button", undefined, "theme-toggle", {type: "button"});
    const paint = () => {
      const dark = currentTheme() === "dark";
      node.replaceChildren(icon(dark ? "sun" : "moon", 16), el("span", dark ? "Light mode" : "Dark mode"));
      node.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    };
    node.addEventListener("click", () => { setTheme(currentTheme() === "dark" ? "light" : "dark"); paint(); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
    paint();
    return node;
  }
  function initials(name) { return String(name || "?").split(/\s+/).map(n => n[0]).join("").slice(0, 2).toUpperCase(); }

  /* Popover menus (conversation options, settings). One shared popover, keyboard operable:
     arrows move between items, letter shortcuts run them, Escape or Tab closes, focus returns to the button.
     Each action is {text, icon, key?, run, cls?, sep?}; sep draws a divider before that item. */
  let openMenuState = null;
  function closeMenu(returnFocus = true) {
    if (!openMenuState) return;
    const {node, trigger} = openMenuState;
    openMenuState = null;
    node.remove();
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus && trigger.isConnected) trigger.focus();
  }
  function openMenu(trigger, label, actions, {align = "end", place = "below"} = {}) {
    const reopen = openMenuState?.trigger === trigger;
    closeMenu(false);
    if (reopen) return;
    const node = el("div", undefined, "menu-pop", {role: "menu", "aria-label": label});
    const items = actions.map(({text, icon: iconName, key, run, cls, sep}) => {
      const option = el("button", undefined, cls || "", {type: "button", role: "menuitem", tabindex: "-1"});
      option.append(icon(iconName, 15), el("span", text));
      if (key) { option.setAttribute("aria-keyshortcuts", key); option.append(el("kbd", key, "menu-key", {"aria-hidden": "true"})); }
      option.addEventListener("click", () => { closeMenu(false); run(); });
      if (sep) node.append(el("div", undefined, "menu-sep", {role: "separator"}));
      node.append(option);
      return option;
    });
    node.addEventListener("keydown", (event) => {
      const shortcut = actions.findIndex(({key}) => key && key === event.key.toUpperCase());
      if (shortcut >= 0 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); items[shortcut].click(); return; }
      const index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
      } else if (event.key === "Home" || event.key === "End") { event.preventDefault(); items[event.key === "Home" ? 0 : items.length - 1].focus(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      else if (event.key === "Tab") closeMenu(false);
    });
    document.body.append(node);
    // Place the menu below the button (or above it), flipping when it would leave the screen.
    const r = trigger.getBoundingClientRect(), h = node.offsetHeight, w = node.offsetWidth;
    const fitsBelow = r.bottom + 4 + h <= innerHeight, fitsAbove = r.top - h - 4 >= 8;
    const above = place === "above" ? fitsAbove || !fitsBelow : !fitsBelow;
    node.style.top = `${above ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    node.style.left = `${Math.min(Math.max(8, align === "start" ? r.left - 8 : r.right - w), innerWidth - w - 8)}px`;
    trigger.setAttribute("aria-expanded", "true");
    openMenuState = {node, trigger};
    items[0].focus();
  }
  document.addEventListener("pointerdown", (event) => {
    if (openMenuState && !openMenuState.node.contains(event.target) && !openMenuState.trigger.contains(event.target)) closeMenu(false);
  });
  window.addEventListener("resize", () => closeMenu(false));
  /* Settings menu (bottom of the sidebar): theme and sign out live here instead of in the sidebar itself. */
  // pages: extra destinations listed first, e.g. [{text, icon, key, run}].
  function settingsMenu(trigger, signOut, pages = []) {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const dark = currentTheme() === "dark";
      openMenu(trigger, "Settings", [
        ...pages,
        {text: dark ? "Light mode" : "Dark mode", icon: dark ? "sun" : "moon", key: "T", sep: pages.length > 0, run: () => { setTheme(dark ? "light" : "dark"); toast(dark ? "Light mode on." : "Dark mode on."); }},
        {text: "Sign out", icon: "logout", key: "S", run: signOut, sep: true},
      ], {align: "end", place: "above"});
    });
  }

  return {openMenu, closeMenu, settingsMenu, countUp, reducedMotion,api, json, el, icon, button, hydrateIcons, toast, time, date, relative, label, badge, markdown, empty, loading, failed, busy, confirmDialog, initials, themeToggle, currentTheme, setTheme, drawer, collapsible, resizableSidebar, focusHeading, fieldError, clearFieldError, promptDialog,
          setCsrf: (token) => { csrf = token || ""; }};
})();
