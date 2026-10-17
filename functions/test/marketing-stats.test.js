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

/* ---------------- relevance, duplicates, filters, sorting ---------------- */

const KW = ["Christian streetwear", "Premium streetwear", "Clothing brand marketing", "Fashion storytelling"];

test("relevance is a caption-to-keyword match: exact phrase 100, partial by share of words, null without a caption", () => {
  const rel = (t) => stats.keywordRelevance(t, KW);
  assert.deepEqual(rel("New Christian streetwear drop is live"), { score: 100, matched: ["Christian streetwear"] });
  assert.equal(rel("Dropping our #christianstreetwear collection").score, 100, "a hashtag of the phrase counts");
  assert.deepEqual(rel("premium coffee roasters"), { score: 50, matched: [] }, "one of two words is below the bar");
  assert.equal(rel("Clothing and brand building tips").score, 67, "two of three words");
  assert.deepEqual(rel("Clothing and brand building tips").matched, ["Clothing brand marketing"]);
  assert.deepEqual(rel("my dog at the beach"), { score: 0, matched: [] });
  assert.equal(rel(""), null);
  assert.equal(rel(null), null);
  assert.equal(rel("   "), null);
  assert.deepEqual(stats.keywordRelevance("anything", []), { score: 0, matched: [] }, "no keywords, nothing to match");
  assert.equal(stats.keywordRelevance("premium streetwear", KW).matched.length, 1);
  assert.equal(stats.RELEVANT_MIN, 60);
});

test("posts with the same caption are duplicates: the most viewed leads, the rest point at it", () => {
  const list = [
    { key: "tiktok_1", id: "1", text: "Faith over fear. New hoodie drop! #gratiel https://x.co/a", views: 500 },
    { key: "tiktok_2", id: "2", text: "faith over fear — new hoodie drop @someone", views: 9000 },
    { key: "tiktok_3", id: "3", text: "Faith over fear. New hoodie drop!", views: null },
    { key: "tiktok_4", id: "4", text: "Short", views: 1 },
    { key: "tiktok_5", id: "5", text: "Short", views: 2 },
    { key: "tiktok_6", id: "6", text: "", views: 3 }
  ];
  const out = stats.enrich(list, KW, NOW);
  assert.deepEqual(out.map((p) => p.dupOf), ["tiktok_2", null, "tiktok_2", null, null, null]);
  assert.equal(stats.captionKey("Short"), null, "captions under 12 characters aren't compared");
  assert.equal(stats.captionKey("Faith over fear. New hoodie drop! #gratiel"), "faith over fear new hoodie drop");
});

test("enrich adds rate, age and relevance without inventing any", () => {
  const [a, b] = stats.enrich([
    { key: "tiktok_1", id: "1", text: "Christian streetwear", views: 1000, likes: 100, comments: 10, shares: 5, publishedAt: "2026-10-10T00:00:00.000Z" },
    { key: "tiktok_2", id: "2", text: "", views: null, likes: null, comments: null, shares: null, publishedAt: null }
  ], KW, NOW);
  assert.deepEqual([a.rate, a.age, a.relevance], [0.115, 6, 100]);
  assert.deepEqual([b.rate, b.age, b.relevance, b.matched], [null, null, null, []]);
});

const lib = () => stats.enrich([
  { key: "tiktok_1", id: "1", platform: "tiktok", text: "Christian streetwear lookbook", author: "gratiel", views: 50000, likes: 5000, comments: 100, shares: 50, publishedAt: "2026-10-12T00:00:00.000Z", queries: ["Christian streetwear"], sessions: ["s1"], bookmarked: true },
  { key: "tiktok_2", id: "2", platform: "tiktok", text: "My morning coffee routine", author: "barista", views: 900000, likes: 100, comments: 1, shares: 0, publishedAt: "2026-10-14T00:00:00.000Z", queries: ["Premium streetwear"], sessions: ["s1", "s2"] },
  { key: "instagram_3", id: "3", platform: "instagram", text: "Premium streetwear essentials for fall", author: "fitcheck", views: 1200, likes: 300, comments: 20, shares: null, publishedAt: "2024-01-01T00:00:00.000Z", queries: ["#premiumstreetwear"], sessions: ["s2"] },
  { key: "instagram_4", id: "4", platform: "instagram", text: "No date or numbers here, just Christian streetwear", author: null, views: null, likes: null, comments: null, shares: null, publishedAt: null, queries: [], sessions: ["s2"] }
], KW, NOW);
const keys = (r) => r.posts.map((p) => p.key);
const base = { platform: "all", days: 0, minViews: 0, minRate: 0, relevantOnly: false, bookmarkedOnly: false, hideDupes: false, search: "", session: "" };

