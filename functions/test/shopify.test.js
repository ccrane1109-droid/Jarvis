"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const shopify = require("../lib/shopify");
const { ServerError } = require("../lib/errors");
const { OWNER, fakeDb } = require("./helpers");

// These tests use a stand-in for Shopify that follows the documented behaviour (shopify.dev, "Access tokens"):
// a form-encoded POST of grant_type, client_id and client_secret to /admin/oauth/access_token answers
// { access_token, scope, expires_in }, and Admin API calls carry the token in X-Shopify-Access-Token.
// They show what THIS code does with such answers. They do not show how a real store behaves.

const SHOP = "gratiel.myshopify.com";
const ID = "client-id-12345678";
const SECRET = "client-secret-ABCDEFGH-9999";
const NOW = new Date("2026-11-09T15:00:00Z");
const PATH = `users/${OWNER}/shopify/connection`;

function fakeShopify(opts) {
  const o = Object.assign({ shop: SHOP, clientId: ID, clientSecret: SECRET, scope: "read_orders,read_products", lifetime: 86399, name: "Gratiel", override: null }, opts || {});
  const s = { requests: [], issued: new Set(), n: 0, revoked: new Set() };
  s.fetch = async (url, init) => {
    url = String(url);
    s.requests.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect, hasSignal: !!init.signal });
    if (o.override) { const r = await o.override(url, init, s); if (r) return reply(r); }
    const u = new URL(url);
    if (u.host !== o.shop) return reply({ status: 404, body: "no such shop" });
    if (u.pathname === "/admin/oauth/access_token") {
      const f = new URLSearchParams(init.body);
      if (f.get("grant_type") !== "client_credentials" || f.get("client_id") !== o.clientId || f.get("client_secret") !== o.clientSecret) {
        return reply({ status: 400, body: { error: "invalid_client", error_description: "bad credentials for " + f.get("client_secret") } });
      }
      const t = "shpat_token_" + (++s.n) + "_abcdefgh";
      s.issued.add(t);
      return reply({ status: 200, body: { access_token: t, scope: o.scope, expires_in: o.lifetime } });
    }
    if (u.pathname === "/admin/api/" + shopify.API_VERSION + "/graphql.json") {
      const t = init.headers["X-Shopify-Access-Token"];
      if (!s.issued.has(t) || s.revoked.has(t)) return reply({ status: 401, body: { errors: "[API] Invalid API key or access token" } });
      return reply({ status: 200, body: { data: { shop: { name: o.name } } } });
    }
    return reply({ status: 404, body: "" });
  };
  s.tokenCalls = () => s.requests.filter((r) => r.url.endsWith("/admin/oauth/access_token")).length;
  s.apiCalls = () => s.requests.filter((r) => r.url.includes("/graphql.json")).length;
  return s;
}
function reply(r) { return { status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body === undefined ? {} : r.body)) }; }

function setup(opts, now) {
  const fs = fakeShopify(opts);
  const clock = { t: now || NOW };
  const d = { db: fakeDb(), ownerUid: OWNER, now: () => clock.t, fetch: fs.fetch, log: { info() {}, error() {} } };
  return { fs, d, clock, call: (data, uid) => shopify.handle(uid === undefined ? OWNER : uid, data, d) };
}
const connectData = (over) => Object.assign({ action: "connect", shop: SHOP, clientId: ID, clientSecret: SECRET }, over || {});
const rejects = async (p, code, re) => assert.rejects(p, (e) => { assert.ok(e instanceof ServerError, "a ServerError, not an unexpected failure: " + e); assert.equal(e.code, code); if (re) assert.match(e.message, re); return true; });
const noSecrets = (value, extra) => { const s = JSON.stringify(value); [SECRET, ID, "shpat_token_"].concat(extra || []).forEach((x) => assert.ok(!s.includes(x), "leaked " + x)); };

