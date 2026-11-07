"use strict";

process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../../js/video-intel-logic");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
const TODAY = "2026-11-04";
const PILLARS = ["Faith", "Behind the brand", "Style & outfits", "Community"];
let n = 0;
const ctx = (extra) => Object.assign({ now: NOW, today: TODAY, pillars: PILLARS, campaigns: [], id: (p) => p + "_" + (++n) }, extra || {});
const form = (extra) => Object.assign({ title: "Why we started Gratiel", platform: "instagram", pillars: ["Faith"] }, extra || {});
const one = (extra, c) => { const r = V.makeVideos(form(extra), [(extra && extra.platform) || "instagram"], ctx(c)); assert.ok(r.ok, JSON.stringify(r.errors)); return r.videos[0]; };
const storeWith = (...vids) => V.addVideos(V.emptyStore(), vids);

/* ---------------- links ---------------- */

test("post links: each platform's real shapes are recognised, tracking parameters are dropped, and only https is accepted", () => {
  assert.deepEqual(V.parsePostUrl("https://www.instagram.com/reel/Cx1AbCdEfGh/?igsh=abc123"), { platform: "instagram", key: "Cx1AbCdEfGh", url: "https://www.instagram.com/reel/Cx1AbCdEfGh/" });
  assert.equal(V.parsePostUrl("https://instagram.com/gratiel/reel/Cx1AbCdEfGh/").key, "Cx1AbCdEfGh");
  assert.equal(V.parsePostUrl("https://www.instagram.com/p/Cx1AbCdEfGh/").platform, "instagram");
  assert.deepEqual(V.parsePostUrl("https://youtu.be/dQw4w9WgXcQ?si=zz"), { platform: "youtube", key: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(V.parsePostUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share").url, "https://www.youtube.com/shorts/dQw4w9WgXcQ");
  assert.equal(V.parsePostUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3s").url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(V.parsePostUrl("https://www.tiktok.com/@gratiel/video/7301234567890123456?is_from_webapp=1").key, "7301234567890123456");
  const short = V.parsePostUrl("https://vm.tiktok.com/ZMabc123/");
  assert.equal(short.platform, "tiktok");
  assert.equal(short.key, null, "a short link is TikTok's, but carries no video id");
  for (const bad of ["", "gratiel", "http://youtu.be/dQw4w9WgXcQ", "https://evil.example/shorts/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short",
    "https://user:pw@www.instagram.com/reel/Cx1AbCdEfGh/", "https://www.tiktok.com/@gratiel", "https://www.instagram.com/gratiel/", "javascript:alert(1)", "https://youtube.com.evil.example/shorts/dQw4w9WgXcQ"]) {
    assert.equal(V.parsePostUrl(bad), null, bad);
  }
  assert.equal(V.parsePostUrl(null), null);
  assert.equal(V.parsePostUrl(42), null);
});

/* ---------------- the stored shape ---------------- */

test("a store of the right shape is made from anything stored; unknown lists and settings from a newer version are kept", () => {
  assert.deepEqual(V.normalizeStore(null), V.emptyStore());
  assert.deepEqual(V.normalizeStore("garbage"), V.emptyStore());
  assert.deepEqual(V.normalizeStore([1, 2]), V.emptyStore());
  assert.deepEqual(V.emptyStore().videos, []);
  V.LISTS.forEach((k) => assert.ok(Array.isArray(V.emptyStore()[k]), k));
  const raw = deepFreeze({ version: 2, settings: { a: 1 }, videos: [{ id: "v1", title: "  Hi  ", platform: "facebook", pillars: ["Faith"] }, { title: "no id" }, null, { id: "v1", title: "duplicate id" }],
    campaigns: "oops", evaluations: [{ id: "e1", videoId: "v1" }, { videoId: "x" }], newerThing: { keep: true }, futureList: [1] });
  const s = V.normalizeStore(raw);
  assert.equal(s.version, 2, "a newer version number is kept, not lowered");
  assert.deepEqual(s.settings, { a: 1 });
  assert.equal(s.videos.length, 1, "no id and duplicate ids are dropped");
  assert.equal(s.videos[0].title, "Hi");
  assert.equal(s.videos[0].platform, "facebook", "a platform this version doesn't know is kept, not erased");
  assert.deepEqual(s.campaigns, []);
  assert.deepEqual(s.evaluations, [{ id: "e1", videoId: "v1" }]);
  assert.deepEqual(s.newerThing, { keep: true });
  assert.deepEqual(s.futureList, [1]);
});

test("normalizing keeps what is valid and fills the rest with empty, never with invented values", () => {
  const v = V.normalizeStore({ videos: [{ id: "v1", title: "T", platform: "tiktok", publishedDate: "2026-02-30", durationSec: "12", plannedDate: "nope", publishedTime: "25:00" }] }).videos[0];
  assert.equal(v.publishedDate, "");
  assert.equal(v.plannedDate, "");
  assert.equal(v.publishedTime, "");
  assert.equal(v.durationSec, null, "a duration that is not a number is unknown, not zero");
  assert.equal(v.workId, "v1");
  assert.equal(v.deletedAt, null);
  assert.deepEqual(v.objective, { primary: "", secondary: [] });
  assert.deepEqual(v.pillars, []);
});

/* ---------------- what the user types ---------------- */

test("a video needs a title, a platform and a pillar from the list in Settings", () => {
  const bad = V.checkVideoInput({}, ctx());
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.title && bad.errors.platform && bad.errors.pillars);
  assert.equal(V.checkVideoInput(form({ pillars: ["Made up pillar"] }), ctx()).errors.pillars, "Choose a pillar from your list in Settings.");
  assert.equal(V.checkVideoInput(form({ pillars: [] }), ctx()).errors.pillars, "Choose the content pillar this video belongs to.");
  assert.equal(V.checkVideoInput(form({ platform: "facebook" }), ctx()).errors.platform, "Choose a platform.");
  assert.equal(V.checkVideoInput(form({ title: "   " }), ctx()).errors.title, "Give the video a title.");
  const good = V.checkVideoInput(form({ pillars: ["Faith", "Community", "Faith"] }), ctx());
  assert.ok(good.ok);
  assert.deepEqual(good.value.pillars, ["Faith", "Community"], "the first is the primary pillar; repeats are dropped");
});

test("a pillar renamed in Settings after the video was saved does not make the video uneditable", () => {
  const v = one({ pillars: ["Faith"] });
  const renamed = ctx({ pillars: ["Faith & belief", "Community"], existing: v });
  assert.ok(V.checkVideoInput(form({ pillars: ["Faith"] }), renamed).ok, "its saved pillar stays valid while it is being edited");
  assert.equal(V.checkVideoInput(form({ pillars: ["Faith"] }), ctx({ pillars: ["Faith & belief"] })).ok, false, "but a NEW video can't use a pillar that is gone");
});

test("text is never silently cut: too much is an error, and the script keeps its line breaks", () => {
  assert.ok(V.checkVideoInput(form({ title: "x".repeat(121) }), ctx()).errors.title);
  assert.ok(V.checkVideoInput(form({ hook: "x".repeat(301) }), ctx()).errors.hook);
  assert.ok(V.checkVideoInput(form({ script: "x".repeat(8001) }), ctx()).errors.script);
  assert.ok(V.checkVideoInput(form({ notes: "x".repeat(1001) }), ctx()).errors.notes);
  assert.ok(V.checkVideoInput(form({ structureNote: "x".repeat(121) }), ctx()).errors.structureNote);
  const script = "Line one.\n\nLine two, with  two spaces.\n";
  const ok = V.checkVideoInput(form({ script: script }), ctx());
  assert.equal(ok.value.script, "Line one.\n\nLine two, with  two spaces.", "only trailing whitespace is trimmed");
  assert.equal(V.checkVideoInput(form({ title: "x".repeat(120) }), ctx()).ok, true, "exactly at the limit is fine");
});

test("purpose and structure: only the listed choices, one main purpose, secondary ones never repeat it", () => {
  assert.ok(V.checkVideoInput(form({ objective: { primary: "sales", secondary: ["trust", "engagement"] }, structure: "pas_story" }), ctx()).ok);
  assert.ok(V.checkVideoInput(form({ objective: { primary: "", secondary: [] }, structure: "" }), ctx()).ok, "both are optional until an evaluation needs them");
  assert.ok(V.checkVideoInput(form({ objective: { primary: "fame" } }), ctx()).errors.objective);
  assert.ok(V.checkVideoInput(form({ objective: { primary: "sales", secondary: ["sales"] } }), ctx()).errors.objective);
  assert.ok(V.checkVideoInput(form({ objective: { primary: "", secondary: ["trust"] } }), ctx()).errors.objective);
  assert.ok(V.checkVideoInput(form({ objective: { primary: "sales", secondary: ["nope"] } }), ctx()).errors.objective);
  assert.ok(V.checkVideoInput(form({ structure: "freestyle" }), ctx()).errors.structure);
  const r = V.checkVideoInput(form({ objective: { primary: "sales", secondary: ["trust", "trust"] } }), ctx());
  assert.deepEqual(r.value.objective.secondary, ["trust"]);
});

test("length, dates and times: real values only, a published date can't be in the future, and nothing unknown becomes 0", () => {
  assert.equal(V.checkVideoInput(form({ durationSec: "" }), ctx()).value.durationSec, null);
  assert.equal(V.checkVideoInput(form({ durationSec: 27.46 }), ctx()).value.durationSec, 27.5);
  for (const d of [0, -3, "abc", 1801, NaN]) assert.ok(V.checkVideoInput(form({ durationSec: d }), ctx()).errors.durationSec, String(d));
  assert.ok(V.checkVideoInput(form({ plannedDate: "2026-02-30" }), ctx()).errors.plannedDate);
  assert.ok(V.checkVideoInput(form({ publishedDate: "2026-11-05" }), ctx()).errors.publishedDate, "tomorrow");
  assert.ok(V.checkVideoInput(form({ publishedDate: TODAY }), ctx()).ok, "today is fine");
  assert.ok(V.checkVideoInput(form({ publishedDate: "2026-10-30", publishedTime: "18:30" }), ctx()).ok);
  assert.ok(V.checkVideoInput(form({ publishedDate: "2026-10-30", publishedTime: "6:30pm" }), ctx()).errors.publishedTime);
  assert.ok(V.checkVideoInput(form({ publishedTime: "18:30" }), ctx()).errors.publishedTime, "a time needs a date");
});

test("the post link must be for the video's own platform, and is stored without tracking parameters", () => {
  const ok = V.checkVideoInput(form({ platform: "instagram", url: "https://www.instagram.com/reel/Cx1AbCdEfGh/?igsh=abc" }), ctx());
  assert.ok(ok.ok);
  assert.equal(ok.value.url, "https://www.instagram.com/reel/Cx1AbCdEfGh/");
  assert.equal(ok.value.platformKey, "Cx1AbCdEfGh");
  assert.match(V.checkVideoInput(form({ platform: "instagram", url: "https://youtu.be/dQw4w9WgXcQ" }), ctx()).errors.url, /YouTube Shorts, not Instagram Reels/);
  assert.match(V.checkVideoInput(form({ url: "not a link" }), ctx()).errors.url, /doesn't look like a link/);
  assert.equal(V.checkVideoInput(form({ url: "" }), ctx()).value.platformKey, null);
});

test("a campaign has to exist, unless the video already had it", () => {
  const camp = { id: "cmp_1", name: "Fall drop", deletedAt: null };
  assert.ok(V.checkVideoInput(form({ campaignId: "cmp_1" }), ctx({ campaigns: [camp] })).ok);
  assert.ok(V.checkVideoInput(form({ campaignId: "cmp_gone" }), ctx({ campaigns: [camp] })).errors.campaignId);
  assert.ok(V.checkVideoInput(form({ campaignId: "cmp_1" }), ctx({ campaigns: [Object.assign({}, camp, { deletedAt: 5 })] })).errors.campaignId, "a deleted campaign can't be newly chosen");
  const kept = V.checkVideoInput(form({ campaignId: "cmp_1" }), ctx({ campaigns: [], existing: { campaignId: "cmp_1", pillars: ["Faith"] } }));
  assert.ok(kept.ok, "but an existing video that already had it can still be saved");
  assert.equal(V.checkVideoInput(form(), ctx()).value.campaignId, null);
});

/* ---------------- making, changing, deleting ---------------- */

test("one form can make a video for each platform; they share a work id but each has its own id", () => {
  const r = V.makeVideos(form({ ideaId: "idea_7" }), ["instagram", "tiktok", "youtube", "tiktok"], ctx());
  assert.ok(r.ok);
  assert.equal(r.videos.length, 3, "a repeated platform is made once");
  assert.equal(new Set(r.videos.map((v) => v.id)).size, 3);
  assert.deepEqual(r.videos.map((v) => v.platform), ["instagram", "tiktok", "youtube"]);
  assert.ok(r.videos.every((v) => v.workId === "idea_7" && v.ideaId === "idea_7"));
  assert.ok(r.videos.every((v) => v.createdAt === NOW && v.updatedAt === NOW && v.deletedAt === null));
  const solo = V.makeVideos(form(), ["tiktok"], ctx()).videos[0];
  assert.equal(solo.workId, solo.id, "with no idea, a video is its own work");
});

test("a link and a published date belong to one post, so several platforms can't be given them", () => {
  const r = V.makeVideos(form({ url: "https://youtu.be/dQw4w9WgXcQ" }), ["instagram", "youtube"], ctx());
  assert.equal(r.ok, false);
  assert.ok(r.errors.url);
  assert.equal(V.makeVideos(form({ publishedDate: "2026-11-01" }), ["instagram", "tiktok"], ctx()).ok, false);
  assert.equal(V.makeVideos(form(), [], ctx()).ok, false);
  assert.ok(V.makeVideos(form({ url: "https://youtu.be/dQw4w9WgXcQ", platform: "youtube" }), ["youtube"], ctx()).ok);
  // nothing is made when any one of the videos is invalid
  assert.equal(V.makeVideos(form({ title: "" }), ["instagram", "tiktok"], ctx()).ok, false);
});

test("changing a video keeps its identity, can't change its platform, and moves updatedAt forward", () => {
  const v = one({ title: "Old title" });
  const store = deepFreeze(storeWith(v));
  const later = NOW + 5000;
  const r = V.updateVideo(store, v.id, form({ title: "New title", platform: "tiktok", hook: "A new hook" }), ctx({ now: later }));
  assert.ok(r.ok);
  assert.equal(r.video.title, "New title");
  assert.equal(r.video.platform, "instagram", "the platform is fixed: its numbers belong to that platform");
  assert.equal(r.video.id, v.id);
  assert.equal(r.video.workId, v.workId);
  assert.equal(r.video.createdAt, v.createdAt);
  assert.equal(r.video.updatedAt, later);
  assert.equal(store.videos[0].title, "Old title", "the input store is untouched");
  assert.equal(V.updateVideo(store, "nope", form(), ctx()).ok, false);
  assert.equal(V.updateVideo(store, v.id, form({ title: "" }), ctx()).ok, false);
  const publish = V.updateVideo(r.store, v.id, form({ title: "New title", publishedDate: "2026-11-01", publishedTime: "18:00", url: "https://www.instagram.com/reel/Cx1AbCdEfGh/" }), ctx({ now: later + 1 }));
  assert.ok(publish.ok);
  assert.equal(publish.video.publishedDate, "2026-11-01");
  assert.equal(publish.video.platformKey, "Cx1AbCdEfGh");
});

test("deleting is a tombstone that wins over an older copy, and Undo clears it", () => {
  const v = one({});
  let s = storeWith(v);
  s = V.removeVideo(s, v.id, v.updatedAt);        // same millisecond as the last save
  const gone = s.videos[0];
  assert.ok(gone.deletedAt);
  assert.ok(gone.updatedAt > v.updatedAt, "updatedAt always moves forward, even in the same millisecond, so the delete wins a merge");
  assert.equal(V.videos(s).length, 0);
  assert.equal(V.videoById(s, v.id), null);
  assert.equal(s.videos.length, 1, "the record is still stored");
  s = V.restoreVideo(s, v.id, gone.updatedAt);
  assert.equal(s.videos[0].deletedAt, null);
  assert.ok(s.videos[0].updatedAt > gone.updatedAt, "and Undo wins over the delete");
  assert.equal(V.videos(s).length, 1);
  assert.equal(V.updateVideo(V.removeVideo(s, v.id, NOW), v.id, form(), ctx()).ok, false, "a deleted video can't be edited");
});

test("tombstones are dropped after 90 days, together with anything that belonged to the video", () => {
  const old = one({ title: "Old" }), keep = one({ title: "Keep" }), recent = one({ title: "Recent" });
  let s = storeWith(old, keep, recent);
  s.evaluations = [{ id: "e1", videoId: old.id }, { id: "e2", videoId: keep.id }];
  s.snapshots = [{ id: "s1", videoId: old.id }];
  s.campaigns = [{ id: "c_old", name: "Old", deletedAt: NOW - 100 * 864e5 }, { id: "c_new", name: "New", deletedAt: NOW - 10 * 864e5 }, { id: "c_live", name: "Live", deletedAt: null }];
  s = V.removeVideo(s, old.id, NOW - 91 * 864e5);
  s = V.removeVideo(s, recent.id, NOW - 89 * 864e5);
  deepFreeze(s);
  const p = V.purgeTombstones(s, NOW);
  assert.deepEqual(p.videos.map((v) => v.title).sort(), ["Keep", "Recent"], "91 days old is dropped, 89 is kept");
  assert.deepEqual(p.evaluations.map((e) => e.id), ["e2"]);
  assert.deepEqual(p.snapshots, []);
  assert.deepEqual(p.campaigns.map((c) => c.id).sort(), ["c_live", "c_new"]);
  assert.equal(s.videos.length, 3, "the input is untouched");
});

/* ---------------- where a video stands ---------------- */

test("a video moves forward only when the data for the next stage exists", () => {
  const v = one({});
  const base = storeWith(v);
  assert.equal(V.statusOf(v, base), "planned");
  assert.equal(V.statusOf(v, Object.assign({}, base, { evaluations: [{ id: "e", videoId: v.id }] })), "evaluated");
  assert.equal(V.statusOf(v, Object.assign({}, base, { evaluations: [{ id: "e", videoId: v.id, deletedAt: 1 }] })), "planned", "a deleted evaluation doesn't count");
  const pub = Object.assign({}, v, { publishedDate: "2026-11-01" });
  assert.equal(V.statusOf(pub, base), "published");
  assert.equal(V.statusOf(pub, Object.assign({}, base, { snapshots: [{ id: "s", videoId: v.id }] })), "measured");
  assert.equal(V.statusOf(v, Object.assign({}, base, { snapshots: [{ id: "s", videoId: v.id }] })), "planned", "numbers can't exist for a video that isn't published");
  assert.equal(V.statusOf(pub, Object.assign({}, base, { snapshots: [{ id: "s", videoId: v.id }], reports: [{ id: "r", videoId: v.id }] })), "analyzed");
  assert.equal(V.statusOf(pub, Object.assign({}, base, { snapshots: [{ id: "s", videoId: "other" }] })), "published", "another video's numbers don't count");
});

test("how long a video has been out is whole days from its published date, and empty when it has none", () => {
  const v = (d) => ({ publishedDate: d });
  assert.equal(V.ageDays(v("2026-11-04"), TODAY), 0);
  assert.equal(V.ageDays(v("2026-11-03"), TODAY), 1);
  assert.equal(V.ageDays(v("2026-10-25"), TODAY), 10);
  assert.equal(V.ageDays(v("2025-11-04"), TODAY), 365);
  assert.equal(V.ageDays(v(""), TODAY), null);
  assert.equal(V.ageDays(v("2026-11-04"), "nonsense"), null);
  assert.equal(V.ageText(v("2026-11-04"), TODAY), "out today");
  assert.equal(V.ageText(v("2026-11-03"), TODAY), "out 1 day");
  assert.equal(V.ageText(v("2026-10-25"), TODAY), "out 10 days");
  assert.equal(V.ageText(v(""), TODAY), "");
  assert.equal(V.ageDays(v("2026-03-07"), "2026-03-09"), 2, "across the clocks changing, a day is still a calendar day");
});

/* ---------------- campaigns ---------------- */

test("campaigns: a name, optional goal and dates; no duplicate names; the end can't precede the start", () => {
  let s = V.emptyStore();
  const r = V.addCampaign(s, { name: " Fall drop ", goal: "Sell out the hoodie", startDate: "2026-10-01", endDate: "2026-11-30" }, ctx());
  assert.ok(r.ok);
  assert.equal(r.campaign.name, "Fall drop");
  s = r.store;
  assert.equal(V.addCampaign(s, { name: "FALL DROP" }, ctx()).errors.name, "You already have a campaign with that name.");
  assert.ok(V.addCampaign(s, { name: "" }, ctx()).errors.name);
  assert.ok(V.addCampaign(s, { name: "x".repeat(61) }, ctx()).errors.name);
  assert.ok(V.addCampaign(s, { name: "A", goal: "x".repeat(201) }, ctx()).errors.goal);
  assert.ok(V.addCampaign(s, { name: "A", startDate: "2026-12-01", endDate: "2026-11-01" }, ctx()).errors.endDate);
  assert.ok(V.addCampaign(s, { name: "A", startDate: "2026-13-01" }, ctx()).errors.startDate);
  assert.ok(V.addCampaign(s, { name: "A" }, ctx()).ok, "dates are optional");
  const id = r.campaign.id;
  const up = V.updateCampaign(s, id, { name: "Fall drop", goal: "New goal" }, ctx({ now: NOW + 9 }));
  assert.ok(up.ok, "keeping its own name is not a duplicate");
  assert.equal(up.campaign.goal, "New goal");
  assert.ok(up.campaign.updatedAt > r.campaign.updatedAt);
  assert.equal(V.updateCampaign(s, "nope", { name: "Z" }, ctx()).ok, false);
});

test("deleting a campaign leaves its videos alone (they just show no campaign), and Undo brings it back", () => {
  let s = V.addCampaign(V.emptyStore(), { name: "Fall drop" }, ctx()).store;
  const cid = s.campaigns[0].id;
  const v = one({ campaignId: cid }, { campaigns: s.campaigns });
  s = V.addVideos(s, [v]);
  assert.equal(V.videoCountIn(s, cid), 1);
  assert.equal(V.campaignName(s, cid), "Fall drop");
  s = V.removeCampaign(s, cid, NOW + 1);
  assert.equal(V.campaigns(s).length, 0);
  assert.equal(V.campaignName(s, cid), "", "a deleted campaign has no name to show");
  assert.equal(V.videos(s).length, 1);
  assert.equal(s.videos[0].campaignId, cid, "the video still remembers it, so Undo restores the link");
  s = V.restoreCampaign(s, cid, NOW + 2);
  assert.equal(V.campaignName(s, cid), "Fall drop");
});

/* ---------------- the Idea Library link ---------------- */

test("an idea's platform decides which videos to offer; the pillar is filled in only when it is one of yours", () => {
  assert.deepEqual(V.platformsForIdea({ platform: "both" }), ["instagram", "tiktok"]);
  assert.deepEqual(V.platformsForIdea({ platform: "youtube" }), ["youtube"]);
  assert.deepEqual(V.platformsForIdea({ platform: "instagram" }), ["instagram"]);
  assert.deepEqual(V.platformsForIdea({ platform: "myspace" }), []);
  assert.deepEqual(V.platformsForIdea(null), []);
  const idea = { id: "idea_1", title: "Our story", hook: "I almost quit", script: "Line 1\nLine 2", contentPillar: "Faith", platform: "both", plannedDate: "2026-11-10" };
  const p = V.prefillFromIdea(idea, { pillars: PILLARS });
  assert.deepEqual(p, { ideaId: "idea_1", title: "Our story", hook: "I almost quit", script: "Line 1\nLine 2", pillars: ["Faith"], plannedDate: "2026-11-10", platforms: ["instagram", "tiktok"] });
  assert.deepEqual(V.prefillFromIdea(Object.assign({}, idea, { contentPillar: "Product drops" }), { pillars: PILLARS }).pillars, [], "not one of your pillars: left for you to choose");
  assert.deepEqual(V.prefillFromIdea(Object.assign({}, idea, { contentPillar: "" }), { pillars: PILLARS }).pillars, []);
  assert.deepEqual(V.prefillFromIdea(undefined, { pillars: PILLARS }).platforms, []);
});

test("platforms an idea already has a video for are reported, ignoring deleted ones", () => {
  const a = one({ ideaId: "idea_1", platform: "instagram" }), b = one({ ideaId: "idea_1", platform: "tiktok" }), c = one({ ideaId: "idea_2", platform: "youtube" });
  let s = storeWith(a, b, c);
  assert.deepEqual(V.platformsUsed(s, "idea_1").sort(), ["instagram", "tiktok"]);
  s = V.removeVideo(s, b.id, NOW + 1);
  assert.deepEqual(V.platformsUsed(s, "idea_1"), ["instagram"]);
  assert.deepEqual(V.platformsUsed(s, "nope"), []);
});

/* ---------------- the Library list ---------------- */

test("the Library filters by platform, status, campaign, pillar and words, and never lists deleted videos", () => {
  let s = V.addCampaign(V.emptyStore(), { name: "Fall drop" }, ctx()).store;
  const cid = s.campaigns[0].id;
  const a = one({ title: "Hoodie reveal", platform: "instagram", pillars: ["Product drops"].concat([]), hook: "It took a year" }, { pillars: PILLARS.concat("Product drops") });
  const b = one({ title: "Sunday service fit", platform: "tiktok", pillars: ["Faith"], campaignId: cid, publishedDate: "2026-10-28" }, { campaigns: s.campaigns });
  const c = one({ title: "Why Gratiel", platform: "youtube", pillars: ["Faith", "Community"], script: "Gratitude is the point" });
  s = V.addVideos(s, [a, b, c]);
  s.snapshots = [{ id: "s1", videoId: b.id }];
  const titles = (f) => V.filterVideos(s, f).map((v) => v.title);
  assert.equal(titles({}).length, 3);
  assert.deepEqual(titles({ platform: "tiktok" }), ["Sunday service fit"]);
  assert.deepEqual(titles({ status: "measured" }), ["Sunday service fit"]);
  assert.deepEqual(titles({ status: "planned" }).sort(), ["Hoodie reveal", "Why Gratiel"]);
  assert.deepEqual(titles({ campaignId: cid }), ["Sunday service fit"]);
  assert.deepEqual(titles({ pillar: "Faith" }).sort(), ["Sunday service fit", "Why Gratiel"]);
  assert.deepEqual(titles({ pillar: "Community" }), ["Why Gratiel"], "any of a video's pillars matches, not just the primary");
  assert.deepEqual(titles({ query: "GRATITUDE" }), ["Why Gratiel"], "words are searched in the script too, ignoring case");
  assert.deepEqual(titles({ query: "fall drop" }), ["Sunday service fit"], "and in the campaign's name");
  assert.deepEqual(titles({ query: "a year" }), ["Hoodie reveal"]);
  assert.deepEqual(titles({ query: "zzz" }), []);
  assert.deepEqual(titles({ platform: "instagram", pillar: "Faith" }), []);
  s = V.removeVideo(s, c.id, NOW + 1);
  assert.equal(titles({}).length, 2);
});

test("sorting: newest dated first, a video with no date last, and by title on request", () => {
  const mk = (title, extra, t) => one(Object.assign({ title: title }, extra), { now: NOW + t });
  const a = mk("B older", { publishedDate: "2026-10-01" }, 1), b = mk("A newer", { publishedDate: "2026-10-20" }, 2),
    c = mk("C planned", { plannedDate: "2026-11-15" }, 3), d = mk("D undated", {}, 4), e = mk("E undated later", {}, 5);
  const s = storeWith(a, b, c, d, e);
  const order = (sort) => V.filterVideos(s, { sort: sort }).map((v) => v.title);
  assert.deepEqual(order("recent"), ["C planned", "A newer", "B older", "E undated later", "D undated"]);
  assert.deepEqual(order("oldest"), ["B older", "A newer", "C planned", "E undated later", "D undated"], "undated stay last, newest-created first");
  assert.deepEqual(order("title"), ["A newer", "B older", "C planned", "D undated", "E undated later"]);
  assert.deepEqual(V.filterVideos(s, undefined).length, 5);
});

test("nothing here changes what it is given", () => {
  const v = one({});
  const s = deepFreeze(storeWith(v));
  assert.doesNotThrow(() => {
    V.filterVideos(s, { query: "x" }); V.videos(s); V.statusOf(v, s); V.purgeTombstones(s, NOW);
    V.removeVideo(s, v.id, NOW); V.restoreVideo(s, v.id, NOW); V.updateVideo(s, v.id, form(), ctx());
    V.addCampaign(s, { name: "N" }, ctx()); V.normalizeStore(s);
  });
});

test("every problem with a new video is reported at once, so one save shows everything to fix", () => {
  const r = V.makeVideos({}, [], ctx());
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["pillars", "platform", "title"], "no platform, no title, no pillar: all three, not just the first");
  assert.equal(r.errors.platform, "Choose at least one platform.");
  // a link that belongs to one platform is not blamed on 'no platform chosen'
  const withLink = V.makeVideos(form({ title: "" , url: "https://youtu.be/dQw4w9WgXcQ" }), [], ctx());
  assert.deepEqual(Object.keys(withLink.errors).sort(), ["platform", "title"]);
  // two platforms with a link, and a bad title: both problems
  const two = V.makeVideos(form({ title: "", url: "https://youtu.be/dQw4w9WgXcQ" }), ["instagram", "youtube"], ctx());
  assert.deepEqual(Object.keys(two.errors).sort(), ["title", "url"]);
  assert.match(two.errors.url, /separately/);
  // one bad platform's worth of validation is not repeated per platform
  assert.equal(V.makeVideos(form({ pillars: ["Nope"] }), ["instagram", "tiktok"], ctx()).errors.pillars, "Choose a pillar from your list in Settings.");
});
