/* ==========================================================================
   JARVIS — cloud backup: the rules (pure functions, no page or network access,
   so they can be tested outside the browser).

   Why this exists: the original sync keeps every synced key in ONE cloud
   document, which Firestore caps at 1 MiB, and several kinds of data (food
   log, tasks, goals, groceries, Discipline, form-check history) were never
   added to it. Adding a growing food log to that document would eventually
   make every sync fail. So these keys get their own private documents
   (users/{uid}/appData), cut into chunks well under the cap.

   What is stored for a key `K`:
     appData/K        manifest { parts, chars, hash, updatedAt, device }
     appData/K~0..n   the text of the value (exactly what localStorage holds), in chunks

   The decision at sign-in, per key (decide()):
     nothing in the cloud            -> push this device's data (or nothing, if there is none)
     this device has no data         -> pull (a new phone, or cleared storage)
     same content                    -> nothing to do
     this device unchanged since its last sync, cloud changed   -> pull
     cloud unchanged since this device last saw it, device changed -> push
     both changed (or two devices meeting for the first time)   -> merge, never replace

   A merge keeps everything from both sides. Records are matched by id (the
   newer one wins when both changed), days by date, and nothing is dropped.
   Its one cost: an item deleted on one device can come back if the other
   device still had it when the two met.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisBackupLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Device data with no cloud copy before now. Not here on purpose: keys already synced by the original
  // sync, secrets (provider keys), and device-only state (briefing date, reminders cache, push check).
  const BACKUP_KEYS = [
    "jarvisNutritionLog", "jarvisNutritionSavedFoods", "jarvisNutritionRecipes", "jarvisNutritionGoals",
    "jarvisNutritionProfile", "jarvisNutritionCheckins",
    "jarvisTasks", "jarvisGoals",
    "jarvisDiscipline",
    "jarvisGroceryList", "jarvisGroceryMealPlan", "jarvisGroceryPantry", "jarvisGroceryPrefs",
    "jarvisFormCheckHistory"
  ];
  const CHUNK_CHARS = 250000; // even at 3 bytes a character this stays under Firestore's 1 MiB document limit

  /* ---------------- fingerprints and chunks ---------------- */

  // A quick fingerprint to tell "same content" from "changed" (cyrb53). Not for security.
  function hashText(text) {
    const s = String(text);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + "-" + s.length;
  }

  function chunkText(text, size) {
    const n = size || CHUNK_CHARS;
    const s = String(text);
    const out = [];
    for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
    return out.length ? out : [""];
  }
  function partId(key, i) { return key + "~" + i; }

  // Puts a stored value back together and checks it. -> { ok: true, text } or { ok: false, reason }
  function assemble(manifest, partsByIndex) {
    if (!manifest || !Number.isInteger(manifest.parts) || manifest.parts < 1) return { ok: false, reason: "no manifest" };
    let text = "";
    for (let i = 0; i < manifest.parts; i++) {
      const p = partsByIndex[i];
      if (typeof p !== "string") return { ok: false, reason: "missing part " + i };
      text += p;
    }
    if (text.length !== manifest.chars) return { ok: false, reason: "wrong length" };
    if (hashText(text) !== manifest.hash) return { ok: false, reason: "wrong fingerprint" };
    return { ok: true, text: text };
  }

  // Text that holds no data: nothing, or an empty list/object.
  function isEmptyText(text) {
    if (text === null || text === undefined) return true;
    const t = String(text).trim();
    if (t === "" || t === "null" || t === "[]" || t === "{}") return true;
    try {
      const v = JSON.parse(t);
      return v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
    } catch (e) { return false; }
  }

  /* ---------------- the sign-in decision ---------------- */

  //   cloud: { rev, hash } | null        what the cloud holds (rev = its updatedAt)
  //   localText: string | null           what this device holds
  //   meta: { rev, hash, pendingHash } | null   what this device recorded at its last successful sync
  // -> "none" | "same" | "push" | "pull" | "merge"
  function decide(input) {
    const cloud = input.cloud, localText = input.localText, meta = input.meta;
    const hasLocal = localText !== null && localText !== undefined && localText !== "";
    if (!cloud) return hasLocal && !isEmptyText(localText) ? "push" : "none";
    if (!hasLocal) return "pull";
    const lh = hashText(localText);
    if (lh === cloud.hash) return "same";
    if (!meta && isEmptyText(localText)) return "pull";            // a fresh or cleared device
    if (meta && meta.hash === lh) return "pull";                   // this device hasn't changed; the cloud has
    if (meta && (meta.rev === cloud.rev || (meta.pendingHash && meta.pendingHash === cloud.hash))) return "push"; // the cloud hasn't changed (or is this device's own earlier write)
    return "merge";
  }

  /* ---------------- merging two copies, losing nothing ---------------- */

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function stampOf(x) {
    return isObj(x) ? Math.max(num(x.updatedAt), num(x.savedAt), num(x.addedAt), num(x.createdAt), num(x.lastCalculatedAt)) : 0;
  }
  function canon(v) { return JSON.stringify(v); }

  // Lists of records: matched by id (else by identical content). Both versions of one record: the newer wins,
  // and this device's wins a tie. This device's order is kept, then anything only the cloud had.
  function mergeById(local, cloud) {
    if (!Array.isArray(local)) return Array.isArray(cloud) ? cloud : local;
    if (!Array.isArray(cloud)) return local;
    const keyOf = function (x) { return isObj(x) && typeof x.id === "string" && x.id ? "id:" + x.id : "json:" + canon(x); };
    const out = [], at = {};
    local.forEach(function (x) { const k = keyOf(x); if (!(k in at)) { at[k] = out.length; out.push(x); } });
    cloud.forEach(function (x) {
      const k = keyOf(x);
      if (!(k in at)) { at[k] = out.length; out.push(x); }
      else if (stampOf(x) > stampOf(out[at[k]])) out[at[k]] = x;
    });
    return out;
  }

  // The food log: { "YYYY-MM-DD": { water, meals: { breakfast: [items], ... } } }.
  function mergeDateMeals(local, cloud) {
    if (!isObj(local)) return isObj(cloud) ? cloud : local;
    if (!isObj(cloud)) return local;
    const out = {};
    Object.keys(local).concat(Object.keys(cloud)).forEach(function (d) {
      if (d in out) return;
      const a = local[d], b = cloud[d];
      if (!isObj(a)) { out[d] = isObj(b) ? b : a; return; }
      if (!isObj(b)) { out[d] = a; return; }
      const day = Object.assign({}, b, a);
      day.water = Math.max(num(a.water), num(b.water));
      const meals = {};
      const am = isObj(a.meals) ? a.meals : {}, bm = isObj(b.meals) ? b.meals : {};
      Object.keys(am).concat(Object.keys(bm)).forEach(function (m) { if (!(m in meals)) meals[m] = mergeById(am[m] || [], bm[m] || []); });
      day.meals = meals;
      out[d] = day;
    });
    return out;
  }

  // Maps of records that carry an updatedAt (the pantry).
  function mergeMapNewest(local, cloud) {
    if (!isObj(local)) return isObj(cloud) ? cloud : local;
    if (!isObj(cloud)) return local;
    const out = Object.assign({}, cloud);
    Object.keys(local).forEach(function (k) { out[k] = k in cloud && stampOf(cloud[k]) > stampOf(local[k]) ? cloud[k] : local[k]; });
    return out;
  }

  // One settings-like record: the more recently calculated one wins, this device's on a tie.
  function mergeNewest(local, cloud) {
    if (!isObj(local)) return isObj(cloud) ? cloud : local;
    if (!isObj(cloud)) return local;
    return stampOf(cloud) > stampOf(local) ? cloud : local;
  }

  // Settings objects: every setting from both; this device's value where both have one.
  function mergeObjects(local, cloud) {
    if (!isObj(local)) return isObj(cloud) ? cloud : local;
    if (!isObj(cloud)) return local;
    const out = Object.assign({}, cloud);
    Object.keys(local).forEach(function (k) { out[k] = isObj(local[k]) && isObj(cloud[k]) ? mergeObjects(local[k], cloud[k]) : local[k]; });
    return out;
  }

  // The 30-day program. Two copies that started on different days are two different runs (day 3 of one is not day 3 of
  // the other), so the later start wins whole: that is what a restart looks like, and mixing the ticks would show
  // missions as done that were never done in the new run. The same start: ticks and reflections from both, this
  // device's wording where both wrote one.
  function mergeProgram(lp, cp) {
    const start = lp.start && cp.start ? (lp.start >= cp.start ? lp.start : cp.start) : (lp.start || cp.start || null);
    const takeL = !cp.start || (lp.start && lp.start >= cp.start), takeC = !lp.start || (cp.start && cp.start >= lp.start);
    const L = takeL ? lp : {}, C = takeC ? cp : {};
    const done = {};
    Object.keys(Object.assign({}, C.done, L.done)).forEach(function (d) {
      done[d] = Array.from(new Set([].concat((L.done && L.done[d]) || [], (C.done && C.done[d]) || []))).sort();
    });
    return { start: start, done: done, reflections: Object.assign({}, C.reflections, L.reflections) };
  }

  // The Discipline tracker's store: rules by text, the avoiding log by time, each day as a whole (the one touched
  // last), the 30-day program (see mergeProgram), and this device's settings and running timer.
  function mergeDiscipline(local, cloud) {
    if (!isObj(local)) return isObj(cloud) ? cloud : local;
    if (!isObj(cloud)) return local;
    const out = Object.assign({}, cloud, local);
    // A rule is one rule by its id (so a rule reworded or switched off on one device is not doubled by the other copy)
    // and by its words, ignoring case and punctuation. This device's copy is read first, so its version wins.
    const rules = [], seen = {}, seenId = {};
    const wordsKey = function (t) { return t.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff' ]+/g, " ").replace(/\s+/g, " ").trim(); };
    (Array.isArray(local.rules) ? local.rules : []).concat(Array.isArray(cloud.rules) ? cloud.rules : []).forEach(function (r) {
      const k = isObj(r) && typeof r.text === "string" ? wordsKey(r.text) : null;
      const id = isObj(r) && typeof r.id === "string" && r.id ? r.id : null;
      if (k !== null && !seen[k] && !(id && seenId[id]) && rules.length < 5) { seen[k] = true; if (id) seenId[id] = true; rules.push(r); }
    });
    out.rules = rules;
    const avoid = [], at = {};
    (Array.isArray(local.avoid) ? local.avoid : []).concat(Array.isArray(cloud.avoid) ? cloud.avoid : []).forEach(function (a) {
      const k = isObj(a) ? String(a.at) : null;
      if (k !== null && !at[k]) { at[k] = true; avoid.push(a); }
    });
    out.avoid = avoid.sort(function (x, y) { return num(x.at) - num(y.at); }).slice(-300);
    out.timer = local.timer || null;
    out.program = mergeProgram(isObj(local.program) ? local.program : {}, isObj(cloud.program) ? cloud.program : {});
    const touched = function (day) {
      return isObj(day) ? Math.max(num(day.review && day.review.savedAt), num(day.morning && day.morning.savedAt), num(day.morning && day.morning.editedAt)) : 0;
    };
    const days = {}, ld = isObj(local.days) ? local.days : {}, cd = isObj(cloud.days) ? cloud.days : {};
    Object.keys(ld).concat(Object.keys(cd)).forEach(function (d) {
      if (d in days) return;
      days[d] = !(d in cd) ? ld[d] : !(d in ld) ? cd[d] : touched(cd[d]) > touched(ld[d]) ? cd[d] : ld[d];
    });
    out.days = days;
    return out;
  }

  const STRATEGY = {
    jarvisNutritionLog: mergeDateMeals,
    jarvisNutritionSavedFoods: mergeById, jarvisNutritionRecipes: mergeById, jarvisNutritionCheckins: mergeById,
    jarvisTasks: mergeById, jarvisGoals: mergeById, jarvisGroceryList: mergeById, jarvisGroceryMealPlan: mergeById, jarvisFormCheckHistory: mergeById,
    jarvisGroceryPantry: mergeMapNewest,
    jarvisNutritionProfile: mergeNewest,
    jarvisNutritionGoals: mergeObjects, jarvisGroceryPrefs: mergeObjects,
    jarvisDiscipline: mergeDiscipline
  };

  // Two stored copies of one key -> { ok, text }. If one can't be read, the other is used; if neither can, ok is false.
  function mergeText(key, localText, cloudText) {
    let a, b, aOk = true, bOk = true;
    try { a = JSON.parse(localText); } catch (e) { aOk = false; }
    try { b = JSON.parse(cloudText); } catch (e) { bOk = false; }
    if (!aOk && !bOk) return { ok: false };
    if (!aOk) return { ok: true, text: cloudText };
    if (!bOk) return { ok: true, text: localText };
    const fn = STRATEGY[key] || mergeObjects;
    return { ok: true, text: JSON.stringify(fn(a, b)) };
  }

  return {
    BACKUP_KEYS: BACKUP_KEYS, CHUNK_CHARS: CHUNK_CHARS,
    hashText: hashText, chunkText: chunkText, partId: partId, assemble: assemble, isEmptyText: isEmptyText,
    decide: decide, mergeText: mergeText,
    mergeById: mergeById, mergeDateMeals: mergeDateMeals, mergeMapNewest: mergeMapNewest, mergeNewest: mergeNewest, mergeObjects: mergeObjects, mergeDiscipline: mergeDiscipline
  };
});
