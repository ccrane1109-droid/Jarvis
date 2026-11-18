/* ==========================================================================
   JARVIS — Learning & Research Hub: the "to organize" inbox.

   Things saved with the old Quick Capture button (a takeaway, idea, question, action step, quote or flashcard) were marked
   "to organize". They are still here: the Notes tab lists them above your notes until you open them or mark them organized.
   New items are saved straight to where they belong from the + Add menu.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc;
  /* ---------------- the inbox: what was captured and is not organized yet ---------------- */

  function inboxRow(item) {
    const r = item.record, kind = item.kind;
    const label = kind === "cards" ? "Flashcard" : kind === "actions" ? "Action step" : A.typeLabel(r.type);
    const text = kind === "cards" ? r.question : kind === "actions" ? r.lesson : (r.title || r.text);
    return '<li class="ln-sched-row"><div class="ln-sched-main"><span class="ln-badges">' + A.badge("accent", label) + '</span><span class="ln-item-title">' + esc(A.snippet(text, 140)) + '</span></div>' +
      '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="inbox-organize" data-kind="' + kind + '" data-id="' + esc(r.id) + '">Organize</button>' +
      '<button type="button" class="btn btn-secondary" data-act="inbox-done" data-kind="' + kind + '" data-id="' + esc(r.id) + '">Done</button></div></li>';
  }
  // The inbox as a short list above the Notes (only when something is waiting).
  function inboxHtml() {
    const items = L.inboxItems(store.state());
    if (!items.length) return "";
    return '<section class="ln-sec ln-inbox" aria-labelledby="lnInboxK"><h2 class="ln-label" id="lnInboxK">To organize (' + items.length + ')</h2><ul class="ln-sched">' + items.map(inboxRow).join("") + '</ul></section>';
  }
  A.inboxHtml = inboxHtml;

  A.acts["inbox-organize"] = function (el) {
    const kind = el.getAttribute("data-kind"), id = el.getAttribute("data-id"), r = store.get(kind, id);
    if (!r) return;
    if (kind === "notes") A.editNote(r); else if (kind === "actions") A.editAction(r); else if (A.editCard) A.editCard(r);
  };
  A.acts["inbox-done"] = function (el) {
    const kind = el.getAttribute("data-kind"), id = el.getAttribute("data-id");
    if (!store.patch(kind, id, { inbox: undefined })) A.saveFailed(); else A.say("Marked as organized.");
  };
})();
