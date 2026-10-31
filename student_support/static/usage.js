"use strict";
/* Usage dashboard pieces shared by the student Traces page and the admin Usage page: a time-range switch,
   KPI tiles, a tokens-over-time chart (hover or arrow keys for a readout, plus a table view), horizontal
   bar lists and an outcome meter. Data comes from /api/usage or /api/admin/usage. */
const CDUsage = (() => {
  const {el, icon, label, badge} = CD;
  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  /* ---------- Formatting ---------- */
  const full = (n) => (n ?? 0).toLocaleString();
  const whole = (n) => full(Math.round(n ?? 0));
  function compact(n) {
    if (n === null || n === undefined) return "—";
    const a = Math.abs(n);
    const fmt = (v, unit) => `${v.toFixed(v >= 100 || Number.isInteger(v) ? 0 : 1).replace(/\.0$/, "")}${unit}`;
    if (a >= 1e6) return fmt(n / 1e6, "M");
    if (a >= 1e3) return fmt(n / 1e3, "k");
    return String(Math.round(n));
  }
  function seconds(ms) {
    if (ms === null || ms === undefined) return "—";
    return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`;
  }
  const percent = (r) => (r === null || r === undefined ? "—" : `${Math.round(r * 100)}%`);
  const tzOffset = () => -new Date().getTimezoneOffset();
  const dayLabel = (iso, opts = {day: "numeric", month: "short"}) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);

  /* ---------- Range switch ---------- */
  const RANGES = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]];
  function rangeSwitch(current, onChange) {
    const group = el("div", undefined, "range-switch", {role: "group", "aria-label": "Time range"});
    for (const [key, text] of RANGES) {
      const option = el("button", text, undefined, {type: "button", "aria-pressed": String(key === current)});
      option.addEventListener("click", () => {
        if (option.getAttribute("aria-pressed") === "true") return;
        group.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === option)));
        onChange(key);
      });
      group.append(option);
    }
    return group;
  }
  const rangeText = (key) => ({"7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days", all: "all time"}[key] || key);

  /* ---------- KPI tiles ---------- */
  function splitBar(a, b, className = "split-bar") {
    const bar = el("span", undefined, className, {"aria-hidden": "true"});
    const first = el("span", undefined, "seg seg-in"), second = el("span", undefined, "seg seg-out");
    first.style.setProperty("flex-grow", String(a + b ? a : 1));
    second.style.setProperty("flex-grow", String(a + b ? b : 0));
    bar.append(first, second);
    return bar;
  }
  function kpi({text, value, raw, fmt, sub, iconName, title, split}) {
    const node = el("div", undefined, "kpi", title ? {title} : undefined);
    const top = el("div", undefined, "kpi-top");
    const badgeIcon = el("span", undefined, "kpi-icon"); badgeIcon.append(icon(iconName, 15));
    top.append(el("span", text, "kpi-label"), badgeIcon);
    const number = el("strong", value, "kpi-value");
    node.append(top, number);
    if (fmt && typeof raw === "number") CD.countUp(number, raw, fmt);
    if (split) node.append(splitBar(...split));
    if (sub) node.append(el("span", sub, "kpi-sub"));
    return node;
  }
  function kpis(container, t, lead = []) {
    const tiles = [
      ...lead,
      {text: "Agent runs", value: full(t.runs), raw: t.runs, fmt: whole, iconName: "log", sub: t.runs ? `${percent(t.success_rate)} completed` : "No runs in this range"},
      {text: "Tokens used", value: compact(t.total_tokens), raw: t.total_tokens, fmt: compact, iconName: "sparkle", title: `${full(t.total_tokens)} tokens: ${full(t.input_tokens)} input, ${full(t.output_tokens)} output`,
       split: [t.input_tokens, t.output_tokens], sub: `${compact(t.input_tokens)} input · ${compact(t.output_tokens)} output`},
      {text: "Avg tokens per run", value: compact(t.avg_tokens_per_run), raw: t.avg_tokens_per_run, fmt: compact, iconName: "chat", title: "Across runs that called the model",
       sub: t.partial_usage_runs ? `${t.partial_usage_runs} run${t.partial_usage_runs === 1 ? "" : "s"} without full usage` : "Runs that called the model"},
      {text: "Avg response time", value: seconds(t.avg_latency_ms), raw: t.avg_latency_ms, fmt: seconds, iconName: "clock", sub: t.p95_latency_ms !== null ? `95th percentile ${seconds(t.p95_latency_ms)}` : "No runs yet"},
      {text: "Model calls", value: full(t.model_calls), raw: t.model_calls, fmt: whole, iconName: "bot", sub: t.runs ? `${(t.model_calls / t.runs).toFixed(1)} per run` : "—"},
      {text: "Tool calls", value: full(t.tool_calls), raw: t.tool_calls, fmt: whole, iconName: "settings", sub: `${full(t.sources_cited)} policy section${t.sources_cited === 1 ? "" : "s"} read`},
    ];
    container.replaceChildren(...tiles.map(kpi));
  }

  /* ---------- Tokens over time: stacked bars, input below output ---------- */
  function niceMax(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value)), n = value / power;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
  }
  // A bar whose top corners are rounded (the data end); the baseline end stays square.
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function tokenChart(container, points, bucket) {
    const sumIn = points.reduce((s, p) => s + p.input_tokens, 0), sumOut = points.reduce((s, p) => s + p.output_tokens, 0);
    const when = (p) => bucket === "week" ? `Week of ${dayLabel(p.date)}` : dayLabel(p.date, {weekday: "short", day: "numeric", month: "short"});

    const head = el("div", undefined, "chart-head");
    const legend = el("div", undefined, "chart-legend");
    for (const [cls, name, total] of [["key-in", "Input tokens", sumIn], ["key-out", "Output tokens", sumOut]]) {
      const item = el("span", undefined, "legend-item"); item.append(el("span", undefined, `legend-key ${cls}`, {"aria-hidden": "true"}), el("span", name), el("strong", compact(total)));
      legend.append(item);
    }
    const toggle = el("button", "Show table", "link-button", {type: "button", "aria-expanded": "false"});
    head.append(legend, toggle);

    const plot = el("div", undefined, "chart-plot");
    const tip = el("div", undefined, "chart-tip", {"aria-hidden": "true"}); tip.hidden = true;
    const live = el("div", undefined, "sr-only", {"aria-live": "polite"});
    const tableWrap = el("div", undefined, "table-wrap chart-table"); tableWrap.hidden = true;
    const table = el("table"); const thead = el("thead"), hr = el("tr");
    for (const h of [bucket === "week" ? "Week" : "Day", "Input", "Output", "Total", "Runs"]) hr.append(el("th", h, undefined, {scope: "col"}));
    thead.append(hr); const tbody = el("tbody");
    for (const p of [...points].reverse()) {
      const row = el("tr");
      row.append(el("td", when(p)), el("td", full(p.input_tokens)), el("td", full(p.output_tokens)), el("td", full(p.input_tokens + p.output_tokens)), el("td", full(p.runs)));
      tbody.append(row);
    }
    table.append(thead, tbody); tableWrap.append(table);
    toggle.addEventListener("click", () => {
      const show = tableWrap.hidden;
      tableWrap.hidden = !show; plot.hidden = show;
      toggle.textContent = show ? "Show chart" : "Show table"; toggle.setAttribute("aria-expanded", String(show));
    });
    container.replaceChildren(head, plot, tableWrap, live);
    if (!sumIn && !sumOut) {
      plot.classList.add("is-empty"); plot.append(el("p", "No tokens recorded in this range.", "muted small"));
      return;
    }

    let active = -1, columns = [], geometry = null, entered = false;
    const show = (index, announce) => {
      columns.forEach((g, i) => g.classList.toggle("is-active", i === index));
      active = index;
      if (index < 0 || !geometry) { tip.hidden = true; return; }
      const p = points[index];
      tip.replaceChildren(el("span", when(p), "tip-title"));
      for (const [cls, name, value] of [["key-out", "Output", p.output_tokens], ["key-in", "Input", p.input_tokens]]) {
        const row = el("span", undefined, "tip-row"); row.append(el("span", undefined, `tip-key ${cls}`), el("strong", full(value)), el("span", name)); tip.append(row);
      }
      tip.append(el("span", `${full(p.input_tokens + p.output_tokens)} total · ${p.runs} run${p.runs === 1 ? "" : "s"}`, "tip-foot"));
      tip.hidden = false;
      // Beside the column (right of it, or left near the right edge) so the hovered bar stays visible.
      const {x, half} = geometry.columns[index];
      const width = tip.offsetWidth, room = plot.clientWidth, scale = room / geometry.width;
      const right = x * scale + half * scale + 10;
      tip.style.setProperty("left", `${right + width <= room ? right : Math.max(0, x * scale - half * scale - 10 - width)}px`);
      tip.style.setProperty("top", `${geometry.top}px`);
      if (announce) live.textContent = `${when(p)}: ${full(p.input_tokens)} input, ${full(p.output_tokens)} output tokens, ${p.runs} runs.`;
    };

    const draw = () => {
      const width = Math.max(260, plot.clientWidth), height = 210;
      const m = {top: 14, right: 6, bottom: 26, left: 40};
      const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
      const max = niceMax(Math.max(...points.map(p => p.input_tokens + p.output_tokens)));
      const band = iw / points.length, barW = Math.max(2, Math.min(26, band * .62));
      const chart = svg("svg", {viewBox: `0 0 ${width} ${height}`, width, height, class: "chart-svg", tabindex: "0", role: "img",
        "aria-label": `Tokens per ${bucket}: ${full(sumIn)} input and ${full(sumOut)} output in total. Use the left and right arrow keys to read each ${bucket}.`});
      for (let i = 0; i <= 4; i++) {
        const value = max * i / 4, y = m.top + ih - ih * i / 4;
        chart.append(svg("line", {x1: m.left, x2: width - m.right, y1: y, y2: y, class: i ? "grid" : "baseline"}));
        const tick = svg("text", {x: m.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end"}); tick.textContent = compact(value); chart.append(tick);
      }
      const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 64))));
      columns = []; geometry = {columns: [], width, top: m.top};
      points.forEach((p, i) => {
        const g = svg("g", {class: "col"});
        const x = m.left + i * band + (band - barW) / 2, base = m.top + ih;
        const hIn = p.input_tokens / max * ih, hOut = p.output_tokens / max * ih;
        const gap = hIn && hOut ? 2 : 0;
        // The hit area comes first so its hover wash sits behind the bars.
        g.append(svg("rect", {x: m.left + i * band, y: m.top, width: band, height: ih, class: "hit"}));
        if (hIn) g.append(svg("path", {d: hOut ? `M${x},${base}V${base - hIn}H${x + barW}V${base}Z` : topRounded(x, base - hIn, barW, hIn, 4), class: "bar-in"}));
        if (hOut) g.append(svg("path", {d: topRounded(x, base - hIn - gap - hOut, barW, hOut, 4), class: "bar-out"}));
        g.addEventListener("pointerenter", () => show(i));
        g.style.setProperty("--i", String(i)); chart.append(g); columns.push(g);
        geometry.columns.push({x: x + barW / 2, half: barW / 2});
        if ((points.length - 1 - i) % every === 0) {
          const t = svg("text", {x: x + barW / 2, y: height - 8, class: "axis-label", "text-anchor": "middle"});
          t.textContent = dayLabel(p.date); chart.append(t);
        }
      });
      chart.addEventListener("pointerleave", () => show(-1));
      chart.addEventListener("focus", () => show(active >= 0 ? active : points.length - 1, true));
      chart.addEventListener("blur", () => show(-1));
      chart.addEventListener("keydown", (event) => {
        const moves = {ArrowLeft: -1, ArrowRight: 1};
        if (event.key in moves) { event.preventDefault(); show(Math.min(points.length - 1, Math.max(0, (active < 0 ? points.length - 1 : active) + moves[event.key])), true); }
        else if (event.key === "Home" || event.key === "End") { event.preventDefault(); show(event.key === "Home" ? 0 : points.length - 1, true); }
        else if (event.key === "Escape") show(-1);
      });
      // Bars grow in on the first draw only, not on every resize.
      if (!entered) { entered = true; chart.classList.add("is-entering"); }
      plot.replaceChildren(chart, tip);
      if (active >= 0) show(active);
    };
    draw();
    let frame = 0, lastWidth = plot.clientWidth;
    new ResizeObserver(() => {
      if (plot.hidden || plot.clientWidth === lastWidth) return;
      lastWidth = plot.clientWidth; cancelAnimationFrame(frame); frame = requestAnimationFrame(draw);
    }).observe(plot);
  }

  /* ---------- Horizontal bar list (tools, conversations, models) ---------- */
  // split(item) -> [input, output] draws the bar in the two token colours instead of the brand colour.
  function barList(container, items, {value, name, detail, format = full, onOpen, split, emptyText = "Nothing in this range."}) {
    if (!items.length) return container.replaceChildren(el("p", emptyText, "muted small bar-empty"));
    const max = Math.max(1, ...items.map(value));
    container.replaceChildren(...items.map(item => {
      const row = el(onOpen ? "button" : "div", undefined, "bar-row", onOpen ? {type: "button"} : undefined);
      const text = el("span", undefined, "bar-text");
      text.append(el("span", name(item), "bar-name"));
      const more = detail?.(item); if (more) text.append(el("span", more, "bar-detail"));
      const track = el("span", undefined, "bar-track", {"aria-hidden": "true"});
      const fill = split ? splitBar(...split(item), "split-bar bar-fill") : el("span", undefined, "bar-fill");
      fill.style.setProperty("--w", String(Math.max(2, value(item) / max * 100)));
      track.append(fill);
      row.append(text, el("strong", format(value(item)), "bar-value"), track);
      if (onOpen) row.addEventListener("click", () => onOpen(item));
      return row;
    }));
  }
  function tools(container, items) {
    barList(container, items, {value: t => t.calls, name: t => label(t.name),
      detail: t => t.failed ? `${t.failed} failed` : "", emptyText: "No tools were called in this range."});
  }

  /* ---------- Outcomes: one meter plus a labelled list ---------- */
  function outcomes(container, statuses, runs) {
    if (!runs) return container.replaceChildren(el("p", "No runs in this range.", "muted small bar-empty"));
    const meter = el("div", undefined, "outcome-meter", {"aria-hidden": "true"});
    const list = el("ul", undefined, "outcome-list");
    for (const {status, runs: n} of statuses) {
      const seg = el("span", undefined, `outcome-seg out-${status.replace(/[^a-z_]/g, "")}`); seg.style.setProperty("flex-grow", String(n)); meter.append(seg);
      const item = el("li"); item.append(badge(status), el("strong", full(n)), el("span", percent(n / runs), "muted small")); list.append(item);
    }
    container.replaceChildren(meter, list);
  }

  return {rangeSwitch, rangeText, kpis, tokenChart, barList, tools, outcomes, splitBar, compact, full, seconds, percent, tzOffset};
})();
