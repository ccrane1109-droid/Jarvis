/* ==========================================================================
   JARVIS — Shopify store connection (owner only, server side).

   What it does: lets the owner connect their own Shopify store, checks that the connection works, and
   removes it. It reads one fact from the store (its name) to prove the connection is real. It does not
   read orders, products or customers, and it never writes anything to the store.

   Why it lives on the server: Shopify does not allow browsers to call its Admin API, and the credentials
   must never sit in the page. The page sends the store address, Client ID and Client Secret here once;
   they are kept in a part of the database that browsers cannot read (see firestore.rules), and the page
   only ever gets back the store's name and address, the permissions Shopify granted, and times.

   How it connects (Shopify "client credentials grant", for an app made in the Dev Dashboard by the same
   organization that owns the store): POST the Client ID and Client Secret to
   https://{store}.myshopify.com/admin/oauth/access_token and receive an access token that lasts about
   24 hours, plus the list of permissions ("scope") the store granted. A new token is requested when the
   old one is close to expiring. Facts from Shopify's documentation (shopify.dev, "Access tokens"); this
   file has been tested against a stand-in for Shopify, not against a real store.

   Firestore (written only by the server):
     users/{uid}/shopify/connection   { shop, clientId, clientSecret, token, tokenExpiresAt, scope,
                                        shopName, connectedAt, verifiedAt, problem }

   Safety rules enforced here:
     - the server makes requests only to https://<handle>.myshopify.com (checked with a strict pattern,
       no redirects followed), because it will contact whatever address it is given;
     - nothing secret (Client Secret, token) is ever returned, logged, or put in an error message,
       including when Shopify echoes it back;
     - a failed attempt to connect saves nothing and leaves an existing working connection alone.
   ========================================================================== */

"use strict";

const errors = require("./errors");

const API_VERSION = "2026-10";           // Shopify's latest stable Admin API version at the time of writing (supported 12+ months)
const TIMEOUT_MS = 10000;
const MAX_BODY_CHARS = 200000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;  // ask for a new token when fewer than 5 minutes are left
const FALLBACK_LIFETIME_MS = 60 * 60 * 1000; // if Shopify doesn't say how long a token lasts, assume one hour
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const FIELD_MAX = 300;

const connPath = (uid) => "users/" + uid + "/shopify/connection";
const SHOP_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?\.myshopify\.com$/;
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/;
const CRED_RE = /^[\x21-\x7e]{8,200}$/;       // printable ASCII, no spaces

function fail(code, message) { return new errors.ServerError(code, message); }

/* ---------------- inputs ---------------- */

