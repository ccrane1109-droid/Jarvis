/* ==========================================================================
   JARVIS — the food sheet: scan a label, check it, say how much, add it.

   One sheet for every way a food gets into Jarvis (scanning, a saved food, a recent food, a recipe, a change of amount, a recipe
   ingredient), in four steps:  1 Scan  ·  2 Review  ·  3 Amount  ·  4 Add.
   A saved food starts at step 3, because its label has already been read and checked.

   The label is the baseline. Every number here is worked out by JarvisFoodAmount from the label's serving and numbers (never from a
   number that was already scaled or rounded), and rounded once, when it is shown or logged. Nothing is invented: a value the scan could
   not read is left empty and marked, and has to be typed (0 is fine) before the food can be used.

   Modes:   log         add to today's food log                            (scan or saved food -> amount -> add to a meal)
            save        keep a scanned food in the library, nothing logged (scan -> review)
            ingredient  hand a recipe ingredient back to its editor        (... -> amount -> add to recipe)
            edit        change the amount of a line already in the log     (amount only)

   JarvisFoodFlow.open({ mode, start: "scan" | "amount", food, entry, meal, itemId, onDone(result), onBack })
   Reads and writes through window.JarvisNutrition.flow only; it never touches the storage keys.
   ========================================================================== */

(function () {
  "use strict";

  const MEALS = ["breakfast", "lunch", "dinner", "snacks"];
  const MAIN_KEYS = ["calories", "protein", "carbs", "fat", "fiber"];
  const MICRO_KEYS = ["sodium", "calcium", "iron", "potassium", "vitaminC", "vitaminD"];
  const FIELD_LABEL = { calories: "Calories", protein: "Protein (g)", carbs: "Carbohydrates (g)", fat: "Fat (g)", fiber: "Fiber (g)", sodium: "Sodium (mg)", calcium: "Calcium (mg)", iron: "Iron (mg)", potassium: "Potassium (mg)", vitaminC: "Vitamin C (mg)", vitaminD: "Vitamin D (mcg)" };
  const FIELD_STEP = { calories: "1", sodium: "1", calcium: "1", potassium: "1" };

  const ICON_CAMERA = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  const ICON_IMAGE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  let st = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.JarvisCore.escapeHtml(String(s === undefined || s === null ? "" : s)); }
  function FA() { return window.JarvisFoodAmount; }
  function host() { return window.JarvisNutrition && window.JarvisNutrition.flow; }
  function round(n, p) { const f = Math.pow(10, p); return Math.round(n * f) / f; }
  function show2(n) { return String(round(n, 2)); }       // 0.5, 1.25, 85
  function show1(n) { return String(round(n, 1)); }
  function num(s) {                                        // a typed number: >= 0, or null when empty or not a number
    const t = String(s === undefined || s === null ? "" : s).trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function makeId() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function sameEntry(a, b) { return !!a && !!b && a.unit === b.unit && Math.abs(a.value - b.value) <= 1e-9 * Math.max(1, Math.abs(a.value)); }
  function mealName(m) { const l = host() && host().mealLabels; return (l && l[m]) || m; }

  /* ---------------- opening and closing ---------------- */

  function open(opts) {
    opts = opts || {};
    if (!FA() || !host()) { window.JarvisCore.showToast("The food sheet isn't ready. Reload the app and try again."); return; }
    const mode = ["log", "save", "ingredient", "edit"].indexOf(opts.mode) !== -1 ? opts.mode : "log";
    st = {
      mode: mode, opts: opts, step: "scan", history: [], food: null, draft: null, entry: null, amountText: "",
      scan: { busy: false, status: "", error: "" }, meal: MEALS.indexOf(opts.meal) !== -1 ? opts.meal : host().guessMeal(),
      skipped: false, savedNote: "", ingName: "", problem: "", opener: document.activeElement, token: null, portionMsg: "", search: ""
    };
    if (opts.food && opts.start === "amount") {
      setFood(opts.food, opts.entry || null);
      if (opts.ingName) st.ingName = opts.ingName;
      st.skipped = mode !== "edit";
      st.step = "amount";
    }
    window.JarvisCore.openModal("foodFlowModal");
    render();
  }

  function finish(result) {
    const s = st, cb = s && s.opts && s.opts.onDone;
    close();
    if (typeof cb === "function") cb(result);
  }

  function close() {
    if (!st) return;
    const s = st;
    st = null;
    window.JarvisCore.closeModal("foodFlowModal");
    if (s.opener && document.contains(s.opener) && typeof s.opener.focus === "function") { try { s.opener.focus(); } catch (e) { /* ignore */ } }
  }

  function dirty() { return !!(st && st.step === "review" && st.draft && (st.draft.fromScan || st.draft.dirty)); }

  function attemptClose() {
    if (!st) return;
    if (dirty() && !window.confirm("Close without saving this food?")) return;
    close();
  }

  function goBack() {
    if (!st) return;
    if (dirty() && !window.confirm("Go back without saving this food?")) return;
    if (st.history.length) { st.step = st.history.pop(); st.token = null; st.scan.busy = false; render(); return; }
    const back = st.opts.onBack;
    close();
    if (typeof back === "function") back();
  }

  function go(step) { st.history.push(st.step); st.step = step; render(); }

  /* ---------------- the food being used ---------------- */

  function setFood(food, entry) {
    st.food = food;
    const e = entry && FA().cleanEntry(entry) ? FA().cleanEntry(entry) : FA().suggestEntry(food);
    st.entry = { value: e.value, unit: e.unit };
    st.amountText = show2(e.value);
    st.ingName = food.name || "";
    st.portionMsg = "";
  }

  function baselineLabel(food) {
    const lab = food.label && food.label.values ? JSON.parse(JSON.stringify(food.label)) : null;
    return lab || { serving: food.serving || "1 serving", values: FA().valuesOf(food) };
  }

  // Where a food's portions and last amount are kept: a saved food or a recipe. null for anything else.
  function sourceKey(food) {
    if (food && food.source === "recipe" && food.id) return { source: "recipe", id: food.id };
    if (food && food.savedId) return { source: "saved", id: food.savedId };
    return null;
  }

  /* ---------------- drawing ---------------- */

  const STEP_NAMES = ["Scan", "Review", "Amount", "Add"];
  function stepsFor() { return st.mode === "save" ? STEP_NAMES.slice(0, 2) : STEP_NAMES; }
  function stepIndex() { return { scan: 0, review: 1, amount: 2, add: 3 }[st.step]; }

  function titleFor() {
    if (st.mode === "edit") return "Change amount";
    if (st.step === "scan") return st.mode === "save" ? "Scan a label" : "Add a food";
    if (st.step === "review") return "Check the label";
    if (st.step === "amount") return "How much?";
    return st.mode === "ingredient" ? "Add to recipe" : "Add to your meal";
  }

  function render() {
    if (!st) return;
    const body = $("ffBody");
    $("ffTitle").textContent = titleFor();
    const steps = $("ffSteps");
    if (st.mode === "edit") { steps.hidden = true; steps.innerHTML = ""; }
    else {
      steps.hidden = false;
      const cur = stepIndex();
      steps.innerHTML = stepsFor().map(function (name, i) {
        const done = i < cur || (st.skipped && i < 2 && cur >= 2);
        const here = i === cur;
        return '<li class="ff-step' + (here ? " is-current" : done ? " is-done" : "") + '"' + (here ? ' aria-current="step"' : "") + '><span class="ff-step-n" aria-hidden="true">' + (done ? "&#10003;" : i + 1) + '</span><span class="ff-step-t">' + name + (done ? '<span class="visually-hidden"> (done)</span>' : "") + '</span></li>';
      }).join("");
    }
    $("ffBack").hidden = !(st.history.length || st.opts.onBack);
    if (st.step === "scan") body.innerHTML = scanHtml();
    else if (st.step === "review") body.innerHTML = reviewHtml();
    else if (st.step === "amount") body.innerHTML = amountHtml();
    else body.innerHTML = addHtml();
    const box = document.querySelector("#foodFlowModal .ff-box");
    if (box) box.scrollTop = 0;
    body.scrollTop = 0;
    if (st.step === "scan") renderSavedResults();
    if (st.step === "review") refreshReview();
    if (st.step === "amount") refreshAmount();
    if (st.step === "add") refreshAdd();
    const total = stepsFor().length, label = st.mode === "edit" ? titleFor() : "Step " + (stepIndex() + 1) + " of " + total + ": " + titleFor();
    $("ffLive").textContent = label;
    const h = $("ffH");
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
  }

  /* ---- step 1: scan ---- */

  function scanHtml() {
    const busy = st.scan.busy;
    return (
      '<h3 class="ff-h" id="ffH" tabindex="-1">Scan the Nutrition Facts label</h3>' +
      '<p class="ff-lead">Hold the phone steady, in good light, with the whole label in view. The photo is read on this phone and not sent anywhere.</p>' +
      '<div class="ff-actions">' +
        '<button type="button" class="btn btn-primary" data-ff="camera"' + (busy ? " disabled" : "") + '>' + ICON_CAMERA + '<span>Take photo</span></button>' +
        '<button type="button" class="btn btn-secondary" data-ff="upload"' + (busy ? " disabled" : "") + '>' + ICON_IMAGE + '<span>Choose photo</span></button>' +
      '</div>' +
      '<p class="ff-status" id="ffStatus" role="status" aria-live="polite">' + (busy ? esc(st.scan.status || "Reading the label…") : "") + '</p>' +
      (st.scan.error ? '<p class="ff-problem" role="alert">' + esc(st.scan.error) + '</p>' : "") +
      '<div class="ff-or" aria-hidden="true"><span>or</span></div>' +
      '<div class="ff-search">' +
        '<label for="ffSavedSearch">Choose a saved food</label>' +
        '<input type="search" id="ffSavedSearch" placeholder="Search your foods" autocomplete="off" value="' + esc(st.search) + '"' + (busy ? " disabled" : "") + '>' +
        '<div id="ffSavedList" class="picker-list ff-saved-list"></div>' +
      '</div>' +
      '<div class="ff-actions ff-actions-single"><button type="button" class="btn btn-secondary" data-ff="manual"' + (busy ? " disabled" : "") + '>Type the numbers in by hand</button></div>'
    );
  }

  function renderSavedResults() {
    const box = $("ffSavedList");
    if (!box) return;
    const q = st.search.trim();
    let list = host().searchSaved(q);
    list.sort(function (a, b) { return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0) || a.name.localeCompare(b.name); });
    list = list.slice(0, q ? 20 : 5);
    if (!list.length) { box.innerHTML = q ? '<div class="empty-state">No saved food matches.</div>' : ""; return; }
    box.innerHTML = list.map(function (f) {
      const v = FA().valuesOf(f), per = (f.label && f.label.serving) || f.serving || "1 serving";
      return '<button type="button" class="picker-list-item" data-ff="pick" data-id="' + esc(f.id) + '"><span class="picker-list-item-title">' + esc(f.name) + (f.favorite ? ' <span class="badge badge-neutral">Favorite</span>' : "") + '</span><span class="picker-list-item-meta">' + Math.round(v.calories || 0) + ' cal &middot; per ' + esc(per) + '</span></button>';
    }).join("");
  }

  async function onFile(file) {
    if (!st || st.step !== "scan" || !file) return;
    const scanner = window.JarvisLabelScan;
    if (!scanner || typeof scanner.scanNutritionLabel !== "function") { st.scan = { busy: false, status: "", error: "Label reading isn't available right now. You can type the numbers in by hand." }; render(); return; }
    const token = {};
    st.token = token;
    st.scan = { busy: true, status: "Reading the label…", error: "" };
    render();
    let res = null;
    try {
      res = await scanner.scanNutritionLabel(file, function (t) {
        if (!st || st.token !== token) return;
        st.scan.status = String(t || "");
        const el = $("ffStatus");
        if (el) el.textContent = st.scan.status;
      });
    } catch (e) { res = { ok: false, error: "That photo couldn't be read." }; }
    if (!st || st.token !== token) return;     // closed or went back while it was reading
    st.token = null;
    st.scan.busy = false;
    if (!res || !res.ok || !res.matchedCount) {
      st.scan.error = (res && res.error) || "Nothing that looks like a nutrition label was found in that photo. Try again closer and in better light, or type the numbers in.";
      render();
      return;
    }
    st.draft = draftFromScan(res);
    go("review");
  }

  /* ---- step 2: review ---- */

  function emptyDraft() {
    return { fromScan: false, dirty: false, name: "", serving: "", size: "", sizeUnit: "g", sizeTouched: false, perContainer: 0, values: {}, review: {}, confirmed: {}, warnings: [], isFruitVeg: false, savedId: "", source: "manual" };
  }

  function draftFromScan(res) {
    const d = emptyDraft();
    const fa = FA(), P = window.JarvisLabelParse;
    d.fromScan = true;
    d.source = "scan";
    d.review = fa.reviewState(res);
    fa.ALL_FIELDS.forEach(function (k) { if (typeof res.fields[k] === "number") d.values[k] = String(res.fields[k]); });
    d.serving = res.servingSize ? String(res.servingSize).slice(0, 60) : "";
    const amt = d.serving && P ? P.parseAmount(d.serving) : null;
    if (amt) { d.size = String(round(amt.value, 3)); d.sizeUnit = amt.unit; }
    if (typeof res.servingsPerContainer === "number" && res.servingsPerContainer > 0) d.perContainer = res.servingsPerContainer;
    d.warnings = (res.warnings || []).slice(0, 6);
    if (!d.serving) d.review.serving = { state: "missing", reason: "The serving size was not read. Type it as printed on the label." };
    return d;
  }

  function fieldHtml(k) {
    const d = st.draft, r = d.review[k];
    const flagged = r && r.state !== "ok" && !d.confirmed[k] && !(r.state === "missing" && num(d.values[k]) !== null);
    const reason = k === "fiber" && r && r.state === "missing" ? "Not read from the label. Leave it empty if the label doesn't show fiber." : r ? r.reason : "";
    return (
      '<div class="ff-field' + (flagged ? " is-flagged" : "") + '" id="ffWrap_' + k + '">' +
        '<label for="ff_' + k + '">' + FIELD_LABEL[k] + '</label>' +
        '<input type="text" inputmode="decimal" autocomplete="off" id="ff_' + k + '" data-field="' + k + '" value="' + esc(d.values[k] === undefined ? "" : d.values[k]) + '"' + (flagged ? ' class="scan-check" aria-describedby="ffFlag_' + k + '"' : "") + '>' +
        '<p class="ff-flag" id="ffFlag_' + k + '"' + (flagged ? "" : " hidden") + '>' + (flagged ? esc(reason) + (r.state === "unsure" ? ' <button type="button" class="ff-ok" data-ff="confirm" data-field="' + k + '">It\'s right<span class="visually-hidden"> for ' + FIELD_LABEL[k].replace(/ \(.*\)/, "") + '</span></button>' : "") : "") + '</p>' +
      '</div>'
    );
  }

  function reviewHtml() {
    const d = st.draft;
    const warn = d.warnings.length ? '<ul class="ff-warnings">' + d.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>" : "";
    const servingFlag = d.review.serving && !d.serving.trim();
    return (
      '<h3 class="ff-h" id="ffH" tabindex="-1">' + (d.fromScan ? "Check what was read" : "Type in the label") + '</h3>' +
      '<p class="ff-lead">These are the numbers <strong>for one serving</strong>, as printed. ' + (d.fromScan ? "Anything marked was not read clearly: check it against the label." : "Leave a number empty if the label doesn't show it.") + '</p>' +
      warn +
      '<div class="form-row"><label for="ffName">Food name</label><input type="text" id="ffName" maxlength="80" autocomplete="off" placeholder="e.g. Greek yogurt" value="' + esc(d.name) + '"><p class="field-hint" id="ffNameNote" role="status"></p></div>' +
      '<div class="form-row two-col">' +
        '<div class="ff-field' + (servingFlag ? " is-flagged" : "") + '"><label for="ffServing">Serving on the label</label><input type="text" id="ffServing" maxlength="60" autocomplete="off" placeholder="e.g. 2/3 cup (55g)" value="' + esc(d.serving) + '"' + (servingFlag ? ' class="scan-check" aria-describedby="ffServingFlag"' : "") + '><p class="ff-flag" id="ffServingFlag"' + (servingFlag ? "" : " hidden") + '>' + (servingFlag ? esc(d.review.serving.reason) : "") + '</p></div>' +
        '<div><label for="ffSize">Weight or volume of that serving</label><div class="ff-inline"><input type="text" inputmode="decimal" id="ffSize" autocomplete="off" placeholder="e.g. 55" value="' + esc(d.size) + '"><select id="ffSizeUnit" aria-label="Weight or volume unit"><option value="g"' + (d.sizeUnit === "g" ? " selected" : "") + '>g</option><option value="ml"' + (d.sizeUnit === "ml" ? " selected" : "") + '>mL</option></select></div></div>' +
      '</div>' +
      '<p class="field-hint" id="ffSizeNote" role="status"></p>' +
      '<div class="ff-grid">' + MAIN_KEYS.map(fieldHtml).join("") + '</div>' +
      '<details class="collapsible-section ff-more"' + (MICRO_KEYS.some(function (k) { return d.values[k] !== undefined; }) ? " open" : "") + '><summary>More nutrients</summary><div class="collapsible-body">' +
        '<div class="ff-grid">' + MICRO_KEYS.map(fieldHtml).join("") + '</div>' +
        '<div class="checklist-item"><input type="checkbox" id="ffFruitVeg"' + (d.isFruitVeg ? " checked" : "") + '><label for="ffFruitVeg">This counts as a fruit or vegetable serving</label></div>' +
      '</div></details>' +
      '<p class="ff-problem" id="ffContinueNote" role="status"></p>' +
      '<div class="ff-actions sheet-sticky-actions"><button type="button" class="btn btn-primary" id="ffContinue" data-ff="continue">' + (st.mode === "save" ? "Save food" : "Continue") + '</button></div>'
    );
  }

  function readyInput() {
    const d = st.draft, v = { name: d.name };
    ["calories", "protein", "carbs", "fat"].forEach(function (k) { v[k] = d.values[k] === undefined ? "" : String(d.values[k]).trim().replace(",", "."); });
    return v;
  }

  // Updates what depends on the typed values (the notes, whether Continue can be pressed) without redrawing the inputs.
  function refreshReview() {
    const d = st.draft, fa = FA();
    const existing = d.name.trim() ? host().findSavedByName(d.name) : null;
    const note = $("ffNameNote");
    if (note) note.textContent = existing && existing.id !== d.savedId ? "You already have “" + existing.name + "” saved. Continuing updates it with these numbers. Its favorite and portions stay." : "";
    // the weight or volume: what the serving text says against what is typed
    const size = num(d.size), parsed = d.serving.trim() ? window.JarvisLabelParse.parseAmount(d.serving) : null;
    let sizeNote = "";
    if (!(size > 0)) sizeNote = "No weight or volume yet, so this food can only be entered in servings. Type the grams (or mL) printed on the label to enter amounts by weight.";
    else if (parsed && (parsed.unit !== d.sizeUnit || Math.abs(parsed.value - size) > Math.max(0.5, parsed.value * 0.02))) sizeNote = "The serving says " + show2(parsed.value) + " " + (parsed.unit === "g" ? "g" : "mL") + " but the box says " + show2(size) + " " + (d.sizeUnit === "g" ? "g" : "mL") + ". The box is used.";
    const sn = $("ffSizeNote");
    if (sn) sn.textContent = sizeNote;
    const ready = fa.readyToContinue(readyInput());
    const btn = $("ffContinue"), msg = $("ffContinueNote");
    if (btn) btn.disabled = !ready.ok;
    if (msg) msg.textContent = ready.ok ? "" : "Still needed: " + ready.problems.join(", ") + ". Type 0 for a number the label shows as none.";
  }

  function onReviewInput(e) {
    const d = st.draft, t = e.target;
    d.dirty = true;
    if (t.id === "ffName") d.name = t.value;
    else if (t.id === "ffServing") {
      d.serving = t.value;
      if (!d.sizeTouched) {
        const a = window.JarvisLabelParse.parseAmount(d.serving);
        d.size = a ? String(round(a.value, 3)) : "";
        if (a) d.sizeUnit = a.unit;
        const si = $("ffSize"), su = $("ffSizeUnit");
        if (si) si.value = d.size;
        if (su) su.value = d.sizeUnit;
      }
      const f = $("ffServingFlag");
      if (f && d.serving.trim()) { f.hidden = true; t.classList.remove("scan-check"); }
    } else if (t.id === "ffSize") { d.size = t.value; d.sizeTouched = true; }
    else if (t.id === "ffSizeUnit") { d.sizeUnit = t.value === "ml" ? "ml" : "g"; d.sizeTouched = true; }
    else if (t.id === "ffFruitVeg") d.isFruitVeg = t.checked;
    else if (t.getAttribute && t.getAttribute("data-field")) {
      const k = t.getAttribute("data-field");
      d.values[k] = t.value;
      d.confirmed[k] = true;                 // typing a number is an answer
      const w = $("ffWrap_" + k), f = $("ffFlag_" + k);
      if (w) w.classList.remove("is-flagged");
      if (f) f.hidden = true;
      t.classList.remove("scan-check");
    }
    refreshReview();
  }

  function recFromDraft() {
    const d = st.draft, values = {};
    FA().ALL_FIELDS.forEach(function (k) { const n = num(d.values[k]); if (n !== null) values[k] = n; });
    const sizeV = num(d.size);
    const size = sizeV > 0 && sizeV <= 100000 ? { value: round(sizeV, 3), unit: d.sizeUnit } : null;
    const serving = d.serving.trim() || (size ? show2(size.value) + " " + (size.unit === "g" ? "g" : "mL") : "1 serving");
    const label = { serving: serving.slice(0, 60), values: values };
    if (size) label.size = size;
    if (d.perContainer > 0) label.perContainer = d.perContainer;
    // numbers that were flagged and that you did not retype or confirm stay marked, so the library can say so
    const needsCheck = Object.keys(d.review).filter(function (k) { return d.review[k].state === "unsure" && !d.confirmed[k] && values[k] !== undefined; });
    return { id: d.savedId || undefined, name: d.name.trim(), label: label, isFruitVeg: d.isFruitVeg, source: d.source, needsCheck: needsCheck };
  }

  function onContinue() {
    const d = st.draft, ready = FA().readyToContinue(readyInput());
    if (!ready.ok) { refreshReview(); return; }
    const r = host().saveScanned(recFromDraft());
    if (!r.ok) { const m = $("ffContinueNote"); if (m) m.textContent = r.error; return; }
    d.savedId = r.food.id;
    const food = Object.assign(r.food, { source: "saved", savedId: r.food.id });
    if (st.mode === "save") {
      window.JarvisCore.showToast(r.created ? 'Saved "' + food.name + '" to your foods.' : r.changed ? 'Updated "' + food.name + '" in your foods.' : '"' + food.name + '" is already saved.');
      finish({ food: food });
      return;
    }
    st.savedNote = r.created ? "Saved to your foods" : r.changed ? "Updated in your foods" : "";
    setFood(food, null);
    go("amount");
  }

  /* ---- step 3: amount ---- */

  function baseLine(food) {
    const fa = FA(), base = fa.baseOf(food), lab = baselineLabel(food);
    const bits = ["One serving on the label: " + lab.serving];
    if (base && !/\d\s*(g|ml)\b/i.test(lab.serving)) bits[0] += " (" + show2(base.value) + " " + (base.unit === "g" ? "g" : "mL") + ")";
    if (base && base.perContainer) bits.push(show2(base.perContainer) + " servings per container");
    return bits.join(" · ");
  }

  function unitChip(unit, current) {
    const on = unit === current;
    const label = FA().UNITS[unit].label === "serving" ? "servings" : FA().UNITS[unit].label;
    return '<button type="button" class="ff-chip ff-unit' + (on ? " is-on" : "") + '" data-ff="unit" data-unit="' + unit + '" aria-pressed="' + (on ? "true" : "false") + '">' + label + '</button>';
  }

  function amountHtml() {
    const fa = FA(), food = st.food, base = fa.baseOf(food), units = fa.unitsFor(base);
    const key = sourceKey(food);
    const unchecked = food.needsCheck && food.needsCheck.length ? '<p class="ff-flag">These numbers were not confirmed from the label: ' + esc(food.needsCheck.map(function (k) { return fa.NAMES[k] || k; }).join(", ")) + '. Check them in Foods &rsaquo; Edit.</p>' : "";
    const noBase = !base ? '<p class="ff-note">This food has no weight or volume, so amounts are in servings. To enter grams, add the weight to the food in Foods &rsaquo; Edit.</p>' : "";
    return (
      '<h3 class="ff-h" id="ffH" tabindex="-1">' + esc(food.name) + '</h3>' +
      '<p class="ff-sub">' + esc(baseLine(food)) + '</p>' +
      (st.savedNote ? '<p class="ff-saved"><span class="badge badge-green">' + esc(st.savedNote) + '</span></p>' : "") +
      unchecked + noBase +
      '<div class="form-row"><label for="ffAmount">Amount you had</label>' +
        '<div class="ff-amount-row"><input type="text" inputmode="decimal" id="ffAmount" autocomplete="off" aria-describedby="ffEq" value="' + esc(st.amountText) + '">' +
        '<div class="ff-units" role="group" aria-label="Unit">' + units.map(function (u) { return unitChip(u, st.entry.unit); }).join("") + '</div></div>' +
      '</div>' +
      '<p class="ff-eq" id="ffEq"></p>' +
      '<div class="ff-quick" id="ffQuick" role="group" aria-label="Quick amounts"></div>' +
      '<div class="ff-preview" id="ffPreview" aria-live="polite" aria-atomic="true"></div>' +
      '<p class="ff-problem" id="ffProblem" role="alert"></p>' +
      (key ? portionsHtml(key) : "") +
      '<div class="ff-actions sheet-sticky-actions"><button type="button" class="btn btn-primary" id="ffNext" data-ff="next">' + (st.mode === "edit" ? "Update amount" : "Next") + '</button></div>'
    );
  }

  function quickChips() {
    const fa = FA(), food = st.food, base = fa.baseOf(food), out = [];
    function add(label, entry, kind) {
      if (!fa.unitAllowed(base, entry.unit) || out.some(function (o) { return sameEntry(o.entry, entry); })) return;
      out.push({ label: label, entry: entry, kind: kind });
    }
    const portions = fa.cleanPortions(food.portions);
    const dflt = portions.filter(function (p) { return p.id === food.defaultPortionId; })[0];
    if (dflt) add(dflt.name + " · " + fa.describeEntry(dflt), { value: dflt.value, unit: dflt.unit }, "portion");
    portions.forEach(function (p) { if (p !== dflt) add(p.name + " · " + fa.describeEntry(p), { value: p.value, unit: p.unit }, "portion"); });
    const last = fa.cleanEntry(food.lastPortion);
    if (last) add("Last time · " + fa.describeEntry(last), last, "last");
    add("½ serving", { value: 0.5, unit: "serving" });
    add("1 serving", { value: 1, unit: "serving" });
    add("2 servings", { value: 2, unit: "serving" });
    if (base && base.perContainer && base.perContainer !== 1 && base.perContainer !== 2) add("Whole package · " + show2(base.perContainer) + " servings", { value: base.perContainer, unit: "serving" });
    return out.slice(0, 9);
  }

  function entryFromText() {
    const text = String(st.amountText || "").trim();
    if (!text) return { entry: null, problem: "" };
    const e = FA().parseEntry(text, st.entry.unit);
    if (!e) return { entry: null, problem: "Type a number, like 85 or 1.5." };
    if (e.error) return { entry: null, problem: "That unit isn't one Jarvis knows. Use g, oz, mL, fl oz or servings." };
    return { entry: e, problem: "" };
  }

  // Redraws what depends on the amount: equivalents, quick chips, the numbers. The amount box itself is left alone while typing.
  function refreshAmount() {
    const fa = FA(), food = st.food;
    const unitSel = document.querySelectorAll("#ffBody .ff-unit");
    Array.prototype.forEach.call(unitSel, function (b) {
      const on = b.getAttribute("data-unit") === st.entry.unit;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const chips = $("ffQuick");
    st.chipList = quickChips();
    if (chips) chips.innerHTML = st.chipList.map(function (c, i) {
      const on = sameEntry(c.entry, st.entry);
      return '<button type="button" class="ff-chip' + (on ? " is-on" : "") + '" data-ff="quick" data-i="' + i + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(c.label) + '</button>';
    }).join("");
    const pv = $("ffPreview"), eq = $("ffEq"), pr = $("ffProblem"), next = $("ffNext");
    if (st.problem) {                       // an amount that was refused (a weight for a volume food, ...): say why, show no numbers
      if (pv) pv.innerHTML = "";
      if (eq) eq.textContent = "";
      if (pr) pr.textContent = st.problem;
      if (next) next.disabled = true;
      return;
    }
    const c = fa.compute(food, st.entry && st.entry.value > 0 ? st.entry : { value: 0, unit: st.entry.unit });
    if (!c.ok) {
      if (pv) pv.innerHTML = "";
      if (eq) eq.textContent = "";
      if (pr) pr.textContent = c.reason === "amount" && !String(st.amountText).trim() ? "" : c.message;
      if (next) next.disabled = true;
      return;
    }
    if (next) next.disabled = false;
    const other = c.equivalents.filter(function (x) { return x.unit !== st.entry.unit; }).map(function (x) { return show2(x.value) + " " + (x.unit === "serving" ? (x.value === 1 ? "serving" : "servings") : fa.UNITS[x.unit].label); });
    if (eq) eq.textContent = other.length ? "That is " + other.join(" · ") : "";
    if (pr) pr.textContent = c.unusual ? (c.factor < 1 ? "That is a very small part of one serving. Check the amount." : "That is a lot of servings. Check the amount.") : "";
    if (pv) pv.innerHTML = previewHtml(c.values);
  }

  function previewHtml(v) {
    const cell = function (name, val, unit) { return '<div class="ff-pv-cell"><span class="ff-pv-n">' + val + (unit || "") + '</span><span class="ff-pv-l">' + name + '</span></div>'; };
    return (
      '<div class="ff-pv-cal"><span class="ff-pv-big">' + Math.round(v.calories || 0) + '</span><span class="ff-pv-unit">calories</span></div>' +
      '<div class="ff-pv-row">' +
        cell("Protein", show1(v.protein || 0), " g") + cell("Carbs", show1(v.carbs || 0), " g") + cell("Fat", show1(v.fat || 0), " g") +
        (v.fiber !== undefined ? cell("Fiber", show1(v.fiber), " g") : "") +
      '</div>'
    );
  }

  function onAmountInput(e) {
    const t = e.target;
    if (t.id === "ffAmount") {
      st.amountText = t.value;
      st.problem = "";
      const r = entryFromText();
      if (r.entry) {
        const base = FA().baseOf(st.food);
        // a unit typed with the number ("200g") picks that unit, if the food allows it
        if (r.entry.unit !== st.entry.unit && !FA().unitAllowed(base, r.entry.unit)) {
          const c = FA().compute(st.food, r.entry);
          st.problem = c.ok ? "That unit can't be used for this food." : c.message;
          st.entry = { value: 0, unit: st.entry.unit };
        } else st.entry = r.entry;
      } else {
        st.entry = { value: 0, unit: st.entry.unit };
        st.problem = r.problem;
      }
      refreshAmount();
    }
  }

  function setUnit(unit) {
    const fa = FA(), base = fa.baseOf(st.food);
    if (!fa.unitAllowed(base, unit) || (unit === st.entry.unit && !st.problem)) return;
    st.problem = "";
    const moved = st.entry && st.entry.value > 0 ? fa.convertEntry(base, st.entry, unit) : null;
    st.entry = moved || { value: 0, unit: unit };
    st.amountText = moved ? show2(moved.value) : st.amountText;
    const input = $("ffAmount");
    if (input) input.value = st.amountText;
    refreshAmount();
  }

  function applyEntry(entry) {
    st.problem = "";
    st.entry = { value: entry.value, unit: entry.unit };
    st.amountText = show2(entry.value);
    const input = $("ffAmount");
    if (input) input.value = st.amountText;
    refreshAmount();
  }

  /* ---- portions (named amounts kept with a saved food or a recipe) ---- */

  function portionsHtml(key) {
    const fa = FA(), food = st.food, list = fa.cleanPortions(food.portions);
    const rows = list.length ? '<ul class="ff-portion-list">' + list.map(function (p) {
      const isDefault = food.defaultPortionId === p.id;
      return '<li class="ff-portion-row"><span class="ff-portion-name">' + esc(p.name) + '</span><span class="ff-portion-amt">' + esc(fa.describeEntry(p)) + '</span>' +
        '<button type="button" class="btn-icon ff-portion-default' + (isDefault ? " is-on" : "") + '" data-ff="portion-default" data-id="' + esc(p.id) + '" aria-pressed="' + (isDefault ? "true" : "false") + '">' + (isDefault ? "Offered first" : "Offer first") + '</button>' +
        '<button type="button" class="btn-icon danger ff-portion-remove" data-ff="portion-remove" data-id="' + esc(p.id) + '" aria-label="Remove portion ' + esc(p.name) + '">Remove</button></li>';
    }).join("") + '</ul>' : '<p class="field-hint">No portions yet. Save an amount you often have, like “my bowl”, and it is offered here next time.</p>';
    return (
      '<details class="collapsible-section ff-portions"' + (st.portionOpen ? " open" : "") + ' id="ffPortions"><summary>My portions' + (list.length ? " (" + list.length + ")" : "") + '</summary><div class="collapsible-body">' + rows +
        '<div class="ff-portion-add"><div class="form-row"><label for="ffPortionName">Save the amount above as a portion</label><input type="text" id="ffPortionName" maxlength="30" autocomplete="off" placeholder="e.g. My bowl"></div>' +
        '<div class="checklist-item"><input type="checkbox" id="ffPortionDefault"><label for="ffPortionDefault">Offer it first for this food</label></div>' +
        '<button type="button" class="btn btn-secondary" data-ff="portion-save">Save portion</button>' +
        '<p class="field-hint" id="ffPortionMsg" role="status">' + esc(st.portionMsg) + '</p></div>' +
      '</div></details>'
    );
  }

  function refreshPortions() {
    const key = sourceKey(st.food);
    const box = $("ffPortions");
    if (!key || !box) return;
    st.portionOpen = true;
    const tmp = document.createElement("div");
    tmp.innerHTML = portionsHtml(key);
    box.replaceWith(tmp.firstChild);
  }

  function savePortion() {
    const fa = FA(), key = sourceKey(st.food), nameEl = $("ffPortionName");
    if (!key || !nameEl) return;
    const c = fa.compute(st.food, st.entry);
    if (!c.ok) { st.portionMsg = c.message; refreshPortions(); return; }
    const add = fa.addPortion(st.food, { name: nameEl.value, value: st.entry.value, unit: st.entry.unit }, makeId);
    if (!add.ok) { st.portionMsg = add.error; refreshPortions(); return; }
    const wantDefault = !!($("ffPortionDefault") && $("ffPortionDefault").checked);
    const patch = { portions: add.portions };
    if (wantDefault) patch.defaultPortionId = add.id;
    const r = host().update(key.source, key.id, patch);
    if (!r.ok) { st.portionMsg = r.error || "That couldn't be saved."; refreshPortions(); return; }
    st.food.portions = add.portions;
    if (wantDefault) st.food.defaultPortionId = add.id;
    st.portionMsg = (add.replaced ? "Updated “" : "Saved “") + nameEl.value.trim() + "”.";
    refreshPortions();
    refreshAmount();
    const m = $("ffPortionName"); if (m) m.focus();
  }

  function portionChange(kind, id) {
    const fa = FA(), key = sourceKey(st.food);
    if (!key) return;
    let patch;
    if (kind === "remove") {
      const gone = fa.removePortion(st.food, id);
      patch = { portions: gone.portions, defaultPortionId: gone.defaultPortionId };
    } else patch = { defaultPortionId: st.food.defaultPortionId === id ? "" : id };
    const r = host().update(key.source, key.id, patch);
    if (!r.ok) { st.portionMsg = r.error || "That couldn't be saved."; refreshPortions(); return; }
    if (kind === "remove") { st.food.portions = patch.portions; if (!patch.defaultPortionId) delete st.food.defaultPortionId; else st.food.defaultPortionId = patch.defaultPortionId; }
    else if (patch.defaultPortionId) st.food.defaultPortionId = patch.defaultPortionId; else delete st.food.defaultPortionId;
    st.portionMsg = kind === "remove" ? "Portion removed." : (patch.defaultPortionId ? "That portion is offered first." : "No portion is offered first now.");
    refreshPortions();
    refreshAmount();
  }

  function onNext() {
    const c = FA().compute(st.food, st.entry);
    if (!c.ok) { refreshAmount(); return; }
    if (st.mode === "edit") { commitEdit(); return; }
    go("add");
  }

  function commitEdit() {
    const o = st.opts, r = host().replaceLogItem({ meal: o.meal, id: o.itemId, entry: st.entry });
    if (!r.ok) { const pr = $("ffProblem"); if (pr) pr.textContent = r.error; return; }
    window.JarvisCore.showToast(r.message);
    finish({ item: r.item });
  }

  /* ---- step 4: add ---- */

  function addHtml() {
    const food = st.food, fa = FA();
    const ing = st.mode === "ingredient";
    return (
      '<h3 class="ff-h" id="ffH" tabindex="-1">' + (ing ? "Add " : "Add ") + esc(food.name) + '</h3>' +
      '<div class="ff-summary" id="ffSummary" aria-live="polite"></div>' +
      (ing
        ? '<div class="form-row"><label for="ffIngName">Name in the recipe</label><input type="text" id="ffIngName" maxlength="80" autocomplete="off" value="' + esc(st.ingName) + '"><p class="field-hint">The amount is saved with the ingredient, so the recipe can show how much of it each portion needs.</p></div>'
        : '<div class="form-row" role="group" aria-labelledby="ffMealL"><span class="ff-label" id="ffMealL">Which meal?</span><div class="ff-meals">' + MEALS.map(function (m) {
          return '<button type="button" class="ff-chip ff-meal" data-ff="meal" data-meal="' + m + '" aria-pressed="false">' + esc(mealName(m)) + '</button>';
        }).join("") + '</div></div>') +
      '<p class="ff-problem" id="ffAddProblem" role="alert"></p>' +
      '<div class="ff-actions sheet-sticky-actions"><button type="button" class="btn btn-primary" id="ffAdd" data-ff="add">' + (ing ? "Add to recipe" : "Add to " + esc(mealName(st.meal))) + '</button></div>'
    );
  }

  function refreshAdd() {
    const fa = FA(), c = fa.compute(st.food, st.entry);
    const box = $("ffSummary");
    if (box) {
      box.innerHTML = c.ok
        ? '<p class="ff-sum-amt">' + esc(fa.describeEntry(st.entry)) + (st.entry.unit !== "serving" ? " &middot; " + show2(c.factor) + " " + (round(c.factor, 2) === 1 ? "serving" : "servings") : "") + '</p>' + previewHtml(c.values)
        : '<p class="ff-problem">' + esc(c.message) + '</p>';
    }
    Array.prototype.forEach.call(document.querySelectorAll("#ffBody .ff-meal"), function (b) {
      const on = b.getAttribute("data-meal") === st.meal;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const add = $("ffAdd");
    if (add) { add.disabled = !c.ok; if (st.mode !== "ingredient") add.textContent = "Add to " + mealName(st.meal); }
  }

  function onAdd() {
    const fa = FA(), c = fa.compute(st.food, st.entry);
    const prob = $("ffAddProblem");
    if (!c.ok) { if (prob) prob.textContent = c.message; return; }
    if (st.mode === "ingredient") {
      const name = ($("ffIngName") ? $("ffIngName").value : st.ingName).replace(/\s+/g, " ").trim();
      if (!name) { if (prob) prob.textContent = "Give the ingredient a name."; return; }
      const r3 = function (n) { return Math.round((n || 0) * 1000) / 1000; };
      // The quantity text is a weight or volume when the label has one ("82.5 g", "237 mL (8 fl oz)"), so groceries and portions can use it.
      let quantity = fa.describeEntry(st.entry);
      if (c.base) quantity = show2(c.factor * c.base.value) + " " + (c.base.unit === "g" ? "g" : "mL") + (st.entry.unit === "g" || st.entry.unit === "ml" ? "" : " (" + fa.describeEntry(st.entry) + ")");
      const ing = { name: name, quantity: quantity, calories: r3(c.exact.calories), protein: r3(c.exact.protein), carbs: r3(c.exact.carbs), fat: r3(c.exact.fat), fiber: r3(c.exact.fiber), label: baselineLabel(st.food), amount: fa.cleanEntry(st.entry) };
      if (st.food.savedId) ing.foodId = st.food.savedId;
      const key = sourceKey(st.food);
      if (key) host().recordUse(key.source, key.id, st.entry);
      finish({ ingredient: ing, food: st.food });
      return;
    }
    const r = host().addToLog({ meal: st.meal, food: st.food, entry: st.entry });
    if (!r.ok) { if (prob) prob.textContent = r.error; return; }
    window.JarvisCore.showToast(r.message);
    finish({ item: r.item, meal: st.meal });
  }

  /* ---------------- events ---------------- */

  function act(what, btn) {
    if (!st) return;
    if (what === "camera") { const i = $("ffCamera"); if (i) i.click(); }
    else if (what === "upload") { const i = $("ffUpload"); if (i) i.click(); }
    else if (what === "manual") { st.draft = emptyDraft(); go("review"); }
    else if (what === "pick") {
      const food = host().resolve("saved", btn.getAttribute("data-id"));
      if (!food) { window.JarvisCore.showToast("That food isn't there any more."); return; }
      setFood(food, null);
      go("amount");
    }
    else if (what === "confirm") {
      const k = btn.getAttribute("data-field"), d = st.draft;
      d.confirmed[k] = true; d.dirty = true;
      const w = $("ffWrap_" + k), f = $("ffFlag_" + k), inp = $("ff_" + k);
      if (w) w.classList.remove("is-flagged");
      if (f) f.hidden = true;
      if (inp) { inp.classList.remove("scan-check"); inp.focus(); }
    }
    else if (what === "continue") onContinue();
    else if (what === "unit") setUnit(btn.getAttribute("data-unit"));
    else if (what === "quick") { const c = (st.chipList || [])[Number(btn.getAttribute("data-i"))]; if (c) applyEntry(c.entry); }
    else if (what === "next") onNext();
    else if (what === "meal") { st.meal = btn.getAttribute("data-meal"); refreshAdd(); }
    else if (what === "add") onAdd();
    else if (what === "portion-save") savePortion();
    else if (what === "portion-remove") portionChange("remove", btn.getAttribute("data-id"));
    else if (what === "portion-default") portionChange("default", btn.getAttribute("data-id"));
  }

  function focusables() {
    const box = document.querySelector("#foodFlowModal .ff-box");
    if (!box) return [];
    return Array.prototype.filter.call(box.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'), function (el) {
      return !el.disabled && !el.hidden && el.offsetParent !== null && el.type !== "hidden" && !el.closest("[hidden]") && !el.closest(".hidden");
    });
  }

  function onKey(e) {
    if (!st) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); attemptClose(); return; }
    if (e.key === "Tab") {
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $("ffH"))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key === "Enter" && e.target && e.target.tagName === "INPUT" && e.target.type !== "checkbox") {
      if (e.target.id === "ffAmount") { e.preventDefault(); onNext(); }
      else if (e.target.id === "ffPortionName") { e.preventDefault(); savePortion(); }
      else if (e.target.id === "ffIngName") { e.preventDefault(); onAdd(); }
    }
  }

  function init() {
    const modal = $("foodFlowModal");
    if (!modal) return;
    $("ffClose").addEventListener("click", attemptClose);
    $("ffBack").addEventListener("click", goBack);
    // Keys are taken on the way down (before any sheet underneath, like the Meal Prep recipe form, can act on them) while this is open.
    window.addEventListener("keydown", function (e) { if (!st) return; e.stopPropagation(); onKey(e); }, true);
    const body = $("ffBody");
    body.addEventListener("click", function (e) {
      const b = e.target.closest("[data-ff]");
      if (!b || b.disabled) return;
      act(b.getAttribute("data-ff"), b);
    });
    body.addEventListener("input", function (e) {
      if (!st) return;
      if (e.target.id === "ffSavedSearch") { st.search = e.target.value; renderSavedResults(); }
      else if (st.step === "review") onReviewInput(e);
      else if (st.step === "amount") onAmountInput(e);
      else if (st.step === "add" && e.target.id === "ffIngName") st.ingName = e.target.value;
    });
    body.addEventListener("change", function (e) { if (st && st.step === "review" && (e.target.id === "ffSizeUnit" || e.target.id === "ffFruitVeg")) onReviewInput(e); });
    ["ffCamera", "ffUpload"].forEach(function (id) {
      $(id).addEventListener("change", function (e) {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (f) onFile(f);
      });
    });
  }

  /* ---------------- for recipe editors (Meal Prep and Nutrition) ---------------- */

  function macroLine(m) { return Math.round(m.calories || 0) + " cal · P " + show1(m.protein || 0) + " g · C " + show1(m.carbs || 0) + " g · F " + show1(m.fat || 0) + " g"; }

  // The whole recipe, one portion, and how much of each ingredient one portion needs. o { ingredients, servings, dishGrams }.
  // The totals are added up exact and rounded once; a portion is the exact total divided, not the rounded total divided.
  function recipeSummaryHtml(o) {
    const fa = FA(), ings = (o && o.ingredients) || [];
    const portions = Math.max(1, Math.round(Number(o && o.servings)) || 1);
    const ex = fa.recipeExact(ings);
    if (!ex.counted) return '<p class="field-hint">Add ingredients with numbers to see the totals for the recipe and for one portion.</p>';
    const whole = fa.roundMacros(ex.totals), per = fa.roundMacros(fa.perPortion(ex.totals, portions));
    const qty = fa.ingredientQuantities(ings, portions).filter(function (x) { return x.name; });
    const pw = fa.portionWeight(o && o.dishGrams, portions);
    let h = '<div class="ff-rs">' +
      '<div class="ff-rs-row"><span class="ff-rs-k">Whole recipe</span><span class="ff-rs-v">' + esc(macroLine(whole)) + '</span></div>' +
      '<div class="ff-rs-row"><span class="ff-rs-k">One portion (&divide; ' + portions + ')</span><span class="ff-rs-v">' + esc(macroLine(per)) + '</span></div>' +
      (pw ? '<div class="ff-rs-row"><span class="ff-rs-k">Finished dish</span><span class="ff-rs-v">' + esc(show2(Number(o.dishGrams))) + ' g, so a portion is ' + esc(show1(pw)) + ' g</span></div>' : '');
    if (ex.uncounted.length) h += '<p class="ff-flag">No numbers for ' + esc(ex.uncounted.join(", ")) + '. ' + (ex.uncounted.length === 1 ? "It is" : "They are") + ' left out of these totals.</p>';
    if (qty.length) {
      h += '<details class="ff-rs-more"><summary>How much of each ingredient one portion needs</summary><ul class="ff-rs-list">' + qty.map(function (x) {
        return '<li><span class="ff-rs-n">' + esc(x.name) + '</span><span class="ff-rs-a">' + esc(x.whole || "no amount") + ' in all</span><span class="ff-rs-a">' + (x.each ? esc(x.each) + ' each' : 'not divided') + '</span></li>';
      }).join("") + '</ul></details>';
    }
    return h + '</div>';
  }

  // What a linked ingredient says about itself, or "" when its numbers are typed.
  function linkNote(ing) {
    if (!ing || !ing.label || !ing.amount) return "";
    const fa = FA(), c = fa.compute({ label: ing.label }, ing.amount);
    if (!c.ok) return "";
    return "From the label: " + fa.describeEntry(ing.amount) + (ing.amount.unit === "serving" ? "" : ", " + show2(c.factor) + " " + (round(c.factor, 2) === 1 ? "serving" : "servings")) + ". The numbers follow the amount. Typing a number here instead makes it your own.";
  }

  // A new ingredient from a scanned label or a saved food. onDone(ingredient).
  function addIngredient(o) {
    open({ mode: "ingredient", start: "scan", onDone: function (r) { if (r && r.ingredient && o && typeof o.onDone === "function") o.onDone(r.ingredient); } });
  }
  // Change the amount of a linked ingredient (from its saved food's label when that food is still saved). onDone(ingredient).
  function changeIngredient(ing, o) {
    if (!ing || !ing.label || !ing.amount) return;
    let food = ing.foodId && host() ? host().resolve("saved", ing.foodId) : null;
    if (!food) food = { source: "ingredient", name: ing.name, serving: ing.label.serving, label: ing.label };
    open({ mode: "ingredient", start: "amount", food: food, entry: ing.amount, ingName: ing.name, onDone: function (r) { if (r && r.ingredient && o && typeof o.onDone === "function") o.onDone(r.ingredient); } });
  }

  window.JarvisFoodFlow = { open: open, close: function () { close(); }, recipeSummaryHtml: recipeSummaryHtml, linkNote: linkNote, addIngredient: addIngredient, changeIngredient: changeIngredient };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
