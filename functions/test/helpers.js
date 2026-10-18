"use strict";

// In-memory stand-ins for Firestore and fetch so server logic can be tested
// without a Firebase project or real API calls.

const OWNER = "owner-uid";
const KEY = "isk_live_FAKE_TEST_KEY_0000";

function fakeDb(initial) {
  const store = new Map(Object.entries(initial || {}));
  let txChain = Promise.resolve();
  const db = {
    store,
    doc(path) {
      return {
        path,
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
        },
        async create(data) {
          if (store.has(path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          store.set(path, Object.assign({}, data));
        },
        async update(data) {
          if (!store.has(path)) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
          store.set(path, Object.assign({}, store.get(path), data));
        },
        async delete() {
          store.delete(path);
        }
      };
    },
    collection(path) {
      const q = { filters: [], order: null, max: Infinity };
      const query = {
        where(field, op, value) { q.filters.push({ field, op, value }); return query; },
        orderBy(field) { q.order = field; return query; },
        limit(n) { q.max = n; return query; },
        async get() {
          const prefix = path + "/";
          let docs = [];
          store.forEach((value, key) => {
            if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
              docs.push({ id: key.slice(prefix.length), data: () => value });
            }
          });
          q.filters.forEach((f) => {
            if (f.op !== "<=") throw new Error("fake query: only <= is supported");
            // Like Firestore, a range filter only matches values of the same type (so null never matches).
            docs = docs.filter((d) => typeof d.data()[f.field] === "string" && d.data()[f.field] <= f.value);
          });
          if (q.order) docs.sort((a, b) => (a.data()[q.order] < b.data()[q.order] ? -1 : a.data()[q.order] > b.data()[q.order] ? 1 : 0));
          return { docs: docs.slice(0, q.max) };
        }
      };
      return query;
    },
    // Transactions run one at a time (like Firestore, which retries conflicting ones), reads see the state
    // before the transaction, and writes are applied together at the end.
    runTransaction(fn) {
      const run = async () => {
        const writes = [];
        const tx = {
          get: (ref) => ref.get(),
          create: (ref, data) => { writes.push(() => ref.create(data)); },
          set: (ref, data, opts) => { writes.push(() => ref.set(data, opts)); },
          update: (ref, data) => { writes.push(() => ref.update(data)); },
          delete: (ref) => { writes.push(() => ref.delete()); }
        };
        const result = await fn(tx);
        for (const w of writes) await w();
        return result;
      };
      const next = txChain.then(run, run);
      txChain = next.catch(() => {});
      return next;
    }
  };
  return db;
}

// Stands in for the web-push library: records every send and answers from a list or a function.
function fakeWebPush(answer) {
  const calls = [];
  return {
    calls,
    vapid: null,
    setVapidDetails(subject, pub, priv) { this.vapid = { subject, pub, priv }; },
    async sendNotification(subscription, payload, options) {
      calls.push({ subscription, payload, options });
      const r = typeof answer === "function" ? answer(subscription, payload, options, calls.length) : (answer && answer.length ? answer.shift() : { statusCode: 201 });
      if (r && r.error) throw Object.assign(new Error(r.error.message || "push failed"), { statusCode: r.error.statusCode, body: r.error.body });
      return r || { statusCode: 201 };
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

module.exports = { OWNER, KEY, fakeDb, fakeFetch, fakeWebPush, deps };
