"use strict";

// The Overview's numbers come from js/marketing-stats.js; these tests pin down
// that each one is calculated from real fields and left empty when it can't be.

const test = require("node:test");
const assert = require("node:assert/strict");
const stats = require("../../js/marketing-stats.js");

const NOW = new Date("2026-10-16T12:00:00Z");
const post = (id, over) => Object.assign({ id, url: null, text: "t", author: "a", views: 1000, likes: 100, comments: 10, shares: 5, publishedAt: "2026-10-10T00:00:00.000Z" }, over || {});
const src = (platform, label, status, items) => ({ platform, label, status, items: items || [] });

test("engagement rate is (likes + comments + shares) / views, from reported counts only", () => {
  assert.equal(stats.engagementRate(post("1")), 0.115);
  assert.equal(stats.engagementRate(post("2", { comments: null, shares: null })), 0.1, "missing counts aren't treated as zero");
  assert.equal(stats.engagementRate(post("3", { likes: null, comments: null, shares: null })), null, "nothing reported");
  assert.equal(stats.engagementRate(post("4", { views: null })), null, "no view count");
  assert.equal(stats.engagementRate(post("5", { views: 99 })), null, "too few views to be meaningful");
  assert.equal(stats.engagementRate(post("6", { views: 100, likes: 10, comments: 0, shares: 0 })), 0.1);
  assert.equal(stats.engagementRate(null), null);
  assert.equal(stats.formatRate(0.115), "11.5%");
  assert.equal(stats.formatRate(null), "—");
});

test("posts seen in several searches are counted once per platform", () => {
  const run = { sources: [
    src("tiktok", "a", "completed", [post("t1"), post("t2")]),
    src("tiktok", "b", "cached", [post("t1"), post("t3")]),
    src("instagram", "#x", "completed", [post("t1")]) // same id, different platform: a different post
  ] };
  const posts = stats.uniquePosts(run);
  assert.deepEqual(posts.map((p) => p.platform + ":" + p.item.id), ["tiktok:t1", "tiktok:t2", "tiktok:t3", "instagram:t1"]);
  assert.equal(stats.uniquePosts(null).length, 0);
  assert.equal(stats.uniquePosts({ sources: [{ platform: "tiktok", items: [null, { nope: 1 }, { id: 5 }] }] }).length, 0);
});

test("run stats: counts, freshness, engagement and top posts", () => {
  const run = {
    finishedAt: "2026-10-16T09:00:00Z", trigger: "manual", creditsUsed: 60,
    sources: [
      src("tiktok", "a", "completed", [
        post("t1", { views: 1200000, likes: 120000, comments: 0, shares: 0, publishedAt: "2026-10-15T00:00:00Z" }),
        post("t2", { views: 5000, likes: 50, comments: 0, shares: 0, publishedAt: "2026-07-01T00:00:00Z" }),
        post("t3", { views: null, likes: null, comments: null, shares: null, publishedAt: null })
      ]),
      src("instagram", "#x", "completed", [post("i1", { views: null }), post("i2", { views: null }), post("i3", { views: null })]),
      src("tiktok", "c", "failed", []),
      src("instagram", "#y", "unavailable", [])
    ]
  };
  const s = stats.runStats(run, NOW);
  assert.equal(s.posts, 6);
  assert.deepEqual(s.byPlatform, { instagram: 3, tiktok: 3 });
  assert.equal(s.rated, 2);
  assert.ok(Math.abs(s.avgRate - (0.1 + 0.01) / 2) < 1e-9);
  assert.ok(Math.abs(s.medianRate - 0.055) < 1e-9);
  assert.equal(s.dated, 5);
  assert.equal(s.fresh, 4, "t1 and the three Instagram posts from Oct 10");
  assert.equal(s.newestDays, 1);
  assert.equal(s.oldestDays, 107);
  assert.deepEqual(s.topByViews.map((p) => p.item.id), ["t1", "t2"]);
  assert.deepEqual(s.searches, { total: 4, ok: 2, failed: 1, skipped: 1 });
  assert.equal(s.creditsUsed, 60);
  assert.equal(s.trigger, "manual");
  assert.equal(stats.runStats(null, NOW), null);
  assert.equal(stats.runStats({}, NOW), null);
});

test("sentences say only what the numbers show", () => {
  const run = { finishedAt: "2026-10-16T09:00:00Z", sources: [
    src("tiktok", "a", "completed", [post("t1", { views: 2000, likes: 200, comments: 0, shares: 0 })]),
    src("instagram", "#x", "completed", [post("i1", { views: null }), post("i2", { views: null }), post("i3", { views: null })]),
    src("tiktok", "c", "failed", [])
  ] };
  const lines = stats.describeRun(stats.runStats(run, NOW));
  const text = lines.join(" | ");
  assert.match(text, /2 searches of 3 returned results: 4 posts \(1 TikTok, 3 Instagram\)\. 1 search failed\./);
  assert.match(text, /4 of 4 posts with a date were published in the last 30 days\. The newest is 6 days old/);
  assert.match(text, /Average engagement rate is 10\.0% \(typical post 10\.0%\) across 1 post that report at least 100 views/);
  assert.match(text, /Most Instagram posts here don't report views/);
  assert.ok(!/TikTok posts here don't report/.test(text));
});

test("no posts, no dates and no views are each said plainly, with nothing invented", () => {
  assert.deepEqual(stats.describeRun(null), []);
  const empty = stats.describeRun(stats.runStats({ sources: [src("tiktok", "a", "completed", [])] }, NOW));
  assert.equal(empty.length, 1);
  assert.match(empty[0], /returned no posts/);
  const bare = stats.describeRun(stats.runStats({ sources: [src("tiktok", "a", "completed", [post("x", { views: null, publishedAt: null })])] }, NOW)).join(" ");
  assert.match(bare, /None of these posts included a publish date/);
  assert.match(bare, /Engagement rate needs view counts/);
  assert.ok(!/Average engagement rate is/.test(bare));
});
