/* ==========================================================================
   JARVIS — Learning & Research Hub: Quick Capture.

   A button that stays on every Learning screen. It saves a takeaway, a research idea, a question to investigate, an action
   step, a quote or a flashcard in a few seconds, and marks it "to organize" (an inbox) so it can be sorted into the right
   book or project later. Nothing is guessed: what you type is what is saved, attached to the book or research project you
   are looking at only if you leave that ticked.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc, K = window.JarvisLearningCards;
  const KEY = "jarvisLearnCaptureType";

  const KINDS = [
    { key: "takeaway", label: "Takeaway", field: "Key takeaway", hint: "What is worth remembering?" },
    { key: "idea", label: "Research idea", field: "Research idea", hint: "Something you would like to research" },
    { key: "question", label: "Question", field: "Question to investigate", hint: "What do you want to find out?" },
    { key: "action", label: "Action step", field: "Action step", hint: "What will you do?" },
    { key: "quote", label: "Quote", field: "Quote", hint: "The words, as written" },
    { key: "flashcard", label: "Flashcard", field: "Question", hint: "The question side" }
  ];

  function lastKind() { try { const v = window.localStorage.getItem(KEY); return KINDS.some(function (k) { return k.key === v; }) ? v : "takeaway"; } catch (e) { return "takeaway"; } }
  function rememberKind(k) { try { window.localStorage.setItem(KEY, k); } catch (e) { /* a browser that won't store it: the choice just isn't remembered */ } }

  // The book or research project on screen, if any: what a capture is attached to by default.
  function context() {
    const st = A.state;
    if (st.tab === "books" && st.id) { const b = store.get("books", st.id); if (b) return { kind: "book", id: b.id, title: b.title }; }
    if (st.tab === "research" && st.id) { const r = store.get("research", st.id); if (r) return { kind: "research", id: r.id, title: r.title }; }
    return null;
  }

  function open() {
    const ctxRef = context(), startKind = lastKind();
    const chips = KINDS.map(function (k) {
      return '<input type="radio" name="kind" id="lnk_' + k.key + '" value="' + k.key + '"' + (k.key === startKind ? " checked" : "") + ' class="visually-hidden"><label for="lnk_' + k.key + '" class="ln-rate-l ln-kind-l">' + esc(k.label) + '</label>';
    }).join("");
    const body =
      '<fieldset class="ln-rate-set"><legend>What are you capturing?</legend><div class="ln-rate ln-kinds">' + chips + '</div></fieldset>' +
      A.fArea("text", "Key takeaway", "", { rows: 4, max: 10000, required: true }) +
      '<div id="lnCapAnswer" hidden>' + A.fArea("answer", "Answer", "", { rows: 3, max: 2000, required: true, placeholder: "The answer, so you can check yourself" }) + '</div>' +
      '<div id="lnCapPage" hidden>' + A.fText("page", "Page or speaker (optional)", "", { max: 40, placeholder: "p. 112, or who said it" }) + '</div>' +
      '<div id="lnCapRemember" class="form-row"><label class="ln-check"><input type="checkbox" name="remember"><span>Remember this: review it after 1, 3, 7, 14 and 30 days</span></label></div>' +
      (ctxRef ? '<div class="form-row"><label class="ln-check"><input type="checkbox" name="useContext" checked><span>Attach to “' + esc(A.snippet(ctxRef.title, 50)) + '”</span></label></div>' : "") +
      '<p class="field-hint">It goes to your inbox so you can organize it later.</p>' +
      '<button type="button" class="btn btn-secondary" data-sheet-act="save-more">Save and add another</button>';

    function sync(el) {
      const kind = el.querySelector('input[name="kind"]:checked').value, k = KINDS.filter(function (x) { return x.key === kind; })[0];
      el.querySelector('label[for="lnf_text"]').firstChild.textContent = k.field;
      const ta = el.querySelector("#lnf_text"); ta.setAttribute("placeholder", k.hint);
      el.querySelector("#lnCapAnswer").hidden = kind !== "flashcard";
      el.querySelector("#lnCapPage").hidden = kind !== "quote";
      el.querySelector("#lnCapRemember").hidden = !(kind === "takeaway" || kind === "quote" || kind === "flashcard");
      const rem = el.querySelector('input[name="remember"]');
      if (kind === "flashcard") { if (!rem.hasAttribute("data-touched")) rem.checked = true; el.querySelector("#lnCapRemember span").textContent = "Review it on a schedule (1, 3, 7, 14, 30 days)"; }
      else { if (!rem.hasAttribute("data-touched")) rem.checked = false; el.querySelector("#lnCapRemember span").textContent = "Remember this: review it after 1, 3, 7, 14 and 30 days"; }
    }

    // Saves what is in the form. -> { ok: true, label } | { ok: false, errors }
    function save(v) {
      const kind = v.kind, today = store.today();
      const useCtx = ctxRef && v.useContext;
      const bookIds = useCtx && ctxRef.kind === "book" ? [ctxRef.id] : [], researchIds = useCtx && ctxRef.kind === "research" ? [ctxRef.id] : [];
      let r, rec;
      if (kind === "action") {
        r = L.checkAction({ lesson: v.text, status: "todo", sourceType: useCtx ? ctxRef.kind : "none", sourceId: useCtx ? ctxRef.id : "", inbox: true },
          { today: today, books: store.list("books"), research: store.list("research"), notes: store.list("notes") });
        if (!r.ok) return { ok: false, errors: { text: r.errors.lesson || "Write the action step." } };
        rec = store.add("actions", r.value);
      } else if (kind === "flashcard") {
        r = K.check({ question: v.text, answer: v.answer, bookIds: bookIds, researchIds: researchIds, remember: !!v.remember, inbox: true }, { today: today, books: store.list("books"), research: store.list("research") });
        if (!r.ok) return { ok: false, errors: { text: r.errors.question, answer: r.errors.answer } };
        rec = store.add("cards", r.value);
      } else {
        r = L.checkNote({ type: kind, text: v.text, page: kind === "quote" ? v.page : "", bookIds: bookIds, researchIds: researchIds, remember: !!v.remember && (kind === "takeaway" || kind === "quote"), inbox: true },
          { today: today, books: store.list("books"), research: store.list("research"), notes: store.list("notes") });
        if (!r.ok) return { ok: false, errors: { text: r.errors.text || "Write something to save." } };
        rec = store.add("notes", r.value);
      }
      if (!rec) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
      rememberKind(kind);
      return { ok: true, label: KINDS.filter(function (x) { return x.key === kind; })[0].label };
    }

    A.openSheet({
      title: "Quick capture", body: body, submit: "Save", focus: "#lnf_text",
      onOpen: sync,
      onChange: function (t, el) {
        if (t.name === "kind") sync(el);
        if (t.name === "remember") t.setAttribute("data-touched", "1");
      },
      onAct: function (act, btn, el) {
        if (act !== "save-more") return;
        const form = el.querySelector("form"), r = save(A.formValues(form));
        Array.prototype.forEach.call(form.querySelectorAll("[aria-invalid]"), function (f) { f.removeAttribute("aria-invalid"); });
        if (!r.ok) { A.showErrors(el, r.errors, r.message); return; }
        A.showErrors(el, {}, "");
        ["text", "answer", "page"].forEach(function (n) { const f = form.elements[n]; if (f) f.value = ""; });
        A.say(r.label + " saved. Ready for another.");
        const live = el.querySelector("#lnCapSaved") || (function () { const p = document.createElement("p"); p.id = "lnCapSaved"; p.className = "ln-saved-note"; p.setAttribute("role", "status"); el.querySelector("form").insertBefore(p, el.querySelector(".ln-sheet-actions")); return p; })();
        live.textContent = r.label + " saved.";
        form.elements.text.focus();
      },
      onSubmit: function (v) {
        const r = save(v);
        if (!r.ok) return r;
        A.notice(r.label + " saved to your inbox.", "");
        return { ok: true };
      }
    });
  }

  /* ---------------- the inbox: what was captured and is not organized yet ---------------- */

  function inboxRow(item) {
    const r = item.record, kind = item.kind;
    const label = kind === "cards" ? "Flashcard" : kind === "actions" ? "Action step" : A.typeLabel(r.type);
    const text = kind === "cards" ? r.question : kind === "actions" ? r.lesson : (r.title || r.text);
    return '<li class="ln-sched-row"><div class="ln-sched-main"><span class="ln-badges">' + A.badge("accent", label) + '</span><span class="ln-item-title">' + esc(A.snippet(text, 140)) + '</span></div>' +
      '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="inbox-organize" data-kind="' + kind + '" data-id="' + esc(r.id) + '">Organize</button>' +
      '<button type="button" class="btn btn-secondary" data-act="inbox-done" data-kind="' + kind + '" data-id="' + esc(r.id) + '">Done</button></div></li>';
  }
  // A card listing the inbox (the Dashboard shows a few; Knowledge shows them all).
  function inboxHtml(limit) {
    const items = L.inboxItems(store.state());
    if (!items.length) return "";
    const shown = limit ? items.slice(0, limit) : items;
    return '<section class="card ln-card ln-inbox" aria-labelledby="lnInbox' + (limit ? "D" : "K") + '"><div class="card-title-row"><h2 class="card-title" id="lnInbox' + (limit ? "D" : "K") + '">Captured to organize (' + items.length + ')</h2>' +
      (limit && items.length > limit ? '<button type="button" class="btn-icon" data-go="knowledge">See all</button>' : "") + '</div><ul class="ln-sched">' + shown.map(inboxRow).join("") + '</ul></section>';
  }
  A.inboxHtml = inboxHtml;
  A.dashTop.push(function () { return inboxHtml(3); });

  A.acts["inbox-organize"] = function (el) {
    const kind = el.getAttribute("data-kind"), id = el.getAttribute("data-id"), r = store.get(kind, id);
    if (!r) return;
    if (kind === "notes") A.editNote(r); else if (kind === "actions") A.editAction(r); else if (A.editCard) A.editCard(r);
  };
  A.acts["inbox-done"] = function (el) {
    const kind = el.getAttribute("data-kind"), id = el.getAttribute("data-id");
    if (!store.patch(kind, id, { inbox: undefined })) A.saveFailed(); else A.say("Marked as organized.");
  };
  A.acts["capture"] = open;
  A.capture = open;

  // The floating button (it lives in the Learning panel, so it only shows there).
  function wire() {
    const fab = document.getElementById("lnFab");
    if (fab && !fab._wired) { fab._wired = true; fab.addEventListener("click", open); }
  }
  wire();
  document.addEventListener("DOMContentLoaded", wire);
})();
