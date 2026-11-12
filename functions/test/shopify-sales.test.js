"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/shopify-sales");
const shopify = require("../lib/shopify");
const { ServerError } = require("../lib/errors");
const { OWNER, fakeDb } = require("./helpers");

// The pretend Shopify here serves orders newest-first in pages, the way Shopify's documented
// `orders` connection does. These tests show what JARVIS does with such answers; they do not show
// how a real store behaves, and the exact field names are from my knowledge of Shopify's API, not
// confirmed against its reference pages from this environment.

const SHOP = "gratiel.myshopify.com", ID = "client-id-12345678", SECRET = "client-secret-ABCDEFGH-9999";
const NY = "America/New_York";
const NOW = new Date("2026-11-09T15:00:00Z");           // 10:00 AM on Monday 9 November in New York
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const order = (n, atMs, amount, over) => Object.assign({ name: "#" + n, createdAt: iso(atMs), cancelledAt: null, test: false, currentTotalPriceSet: { shopMoney: { amount: amount, currencyCode: "USD" } } }, over || {});

/* ---------------- the arithmetic ---------------- */

test("days start at midnight in the phone's time zone, including on a day the clocks change", () => {
  // Mon 9 Nov 2026, 10:00 EST (clocks went back on Sun 1 Nov)
  let w = S.windowsFor(NOW.getTime(), NY);
  assert.deepEqual([iso(w.starts.today), iso(w.starts.last7), iso(w.starts.last30)], ["2026-11-09T05:00:00.000Z", "2026-11-03T05:00:00.000Z", "2026-10-11T04:00:00.000Z"]);
  assert.equal(w.earliest, w.starts.last30);
  // the 25-hour day itself: Sun 1 Nov, 15:00 UTC is 10:00 EST; "today" began at midnight EDT
  w = S.windowsFor(Date.parse("2026-11-01T15:00:00Z"), NY);
  assert.equal(iso(w.starts.today), "2026-11-01T04:00:00.000Z");
  assert.equal(iso(w.starts.last7), "2026-10-26T04:00:00.000Z");
  // spring forward (Sun 8 Mar 2026): "today" at 12:00 UTC is 08:00 EDT
  w = S.windowsFor(Date.parse("2026-03-08T12:00:00Z"), NY);
  assert.equal(iso(w.starts.today), "2026-03-08T05:00:00.000Z");
  // UTC, and an unknown zone falls back to UTC rather than guessing
  assert.equal(iso(S.windowsFor(NOW.getTime(), "UTC").starts.today), "2026-11-09T00:00:00.000Z");
  assert.equal(S.windowsFor(NOW.getTime(), "Mars/Base").tz, "UTC");
  assert.equal(S.windowsFor(NOW.getTime(), undefined).tz, "UTC");
  assert.equal(S.validZone("Mars/Base"), false);
  assert.equal(S.validZone(NY), true);
  assert.equal(S.validZone("x".repeat(80)), false);
});

test("amounts are read as whole cents, and anything that isn't a plain amount is refused", () => {
  assert.deepEqual(["0.00", "12.5", "1234.56", "0.1", "99999999.99", "7"].map(S.toCents), [0, 1250, 123456, 10, 9999999999, 700]);
  ["", " ", "abc", "1,234.50", "-5.00", "1e3", "$5", "5.", ".5", "NaN", "Infinity", "12345678901234.00", null, undefined, 5, {}].forEach((x) => assert.equal(S.toCents(x), null, String(x)));
  assert.equal(S.centsText(30), "0.30");
  assert.equal(S.centsText(S.toCents("0.1") + S.toCents("0.2")), "0.30", "no floating-point drift");
  assert.equal(S.centsText(0), "0.00");
});