// "gratiel", "gratiel.myshopify.com", "https://gratiel.myshopify.com/admin" and "https://admin.shopify.com/store/gratiel"
// all mean the same store. Anything that is not exactly <handle>.myshopify.com afterwards is refused.
// -> { ok: true, shop: "gratiel.myshopify.com" } | { ok: false, reason }
function normalizeShop(input) {
  if (typeof input !== "string") return { ok: false, reason: "Enter your store's address, like your-store.myshopify.com." };
  let s = input.trim().toLowerCase();
  if (!s || s.length > FIELD_MAX) return { ok: false, reason: "Enter your store's address, like your-store.myshopify.com." };
  s = s.replace(/^https?:\/\//, "");
  const cut = s.search(/[/?#]/);
  const host = cut === -1 ? s : s.slice(0, cut);
  const path = cut === -1 ? "" : s.slice(cut);
  let shop = "";
  if (host === "admin.shopify.com") {
    const m = /^\/store\/([a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?)(?:[/?#]|$)/.exec(path);
    if (m) shop = m[1] + ".myshopify.com";
  } else if (HANDLE_RE.test(host)) {
    shop = host + ".myshopify.com";
  } else {
    shop = host;
  }
  if (!SHOP_RE.test(shop)) {
    return { ok: false, reason: "That doesn't look like a Shopify store address. It should end in .myshopify.com (for example your-store.myshopify.com), not your own website's address." };
  }
  return { ok: true, shop: shop };
}

function checkCredential(value, label) {
  if (typeof value !== "string" || !CRED_RE.test(value.trim())) return { ok: false, reason: label + " is missing or isn't the right shape. Copy it again in full, with nothing before or after it." };
  return { ok: true, value: value.trim() };
}

/* ---------------- talking to Shopify ---------------- */

// One request with a time limit and no redirects. -> { status, text }; throws a ServerError if Shopify can't be reached.
async function request(deps, url, init) {
  const ms = deps.timeoutMs || TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, ms);
  try {
    const res = await (deps.fetch || fetch)(url, Object.assign({}, init, { signal: ctrl.signal, redirect: "error" }));
    const text = String(await res.text()).slice(0, MAX_BODY_CHARS);
    return { status: res.status, text: text };
  } catch (err) {
    if (err instanceof errors.ServerError) throw err;
    const timedOut = err && (err.name === "AbortError" || err.name === "TimeoutError");
    throw fail("unavailable", timedOut ? "Shopify didn't answer in time. Try again in a minute." : "Couldn't reach Shopify. Check the connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }

// Words from Shopify, made safe to show: only plain printable text, short, and never containing the credentials.
function safeText(value, secrets) {
  let s = typeof value === "string" ? value : "";
  (secrets || []).forEach(function (x) { if (x && x.length >= 4) s = s.split(x).join("***"); });
  s = s.replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

function statusProblem(status, body, secrets) {
  const json = parseJson(body);
  const code = json && typeof json.error === "string" ? safeText(json.error, secrets) : "";
  const desc = json && typeof json.error_description === "string" ? safeText(json.error_description, secrets) : "";
  const said = [code, desc].filter(Boolean).join(": ");
  if (/shop_not_permitted/.test(code) || /shop_not_permitted/.test(String(body))) {
    return fail("failed-precondition", "Shopify says this app can't be used with this store (shop_not_permitted). The app must be created by the same Shopify organization that owns the store, and installed on it.");
  }
  if (status === 429 || status >= 500) return fail("unavailable", "Shopify is busy or having trouble right now (it answered " + status + "). Try again in a minute.");
  if (status === 404) return fail("not-found", "Shopify has no store at that address (it answered 404). Check the address.");
  return fail("failed-precondition", "Shopify didn't accept these credentials (it answered " + status + (said ? ": " + said : "") + "). Check that the Client ID and Client Secret are copied in full, that the app is installed on this store, and that the store and the app belong to the same Shopify organization.");
}

// -> { token, scope: [names], expiresAt (ms) }
async function exchangeToken(shop, clientId, clientSecret, deps) {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString();
  const res = await request(deps, "https://" + shop + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body
  });
  if (res.status !== 200) throw statusProblem(res.status, res.text, [clientId, clientSecret]);
  const json = parseJson(res.text);
  const token = json && json.access_token;
  if (typeof token !== "string" || !/^[\x21-\x7e]{8,500}$/.test(token)) throw fail("failed-precondition", "Shopify answered, but not with an access token. Check the Client ID and Client Secret.");
  const lifetime = Number.isFinite(json.expires_in) && json.expires_in > 0 ? Math.min(json.expires_in * 1000, MAX_LIFETIME_MS) : FALLBACK_LIFETIME_MS;
  return { token: token, scope: parseScope(json.scope), expiresAt: deps.now().getTime() + lifetime };
}

function parseScope(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return /^[a-z_]{3,60}$/.test(s); }).slice(0, 80);
}

// Reads the store's name, which proves the token works. -> { status: "ok", name } | { status: "unauthorized" }; throws a ServerError otherwise.
async function readShopName(shop, token, deps) {
  const res = await request(deps, "https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: "{ shop { name } }" })
  });
  if (res.status === 401) return { status: "unauthorized" };
  if (res.status !== 200) throw statusProblem(res.status, res.text, [token]);
  const json = parseJson(res.text);
  if (json && Array.isArray(json.errors) && json.errors.length) {
    const first = json.errors[0];
    throw fail("failed-precondition", "Shopify answered, but refused the request: " + (safeText(first && first.message, [token]) || "no reason given") + ".");
  }
  const name = json && json.data && json.data.shop && json.data.shop.name;
  if (typeof name !== "string" || !name.trim()) throw fail("failed-precondition", "Shopify answered, but didn't say the store's name. Try again.");
  return { status: "ok", name: safeText(name, [token]).slice(0, 100) };
}

/* ---------------- what the page may see ---------------- */

// Only these fields ever leave the server. The Client Secret and the token are never in here.
function publicStatus(c) {
  if (!c) return { connected: false };
  const scopes = Array.isArray(c.scope) ? c.scope : [];
  return {
    connected: true,
    shop: c.shop,
    shopName: c.shopName || "",
    scopes: scopes,
    readOnly: scopes.length > 0 && scopes.every(function (s) { return s.indexOf("read_") === 0; }),
    connectedAt: c.connectedAt || null,
    verifiedAt: c.verifiedAt || null,
    problem: c.problem || ""
  };
}

async function load(uid, deps) {
  const snap = await deps.db.doc(connPath(uid)).get();
  return snap.exists ? snap.data() : null;
}

/* ---------------- actions ---------------- */

async function connect(uid, data, deps) {
  const shop = normalizeShop(data.shop);
  if (!shop.ok) throw fail("invalid-argument", shop.reason);
  const id = checkCredential(data.clientId, "The Client ID");
  if (!id.ok) throw fail("invalid-argument", id.reason);
  const secret = checkCredential(data.clientSecret, "The Client Secret");
  if (!secret.ok) throw fail("invalid-argument", secret.reason);

  const t = await exchangeToken(shop.shop, id.value, secret.value, deps);
  const name = await readShopName(shop.shop, t.token, deps);
  if (name.status !== "ok") throw fail("failed-precondition", "Shopify gave a token but then wouldn't accept it. Try again in a minute.");

  const nowIso = deps.now().toISOString();
  const doc = {
    shop: shop.shop, clientId: id.value, clientSecret: secret.value,
    token: t.token, tokenExpiresAt: t.expiresAt, scope: t.scope,
    shopName: name.name, connectedAt: nowIso, verifiedAt: nowIso, problem: ""
  };
  await deps.db.doc(connPath(uid)).set(doc);
  return publicStatus(doc);
}

// Makes sure there is a token that is not about to expire; -> the (possibly updated) connection, saved when it changed.
async function freshToken(uid, conn, deps, force) {
  const soon = deps.now().getTime() + REFRESH_MARGIN_MS;
  if (!force && conn.token && Number.isFinite(conn.tokenExpiresAt) && conn.tokenExpiresAt > soon) return conn;
  const t = await exchangeToken(conn.shop, conn.clientId, conn.clientSecret, deps);
  const next = Object.assign({}, conn, { token: t.token, tokenExpiresAt: t.expiresAt, scope: t.scope });
  await deps.db.doc(connPath(uid)).set(next);
  return next;
}

// Looks again at the store. A problem is recorded and returned (the connection is kept, so a bad minute at Shopify
// doesn't disconnect anything); only "Disconnect" removes it.
async function check(uid, deps) {
  const conn = await load(uid, deps);
  if (!conn) return { connected: false };
  const nowIso = deps.now().toISOString();
  try {
    let c = await freshToken(uid, conn, deps, false);
    let name = await readShopName(c.shop, c.token, deps);
    if (name.status === "unauthorized") {
      c = await freshToken(uid, c, deps, true);
      name = await readShopName(c.shop, c.token, deps);
    }
    if (name.status !== "ok") throw fail("failed-precondition", "Shopify no longer accepts this connection. Disconnect and connect again.");
    const next = Object.assign({}, c, { shopName: name.name, verifiedAt: nowIso, problem: "" });
    await deps.db.doc(connPath(uid)).set(next);
    return publicStatus(next);
  } catch (err) {
    if (!(err instanceof errors.ServerError)) throw err;
    const latest = (await load(uid, deps)) || conn;
    const next = Object.assign({}, latest, { problem: err.message });
    await deps.db.doc(connPath(uid)).set(next);
    return publicStatus(next);
  }
}

async function disconnect(uid, deps) {
  await deps.db.doc(connPath(uid)).delete();
  return { connected: false };
}

const ACTIONS = ["status", "connect", "check", "disconnect"];

// deps: { db, ownerUid, now, log, fetch?, timeoutMs? }
async function handle(uid, data, deps) {
  errors.requireOwner(uid, deps);
  const d = data || {};
  switch (d.action) {
    case "status": return publicStatus(await load(uid, deps));
    case "connect": return connect(uid, d, deps);
    case "check": return check(uid, deps);
    case "disconnect": return disconnect(uid, deps);
    default: throw fail("invalid-argument", "Unknown Shopify action.");
  }
}

module.exports = { handle, normalizeShop, publicStatus, parseScope, safeText, ACTIONS, API_VERSION, REFRESH_MARGIN_MS, connPath };