test("a store address is accepted only if it is exactly <handle>.myshopify.com", () => {
  const good = {
    "gratiel": SHOP, "  Gratiel  ": SHOP, "gratiel.myshopify.com": SHOP, "GRATIEL.MYSHOPIFY.COM": SHOP, "https://gratiel.myshopify.com": SHOP,
    "https://gratiel.myshopify.com/admin/orders?x=1#top": SHOP, "http://gratiel.myshopify.com/": SHOP, "https://admin.shopify.com/store/gratiel": SHOP,
    "https://admin.shopify.com/store/gratiel/orders": SHOP, "my-store-2.myshopify.com": "my-store-2.myshopify.com", "a.myshopify.com": "a.myshopify.com",
    // a bare word is a store handle, so even "localhost" only ever becomes an address under myshopify.com
    "localhost": "localhost.myshopify.com"
  };
  Object.keys(good).forEach((k) => assert.deepEqual(shopify.normalizeShop(k), { ok: true, shop: good[k] }, k));
  const bad = [
    "", "   ", null, undefined, 5, {}, ["gratiel"], "gratiel.com", "www.gratiel.com", "gratiel.myshopify.com.evil.example", "evil.example/gratiel.myshopify.com",
    "evil.example#.myshopify.com", "evil.example?.myshopify.com", "user@gratiel.myshopify.com", "user:pw@gratiel.myshopify.com", "gratiel.myshopify.com:8443",
    "gratiel.myshopify.com\\.evil.example", "evil.example\\.myshopify.com", "-gratiel.myshopify.com", "gratiel-.myshopify.com", "gra tiel", "gratiel..myshopify.com",
    "sub.gratiel.myshopify.com", "127.0.0.1", "169.254.169.254", "[::1]", "xn--grtiel-9ya.myshopify.com.", "grätiel.myshopify.com", "ｇratiel.myshopify.com",
    "https://admin.shopify.com/store/", "https://admin.shopify.com/store/evil.example", "https://admin.shopify.com/other/gratiel", "admin.shopify.com", "x".repeat(400),
    "javascript:alert(1)", "file:///etc/passwd", "//gratiel.myshopify.com"
  ];
  bad.forEach((k) => assert.equal(shopify.normalizeShop(k).ok, false, String(k)));
  assert.match(shopify.normalizeShop("gratiel.com").reason, /\.myshopify\.com/);
});

test("connecting: asks Shopify for a token, proves it with the store's name, saves it server-side, and returns nothing secret", async () => {
  const t = setup();
  const out = await t.call(connectData());
  assert.deepEqual(out, { connected: true, shop: SHOP, shopName: "Gratiel", scopes: ["read_orders", "read_products"], readOnly: true, connectedAt: NOW.toISOString(), verifiedAt: NOW.toISOString(), problem: "" });
  noSecrets(out);

  assert.equal(t.fs.requests.length, 2);
  const [tok, api] = t.fs.requests;
  assert.equal(tok.url, "https://" + SHOP + "/admin/oauth/access_token");
  assert.equal(tok.method, "POST");
  assert.equal(tok.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tok.body)), { grant_type: "client_credentials", client_id: ID, client_secret: SECRET });
  assert.equal(api.url, "https://" + SHOP + "/admin/api/2026-10/graphql.json");
  assert.equal(api.method, "POST");
  assert.match(api.headers["X-Shopify-Access-Token"], /^shpat_token_1_/);
  assert.deepEqual(JSON.parse(api.body), { query: "{ shop { name } }" });
  assert.ok(!/mutation/i.test(api.body), "it only reads");
  t.fs.requests.forEach((r) => { assert.equal(r.redirect, "error", "redirects are never followed"); assert.ok(r.hasSignal, "every request has a time limit"); assert.ok(r.url.startsWith("https://" + SHOP + "/"), "only ever the store's own address"); });

  assert.deepEqual([...t.d.db.store.keys()], [PATH], "the only thing written is the one server-side connection document");
  const saved = t.d.db.store.get(PATH);
  assert.equal(saved.clientSecret, SECRET);
  assert.equal(saved.tokenExpiresAt, NOW.getTime() + 86399 * 1000);
  assert.deepEqual(saved.scope, ["read_orders", "read_products"]);
});

test("the store address can be typed several ways and is stored in one form", async () => {
  const t = setup();
  const out = await t.call(connectData({ shop: "https://admin.shopify.com/store/Gratiel/" }));
  assert.equal(out.shop, SHOP);
  assert.equal(t.fs.requests[0].url, "https://" + SHOP + "/admin/oauth/access_token");
});