test("filters combine, and posts missing the needed data are left out and counted", () => {
  const f = (over) => stats.filterPosts(lib(), Object.assign({}, base, over));
  assert.deepEqual(keys(f({})), ["tiktok_1", "tiktok_2", "instagram_3", "instagram_4"]);
  assert.deepEqual(keys(f({ platform: "instagram" })), ["instagram_3", "instagram_4"]);
  const recent = f({ days: 30 });
  assert.deepEqual(keys(recent), ["tiktok_1", "tiktok_2"], "the 2024 post is too old and the undated one can't be shown as recent");
  assert.equal(recent.hidden.undated, 1);
  const views = f({ minViews: 10000 });
  assert.deepEqual(keys(views), ["tiktok_1", "tiktok_2"]);
  assert.equal(views.hidden.noViews, 1);
  const rate = f({ minRate: 0.1 });
  assert.deepEqual(keys(rate), ["tiktok_1", "instagram_3"]);
  assert.equal(rate.hidden.noRate, 1);
  assert.deepEqual(keys(f({ relevantOnly: true })), ["tiktok_1", "instagram_3", "instagram_4"]);
  assert.deepEqual(keys(f({ bookmarkedOnly: true })), ["tiktok_1"]);
  assert.deepEqual(keys(f({ session: "s2" })), ["tiktok_2", "instagram_3", "instagram_4"]);
  assert.deepEqual(keys(f({ search: "COFFEE" })), ["tiktok_2"]);
  assert.deepEqual(keys(f({ search: "fitcheck" })), ["instagram_3"], "author is searched");
  assert.deepEqual(keys(f({ search: "#premiumstreetwear" })), ["instagram_3"], "the search that found it is searched");
  assert.deepEqual(keys(f({ platform: "tiktok", days: 30, relevantOnly: true, minViews: 1000 })), ["tiktok_1"]);
  const dupes = stats.enrich([{ key: "a", id: "a", text: "same caption here today", views: 5 }, { key: "b", id: "b", text: "same caption here today", views: 9 }], KW, NOW);
  assert.deepEqual(stats.filterPosts(dupes, Object.assign({}, base, { hideDupes: true })).posts.map((p) => p.key), ["b"]);
  assert.equal(stats.filterPosts(dupes, base).posts.length, 2, "duplicates are shown unless hidden");
});

test("sorting puts posts without the value last and keeps ties in their order", () => {
  const sorted = (by) => keys({ posts: stats.sortPosts(lib(), by) });
  assert.deepEqual(sorted("views"), ["tiktok_2", "tiktok_1", "instagram_3", "instagram_4"]);
  assert.deepEqual(sorted("engagement"), ["instagram_3", "tiktok_1", "tiktok_2", "instagram_4"]);
  assert.deepEqual(sorted("recent"), ["tiktok_2", "tiktok_1", "instagram_3", "instagram_4"]);
  assert.deepEqual(sorted("relevance"), ["tiktok_1", "instagram_3", "instagram_4", "tiktok_2"], "three posts tie at 100 and keep their order");
  assert.deepEqual(sorted("nonsense"), ["tiktok_1", "tiktok_2", "instagram_3", "instagram_4"], "an unknown sort changes nothing");
  const before = lib();
  stats.sortPosts(before, "views");
  assert.equal(before[0].key, "tiktok_1", "the input list isn't reordered");
});

test("views change is reported only when there was an earlier sighting", () => {
  assert.deepEqual(stats.viewsChange({ views: 5000, prevViews: 3000, prevSeenAt: "2026-10-10T00:00:00Z" }), { from: 3000, to: 5000, change: 2000, since: "2026-10-10T00:00:00Z" });
  assert.equal(stats.viewsChange({ views: 5000, prevViews: null, prevSeenAt: null }), null);
  assert.equal(stats.viewsChange({ views: null, prevViews: 3000, prevSeenAt: "2026-10-10T00:00:00Z" }), null);
});
