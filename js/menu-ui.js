/* ==========================================================================
   JARVIS — a small menu sheet shared by the simplified sections (Workout, Nutrition, Habits, Calendar, Strategy).

   JarvisMenu.open({ title, rows, onPick, opener })
     rows: [{ key, label, sub?, minor?, danger?, current? }]  one tap picks a row: the sheet closes, then onPick(key) runs.
   Escape, a tap outside, or the Close button dismiss it and put focus back where it was. Nothing is stored.
   ========================================================================== */

(function () {
  "use strict";

  let overlay = null, returnFocus = null, handler = null;

  function esc(v) {
    return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  function close(restore) {
    if (!overlay) return;
    document.removeEventListener("keydown", onKey, true);
    overlay.parentNode && overlay.parentNode.removeChild(overlay);
    overlay = null; handler = null;
    if (restore !== false && returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  function onKey(e) {
    if (!overlay) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const items = Array.prototype.slice.call(overlay.querySelectorAll("button:not([disabled])"));
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus(); }
  }

  function open(o) {
    close(false);
    const rows = (o && o.rows) || [];
    returnFocus = (o && o.opener) || document.activeElement;
    handler = o && o.onPick;
    overlay = document.createElement("div");
    overlay.className = "modal-overlay sheet-overlay sm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", (o && o.title) || "Menu");
    overlay.innerHTML = '<div class="modal-box sheet-box sm-box"><div class="sheet-handle" aria-hidden="true"></div>' +
      '<div class="sm-box-head"><h2 class="sm-box-title">' + esc((o && o.title) || "") + '</h2><button type="button" class="btn-icon sm-close" data-sm-close>Close</button></div>' +
      '<div class="sm-menu" role="group" aria-label="' + esc((o && o.title) || "Menu") + '">' + rows.map(function (r) {
        if (r.heading) return '<p class="sm-menu-heading">' + esc(r.heading) + '</p>';
        return '<button type="button" class="sm-menu-item' + (r.minor ? " is-minor" : "") + (r.danger ? " is-danger" : "") + (r.current ? " is-current" : "") + '" data-sm-key="' + esc(r.key) + '"' + (r.current ? ' aria-current="true"' : "") + '>' +
          '<span class="sm-menu-main">' + esc(r.label) + '</span>' + (r.sub ? '<span class="sm-menu-sub">' + esc(r.sub) + '</span>' : "") + '</button>';
      }).join("") + '</div></div>';
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-sm-close]")) { close(); return; }
      const b = e.target.closest("[data-sm-key]");
      if (!b) return;
      const key = b.getAttribute("data-sm-key"), fn = handler;
      close(false);
      if (fn) window.setTimeout(function () { fn(key); }, 0);
    });
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    const first = overlay.querySelector(".sm-menu-item.is-current") || overlay.querySelector(".sm-menu-item");
    if (first) first.focus();
  }

  window.JarvisMenu = { open: open, close: close };
})();