test("permissions that could change the store are reported as not read-only", () => {
  const ro = (scope) => shopify.publicStatus({ shop: SHOP, scope }).readOnly;
  assert.equal(ro(["read_orders", "read_products"]), true);
  assert.equal(ro(["read_orders", "write_products"]), false);
  assert.equal(ro([]), false, "no permissions listed is not 'read-only', it is unknown");
  assert.deepEqual(shopify.parseScope("read_orders, read_products ,BAD SCOPE,,write_x;drop"), ["read_orders", "read_products"]);
  assert.deepEqual(shopify.parseScope(undefined), []);
});

test("bad input is refused before anything is sent to Shopify", async () => {
  const t = setup();
  const cases = [
    [{ shop: "gratiel.com" }, /myshopify\.com/], [{ shop: "" }, /address/], [{ shop: "evil.example#.myshopify.com" }, /address|myshopify/],
    [{ clientId: "" }, /Client ID/], [{ clientId: "short" }, /Client ID/], [{ clientId: "has spaces in it 123" }, /Client ID/], [{ clientId: 12345678 }, /Client ID/],
    [{ clientSecret: "" }, /Client Secret/], [{ clientSecret: "x".repeat(201) }, /Client Secret/], [{ clientSecret: undefined }, /Client Secret/], [{ clientSecret: "bad\nsecret1234" }, /Client Secret/]
  ];
  for (const [over, re] of cases) await rejects(t.call(connectData(over)), "invalid-argument", re);
  assert.equal(t.fs.requests.length, 0);
  assert.equal(t.d.db.store.size, 0);
  await rejects(t.call({ action: "nope" }), "invalid-argument");
  await rejects(t.call({}), "invalid-argument");
  await rejects(t.call(undefined), "invalid-argument");
});