test("an order missing its time or its total is an error, not a zero", () => {
  const good = order(1001, NOW.getTime(), "10.00");
  assert.equal(S.normalizeOrder(good).cents, 1000);
  [null, undefined, 5, "x", {}, Object.assign({}, good, { createdAt: undefined }), Object.assign({}, good, { createdAt: "not a date" }),
    Object.assign({}, good, { currentTotalPriceSet: null }), Object.assign({}, good, { currentTotalPriceSet: { shopMoney: { amount: "1,0", currencyCode: "USD" } } }),
    Object.assign({}, good, { currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "usd" } } }), Object.assign({}, good, { currentTotalPriceSet: { shopMoney: { amount: "10.00" } } })
  ].forEach((x) => assert.ok(S.normalizeOrder(x).error, JSON.stringify(x)));
  const n = S.normalizeOrder(Object.assign({}, good, { name: "#10\u0000\u001b[31m01", cancelledAt: "2026-11-08T00:00:00Z", test: true }));
  assert.deepEqual([n.name, n.cancelled, n.test], ["#10[31m01", true, true], "control characters are stripped from the order name");
});

test("totals per period, with cancelled and test orders left out and counted separately", () => {
  const w = S.windowsFor(NOW.getTime(), NY);
  const T = w.starts.today, D7 = w.starts.last7, D30 = w.starts.last30;
  const raw = [
    order(1, T + 3600000, "100.10"), order(2, T + 60000, "20.20"),                              // today
    order(3, T - 1, "5.00"),                                                                    // 1 ms before today: yesterday
    order(4, D7, "1.01"), order(5, D7 - 1, "2.02"),                                             // exactly at the start of the 7 days; 1 ms before it
    order(6, D30, "3.03"), order(7, D30 - 1, "999.00"),                                         // exactly at the start of the 30 days; 1 ms before it (ignored)
    order(8, T + 5, "50.00", { cancelledAt: "2026-11-09T11:00:00Z" }), order(9, T + 6, "60.00", { test: true }),
    order(10, w.nowMs + 3600000, "77.00")                                                       // in the future: ignored
  ];
  const out = S.summarize(raw.map(S.normalizeOrder), w);
  assert.deepEqual(out.periods.map((p) => [p.key, p.orders, p.total]), [["today", 2, "120.30"], ["last7", 4, "126.31"], ["last30", 6, "131.36"]]);
  assert.deepEqual(out.excluded, { cancelled: 1, test: 1 });
  assert.equal(out.currency, "USD");
  assert.equal(out.mixedCurrencies, false);
  assert.deepEqual(out.recent.map((r) => r.name), ["#1", "#2", "#3", "#4", "#5"], "the five most recent counted orders, newest first");
  assert.deepEqual(out.recent[0], { name: "#1", at: iso(T + 3600000), total: "100.10", currency: "USD" });
  assert.ok(!out.recent.some((r) => ["#8", "#9", "#10", "#7"].includes(r.name)), "never a cancelled, test, future or out-of-range order");
});

test("orders in more than one currency are never added together", () => {
  const w = S.windowsFor(NOW.getTime(), NY);
  const eur = order(2, w.starts.today + 1000, "10.00"); eur.currentTotalPriceSet.shopMoney.currencyCode = "EUR";
  const out = S.summarize([order(1, w.starts.today + 2000, "10.00"), eur].map(S.normalizeOrder), w);
  assert.equal(out.mixedCurrencies, true);
  assert.equal(out.currency, "");
  out.periods.forEach((p) => assert.equal(p.total, null, p.key));
  assert.deepEqual(out.periods.map((p) => p.orders), [2, 2, 2], "the counts are still right");
});

test("no orders at all: zero counts, no invented currency", () => {
  const out = S.summarize([], S.windowsFor(NOW.getTime(), NY));
  assert.deepEqual(out.periods.map((p) => [p.orders, p.total]), [[0, "0.00"], [0, "0.00"], [0, "0.00"]]);
  assert.equal(out.currency, "");
  assert.deepEqual(out.recent, []);
});

/* ---------------- the action, against a pretend Shopify ---------------- */

