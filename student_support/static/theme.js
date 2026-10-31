"use strict";
/* Applies the saved light/dark choice before first paint. Loaded without defer on purpose.
   No saved choice means the system setting decides (see the prefers-color-scheme rules). */
(() => {
  try {
    const saved = localStorage.getItem("campus-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch { /* storage unavailable: follow the system setting */ }
  // If a page script fails while the loading screen is still up, say so instead of spinning forever.
  window.addEventListener("error", () => {
    const boot = document.getElementById("boot");
    if (!boot || boot.hidden || boot.dataset.failed) return;
    boot.dataset.failed = "true";
    boot.removeAttribute("aria-busy");
    boot.textContent = "Yukti couldn't start. Refresh the page; if it keeps happening, restart the server.";
  });
})();
