"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calendar-logic.js");
const K = require("../../js/content-logic.js");

const idea = (o) => Object.assign({ id: "i" + Math.random().toString(36).slice(2, 7), title: "Teaser", platform: "tiktok", status: "idea", priority: "medium", plannedDate: "", plannedTime: "" }, o);

test("stages: the six, and old values shown as the nearest one", () => {
  assert.deepEqual(K.STAGES.map((s) => s.value), ["idea", "script", "filming", "editing", "scheduled", "published"]);
  assert.equal(K.stageOf("draft"), "idea");
  assert.equal(K.stageOf("ready"), "filming");
  assert.equal(K.stageOf("filmed"), "editing");
  assert.equal(K.stageOf("posted"), "published");
  assert.equal(K.stageOf("Script"), "script", "case does not matter");
  assert.equal(K.stageOf("editing"), "editing");
  assert.equal(K.stageOf(undefined), "idea");
  assert.equal(K.stageOf("something odd"), "idea", "an unknown value is an Idea, not an error");
  assert.equal(K.stageLabel("ready"), "Filming");
  assert.equal(K.stageRank("published"), 5);
  assert.equal(K.platformLabel("youtube"), "YouTube Shorts");
  assert.equal(K.platformLabel("nonsense"), "Instagram + TikTok");
});

test("ideas with a planned date become calendar items, and only those", () => {
  const ideas = [
    idea({ id: "a", title: "Hoodie teaser", plannedDate: "2026-11-06", plannedTime: "18:30", status: "scheduled", priority: "high", platform: "instagram" }),
    idea({ id: "b", title: "Behind the scenes", plannedDate: "2026-11-07", status: "ready" }),
    idea({ id: "c", title: "Posted already", plannedDate: "2026-11-05", status: "posted" }),
    idea({ id: "d", title: "No date" }),
    idea({ id: "e", title: "Out of range", plannedDate: "2026-12-30" }),
    idea({ id: "f", title: "  ", plannedDate: "2026-11-06" }),
    idea({ id: "g", title: "Bad date", plannedDate: "soon" }), null, 7
  ];
  const items = K.ideaItems(ideas, "2026-11-01", "2026-11-30");
  assert.deepEqual(items.map((i) => i.id).sort(), ["a", "b", "c"]);
  const a = items.find((i) => i.id === "a");
  assert.deepEqual([a.source, a.kind, a.category, a.allDay, a.time, a.endTime, a.startMin, a.stage, a.platformLabel, a.priority, a.key], ["idea", "content", "content", false, "18:30", "19:00", 1110, "scheduled", "Instagram", "high", "idea:a"]);
  const b = items.find((i) => i.id === "b");
  assert.deepEqual([b.allDay, b.stage, b.stageLabel, b.completed], [true, "filming", "Filming", false], "an old 'Ready to film' shows as Filming");
  assert.equal(items.find((i) => i.id === "c").completed, true, "Published is done");
  assert.equal(a.point, true);
  assert.deepEqual(K.ideaItems(null, "2026-11-01", "2026-11-30"), []);
});

test("the pipeline counts every idea once, by stage", () => {
  const p = K.pipeline([idea({ status: "idea" }), idea({ status: "draft" }), idea({ status: "script" }), idea({ status: "posted" }), idea({ status: "scheduled" }), idea({ title: "" }), null]);
  assert.equal(p.total, 5);
  assert.deepEqual(p.counts, { idea: 2, script: 1, filming: 0, editing: 0, scheduled: 1, published: 1 });
  assert.equal(p.byStage.idea.length, 2);
  assert.deepEqual(K.pipeline(undefined).counts, { idea: 0, script: 0, filming: 0, editing: 0, scheduled: 0, published: 0 });
});

test("ideas waiting for a date: not published, no date, furthest along first", () => {
  const list = [
    idea({ id: "1", title: "Zebra idea", status: "idea", priority: "high" }),
    idea({ id: "2", title: "Edited reel", status: "editing" }),
    idea({ id: "3", title: "Done", status: "published" }),
    idea({ id: "4", title: "Has a date", status: "script", plannedDate: "2026-11-09" }),
    idea({ id: "5", title: "Script a", status: "script", priority: "low" }),
    idea({ id: "6", title: "Script b", status: "script", priority: "high" })
  ];
  assert.deepEqual(K.needsDate(list).map((i) => i.id), ["2", "6", "5", "1"]);
});

