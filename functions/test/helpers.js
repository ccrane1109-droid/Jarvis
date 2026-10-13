"use strict";

// In-memory stand-ins for Firestore and fetch so server logic can be tested
// without a Firebase project or real API calls.

const OWNER = "owner-uid";
const KEY = "isk_live_FAKE_TEST_KEY_0000";

function fakeDb(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    store,
    doc(path) {
      return {
        async get() {
          return { exists: store.has(path), data: () => store.get(path) };
        },
        async set(data, opts) {
          const prev = opts && opts.merge ? Object.assign({}, store.get(path) || {}) : {};
          Object.keys(data).forEach((k) => {
            const v = data[k];
            prev[k] = v && typeof v === "object" && "__inc" in v ? (prev[k] || 0) + v.__inc : v;
          });
          store.set(path, prev);
        }
      };
    },
    collection(path) {
      return {
        async get() {
          const prefix = path + "/";
          const docs = [];
          store.forEach((value, key) => {
            if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
              docs.push({ id: key.slice(prefix.length), data: () => value });
            }
          });
          return { docs };
        }
      };
    }
  };
}

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const next = typeof responses === "function" ? responses(String(url)) : responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next.throws) { const e = new Error(next.throws); e.name = next.name || "Error"; throw e; }
    return { status: next.status, text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)) };
  };
  fn.calls = calls;
  return fn;
}

function deps(overrides) {
  const logs = [];
  return Object.assign({
    db: fakeDb(),
    fetchImpl: fakeFetch([]),
    apiKey: KEY,
    ownerUid: OWNER,
    increment: (n) => ({ __inc: n }),
    now: () => new Date("2026-10-14T15:00:00Z"),
    log: { info: (...a) => logs.push(a), error: (...a) => logs.push(a) },
    logs
  }, overrides);
}

module.exports = { OWNER, KEY, fakeDb, fakeFetch, deps };
