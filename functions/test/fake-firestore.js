"use strict";

// A small in-memory stand-in for the parts of the Firebase web SDK that js/cloud-backup.js uses
// (doc, collection, getDocsFromServer, runTransaction), with ways to make things go wrong.
// It is NOT Firestore: the real SDK and the real security rules are exercised separately against the
// Firestore emulator. This exists so the failure cases (lost confirmation, another device writing in the
// middle of a transaction, offline, refused) can be reproduced exactly.

const MAX_DOC_BYTES = 1048576;

function createFakeFirestore() {
  const store = new Map();                  // path -> data
  const db = {
    store: store,
    offline: false,                         // every call fails with "unavailable"
    denied: false,                          // every call fails with "permission-denied"
    hang: false,                            // calls never answer
    fromCache: false,                       // getDocs answers from a (stale) cache
    failNext: [],                           // error codes to fail the next calls with, one each
    dropAckNext: 0,                         // the next N transactions commit, but the caller is told they failed
    beforeCommit: null,                     // function run after a transaction's reads, before it commits (another device writes here)
    counts: { reads: 0, commits: 0 }
  };

  function guard() {
    if (db.hang) return new Promise(function () {});
    if (db.offline) return Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" }));
    if (db.denied) return Promise.reject(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    if (db.failNext.length) return Promise.reject(Object.assign(new Error("injected"), { code: db.failNext.shift() }));
    return null;
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const snapOf = (path) => ({
    id: path.split("/").pop(),
    exists: () => store.has(path),
    data: () => (store.has(path) ? clone(store.get(path)) : undefined)
  });

  const fb = {
    doc: (_db, ...segs) => ({ path: segs.join("/"), id: segs[segs.length - 1] }),
    collection: (_db, ...segs) => ({ path: segs.join("/"), isCollection: true }),
    getDocsFromServer(col) {
      const bad = guard();
      if (bad) return bad;
      db.counts.reads++;
      const prefix = col.path + "/";
      const docs = Array.from(store.keys()).filter((p) => p.startsWith(prefix) && p.indexOf("/", prefix.length) === -1).map(snapOf);
      return Promise.resolve({ docs: docs, metadata: { fromCache: db.fromCache } });
    },
    runTransaction(_db, fn) {
      const bad = guard();
      if (bad) return bad;
      const attempt = (n) => {
        const reads = new Map();
        const writes = [];
        const tx = {
          get(ref) { reads.set(ref.path, store.has(ref.path) ? JSON.stringify(store.get(ref.path)) : null); return Promise.resolve(snapOf(ref.path)); },
          set(ref, data) { writes.push({ op: "set", path: ref.path, data: clone(data) }); return tx; },
          delete(ref) { writes.push({ op: "delete", path: ref.path }); return tx; }
        };
        return Promise.resolve(fn(tx)).then((out) => {
          if (db.beforeCommit) { const f = db.beforeCommit; db.beforeCommit = null; f(); }
          for (const [path, before] of reads) {
            const now = store.has(path) ? JSON.stringify(store.get(path)) : null;
            if (now !== before) {
              if (n >= 4) throw Object.assign(new Error("too much contention"), { code: "aborted" });
              return attempt(n + 1);     // like the real SDK: somebody changed what we read, run the function again
            }
          }
          writes.forEach((w) => {
            if (w.op === "set" && Buffer.byteLength(JSON.stringify(w.data)) > MAX_DOC_BYTES) throw Object.assign(new Error("document too large"), { code: "invalid-argument" });
          });
          writes.forEach((w) => { if (w.op === "set") store.set(w.path, w.data); else store.delete(w.path); });
          db.counts.commits++;
          if (db.dropAckNext > 0) { db.dropAckNext--; throw Object.assign(new Error("connection lost"), { code: "unavailable" }); }
          return out;
        });
      };
      return attempt(0);
    }
  };
  return { db: db, fb: fb };
}

// A localStorage that behaves like one for these purposes.
function createFakeStorage(initial, quotaChars) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      if (quotaChars !== undefined) {
        let used = 0;
        for (const [key, val] of m) used += key === k ? 0 : key.length + val.length;
        if (used + k.length + String(v).length > quotaChars) throw new Error("QuotaExceededError");
      }
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    keys: () => Array.from(m.keys())
  };
}

// Timers you fire by hand, and a clock you move by hand.
function createFakeClock(start) {
  let t = start || 1700000000000;
  const timers = new Map();
  let id = 1;
  return {
    now: () => t,
    advance(ms) { t += ms; },
    setTimer(fn, ms) { const h = id++; timers.set(h, { fn: fn, at: t + ms }); return h; },
    clearTimer(h) { timers.delete(h); },
    pending: () => timers.size,
    // run every timer that is due after moving the clock forward
    async tick(ms) {
      t += ms;
      const due = Array.from(timers.entries()).filter(([, v]) => v.at <= t);
      for (const [h, v] of due) { timers.delete(h); v.fn(); }
      await new Promise((r) => setImmediate(r));
    }
  };
}

module.exports = { createFakeFirestore, createFakeStorage, createFakeClock, MAX_DOC_BYTES };