test("giving an idea a day: what is saved, and what is refused", () => {
  assert.deepEqual(K.schedulePatch({ date: "2026-11-06", time: "18:30", status: "scheduled" }), { ok: true, patch: { plannedDate: "2026-11-06", plannedTime: "18:30", status: "scheduled" } });
  assert.deepEqual(K.schedulePatch({ date: "2026-11-06" }), { ok: true, patch: { plannedDate: "2026-11-06", plannedTime: "" } });
  assert.match(K.schedulePatch({ date: "nope" }).error, /day/);
  assert.match(K.schedulePatch({ date: "2026-11-06", time: "25:00" }).error, /time/);
  assert.match(K.schedulePatch({ date: "2026-11-06", status: "viral" }).error, /stage/);
  assert.deepEqual(K.unschedulePatch(), { plannedDate: "", plannedTime: "" });
  const a = idea({ plannedDate: "2026-11-06", plannedTime: "18:30" });
  assert.deepEqual(K.movePatch(a, { date: "2026-11-08" }).patch, { plannedDate: "2026-11-08", plannedTime: "18:30" }, "dragging to a day keeps the time");
  assert.deepEqual(K.movePatch(a, { date: "2026-11-08", time: "09:00" }).patch, { plannedDate: "2026-11-08", plannedTime: "09:00" });
  assert.equal(K.movePatch(a, { date: "x" }).ok, false);
});

test("ticking a content item means it was posted; unticking puts it back to Scheduled", () => {
  assert.deepEqual(K.donePatch(idea({ status: "scheduled" }), true), { status: "published" });
  assert.deepEqual(K.donePatch(idea({ status: "published" }), false), { status: "scheduled" });
  assert.deepEqual(K.donePatch(idea({ status: "editing" }), false), { status: "editing" }, "unticking something not yet posted changes nothing");
});

test("a batch filming session: one calendar block that lists the ideas", () => {
  const ideas = [idea({ id: "a", title: "Hoodie teaser", platform: "tiktok" }), idea({ id: "b", title: "Cap reveal", platform: "youtube" })];
  const r = K.batchInput(ideas, { date: "2026-11-07", time: "10:00", minutes: 120 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.input.title, r.input.kind, r.input.category, r.input.date, r.input.time, r.input.endTime], ["Batch filming (2 ideas)", "block", "content", "2026-11-07", "10:00", "12:00"]);
  assert.equal(r.input.description, "• Hoodie teaser (TikTok)\n• Cap reveal (YouTube Shorts)");
  assert.deepEqual(r.input.linked, { type: "batch", id: "a", ids: ["a", "b"] });
  // and the calendar accepts it as is
  let n = 0;
  const added = C.add([], r.input, { now: 1, zone: "America/New_York", makeId: () => "ev" + (++n) });
  assert.equal(added.ok, true, added.error);
  assert.deepEqual(added.event.linked, { type: "batch", id: "a", ids: ["a", "b"] }, "the calendar keeps every idea id");
  assert.equal(K.batchInput([ideas[0]], { date: "2026-11-07", time: "10:00", minutes: 60 }).input.title, "Film: Hoodie teaser");
  assert.match(K.batchInput([], { date: "2026-11-07", time: "10:00", minutes: 60 }).error, /at least one/);
  assert.match(K.batchInput(ideas, { date: "x", time: "10:00", minutes: 60 }).error, /day/);
  assert.match(K.batchInput(ideas, { date: "2026-11-07", time: "", minutes: 60 }).error, /start time/);
  assert.match(K.batchInput(ideas, { date: "2026-11-07", time: "10:00", minutes: 10 }).error, /30 minutes/);
  assert.match(K.batchInput(ideas, { date: "2026-11-07", time: "22:30", minutes: 120 }).error, /midnight/);
  const many = Array.from({ length: 21 }, (_, i) => idea({ id: "m" + i }));
  assert.match(K.batchInput(many, { date: "2026-11-07", time: "10:00", minutes: 60 }).error, /20/);
});

