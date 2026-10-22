/* ==========================================================================
   JARVIS — cloud backup: talks to Firestore (the rules themselves are in
   js/backup-logic.js, which is where the decisions and merging live).

   Where things go: users/{uid}/appData, one manifest document per key plus
   one document per chunk of its text. Every write is a Firestore transaction
   that first checks the cloud copy is still the one this device based its
   change on, so a second device's newer data is never silently overwritten,
   and a manifest is never visible without all of its chunks.

   When it runs:
     - at sign-in (reconcile): every key is compared with the cloud copy
       and pushed, pulled or merged (JarvisBackupLogic.decide).
     - after that, each save of one of these keys is uploaded a couple of
       seconds later (several quick saves become one upload).
     - on "Back up now", and when the phone comes back online.

   What it will NOT do, on purpose:
     - change this device's data after the app has started. The feature
       modules read their data once when the app opens, so a late write here
       would only be overwritten by their older in-memory copy, which then
       gets uploaded over the newer cloud copy. If the cloud has something
       newer than this session, that key waits ("reload") and is combined
       the next time JARVIS opens.
     - touch anything while a different account's backup is recorded on
       this device (mismatch) until the user says to.
     - pretend. The status says "Backed up" only after Firestore confirmed
       it, and shows the time of that confirmation.

   Needs firestore.rules to allow users/{uid}/appData (see that file).
   Until they are deployed every write is refused (permission-denied), the
   status says so, and the data simply stays on the device as before.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./backup-logic.js"));
  else root.JarvisBackup = factory(root.JarvisBackupLogic);
})(typeof self !== "undefined" ? self : this, function (logic) {
  "use strict";

  const META_KEY = "jarvisBackupMeta";       // what this device last confirmed with the cloud, per key
  const SAFETY_KEY = "jarvisBackupSafety";   // the previous local copy of a key, kept when a merge replaces it
  const DEVICE_KEY = "jarvisBackupDevice";   // a random id for this browser, written into manifests
  const COLLECTION = "appData";
  const SAVE_DELAY_MS = 2000;
  const RETRY_MS = [5000, 15000, 45000, 120000, 300000];
  const SAFETY_MAX_CHARS = 1500000;
  const MAX_ATTEMPTS = 3;                    // read-decide-write rounds per key when another device keeps winning
  const LIST_TIMEOUT_MS = 20000;             // no single cloud call may hold backup (or its button) up longer than this
  const TRANSACTION_TIMEOUT_MS = 30000;

  /* ---------------- what the user is told ---------------- */

  function describe(s) {
    const when = s.lastOkAt ? new Date(s.lastOkAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const waiting = s.waiting === 1 ? "1 change is" : s.waiting + " changes are";
    switch (s.state) {
      case "ok": return { tone: "ok", text: "Backed up." + (when ? " Last confirmed " + when + "." : ""), button: "Back up now" };
      case "checking": return { tone: "wait", text: "Checking your backup…", button: "Back up now", busy: true };
      case "pending": return { tone: "wait", text: (s.waiting ? waiting : "Changes are") + " waiting to back up…", button: "Back up now" };
      case "offline": return { tone: "warn", text: "Can't reach your backup right now. Your data is saved on this phone and will back up when the connection is back.", button: "Try again" };
      case "rules": return { tone: "warn", text: "Backup isn't switched on for your account yet. Your data is safe on this phone. The steps to switch it on are below.", button: "Try again" };
      case "mismatch": return { tone: "warn", text: "This phone's data was last backed up to a different account, so backup is paused here to avoid mixing the two.", button: "Use this account" };
      case "reload": return { tone: "warn", text: "Your account has newer data than this session. Reload JARVIS to combine it with what's on this phone.", button: "Reload JARVIS" };
      case "error": return { tone: "warn", text: "Backup hit a problem" + (s.detail ? " (" + s.detail + ")" : "") + ". Your data is safe on this phone. It will try again.", button: "Try again" };
      default: return { tone: "off", text: "Sign in to back up your food log, tasks, goals and Discipline to your account.", button: "" };
    }
  }

  function classify(e) {
    const code = String((e && e.code) || "").replace(/^firestore\//, "");
    if (code === "permission-denied") return "rules";
    if (code === "unavailable" || code === "deadline-exceeded" || code === "cancelled") return "offline";
    if (e && e.offline) return "offline";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    return "error";
  }
  function detailOf(e) {
    const code = String((e && e.code) || "").replace(/^firestore\//, "");
    return code || (e && e.message ? String(e.message).slice(0, 60) : "");
  }

  /* ---------------- one signed-in session ---------------- */

  function create(opts) {
    const fb = opts.fb, db = opts.db, uid = opts.uid, storage = opts.storage;
    const now = opts.now || function () { return Date.now(); };
    const setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    const clearTimer = opts.clearTimer || function (t) { clearTimeout(t); };
    const keys = opts.keys || logic.BACKUP_KEYS;

    const dirty = {};     // keys saved on this device and not yet confirmed in the cloud
    const blocked = {};   // keys that need a reload before they can be combined with the cloud
    const listeners = [];
    let state = "checking", detail = "";
    let appStarted = false, reconciled = false, stopped = false;
    let saveTimer = null, retryTimer = null, retryStep = 0;
    let chain = Promise.resolve();

    const deviceId = (function () {
      try {
        let d = storage.getItem(DEVICE_KEY);
        if (!d) { d = "d_" + Math.random().toString(36).slice(2, 10); storage.setItem(DEVICE_KEY, d); }
        return d;
      } catch (e) { return "d_unknown"; }
    })();

    let meta = (function () {
      try {
        const m = JSON.parse(storage.getItem(META_KEY) || "null");
        if (m && typeof m === "object" && m.keys && typeof m.keys === "object") return m;
      } catch (e) { /* start fresh */ }
      return { uid: null, keys: {}, lastOkAt: null };
    })();
    function saveMeta() { try { storage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* the cloud copy is still the truth */ } }
    function metaOf(key) { return meta.keys[key] || null; }
    function setMeta(key, entry) { meta.keys[key] = entry; saveMeta(); }
    function addPending(key, hash) {
      const m = metaOf(key) || { rev: null, hash: null, pending: [] };
      const list = (m.pending || []).filter(function (h) { return h !== hash; }).concat(hash).slice(-4);
      setMeta(key, { rev: m.rev, hash: m.hash, pending: list });
      return list;
    }

    function status() {
      return { state: state, detail: detail, lastOkAt: meta.lastOkAt || null, waiting: Object.keys(dirty).length, reload: Object.keys(blocked) };
    }
    function setState(next, why) {
      state = next; detail = why || "";
      listeners.slice().forEach(function (fn) { try { fn(status()); } catch (e) { /* a broken listener shouldn't stop backup */ } });
    }
    function subscribe(fn) { listeners.push(fn); try { fn(status()); } catch (e) { /* ignore */ } }

    // One network job at a time, in the order asked for.
    function exclusive(job) {
      const run = chain.then(job, job);
      chain = run.then(function () {}, function () {});
      return run;
    }

    /* ---- Firestore access ---- */

    function ref(id) { return fb.doc(db, "users", uid, COLLECTION, id); }

    // Treats a call that never answers as a failure that can be retried. A write that does land after we
    // gave up is recognised later as this device's own (see pushText).
    function bounded(promise, ms) {
      return new Promise(function (resolve, reject) {
        const timer = setTimer(function () { reject(Object.assign(new Error("timed out"), { code: "deadline-exceeded" })); }, ms);
        promise.then(function (v) { clearTimer(timer); resolve(v); }, function (e) { clearTimer(timer); reject(e); });
      });
    }
    function transaction(fn) { return bounded(fb.runTransaction(db, fn), TRANSACTION_TIMEOUT_MS); }

    function listAll() {
      const col = fb.collection(db, "users", uid, COLLECTION);
      const get = fb.getDocsFromServer || fb.getDocs;
      return bounded(get(col), LIST_TIMEOUT_MS).then(function (snap) {
        if (snap.metadata && snap.metadata.fromCache) { const e = new Error("offline"); e.offline = true; throw e; }
        const docs = {};
        snap.docs.forEach(function (d) { docs[d.id] = d.data(); });
        return docs;
      });
    }

    // A manifest plus its chunks -> { present, ok, rev, hash, text }
    function cloudFrom(manifest, partTexts) {
      if (!manifest) return { present: false, ok: false };
      const out = { present: true, rev: manifest.updatedAt, hash: manifest.hash, ok: false };
      const r = logic.assemble(manifest, partTexts);
      if (r.ok) { out.ok = true; out.text = r.text; } else out.reason = r.reason;
      return out;
    }
    function cloudFromDocs(key, docs) {
      const m = docs[key];
      if (!m) return cloudFrom(null);
      const parts = {};
      for (let i = 0; Number.isInteger(m.parts) && i < m.parts && i < 64; i++) { const p = docs[logic.partId(key, i)]; parts[i] = p ? p.text : undefined; }
      return cloudFrom(m, parts);
    }
    // The same, read inside a transaction so it can't be a half-finished write from another device.
    function readKeyConsistent(key) {
      return transaction(function (tx) {
        return tx.get(ref(key)).then(function (ms) {
          if (!ms.exists()) return cloudFrom(null);
          const m = ms.data();
          const n = Number.isInteger(m.parts) && m.parts >= 1 && m.parts <= 64 ? m.parts : 0;
          const reads = [];
          for (let i = 0; i < n; i++) reads.push(tx.get(ref(logic.partId(key, i))));
          return Promise.all(reads).then(function (snaps) {
            const parts = {};
            snaps.forEach(function (s, i) { parts[i] = s.exists() ? s.data().text : undefined; });
            return cloudFrom(m, parts);
          });
        });
      });
    }

    // Writes `text` as the new cloud copy, but only if the cloud still holds what we based it on
    // (`basisRev`, or one of this device's own earlier uploads whose confirmation was lost).
    // -> { ok: true, rev } | { conflict: true }
    function pushText(key, text, basisRev, ownHashes) {
      return transaction(function (tx) {
        const mref = ref(key);
        return tx.get(mref).then(function (ms) {
          const cur = ms.exists() ? ms.data() : null;
          const curRev = cur ? cur.updatedAt : null;
          const isOwn = !!(cur && ownHashes.indexOf(cur.hash) !== -1);
          if (curRev !== basisRev && !isOwn) return { conflict: true };
          const pieces = logic.chunkText(text);
          const rev = Math.max(now(), (curRev || 0) + 1);
          pieces.forEach(function (p, i) { tx.set(ref(logic.partId(key, i)), { text: p, rev: rev }); });
          if (cur && Number.isInteger(cur.parts)) {
            for (let i = pieces.length; i < cur.parts && i < 64; i++) tx.delete(ref(logic.partId(key, i)));
          }
          tx.set(mref, { parts: pieces.length, chars: text.length, hash: logic.hashText(text), updatedAt: rev, device: deviceId });
          return { ok: true, rev: rev };
        });
      });
    }

    function keepPreviousCopy(key, text) {
      if (text === null || text === undefined || logic.isEmptyText(text)) return;
      try {
        const cur = JSON.parse(storage.getItem(SAFETY_KEY) || "null") || { at: 0, keys: {} };
        cur.keys[key] = text;
        cur.at = now();
        const s = JSON.stringify(cur);
        if (s.length <= SAFETY_MAX_CHARS) storage.setItem(SAFETY_KEY, s);
      } catch (e) { /* best effort: the merge keeps everything from both sides anyway */ }
    }
    function writeLocal(key, text) {
      storage.setItem(key, text); // may throw (storage full); the caller reports it as an error for this key
    }

    /* ---- sign-in: bring one key into line ---- */

    function reconcileKey(key, docs) {
      function round(attempt) {
        const localText = storage.getItem(key);
        const first = attempt === 0 ? Promise.resolve(cloudFromDocs(key, docs)) : readKeyConsistent(key);
        return first.then(function (cloud0) {
          // A copy that doesn't add up may only be another device mid-write: look again, consistently.
          return cloud0.present && !cloud0.ok && attempt === 0 ? readKeyConsistent(key) : cloud0;
        }).then(function (cloud) {
          const m = metaOf(key);
          const usable = cloud.present && cloud.ok;
          const basisRev = cloud.present ? cloud.rev : null;
          const own = m && m.pending ? m.pending : [];
          const action = logic.decide({
            cloud: usable ? { rev: cloud.rev, hash: cloud.hash } : null,
            localText: localText,
            meta: m ? { rev: m.rev, hash: m.hash, pendingHash: usable && own.indexOf(cloud.hash) !== -1 ? cloud.hash : null } : null
          });

          if (action === "none") return "none";
          if (action === "same") { setMeta(key, { rev: cloud.rev, hash: cloud.hash, pending: [] }); return "same"; }

          if (action === "pull") {
            if (appStarted) { blocked[key] = true; return "reload"; }
            writeLocal(key, cloud.text);   // nothing to keep: this device is empty, or unchanged since the cloud copy it is replacing
            setMeta(key, { rev: cloud.rev, hash: cloud.hash, pending: [] });
            return "pulled";
          }

          if (action === "push") {
            const h = logic.hashText(localText);
            return pushText(key, localText, basisRev, addPending(key, h)).then(function (res) {
              if (res.conflict) return attempt + 1 < MAX_ATTEMPTS ? round(attempt + 1) : Promise.reject(Object.assign(new Error("changing too fast"), { code: "aborted" }));
              setMeta(key, { rev: res.rev, hash: h, pending: [] });
              return "pushed";
            });
          }

          // merge: keep everything from both copies
          const merged = logic.mergeText(key, localText, cloud.text);
          if (!merged.ok) return Promise.reject(Object.assign(new Error("can't read either copy"), { code: "unreadable" }));
          const mh = logic.hashText(merged.text);
          const upload = mh === cloud.hash
            ? Promise.resolve({ ok: true, rev: cloud.rev })
            : pushText(key, merged.text, basisRev, addPending(key, mh));
          return upload.then(function (res) {
            if (res.conflict) return attempt + 1 < MAX_ATTEMPTS ? round(attempt + 1) : Promise.reject(Object.assign(new Error("changing too fast"), { code: "aborted" }));
            if (appStarted) {
              // The cloud now holds the combined copy; this session can't safely take it, the next start will.
              setMeta(key, { rev: res.rev, hash: logic.hashText(localText), pending: [] });
              blocked[key] = true;
              return "reload";
            }
            keepPreviousCopy(key, localText);
            writeLocal(key, merged.text);
            setMeta(key, { rev: res.rev, hash: mh, pending: [] });
            return "merged";
          });
        });
      }
      return round(0);
    }

    function reconcile() {
      return exclusive(function () {
        if (stopped) return null;
        clearRetry();
        setState("checking");
        if (meta.uid && meta.uid !== uid) { setState("mismatch"); return null; }
        return listAll().then(function (docs) {
          let firstError = null;
          let chainKeys = Promise.resolve();
          keys.forEach(function (key) {
            chainKeys = chainKeys.then(function () {
              return reconcileKey(key, docs).catch(function (e) { firstError = firstError || e; });
            });
          });
          return chainKeys.then(function () {
            if (!meta.uid) { meta.uid = uid; saveMeta(); }
            if (firstError) return failed(firstError);
            reconciled = true;
            meta.lastOkAt = now(); saveMeta();
            finishRound();
            return null;
          });
        }).catch(failed);
      });
    }

    /* ---- after sign-in: upload saves ---- */

    function pushKey(key) {
      const text = storage.getItem(key);
      if (text === null || text === undefined) return Promise.resolve();
      const h = logic.hashText(text);
      const m = metaOf(key);
      if (m && m.hash === h) return Promise.resolve();   // already what the cloud has
      const own = addPending(key, h);
      return pushText(key, text, m ? m.rev : null, own).then(function (res) {
        if (res.conflict) { blocked[key] = true; return; }
        setMeta(key, { rev: res.rev, hash: h, pending: [] });
      });
    }

    function flushNow() {
      return exclusive(function () {
        if (stopped || !reconciled || state === "mismatch" || state === "rules") return null;
        clearTimerSafe();
        const todo = Object.keys(dirty);
        let firstError = null;
        let seq = Promise.resolve();
        todo.forEach(function (key) {
          seq = seq.then(function () {
            if (blocked[key]) { delete dirty[key]; return null; }
            delete dirty[key];
            return pushKey(key).catch(function (e) { dirty[key] = true; firstError = firstError || e; });
          });
        });
        return seq.then(function () {
          if (firstError) return failed(firstError);
          meta.lastOkAt = now(); saveMeta();
          finishRound();
          return null;
        });
      });
    }

    function finishRound() {
      retryStep = 0;
      Object.keys(dirty).forEach(function (key) {   // a save that a reconcile already uploaded isn't waiting for anything
        const text = storage.getItem(key), m = metaOf(key);
        if (text === null || (m && m.hash === logic.hashText(text))) delete dirty[key];
      });
      if (Object.keys(blocked).length) setState("reload");
      else if (Object.keys(dirty).length) { setState("pending"); armSave(); }
      else setState("ok");
    }

    function failed(e) {
      const kind = classify(e);
      setState(kind, detailOf(e));
      if (kind !== "rules") armRetry();
      return null;
    }

    /* ---- timers ---- */

    function clearTimerSafe() { if (saveTimer !== null) { clearTimer(saveTimer); saveTimer = null; } }
    function clearRetry() { if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; } }
    function armSave() {
      if (stopped || saveTimer !== null || !reconciled || state === "mismatch" || state === "rules") return;
      saveTimer = setTimer(function () { saveTimer = null; flushNow(); }, SAVE_DELAY_MS);
    }
    function armRetry() {
      if (stopped || retryTimer !== null) return;
      const wait = RETRY_MS[Math.min(retryStep, RETRY_MS.length - 1)];
      retryStep++;
      retryTimer = setTimer(function () { retryTimer = null; if (reconciled) flushNow(); else reconcile(); }, wait);
    }

    /* ---- what the page calls ---- */

    function onSave(key) {
      if (stopped || keys.indexOf(key) === -1) return;
      dirty[key] = true;
      if (blocked[key]) return;
      if (state === "ok") setState("pending");
      else if (state === "pending") setState("pending");
      armSave();
    }

    return {
      reconcile: reconcile,
      onSave: onSave,
      flush: flushNow,
      // "Back up now": check every key against the cloud again, then say what happened.
      retryNow: function () { clearRetry(); retryStep = 0; return reconcile(); },
      // Backup was paused because another account's backup is recorded on this device; the user chose to use this one.
      acceptAccount: function () { meta = { uid: uid, keys: {}, lastOkAt: null }; saveMeta(); return reconcile(); },
      markAppStarted: function () { appStarted = true; },
      status: status,
      subscribe: subscribe,
      stop: function () { stopped = true; clearTimerSafe(); clearRetry(); listeners.length = 0; },
      // exposed for tests
      _meta: function () { return meta; }
    };
  }

  /* ---------------- the page: one session, plus the account-menu panel ---------------- */

  let current = null;
  let wired = false;

  function paint(s) {
    if (typeof document === "undefined") return;
    const box = document.getElementById("backupStatus");
    const btn = document.getElementById("backupNowBtn");
    const d = describe(s);
    if (box) { box.textContent = d.text; box.setAttribute("data-tone", d.tone); box.setAttribute("data-state", s.state); }
    if (btn) {
      btn.textContent = d.button || "";
      btn.classList.toggle("hidden", !d.button);
      btn.disabled = !!d.busy;
    }
    const gear = document.getElementById("profileMenuBtn");
    if (gear) gear.classList.toggle("has-backup-issue", d.tone === "warn");
    const help = document.getElementById("backupHelp");
    if (help) help.classList.toggle("hidden", s.state !== "rules");
  }

  function wirePage() {
    if (wired || typeof document === "undefined") return;
    wired = true;
    const btn = document.getElementById("backupNowBtn");
    if (btn) {
      btn.addEventListener("click", function () {
        if (!current) return;
        const st = current.status().state;
        if (st === "reload") { window.location.reload(); return; }
        if (st === "mismatch") {
          if (window.confirm("Back up this phone's data to the account you're signed in to now? It will be combined with what that account already has.")) current.acceptAccount();
          return;
        }
        current.retryNow();
      });
    }
    window.addEventListener("online", function () { if (current && ["offline", "error"].indexOf(current.status().state) !== -1) current.retryNow(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && current) current.flush();
    });
  }

  function attach(opts) {
    if (current) current.stop();
    current = create(Object.assign({ storage: window.localStorage }, opts));
    current.subscribe(paint);
    wirePage();
    return current;
  }

  if (typeof document !== "undefined") {
    const initial = function () { paint({ state: "off", waiting: 0, lastOkAt: null }); wirePage(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initial); else initial();
  }

  return {
    create: create, attach: attach, describe: describe, classify: classify,
    onSave: function (key) { if (current) current.onSave(key); },
    appStarted: function () { if (current) current.markAppStarted(); },
    current: function () { return current; },
    META_KEY: META_KEY, SAFETY_KEY: SAFETY_KEY, DEVICE_KEY: DEVICE_KEY
  };
});