function pretend(opts) {
  const o = Object.assign({ orders: [], scope: "read_orders,read_products", grantAfterRefresh: null, name: "Gratiel" }, opts || {});
  const st = { requests: [], issued: new Set(), n: 0, scope: o.scope, orders: o.orders, orderCalls: 0, revoked: new Set(), override: null, tokenCalls: 0 };
  const R = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  st.fetch = async (url, init) => {
    url = String(url);
    st.requests.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
    const u = new URL(url);
    if (u.host !== SHOP) return R(404, "");
    if (u.pathname === "/admin/oauth/access_token") {
      st.tokenCalls++;
      const f = new URLSearchParams(init.body);
      if (f.get("client_id") !== ID || f.get("client_secret") !== SECRET) return R(400, { error: "invalid_client" });
      if (o.grantAfterRefresh && st.armed) st.scope = o.grantAfterRefresh;
      const t = "shpat_tok_" + (++st.n) + "_abcdefgh"; st.issued.add(t);
      return R(200, { access_token: t, scope: st.scope, expires_in: 86399 });
    }
    if (u.pathname.endsWith("/graphql.json")) {
      const t = init.headers["X-Shopify-Access-Token"];
      if (!st.issued.has(t) || st.revoked.has(t)) return R(401, {});
      const body = JSON.parse(init.body);
      if (!/orders\(/.test(body.query)) return R(200, { data: { shop: { name: o.name } } });
      st.orderCalls++;
      if (st.override) { const r = st.override(body, st); if (r) return R(r.status || 200, r.body); }
      const start = body.variables.after ? Number(body.variables.after.slice(1)) : 0;
      const slice = st.orders.slice(start, start + body.variables.first);
      const end = start + slice.length;
      return R(200, { data: { orders: { pageInfo: { hasNextPage: end < st.orders.length, endCursor: "c" + end }, nodes: slice } } });
    }
    return R(404, "");
  };
  st.orderRequests = () => st.requests.filter((r) => r.url.includes("graphql") && /orders\(/.test(r.body));
  return st;
}
async function connected(opts, over) {
  const st = pretend(opts);
  const d = Object.assign({ db: fakeDb(), ownerUid: OWNER, now: () => NOW, fetch: st.fetch, log: { info() {}, error() {} } }, over || {});
  const call = (data, uid) => shopify.handle(uid === undefined ? OWNER : uid, data, d);
  await call({ action: "connect", shop: SHOP, clientId: ID, clientSecret: SECRET });
  st.requests.length = 0; st.tokenCalls = 0; st.armed = true;
  return { st, d, call };
}
const W = () => S.windowsFor(NOW.getTime(), NY);
const newestFirst = (list) => list.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
const rejects = async (p, code, re) => assert.rejects(p, (e) => { assert.ok(e instanceof ServerError, "a ServerError: " + e); assert.equal(e.code, code); if (re) assert.match(e.message, re); return true; });

test("the snapshot asks only for what it needs, only reads, and only talks to the store", async () => {
  const w = W();
  const { st, call } = await connected({ orders: newestFirst([order(1002, w.starts.today + 5000, "40.00"), order(1001, w.starts.today + 1000, "60.00")]) });
  const out = await call({ action: "sales", tz: NY });
  assert.equal(out.ok, true);
  assert.deepEqual(out.periods.map((p) => [p.key, p.orders, p.total]), [["today", 2, "100.00"], ["last7", 2, "100.00"], ["last30", 2, "100.00"]]);
  assert.deepEqual([out.currency, out.tz, out.truncated, out.scanned, out.asOf], ["USD", NY, false, 2, NOW.toISOString()]);
  assert.equal(st.orderRequests().length, 1);
  const r = st.orderRequests()[0], body = JSON.parse(r.body);
  assert.equal(r.url, "https://" + SHOP + "/admin/api/2026-10/graphql.json");
  assert.equal(r.redirect, "error");
  assert.match(r.headers["X-Shopify-Access-Token"], /^shpat_tok_/);
  assert.deepEqual(body.variables, { first: 100, after: null }, "cursors travel as variables, never pasted into the query text");
  assert.ok(!/mutation/i.test(body.query));
  ["customer", "email", "phone", "address", "shipping", "billing", "note"].forEach((w) => assert.ok(!body.query.toLowerCase().includes(w), "does not ask for " + w));
  assert.ok(st.requests.every((x) => new URL(x.url).host === SHOP));
  const s = JSON.stringify(out);
  [SECRET, ID, "shpat_tok_"].forEach((x) => assert.ok(!s.includes(x), "leaked " + x));
});

test("it pages through the orders and stops as soon as it has passed the 30 days", async () => {
  const w = W();
  const list = [];
  for (let i = 0; i < 230; i++) list.push(order(2000 - i, w.nowMs - i * 3 * 3600000, "10.00"));      // one order every 3 hours: 230 orders reach back about 28.7 days
  for (let i = 0; i < 400; i++) list.push(order(1000 - i, w.starts.last30 - (i + 1) * 3600000, "10.00"));   // then older than the 30 days
  const { st, call } = await connected({ orders: newestFirst(list) });
  const out = await call({ action: "sales", tz: NY });
  assert.equal(st.orderRequests().length, 3, "pages of 100: the third page crosses the 30-day edge, so no fourth request");
  assert.deepEqual(out.periods.map((p) => p.orders), [out.periods[0].orders, out.periods[1].orders, 230]);
  assert.equal(out.periods[2].total, "2300.00");
  assert.equal(out.truncated, false);
  assert.ok(out.periods.every((p) => !p.atLeast));
  assert.equal(JSON.parse(st.orderRequests()[1].body).variables.after, "c100");
});

test("if a store has more orders than it will read, it says so and marks the totals 'at least'", async () => {
  const w = W();
  const list = [];
  for (let i = 0; i < 1500; i++) list.push(order(5000 - i, w.nowMs - i * 60000, "1.00"));              // 1,500 orders in the last day
  const { st, call } = await connected({ orders: newestFirst(list) });
  const out = await call({ action: "sales", tz: NY });
  assert.equal(st.orderRequests().length, 10, "never more than 10 pages");
  assert.equal(out.truncated, true);
  assert.equal(out.scanned, 1000);
  const today = out.periods.find((p) => p.key === "today");
  assert.ok(today.orders <= 1000);
  assert.equal(out.periods.find((p) => p.key === "last30").atLeast, true);
});

test("cancelled and test orders are left out and counted, in the full flow", async () => {
  const w = W();
  const { call } = await connected({ orders: newestFirst([order(3, w.starts.today + 3000, "30.00"), order(2, w.starts.today + 2000, "20.00", { cancelledAt: "2026-11-09T12:00:00Z" }), order(1, w.starts.today + 1000, "10.00", { test: true })]) });
  const out = await call({ action: "sales", tz: NY });
  assert.deepEqual(out.periods.map((p) => [p.orders, p.total]), [[1, "30.00"], [1, "30.00"], [1, "30.00"]]);
  assert.deepEqual(out.excluded, { cancelled: 1, test: 1 });
});

test("which day an order falls on depends on the time zone", async () => {
  // 23:30 UTC on 9 Nov is 6:30 PM on 9 Nov in New York, and 03:00 UTC on 10 Nov is 10 PM on 9 Nov there: both are "today" in New York. In UTC only the second is (the first was the day before)
  const nowLate = new Date("2026-11-10T04:00:00Z");
  const list = [order(1, Date.parse("2026-11-10T03:00:00Z"), "10.00"), order(2, Date.parse("2026-11-09T23:30:00Z"), "20.00")];
  const a = await connected({ orders: list }, { now: () => nowLate });
  const ny = await a.call({ action: "sales", tz: NY });
  assert.equal(ny.periods[0].orders, 2, "New York: both are on 9 November, which is still today");
  const b = await connected({ orders: list }, { now: () => nowLate });
  const utc = await b.call({ action: "sales", tz: "UTC" });
  assert.equal(utc.periods[0].orders, 1, "UTC: only the one after midnight is today");
  const c = await connected({ orders: list }, { now: () => nowLate });
  assert.equal((await c.call({ action: "sales" })).tz, "UTC", "no zone given: UTC, and it says so");
});

test("without the read_orders permission it doesn't ask for orders, and it checks once whether the permission was added since", async () => {
  let t = await connected({ scope: "read_products" });
  await rejects(t.call({ action: "sales", tz: NY }), "failed-precondition", /read_orders permission/);
  assert.equal(t.st.orderRequests().length, 0, "it never asked Shopify for orders");
  assert.equal(t.st.tokenCalls, 1, "but it did ask for a fresh token once, in case the permission was added after the last one");
  t = await connected({ scope: "read_products", grantAfterRefresh: "read_products,read_orders", orders: [] });
  const out = await t.call({ action: "sales", tz: NY });
  assert.equal(out.ok, true, "permission added later: works after the refresh");
  assert.equal(t.st.tokenCalls, 1);
  t = await connected({ scope: "" });
  await rejects(t.call({ action: "sales", tz: NY }), "failed-precondition", /read_orders/);
});

test("it refuses to count anything it can't trust", async () => {
  const w = W();
  const good = [order(2, w.starts.today + 3 * 3600000, "20.00"), order(1, w.starts.today + 1000, "10.00")];
  const cases = [
    [{ orders: [good[0], Object.assign({}, good[1], { createdAt: "garbage" })] }, /no creation time/],
    [{ orders: [good[0], Object.assign({}, good[1], { currentTotalPriceSet: null })] }, /no readable total/],
    [{ orders: [good[1], good[0]] }, /newest first/]
  ];
  for (const [opts, re] of cases) {
    const t = await connected(opts);
    await rejects(t.call({ action: "sales", tz: NY }), "failed-precondition", re);
  }
  const answers = [
    [{ body: { data: null } }, "failed-precondition", /no order data.*read_orders/],
    [{ body: { data: { orders: { nodes: "nope" } } } }, "failed-precondition", /list of orders/],
    [{ body: { errors: [{ message: "Access denied for orders field. Required access: read_orders", extensions: { code: "ACCESS_DENIED" } }] } }, "failed-precondition", /refused the request for your orders: Access denied/],
    [{ body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } }, "unavailable", /slow down/],
    [{ status: 429, body: "" }, "unavailable", /busy.*429/],
    [{ status: 500, body: "" }, "unavailable", /500/],
    [{ body: "<html>" }, "failed-precondition", /no order data/]
  ];
  for (const [ans, code, re] of answers) {
    const t = await connected({ orders: good });
    t.st.override = () => ans;
    await rejects(t.call({ action: "sales", tz: NY }), code, re);
  }
});

test("a token Shopify turns down is renewed once and the request repeated, but not forever", async () => {
  const w = W();
  const { st, call } = await connected({ orders: [order(1, w.starts.today + 1000, "10.00")] });
  st.revoked.add([...st.issued][0]);
  const out = await call({ action: "sales", tz: NY });
  assert.equal(out.periods[0].orders, 1);
  assert.equal(st.tokenCalls, 1, "one new token");
  const u = await connected({ orders: [] });
  u.st.override = () => ({ status: 401, body: {} });
  await rejects(u.call({ action: "sales", tz: NY }), "failed-precondition", /no longer accepts/);
  assert.equal(u.st.tokenCalls, 1);
  assert.equal(u.st.orderRequests().length, 2);
});

test("bad input, no connection, and non-owners", async () => {
  const t = await connected({ orders: [] });
  for (const tz of ["Mars/Base", "x".repeat(80), 5, null, {}, ""]) await rejects(t.call({ action: "sales", tz }), "invalid-argument", /time zone/);
  assert.equal(t.st.requests.length, 0, "refused before anything was sent");
  const none = setup2();
  await rejects(none.call({ action: "sales", tz: NY }), "failed-precondition", /Connect your Shopify store first/);
  await rejects(t.call({ action: "sales", tz: NY }, null), "unauthenticated");
  await rejects(t.call({ action: "sales", tz: NY }, "someone-else"), "permission-denied");
  assert.equal(t.st.requests.length, 0);
  function setup2() { const st = pretend(); const d = { db: fakeDb(), ownerUid: OWNER, now: () => NOW, fetch: st.fetch, log: {} }; return { call: (data) => shopify.handle(OWNER, data, d) }; }
});

test("a sales read leaves the saved connection as it was (apart from a renewed token)", async () => {
  const w = W();
  const { st, d, call } = await connected({ orders: [order(1, w.starts.today + 1000, "10.00")] });
  const before = JSON.parse(JSON.stringify(d.db.store.get("users/" + OWNER + "/shopify/connection")));
  await call({ action: "sales", tz: NY });
  assert.deepEqual(d.db.store.get("users/" + OWNER + "/shopify/connection"), before);
  assert.deepEqual([...d.db.store.keys()], ["users/" + OWNER + "/shopify/connection"], "no orders are stored anywhere");
  assert.equal(st.tokenCalls, 0);
});