test("the calendar keeps up to 20 linked ids and drops junk", () => {
  const ids = Array.from({ length: 25 }, (_, i) => "id" + i).concat([5, "", "id1"]);
  const r = C.check({ title: "x", date: "2026-11-04", time: "10:00", linked: { type: "batch", id: "id0", ids: ids } }, { zone: "America/New_York" });
  assert.equal(r.ok, true);
  assert.equal(r.event.linked.ids.length, 20);
  assert.equal(new Set(r.event.linked.ids).size, 20, "no repeats");
  assert.equal(C.check({ title: "x", date: "2026-11-04", time: "10:00", linked: { type: "idea", id: "a" } }, {}).event.linked.ids, undefined);
});

// A fixed set of posts: one account whose Tuesday-evening posts do well, plus noise.
function posts(n, hourOf, viewsOf, author, platform) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const hour = hourOf(i), day = 1 + (i % 28);
    out.push({ author: author || "acct", platform: platform || "tiktok", views: viewsOf(i), publishedAt: new Date(Date.UTC(2026, 9, day, hour + 4, 0)).toISOString() });   // +4: New York is UTC-4 in October
  }
  return out;
}

test("best times to post: only when there are enough real posts, and only windows that beat the account's own usual", () => {
  const NY = "America/New_York";
  const few = K.bestPostingTimes(posts(10, () => 18, () => 1000), { zone: NY });
  assert.deepEqual(few, { ok: false, reason: "not-enough", have: 10, need: 30 });
  assert.deepEqual(K.bestPostingTimes([], { zone: NY }), { ok: false, reason: "not-enough", have: 0, need: 30 });
  assert.equal(K.bestPostingTimes(null, {}).ok, false);
  // 60 posts by one account: evening (18-21) posts get 3x the views, morning (6-9) posts get 1x, afternoon gets 0.5x
  const list = posts(60, (i) => [7, 13, 19][i % 3], (i) => [1000, 500, 3000][i % 3]);
  const r = K.bestPostingTimes(list, { zone: NY });
  assert.equal(r.ok, true);
  assert.equal(r.have, 60);
  assert.equal(r.accounts, 1);
  assert.equal(r.best.length, 1, "only the window that beat the account's usual is suggested");
  assert.deepEqual([r.best[0].startHour, r.best[0].label, r.best[0].posts], [18, "6–9 PM", 20]);
  assert.equal(r.best[0].lift, 3, "its posts got three times the account's median views");
  assert.equal(r.windows.length, 3, "windows with too few posts are left out");
  // times are shown in the zone asked for
  const tokyo = K.bestPostingTimes(list, { zone: "Asia/Tokyo" });
  assert.notEqual(tokyo.best[0].startHour, 18);
});

test("best times to post: ignores what cannot be trusted", () => {
  const NY = "America/New_York";
  const junk = [
    { author: "a", platform: "tiktok", views: 0, publishedAt: "2026-10-05T12:00:00Z" },
    { author: "a", platform: "tiktok", views: 100, publishedAt: "not a date" },
    { author: "", platform: "tiktok", views: 100, publishedAt: "2026-10-05T12:00:00Z" },
    { author: "a", platform: "tiktok", views: "lots", publishedAt: "2026-10-05T12:00:00Z" }, null, 5
  ];
  assert.deepEqual(K.bestPostingTimes(junk, { zone: NY, minPosts: 1 }), { ok: false, reason: "not-enough", have: 0, need: 1 });
  // an account with only two posts is not enough to know what is typical for it
  const two = posts(2, () => 12, () => 500, "tiny");
  assert.equal(K.bestPostingTimes(two, { zone: NY, minPosts: 1 }).ok, false);
  // a giant account does not drown a small one: each is compared with itself
  const mixed = posts(30, (i) => [7, 19][i % 2], (i) => [1000000, 3000000][i % 2], "giant").concat(posts(30, (i) => [7, 19][i % 2], (i) => [10, 30][i % 2], "small"));
  const r = K.bestPostingTimes(mixed, { zone: NY });
  assert.equal(r.accounts, 2);
  assert.equal(r.best[0].startHour, 18);
  // author may be an object
  const objs = posts(30, (i) => [7, 19][i % 2], (i) => [100, 300][i % 2]).map((p) => Object.assign({}, p, { author: { username: "Acct" } }));
  assert.equal(K.bestPostingTimes(objs, { zone: NY }).ok, true);
});
