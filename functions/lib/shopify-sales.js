/* ==========================================================================
   JARVIS — Shopify sales snapshot: the arithmetic (pure; no network, no database).

   Takes the orders Shopify returned and works out, for Today / Last 7 days / Last 30 days:
   how many orders, and what they add up to. Plus the 5 most recent orders.

   What it counts, in plain words:
     - Days are calendar days in the time zone it is given (the phone's), so "Today" starts at
       that zone's midnight, even on a day the clocks change.
     - "Last 7 days" and "Last 30 days" include today.
     - Cancelled orders and test orders are left out, and counted separately so the screen can
       say how many were left out.
     - An order's amount is its "current total price" in the store's own currency, as Shopify
       reports it. Nothing is converted. If orders come in more than one currency they are NOT
       added together (the result says so instead of giving a made-up total).
     - Sums are done in whole cents so they don't drift.

   It refuses to guess: an order that is missing its time or its amount is an error, not a zero.
   ========================================================================== */

"use strict";

const { DateTime, IANAZone } = require("luxon");

const PERIODS = [
  { key: "today", label: "Today", days: 1 },
  { key: "last7", label: "Last 7 days", days: 7 },
  { key: "last30", label: "Last 30 days", days: 30 }
];
const MAX_DAYS = 30;          // the longest period; Shopify's default read_orders permission reaches back 60 days
const RECENT = 5;

function validZone(tz) { return typeof tz === "string" && tz.length > 0 && tz.length <= 64 && IANAZone.isValidZone(tz); }

// -> { tz, nowMs, starts: { today, last7, last30 } (ms) }
function windowsFor(nowMs, tz) {
  const zone = validZone(tz) ? tz : "UTC";
  const startOfToday = DateTime.fromMillis(nowMs, { zone: zone }).startOf("day");
  const starts = {};
  PERIODS.forEach(function (p) { starts[p.key] = startOfToday.minus({ days: p.days - 1 }).toMillis(); });
  return { tz: zone, nowMs: nowMs, starts: starts, earliest: starts.last30 };
}

// "123.45" -> 12345 (whole cents). Anything that isn't a plain non-negative decimal -> null.
function toCents(text) {
  if (typeof text !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(text.trim())) return null;
  return Math.round(Number(text.trim()) * 100);
}
function centsText(c) { return (c / 100).toFixed(2); }

// One order as Shopify sent it -> { name, atMs, cancelled, test, cents, currency }, or { error } if a needed part is missing.
function normalizeOrder(node) {
  if (!node || typeof node !== "object") return { error: "an order was empty" };
  const at = typeof node.createdAt === "string" ? Date.parse(node.createdAt) : NaN;
  if (isNaN(at)) return { error: "an order had no creation time" };
  const money = node.currentTotalPriceSet && node.currentTotalPriceSet.shopMoney;
  const cents = money ? toCents(money.amount) : null;
  const currency = money && typeof money.currencyCode === "string" && /^[A-Z]{3}$/.test(money.currencyCode) ? money.currencyCode : "";
  if (cents === null || !currency) return { error: "an order had no readable total" };
  return {
    name: typeof node.name === "string" ? node.name.replace(/[^\x20-\x7e]/g, "").slice(0, 40) : "",
    atMs: at,
    cancelled: !!node.cancelledAt,
    test: node.test === true,
    cents: cents,
    currency: currency
  };
}

// orders: normalized orders (any order), windows: from windowsFor.
// -> { currency, mixedCurrencies, periods: [{ key, label, orders, total|null }], recent: [{ name, at, total }], excluded: { cancelled, test } }
function summarize(orders, windows) {
  const excluded = { cancelled: 0, test: 0 };
  const counted = [];
  orders.forEach(function (o) {
    if (o.atMs < windows.earliest || o.atMs > windows.nowMs + 60000) return;     // outside the 30 days (a minute of slack for clocks)
    if (o.cancelled) { excluded.cancelled++; return; }
    if (o.test) { excluded.test++; return; }
    counted.push(o);
  });
  const currencies = {};
  counted.forEach(function (o) { currencies[o.currency] = true; });
  const codes = Object.keys(currencies);
  const mixed = codes.length > 1;
  const periods = PERIODS.map(function (p) {
    const inside = counted.filter(function (o) { return o.atMs >= windows.starts[p.key]; });
    return { key: p.key, label: p.label, orders: inside.length, total: mixed ? null : centsText(inside.reduce(function (s, o) { return s + o.cents; }, 0)) };
  });
  const recent = counted.slice().sort(function (a, b) { return b.atMs - a.atMs; }).slice(0, RECENT).map(function (o) {
    return { name: o.name, at: new Date(o.atMs).toISOString(), total: centsText(o.cents), currency: o.currency };
  });
  return { currency: mixed ? "" : (codes[0] || ""), mixedCurrencies: mixed, periods: periods, recent: recent, excluded: excluded };
}

module.exports = { PERIODS, MAX_DAYS, RECENT, validZone, windowsFor, toCents, centsText, normalizeOrder, summarize };
