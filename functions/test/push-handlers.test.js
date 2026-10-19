"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../js/push-handlers.js");

const SCOPE = "https://ccrane1109-droid.github.io/Jarvis/";

test("every kind of message, even a broken one, becomes something that can be shown", () => {
  const good = H.parsePush(JSON.stringify({ v: 1, id: "r1_2026", kind: "reminder", title: "  Drink   water ", body: "x".repeat(400), tag: "r1_2026", url: "./index.html?reminder=r1_2026" }));
  assert.deepEqual([good.title, good.body.length, good.tag, good.id, good.kind], ["Drink water", 160, "r1_2026", "r1_2026", "reminder"]);
  const broken = ["", "not json", "null", "[1,2]", "42", '"just text"', "{", undefined, null, JSON.stringify({}), JSON.stringify({ title: 5, body: {}, url: [] })];
  broken.forEach((raw) => {
    const p = H.parsePush(raw);
    assert.ok(typeof p.title === "string" && p.title.length > 0, "a title: " + String(raw));
    assert.ok(typeof p.tag === "string" && p.tag.length > 0, "a tag: " + String(raw));
    assert.ok(typeof p.url === "string" && p.url.length > 0, "a link: " + String(raw));
  });
  assert.equal(H.parsePush("garbage").title, "JARVIS");
  assert.equal(H.parsePush("garbage").body, "You have a reminder.");
  assert.equal(H.parsePush(JSON.stringify({ kind: "weird", title: "t" })).kind, "reminder");
  assert.equal(H.parsePush(JSON.stringify({ kind: "test", title: "t" })).kind, "test");
});

test("the notification carries the title, text, a tag that replaces duplicates, and an icon inside the app", () => {
  const n = H.notificationFor(H.parsePush(JSON.stringify({ id: "abc", title: "Creatine", body: "with water", tag: "abc", url: "./index.html?reminder=abc", kind: "reminder" })), SCOPE);
  assert.equal(n.title, "Creatine");
  assert.deepEqual([n.options.body, n.options.tag, n.options.icon, n.options.badge], ["with water", "abc", SCOPE + "icon-192.png", SCOPE + "icon-192.png"]);
  assert.deepEqual(n.options.data, { url: "./index.html?reminder=abc", id: "abc", kind: "reminder" });
  assert.deepEqual(Object.keys(n.options).sort(), ["badge", "body", "data", "icon", "tag"], "only options every browser understands");
  const fallback = H.notificationFor(H.parsePush(""), SCOPE);
  assert.deepEqual([fallback.title, fallback.options.body, fallback.options.tag], ["JARVIS", "You have a reminder.", "jarvis-reminder"]);
});

test("a tap always goes to a page inside JARVIS, never somewhere else", () => {
  assert.equal(H.targetUrl({ url: "./index.html?reminder=abc" }, SCOPE), SCOPE + "index.html?reminder=abc");
  assert.equal(H.targetUrl({ url: "index.html" }, SCOPE), SCOPE + "index.html");
  const away = [
    "https://evil.example/phish", "//evil.example/x", "https://ccrane1109-droid.github.io/Other/", "https://ccrane1109-droid.github.io.evil.example/Jarvis/",
    "javascript:alert(1)", "data:text/html,hi", "../../other", "/elsewhere"
  ];
  away.forEach((u) => assert.equal(H.targetUrl({ url: u }, SCOPE), SCOPE + "index.html", u));
  assert.equal(H.targetUrl(null, SCOPE), SCOPE + "index.html");
  assert.equal(H.targetUrl({ url: 5 }, SCOPE), SCOPE + "index.html");
});

test("an open JARVIS window is brought forward instead of opening a second one", () => {
  assert.equal(H.appWindow(["https://example.com/", SCOPE + "index.html"], SCOPE), 1);
  assert.equal(H.appWindow([], SCOPE), -1);
  assert.equal(H.appWindow(["https://ccrane1109-droid.github.io/Other/"], SCOPE), -1);
});