test("a failed connection attempt says why in plain words, never repeats the secret, and saves nothing", async () => {
  // wrong secret; Shopify's own answer happens to echo what it was given
  let t = setup({ clientSecret: "something-else-entirely" });
  await assert.rejects(t.call(connectData()), (e) => {
    assert.ok(e instanceof ServerError);
    assert.equal(e.code, "failed-precondition");
    assert.match(e.message, /didn't accept these credentials.*400.*invalid_client/);
    noSecrets(e.message);
    assert.ok(e.message.includes("***"), "the echoed secret was masked");
    return true;
  });
  assert.equal(t.d.db.store.size, 0);
  assert.equal(t.fs.requests.length, 1, "it stops at the first refusal");

  const answers = [
    [{ status: 400, body: { error: "shop_not_permitted", error_description: "x" } }, "failed-precondition", /different|same Shopify organization.*installed|can't be used with this store/],
    [{ status: 404, body: "Not Found" }, "not-found", /no store at that address/],
    [{ status: 429, body: "" }, "unavailable", /busy.*429/], [{ status: 503, body: "" }, "unavailable", /503/],
    [{ status: 200, body: "<html>not json</html>" }, "failed-precondition", /not with an access token/],
    [{ status: 200, body: { scope: "read_orders" } }, "failed-precondition", /not with an access token/],
    [{ status: 200, body: { access_token: "short" } }, "failed-precondition", /not with an access token/],
    [{ status: 200, body: { access_token: "has a space in it!!" } }, "failed-precondition", /not with an access token/],
    [{ status: 401, body: { error: "a\u0000b\u001b[31mred" } }, "failed-precondition", /401/]
  ];
  for (const [ans, code, re] of answers) {
    t = setup({ override: async (url) => (url.endsWith("/access_token") ? ans : null) });
    const err = await t.call(connectData()).then(() => null, (e) => e);
    assert.ok(err instanceof ServerError, JSON.stringify(ans));
    assert.equal(err.code, code);
    assert.match(err.message, re);
    assert.ok(!/[\u0000-\u001f]/.test(err.message), "no control characters from Shopify's text reach the screen");
    assert.equal(t.d.db.store.size, 0, JSON.stringify(ans));
  }

  // the store refuses the token it just issued, or refuses to say its name
  t = setup({ override: async (url) => (url.includes("graphql") ? { status: 200, body: { errors: [{ message: "Access denied for shop field. Required access: read_shop" }] } } : null) });
  await rejects(t.call(connectData()), "failed-precondition", /refused the request: Access denied for shop field/);
  assert.equal(t.d.db.store.size, 0);
  t = setup({ override: async (url) => (url.includes("graphql") ? { status: 200, body: { data: { shop: { name: "   " } } } } : null) });
  await rejects(t.call(connectData()), "failed-precondition", /didn't say the store's name/);
  t = setup({ override: async (url) => (url.includes("graphql") ? { status: 401, body: {} } : null) });
  await rejects(t.call(connectData()), "failed-precondition", /wouldn't accept it/);
  assert.equal(t.d.db.store.size, 0);
});

test("can't reach Shopify, or Shopify sends the request elsewhere: a clear message and nothing saved", async () => {
  const cases = [
    [async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }, /Couldn't reach Shopify/],
    [async () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("unexpected redirect") }); }, /Couldn't reach Shopify/],
    [async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, /didn't answer in time/]
  ];
  for (const [fetchFn, re] of cases) {
    const t = setup();
    t.d.fetch = fetchFn;
    await rejects(t.call(connectData()), "unavailable", re);
    assert.equal(t.d.db.store.size, 0);
  }
  // a Shopify that never answers is given up on after the time limit
  const t = setup();
  t.d.timeoutMs = 25;
  t.d.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const started = Date.now();
  await rejects(t.call(connectData()), "unavailable", /didn't answer in time/);
  assert.ok(Date.now() - started < 2000);
});

test("a failed attempt leaves an existing working connection alone", async () => {
  const t = setup();
  await t.call(connectData());
  const before = JSON.stringify(t.d.db.store.get(PATH));
  const writes = t.d.db.store.size;
  await rejects(t.call(connectData({ clientSecret: "a-wrong-secret-1234" })), "failed-precondition", /didn't accept/);
  assert.equal(JSON.stringify(t.d.db.store.get(PATH)), before);
  assert.equal(t.d.db.store.size, writes);
  assert.equal((await t.call({ action: "status" })).shopName, "Gratiel");
});

test("status: not connected, then connected; never includes the secret or token", async () => {
  const t = setup();
  assert.deepEqual(await t.call({ action: "status" }), { connected: false });
  await t.call(connectData());
  const s = await t.call({ action: "status" });
  assert.deepEqual(Object.keys(s).sort(), ["connectedAt", "connected", "problem", "readOnly", "scopes", "shop", "shopName", "verifiedAt"].sort());
  noSecrets(s);
  assert.equal(t.fs.requests.length, 2, "looking at the status doesn't call Shopify");
});

test("check: reuses a token that is still good, and asks for a new one when it is about to expire", async () => {
  const t = setup();
  await t.call(connectData());
  t.clock.t = new Date(NOW.getTime() + 60 * 60 * 1000);                  // an hour later
  let out = await t.call({ action: "check" });
  assert.equal(out.problem, "");
  assert.equal(out.verifiedAt, t.clock.t.toISOString());
  assert.equal(out.connectedAt, NOW.toISOString(), "the connect time doesn't change");
  assert.equal(t.fs.tokenCalls(), 1, "no new token was needed");
  assert.equal(t.fs.apiCalls(), 2);

  t.clock.t = new Date(NOW.getTime() + 86399 * 1000 - 4 * 60 * 1000);      // 4 minutes before it expires
  out = await t.call({ action: "check" });
  assert.equal(t.fs.tokenCalls(), 2, "a new token was requested");
  assert.match(t.fs.requests[t.fs.requests.length - 1].headers["X-Shopify-Access-Token"], /^shpat_token_2_/);
  assert.equal(t.d.db.store.get(PATH).tokenExpiresAt, t.clock.t.getTime() + 86399 * 1000);
  noSecrets(out);
});

test("check: if Shopify says the token is no good, it gets one new token and tries once more", async () => {
  const t = setup();
  await t.call(connectData());
  t.fs.revoked.add([...t.fs.issued][0]);
  const out = await t.call({ action: "check" });
  assert.equal(out.problem, "");
  assert.equal(t.fs.tokenCalls(), 2);
  assert.equal(t.fs.apiCalls(), 3);
  // and if the second try fails too it stops (no endless loop)
  const u = setup({ override: async (url) => (url.includes("graphql") ? { status: 401, body: {} } : null) });
  u.d.db.store.set(PATH, { shop: SHOP, clientId: ID, clientSecret: SECRET, token: "shpat_old_token_1", tokenExpiresAt: NOW.getTime() + 3600000, scope: ["read_orders"], shopName: "Gratiel", connectedAt: "x", verifiedAt: "x", problem: "" });
  const r = await u.call({ action: "check" });
  assert.match(r.problem, /no longer accepts/);
  assert.equal(u.fs.tokenCalls(), 1);
  assert.equal(u.fs.apiCalls(), 2);
});

test("check: a problem is recorded and shown, and the connection is kept so a bad minute doesn't disconnect it", async () => {
  const t = setup();
  await t.call(connectData());
  t.fs.requests.length = 0;
  t.d.fetch = async () => { throw new TypeError("fetch failed"); };
  const out = await t.call({ action: "check" });
  assert.equal(out.connected, true);
  assert.match(out.problem, /Couldn't reach Shopify/);
  assert.equal(out.verifiedAt, NOW.toISOString(), "the last time it was confirmed good is not overwritten");
  assert.equal(t.d.db.store.get(PATH).clientSecret, SECRET, "still connected");
  // later it works again and the problem clears
  t.d.fetch = t.fs.fetch;
  const ok = await t.call({ action: "check" });
  assert.equal(ok.problem, "");

  // credentials that Shopify now refuses, when a new token is due: reported, still kept
  t.clock.t = new Date(NOW.getTime() + 2 * 86400000);
  t.d.fetch = async (url) => (url.endsWith("/access_token") ? reply({ status: 400, body: { error: "invalid_client" } }) : reply({ status: 401, body: {} }));
  const bad = await t.call({ action: "check" });
  assert.match(bad.problem, /didn't accept these credentials/);
  noSecrets(bad);
  assert.equal(t.d.db.store.has(PATH), true);
  assert.deepEqual(await shopify.handle(OWNER, { action: "check" }, Object.assign({}, t.d, { db: fakeDb() })), { connected: false }, "checking with nothing connected just says so");
});

test("disconnect removes the saved credentials and token; doing it twice is fine", async () => {
  const t = setup();
  await t.call(connectData());
  assert.deepEqual(await t.call({ action: "disconnect" }), { connected: false });
  assert.equal(t.d.db.store.size, 0);
  assert.deepEqual(await t.call({ action: "disconnect" }), { connected: false });
  assert.deepEqual(await t.call({ action: "status" }), { connected: false });
  const before = t.fs.requests.length;
  assert.deepEqual(await t.call({ action: "check" }), { connected: false });
  assert.equal(t.fs.requests.length, before, "nothing is sent to Shopify once disconnected");
});

test("only the owner can use it, and nothing is sent anywhere for anyone else", async () => {
  const t = setup();
  for (const action of ["status", "connect", "check", "disconnect"]) {
    await rejects(t.call(connectData({ action }), null), "unauthenticated");
    await rejects(t.call(connectData({ action }), "someone-else"), "permission-denied");
  }
  await rejects(shopify.handle(OWNER, { action: "status" }, Object.assign({}, t.d, { ownerUid: "" })), "failed-precondition");
  assert.equal(t.fs.requests.length, 0);
  assert.equal(t.d.db.store.size, 0);
});

test("the credentials are only ever sent to the store's own address, whatever else is going on", async () => {
  const t = setup();
  await t.call(connectData());
  await t.call({ action: "check" });
  t.clock.t = new Date(NOW.getTime() + 2 * 86400000);
  await t.call({ action: "check" });
  const hosts = new Set(t.fs.requests.map((r) => new URL(r.url).host));
  assert.deepEqual([...hosts], [SHOP]);
  t.fs.requests.forEach((r) => { assert.ok(!r.url.includes(SECRET) && !r.url.includes(ID), "credentials are never put in an address"); });
});

test("the rules file closes the Shopify connection to browsers completely", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "firestore.rules"), "utf8");
  const m = src.match(/match \/shopify\/\{docId\} \{([\s\S]*?)\}/);
  assert.ok(m, "a shopify rule exists");
  assert.match(m[1], /allow read, write: if false;/);
  assert.doesNotMatch(m[1], /request\.auth/, "no browser account can read or write it");
  assert.equal(shopify.connPath("u1"), "users/u1/shopify/connection");
});
