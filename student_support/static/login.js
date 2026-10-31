"use strict";
/* Sign-in screens (student app and admin panel): a show/hide toggle on the password field, a Caps Lock hint,
   fields marked invalid and linked to the error message, and the showcase panel on wide screens. */
const CDLogin = (() => {
  const {el, icon} = CD;

  function enhance({password, fields = [], error}) {
    const wrap = el("div", undefined, "input-wrap");
    password.replaceWith(wrap); wrap.append(password);
    const reveal = el("button", undefined, "input-action", {type: "button", "aria-label": "Show password", "aria-pressed": "false", title: "Show password"});
    reveal.append(icon("eye", 16));
    reveal.addEventListener("click", () => {
      const show = password.type === "password";
      password.type = show ? "text" : "password";
      reveal.setAttribute("aria-pressed", String(show));
      reveal.setAttribute("aria-label", show ? "Hide password" : "Show password"); reveal.title = reveal.getAttribute("aria-label");
      reveal.replaceChildren(icon(show ? "eyeOff" : "eye", 16));
      password.focus();
    });
    wrap.append(reveal);
    // Hide the password again before it is sent, so it never stays visible on screen.
    password.closest("form")?.addEventListener("submit", () => { if (password.type === "text") reveal.click(); });

    // The hint stays in the page (an empty live region) so screen readers announce it when text appears.
    const caps = el("p", undefined, "caps-hint", {"aria-live": "polite"});
    wrap.after(caps);
    const check = (event) => { const on = event.getModifierState?.("CapsLock"); const text = on ? "Caps Lock is on" : ""; if (caps.textContent !== text) caps.textContent = text; };
    password.addEventListener("keydown", check); password.addEventListener("keyup", check);
    password.addEventListener("blur", () => { caps.textContent = ""; });

    // When the error shows, mark the fields at fault: the empty ones, or both when the ID or password was wrong.
    if (error && fields.length) {
      const mark = () => {
        const bad = error.hidden ? [] : (fields.some(f => !f.value.trim()) ? fields.filter(f => !f.value.trim()) : fields);
        for (const f of fields) {
          if (bad.includes(f)) { f.setAttribute("aria-invalid", "true"); f.setAttribute("aria-describedby", error.id); }
          else { f.removeAttribute("aria-invalid"); f.removeAttribute("aria-describedby"); }
        }
      };
      new MutationObserver(mark).observe(error, {attributes: true, attributeFilter: ["hidden"], childList: true, characterData: true, subtree: true});
      for (const f of fields) f.addEventListener("input", () => { f.removeAttribute("aria-invalid"); f.removeAttribute("aria-describedby"); });
    }
  }

  /* ---------- Showcase panel (wide screens): headline, one rotating sample exchange, three points ---------- */
  const SHOWCASE = {
    student: {
      kicker: "Student support",
      title: "Clear answers about your fees and policies, with sources.",
      label: "Example questions",
      // Each example paraphrases a real knowledge base section and cites its real ID.
      samples: [
        {tab: "Fees", q: "What happens if I pay my fees late?",
         a: [["A late charge of "], ["INR 500", true], [" applies for each working day after the due date, up to "], ["INR 5,000", true], [" per term."]], cite: "LATE-07", meta: "From the finance guide"},
        {tab: "Scholarships", q: "Am I eligible for the merit scholarship?",
         a: [["Merit awards go to the "], ["top ten ranks", true], [" of your programme cohort with a term GPA of at least "], ["3.5 out of 4.0", true], [", and 75% attendance in every course."]], cite: "MERIT-09", meta: "From the scholarship guide"},
        {tab: "Tickets", q: "The payment portal crashed on the due date.",
         a: [["Report it to Finance "], ["today", true], [" with a screenshot or transaction reference, and you may pay on the next working day without a late charge. I can raise a ticket for you."]], cite: "PAYMENT-02", meta: "Policy, plus a ticket if you want one"},
      ],
      steps: [["Your own record only", "Never anyone else's"], ["Cites the policy it used", "Open the exact section"],
              ["Raises tickets for you", "Tracked in one place"]],
    },
    staff: {
      kicker: "Staff workspace",
      title: "Tickets, approvals and the knowledge base in one place.",
      label: "What staff see",
      samples: [
        {tab: "Tickets", q: "TKT-4A6B · Payment portal crash", a: [["Raised from chat by "], ["Anshika Sharma", true], [". Priority "], ["High", true], [", unassigned."]], cite: "Queue", meta: "Assign, reply, resolve"},
        {tab: "Approvals", q: "Registered email change · Rohan M.", a: [["New address "], ["rohan.m@example.edu", true], [" is waiting for a staff decision."]], cite: "Approval", meta: "Approve or decline"},
        {tab: "Knowledge", q: "Fee Policy 2026 · 12 sections", a: [["Indexed and searchable. Answers cite sections like "], ["PAYMENT-02", true], ["."]], cite: "Indexed", meta: "Edit and reindex"},
      ],
      steps: [["Role-based access", "Checked on the server"], ["Every action logged", "Searchable activity log"],
              ["Read-only chat review", "Opening one is audited"]],
    },
  };
  function showcase(container, kind = "student") {
    const data = SHOWCASE[kind];
    const head = el("div", undefined, "sc-head");
    head.append(el("p", data.kicker, "sc-kicker"), el("h2", data.title, "sc-title"));

    // Not a live region: the example changes on its own, and announcing each change would interrupt typing.
    const card = el("div", undefined, "sc-card", {id: `sc-card-${kind}`});
    const topic = el("span", undefined, "sc-topic");
    const dots = el("div", undefined, "sc-dots", {role: "group", "aria-label": data.label});
    let index = 0, timer = null, stopped = false;
    const show = (i) => {
      index = i; const s = data.samples[i];
      dots.querySelectorAll("button").forEach((b, n) => b.setAttribute("aria-pressed", String(n === i)));
      topic.textContent = s.tab;
      const q = el("p", s.q, "sc-q");
      const a = el("p", undefined, "sc-a");
      for (const [t, bold] of s.a) a.append(bold ? el("strong", t) : t);
      const foot = el("p", undefined, "sc-foot"); foot.append(el("span", s.cite, "sc-cite"), el("span", s.meta));
      card.replaceChildren(el("span", kind === "student" ? "You asked" : "In the queue", "sc-who"), q, a, foot);
      card.classList.remove("is-in"); void card.offsetWidth; card.classList.add("is-in");
    };
    data.samples.forEach((s, i) => {
      const b = el("button", undefined, undefined, {type: "button", "aria-controls": card.id, "aria-label": `${s.tab} example`, title: s.tab});
      b.addEventListener("click", () => { stopped = true; clearInterval(timer); show(i); });
      dots.append(b);
    });
    const nav = el("div", undefined, "sc-nav"); nav.append(topic, dots);
    const example = el("div", undefined, "sc-example"); example.append(card, nav);

    const steps = el("ul", undefined, "sc-points");
    for (const [title, sub] of data.steps) {
      const li = el("li"), mark = el("span", undefined, "sc-check", {"aria-hidden": "true"}), text = el("span");
      mark.append(icon("check", 14)); text.append(el("strong", title), el("span", sub, "sc-sub"));
      li.append(mark, text); steps.append(li);
    }

    container.replaceChildren(head, example, steps);
    show(0);
    // Cycle the examples while the panel is on screen. It pauses while the pointer or keyboard focus is in the panel,
    // and stops for good once a tab is chosen. With reduced motion it never starts.
    let paused = false;
    container.addEventListener("pointerenter", () => { paused = true; });
    container.addEventListener("pointerleave", () => { paused = container.contains(document.activeElement); });
    container.addEventListener("focusin", () => { paused = true; });
    container.addEventListener("focusout", (event) => { if (!container.contains(event.relatedTarget)) paused = container.matches(":hover"); });
    if (!CD.reducedMotion()) timer = setInterval(() => {
      if (!stopped && !paused && container.offsetParent && !document.hidden) show((index + 1) % data.samples.length);
    }, 5500);
  }

  return {enhance, showcase};
})();
