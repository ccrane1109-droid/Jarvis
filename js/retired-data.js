/* ==========================================================================
   JARVIS — retired sections: what Business, Marketing (with the Video Lab), Trading and AI Video left behind, and
   erasing it (pure rules; the page and the cloud are passed in, so every branch can be tested outside the browser).

   Those four sections were removed from JARVIS. Their saved data is not used by anything any more. This file knows
   exactly where that data lives, finds it, and erases it ONLY after the person has said so (see retired-ui.js):

   On the device (localStorage): the keys in LOCAL_KEYS; the AI connections other than the Nutrition one (those hold API
     keys for video, image and voice services); and the browser database that held AI Video's files (jarvisVideoBlobs).
   In the signed-in account (Firestore, always under users/{uid}):
     - the fields of the original shared document's "store" map listed in SYNCED_FIELDS (the document's other fields,
       such as the two-step sign-in secret, are never touched);
     - the Video Lab's backup (appData/jarvisVideoIntel and its numbered parts);
     - the documents in the Marketing collections the owner could write: marketing, marketingIdeas, marketingFindings.
   NOT erasable from the app: the Marketing records only the old server could write (SERVER_COLLECTIONS). The security
   rules forbid writing them from a browser, so they are reported and left for the Firebase console.

   Nothing outside these lists is ever read for deletion or deleted. Erasing is checked afterwards by looking again.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisRetiredData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LOCAL_KEYS = [
    "jarvisBusiness",
    "jarvisPaperTrades", "jarvisTradingJournal", "jarvisTradingSettings", "jarvisTradingWatchlist",
    "jarvisVideo", "jarvisVideoStudio",
    "jarvisMarketing", "jarvisMarketingLastSync", "jarvisInsightSocialKey",
    "jarvisVideoIntel"
  ];
  const CONNECTIONS_KEY = "jarvisVideoConnections";
  const KEEP_CONNECTION_KINDS = ["nutrition"];        // Nutrition's AI recipe calculator still uses this one
  const INDEXEDDB_NAMES = ["jarvisVideoBlobs"];
  const SYNCED_FIELDS = [
    "jarvisBusiness", "jarvisTradingWatchlist", "jarvisPaperTrades", "jarvisTradingJournal", "jarvisTradingSettings",
    "jarvisVideo", "jarvisVideoStudio", "jarvisMarketing"
  ];
  const BACKUP_DOC = "jarvisVideoIntel";
  const OWNER_COLLECTIONS = ["marketing", "marketingIdeas", "marketingFindings"];
  const SERVER_COLLECTIONS = ["marketingSnapshots", "marketingState", "marketingUsage", "marketingCache", "marketingPosts"];
  const STATE_KEY = "jarvisRetiredState";
  const MAX_PARTS = 1000;

  function parse(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }
  function readState(storage) {
    const s = parse(storage.getItem(STATE_KEY));
    return { localDone: !!(s && s.localDone), cloudDone: !!(s && s.cloudDone) };
  }
  function writeState(storage, state) {
    try { storage.setItem(STATE_KEY, JSON.stringify({ localDone: !!state.localDone, cloudDone: !!state.cloudDone })); return true; } catch (e) { return false; }
  }

  /* ---------------- on this device ---------------- */

  // -> { keys: [present retired keys], connections: n AI connections that would go, any }
  function scanLocal(storage) {
    const keys = LOCAL_KEYS.filter(function (k) { return storage.getItem(k) !== null; });
    const conns = parse(storage.getItem(CONNECTIONS_KEY));
    const connections = Array.isArray(conns) ? conns.filter(function (c) { return !c || KEEP_CONNECTION_KINDS.indexOf(c.kind) === -1; }).length : 0;
    return { keys: keys, connections: connections, any: keys.length > 0 || connections > 0 };
  }

  // Removes the retired keys and every AI connection except Nutrition's. A connections list that can't be read is left alone.
  // -> { ok, removed: [keys], connectionsRemoved: n, errors: [keys that could not be removed] }
  function eraseLocal(storage) {
    const removed = [], errors = [];
    LOCAL_KEYS.forEach(function (k) {
      try {
        if (storage.getItem(k) === null) return;
        storage.removeItem(k);
        if (storage.getItem(k) === null) removed.push(k); else errors.push(k);
      } catch (e) { errors.push(k); }
    });
    let connectionsRemoved = 0;
    const conns = parse(storage.getItem(CONNECTIONS_KEY));
    if (Array.isArray(conns)) {
      const keep = conns.filter(function (c) { return c && KEEP_CONNECTION_KINDS.indexOf(c.kind) !== -1; });
      if (keep.length !== conns.length) {
        try { storage.setItem(CONNECTIONS_KEY, JSON.stringify(keep)); connectionsRemoved = conns.length - keep.length; } catch (e) { errors.push(CONNECTIONS_KEY); }
      }
    }
    return { ok: errors.length === 0, removed: removed, connectionsRemoved: connectionsRemoved, errors: errors };
  }

  // The browser database of AI Video files. idb is window.indexedDB. -> Promise<{ ok, deleted: [names], errors: [names] }>; never rejects.
  function eraseIndexedDb(idb) {
    if (!idb || typeof idb.deleteDatabase !== "function") return Promise.resolve({ ok: true, deleted: [], errors: [] });
    return Promise.all(INDEXEDDB_NAMES.map(function (name) {
      return new Promise(function (resolve) {
        let done = false;
        const finish = function (ok) { if (!done) { done = true; resolve({ name: name, ok: ok }); } };
        try {
          const req = idb.deleteDatabase(name);
          req.onsuccess = function () { finish(true); };
          req.onerror = function () { finish(false); };
          req.onblocked = function () { finish(false); };
        } catch (e) { finish(false); }
      });
    })).then(function (rs) {
      return { ok: rs.every(function (r) { return r.ok; }), deleted: rs.filter(function (r) { return r.ok; }).map(function (r) { return r.name; }), errors: rs.filter(function (r) { return !r.ok; }).map(function (r) { return r.name; }) };
    });
  }

  /* ---------------- in the account ---------------- */

  // d: { fb (the Firestore functions), db, uid }. Reads only. -> Promise<{ fields, backup, docs: { collection: n }, any }>
  function scanCloud(d) {
    const fb = d.fb, db = d.db, uid = d.uid;
    return Promise.all([
      fb.getDocFromServer(fb.doc(db, "users", uid)),
      fb.getDocFromServer(fb.doc(db, "users", uid, "appData", BACKUP_DOC))
    ].concat(OWNER_COLLECTIONS.map(function (c) { return fb.getDocsFromServer(fb.collection(db, "users", uid, c)); }))).then(function (res) {
      const data = res[0].exists() ? res[0].data() : null;
      const store = data && data.store && typeof data.store === "object" ? data.store : null;
      const fields = store ? SYNCED_FIELDS.filter(function (k) { return Object.prototype.hasOwnProperty.call(store, k); }) : [];
      const backup = res[1].exists();
      const docs = {};
      OWNER_COLLECTIONS.forEach(function (c, i) { docs[c] = res[2 + i].docs.map(function (x) { return x.id; }); });
      const any = fields.length > 0 || backup || OWNER_COLLECTIONS.some(function (c) { return docs[c].length > 0; });
      return { fields: fields, backup: backup, docs: docs, any: any };
    });
  }

  // Erases what scanCloud found (scans first if no scan is passed), then looks again. Stops at the first failure and says which.
  // -> Promise<{ ok, errors: [text], erased: { fields: n, backupParts: n, docs: n }, leftBehind: [server-written collection names] }>; never rejects.
  function eraseCloud(d, scan) {
    const fb = d.fb, db = d.db, uid = d.uid;
    const erased = { fields: 0, backupParts: 0, docs: 0 };
    const fail = function (where) { return function (e) { return { ok: false, errors: [where + (e && e.code ? " (" + e.code + ")" : "")], erased: erased, leftBehind: SERVER_COLLECTIONS.slice() }; }; };
    return (scan ? Promise.resolve(scan) : scanCloud(d)).then(function (found) {
      let chain = Promise.resolve();
      if (found.fields.length) {
        chain = chain.then(function () {
          const del = {};
          found.fields.forEach(function (k) { if (SYNCED_FIELDS.indexOf(k) !== -1) del[k] = fb.deleteField(); });
          return fb.setDoc(fb.doc(db, "users", uid), { store: del }, { merge: true }).then(function () { erased.fields = found.fields.length; });
        });
      }
      if (found.backup) {
        chain = chain.then(function () {
          return fb.getDocFromServer(fb.doc(db, "users", uid, "appData", BACKUP_DOC)).then(function (snap) {
            const m = snap.exists() ? snap.data() : null;
            const parts = m && Number.isInteger(m.parts) && m.parts >= 1 && m.parts <= MAX_PARTS ? m.parts : 0;
            let seq = Promise.resolve();
            for (let i = 0; i < parts; i++) {
              seq = seq.then(function () { return fb.deleteDoc(fb.doc(db, "users", uid, "appData", BACKUP_DOC + "~" + i)); }).then(function () { erased.backupParts++; });
            }
            return seq.then(function () { return fb.deleteDoc(fb.doc(db, "users", uid, "appData", BACKUP_DOC)); });
          });
        });
      }
      OWNER_COLLECTIONS.forEach(function (c) {
        (found.docs[c] || []).forEach(function (id) {
          chain = chain.then(function () { return fb.deleteDoc(fb.doc(db, "users", uid, c, id)); }).then(function () { erased.docs++; });
        });
      });
      return chain.then(function () { return scanCloud(d); }).then(function (after) {
        return after.any
          ? { ok: false, errors: ["Some of it is still there after erasing"], erased: erased, leftBehind: SERVER_COLLECTIONS.slice() }
          : { ok: true, errors: [], erased: erased, leftBehind: SERVER_COLLECTIONS.slice() };
      });
    }).catch(fail("Couldn't erase it from your account"));
  }

  // Which removed section a stored key belonged to, for the sentence that tells you what is still there.
  const AREA_ORDER = ["Business", "Marketing", "Trading", "AI Video"];
  function areaOf(key) {
    if (key === "jarvisBusiness") return "Business";
    if (/^jarvisTrading|^jarvisPaperTrades$/.test(key)) return "Trading";
    if (key === "jarvisVideo" || key === "jarvisVideoStudio" || key === CONNECTIONS_KEY) return "AI Video";
    if (/^jarvisMarketing|^jarvisInsightSocialKey$|^jarvisVideoIntel$/.test(key)) return "Marketing";
    return "";
  }
  // keys -> the removed sections they belong to, in a fixed order, each once
  function areasOf(keys) {
    const seen = {};
    (keys || []).forEach(function (k) { const a = areaOf(k); if (a) seen[a] = true; });
    return AREA_ORDER.filter(function (a) { return seen[a]; });
  }

  return {
    areaOf: areaOf, areasOf: areasOf,
    LOCAL_KEYS: LOCAL_KEYS, CONNECTIONS_KEY: CONNECTIONS_KEY, KEEP_CONNECTION_KINDS: KEEP_CONNECTION_KINDS, INDEXEDDB_NAMES: INDEXEDDB_NAMES,
    SYNCED_FIELDS: SYNCED_FIELDS, BACKUP_DOC: BACKUP_DOC, OWNER_COLLECTIONS: OWNER_COLLECTIONS, SERVER_COLLECTIONS: SERVER_COLLECTIONS, STATE_KEY: STATE_KEY,
    readState: readState, writeState: writeState, scanLocal: scanLocal, eraseLocal: eraseLocal, eraseIndexedDb: eraseIndexedDb, scanCloud: scanCloud, eraseCloud: eraseCloud
  };
});
