"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../../js/discipline-delivery");

const rem = (o) => Object.assign({ id: "r1", title: "Evening review: score your day", enabled: true, category: "custom", schedule: { type: "daily", times: ["20:30"], days: [], date: null }, timezone: "America/New_York", nextFireAt: "2026-10-28T20:30:00-04:00" }, o || {});
const nudge = { title: "Evening review: score your day", wantedTime: "20:30", what: "evening review time" };
const snap = (mode, extra) => Object.assign({ available: true, signedIn: true, loaded: true, fromCache: false, cachedAt: null, error: "", reminders: [], settings: null, deviceZone: "America/New_York", push: { mode: mode, permission: "granted", ios: true, standalone: true, supported: true, check: null, loaded: true, error: "" } }, extra || {});

test("the four states are kept apart, and 'delivered' is the one only you can know", () => {
  assert.deepEqual(X.STATES.map((s) => s.key), ["saved", "scheduled", "sent", "delivered"]);
  const delivered = X.STATES.filter((s) => s.key === "delivered")[0];
  assert.match(delivered.text, /JARVIS can't see this, only you can/);
  assert.match(X.STATES[0].text, /server confirmed/);
});

test("a suggested reminder is matched by name, ignoring case and spacing", () => {
  assert.equal(X.matchReminder("  evening   REVIEW: score your day ", [rem()]).id, "r1");
  assert.equal(X.matchReminder("Something else", [rem()]), null);
  assert.equal(X.matchReminder("x", null), null);
});

test("nudgeStatus: not checked, not set up, turned off, saved, scheduled, and a time that no longer matches", () => {
  assert.equal(X.nudgeStatus(nudge, null).state, "unknown");
  assert.equal(X.nudgeStatus(nudge, undefined).label, "Not checked yet");
  assert.deepEqual(X.nudgeStatus(nudge, []).state, "none");
  const off = X.nudgeStatus(nudge, [rem({ enabled: false })]);
  assert.deepEqual([off.state, off.label], ["off", "Saved, turned off"]);
  assert.match(off.note, /won't send anything until you turn it on/);
  const saved = X.nudgeStatus(nudge, [rem()]);
  assert.deepEqual([saved.state, saved.scheduled, saved.label, saved.note, saved.mismatch], ["saved", true, "Saved and scheduled", "", false]);
  const noNext = X.nudgeStatus(nudge, [rem({ nextFireAt: null })]);
  assert.deepEqual([noNext.scheduled, noNext.label], [false, "Saved"], "saved is not the same as scheduled");
  const moved = X.nudgeStatus(nudge, [rem({ schedule: { type: "daily", times: ["20:00"], days: [], date: null } })]);
  assert.equal(moved.mismatch, true);
  assert.equal(moved.note, "Saved for 8:00 PM, but your evening review time is 8:30 PM. Edit the reminder if you want them to match.");
  const several = X.nudgeStatus(nudge, [rem({ schedule: { type: "daily", times: ["07:30", "20:30"], days: [], date: null } })]);
  assert.equal(several.mismatch, false, "one of its times being the right one is a match");
});

test("pushStatus says only what is known, and offers an honest alternative when notifications can't work", () => {
  const cases = { "needs-home-screen": ["off", "Needs the Home Screen"], unsupported: ["off", "Not supported here"], denied: ["bad", "Blocked"], "keys-missing": ["off", "Server setup needed"], off: ["off", "Not on yet"] };
  Object.keys(cases).forEach((mode) => {
    const s = X.pushStatus(snap(mode));
    assert.deepEqual([s.cls, s.label], cases[mode], mode);
    assert.equal(s.canTest, false, mode + " can't be tested");
    assert.match(s.alternative, /alarm in the iPhone Clock app/, mode + " offers the alternative");
  });
  const out = X.pushStatus(snap("on", { signedIn: false }));
  assert.equal(out.label, "Signed out", "signed out comes first");
  const on = X.pushStatus(snap("on"));
  assert.deepEqual([on.cls, on.label, on.canTest, on.alternative], ["ok", "On for this phone", true, ""]);
  assert.match(on.text, /hasn't been tested on this phone/, "with no closed-app test it says that plainly");
  assert.doesNotMatch(on.text, /will (arrive|work)|delivered|guarantee/i, "and never promises");
});

test("pushStatus reports the closed-app test result as the person gave it", () => {
  const fmt = (iso) => "on " + iso.slice(0, 10);
  const arrived = X.pushStatus(snap("on", { push: Object.assign(snap("on").push, { check: { result: "arrived", at: "2026-10-20T12:00:00Z" } }) }), fmt);
  assert.match(arrived.text, /You reported on on 2026-10-20 that a closed-app test arrived\./);
  const missing = X.pushStatus(snap("on", { push: Object.assign(snap("on").push, { check: { result: "missing", at: "2026-10-20T12:00:00Z" } }) }), fmt);
  assert.match(missing.text, /did not arrive\. Check Settings → Notifications → JARVIS, Focus modes and Low Power Mode, then test again\./);
});

test("freshness: says where the list of reminders came from", () => {
  assert.equal(X.freshness(snap("on", { available: false })), "Reminders aren't available in this version.");
  assert.equal(X.freshness(snap("on", { signedIn: false })), "Sign in to see your reminders.");
  assert.equal(X.freshness(snap("on", { loaded: false, error: "Couldn't reach the server." })), "Couldn't reach the server.");
  assert.equal(X.freshness(snap("on", { loaded: true, error: "Couldn't reach the server." })), "Couldn't reach the server. What's shown is from the last time it loaded.", "a failed refresh never leaves the old list looking fresh");
  assert.equal(X.freshness(snap("on")), "Checked with your server since JARVIS was opened.");
  assert.match(X.freshness(snap("on", { fromCache: true, loaded: false, cachedAt: "2026-10-20T12:00:00Z" }), (i) => i.slice(0, 10)), /From the copy saved on this phone on 2026-10-20\. Tap “Check now”/);
  assert.match(X.freshness(snap("on", { loaded: false })), /Not checked yet/);
});

test("zoneNote: warns when reminders run on a different time zone from the phone", () => {
  assert.equal(X.zoneNote(snap("on", { settings: { timezone: "America/New_York" } })), "");
  assert.equal(X.zoneNote(snap("on", { settings: null })), "");
  assert.equal(X.zoneNote(snap("on", { settings: { timezone: "America/New_York" }, deviceZone: "" })), "");
  assert.equal(X.zoneNote(snap("on", { settings: { timezone: "America/New_York" }, deviceZone: "America/Los_Angeles" })), "Your reminders run on America/New York time, but this phone is in America/Los Angeles. Change it in Reminders → Settings if you've moved.");
});
