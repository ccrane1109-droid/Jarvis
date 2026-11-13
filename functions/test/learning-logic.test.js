"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");

const TODAY = "2026-11-09";               // a Monday
const NOW = Date.parse("2026-11-09T15:00:00Z");
const DAY = 86400000;
const book = (o) => L.readBook(Object.assign({ id: "b1", title: "Atomic Habits", author: "James Clear", category: "Self-improvement", totalPages: 300, currentPage: 0, status: "reading", startDate: "", endDate: "", rating: 0, createdAt: 1, updatedAt: 1, log: [] }, o));
const research = (o) => L.readResearch(Object.assign({ id: "r1", title: "Sleep and focus", category: "Health", question: "Does sleep affect focus?", purpose: "", priority: "medium", status: "researching", createdAt: 1, updatedAt: 1, sources: [] }, o));
const note = (o) => L.readNote(Object.assign({ id: "n1", type: "takeaway", text: "Small habits compound.", tags: [], bookIds: [], researchIds: [], day: TODAY, createdAt: NOW, updatedAt: NOW }, o));
const action = (o) => L.readAction(Object.assign({ id: "a1", lesson: "Stack a new habit on an old one", status: "todo", createdAt: 1, updatedAt: 1 }, o));

/* ---------------- dates and small helpers ---------------- */

test("dates: validity, arithmetic and weeks that start on Monday", () => {
  ["2026-11-09", "2024-02-29", "2026-12-31"].forEach((d) => assert.equal(L.isDate(d), true, d));
  ["2026-02-29", "2026-13-01", "2026-11-31", "26-11-09", "2026-1-9", "", null, undefined, 5, "2026-11-09T00:00:00Z"].forEach((d) => assert.equal(L.isDate(d), false, String(d)));
  assert.equal(L.addDays("2026-11-09", 7), "2026-11-16");
  assert.equal(L.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(L.diffDays("2026-11-09", "2026-11-16"), 7);
  assert.equal(L.diffDays("2026-11-09", "2026-11-02"), -7);
  // a Monday maps to itself, a Sunday to the Monday six days before
  assert.deepEqual(["2026-11-09", "2026-11-10", "2026-11-15", "2026-11-08", "2026-11-02", "2026-01-01"].map(L.weekStart), ["2026-11-09", "2026-11-09", "2026-11-09", "2026-11-02", "2026-11-02", "2025-12-29"]);
});

test("tags: lowercased, cleaned, limited, each once", () => {
  assert.deepEqual(L.parseTags("Focus, #Deep Work , focus,  ,Mind-set!"), ["focus", "deep-work", "mind-set"]);
  assert.deepEqual(L.parseTags(["A", "a", " B "]), ["a", "b"]);
  assert.deepEqual(L.parseTags("x".repeat(80)), ["x".repeat(30)]);
  assert.equal(L.parseTags(Array.from({ length: 30 }, (_, i) => "t" + i)).length, 12);
  assert.deepEqual(L.parseTags(null), []);
  assert.deepEqual(L.parseTags(5), []);
  assert.deepEqual(L.parseTags("#, ,##"), []);
});

test("web addresses: http and https only, with a missing scheme added", () => {
  assert.equal(L.cleanUrl("example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(L.cleanUrl("http://example.com"), "http://example.com/");
  assert.equal(L.cleanUrl("  https://www.youtube.com/watch?v=abc  "), "https://www.youtube.com/watch?v=abc");
  ["javascript:alert(1)", "data:text/html,<b>", "ftp://example.com/x", "file:///etc/passwd", "mailto:a@b.co", "", "   ", "not a url", "localhost", "https://", "http://exa mple.com", "x".repeat(2100), null, undefined, 5].forEach((u) => assert.equal(L.cleanUrl(u), "", String(u)));
  assert.equal(L.hostOf("https://www.example.com/x"), "example.com");
  assert.equal(L.hostOf("nonsense"), "");
});

/* ---------------- reading progress ---------------- */

test("progress is current page over total pages, and unknown without a total", () => {
  assert.equal(L.progress(book({ currentPage: 75 })), 25);
  assert.equal(L.progress(book({ currentPage: 100 })), 33);
  assert.equal(L.progress(book({ currentPage: 300 })), 100);
  assert.equal(L.progress(book({ currentPage: 0 })), 0);
  assert.equal(L.progress(book({ totalPages: 0, currentPage: 50 })), null, "no total: no percentage, never a made-up one");
  assert.equal(L.pagesLeft(book({ currentPage: 75 })), 225);
  assert.equal(L.pagesLeft(book({ totalPages: 0 })), null);
  assert.equal(L.progress(null), null);
});

test("page updates are logged once a day, and the first entry is never lost", () => {
  let b = book({ currentPage: 10, log: [{ d: "2026-11-02", p: 10 }] });
  b = L.withPage(b, 25, "2026-11-03", NOW);
  b = L.withPage(b, 40, "2026-11-03", NOW + 1);
  assert.deepEqual(b.log, [{ d: "2026-11-02", p: 10 }, { d: "2026-11-03", p: 40 }], "a second update the same day replaces the first");
  assert.deepEqual([b.currentPage, b.updatedAt], [40, NOW + 1]);
  let big = book({ log: [{ d: "2025-01-01", p: 5 }] });
  for (let i = 0; i < 500; i++) big = L.withPage(big, 6 + i, L.addDays("2025-01-02", i), NOW);
  assert.equal(big.log.length, L.MAX_LOG);
  assert.deepEqual(big.log[0], { d: "2025-01-01", p: 5 }, "the starting point stays");
  assert.equal(big.log[big.log.length - 1].p, 505);
});

test("pages read in a week come only from logged updates", () => {
  const b = (log) => book({ log: log });
  const W = ["2026-11-09", "2026-11-15"];
  assert.equal(L.pagesInRange(b([]), ...W), 0, "no log, no pages");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-09", p: 0 }, { d: "2026-11-11", p: 30 }, { d: "2026-11-14", p: 55 }]), ...W), 55, "added on Monday at page 0: counted from there");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-09", p: 100 }, { d: "2026-11-11", p: 130 }]), ...W), 30, "added mid-book: the pages before the first entry aren't counted");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-02", p: 100 }, { d: "2026-11-05", p: 140 }, { d: "2026-11-12", p: 190 }]), ...W), 50, "from the last page logged before the week");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-02", p: 100 }, { d: "2026-11-05", p: 140 }]), ...W), 0, "nothing logged in the week: zero, not an assumption");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-02", p: 100 }, { d: "2026-11-10", p: 90 }]), ...W), 0, "a correction downwards never counts as negative reading");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-16", p: 50 }]), ...W), 0, "entries after the week don't count");
  assert.equal(L.pagesInRange(b([{ d: "2026-11-09", p: 10 }, { d: "2026-11-09", p: 20 }]), ...W), 10);
  assert.equal(L.pagesInRange(null, ...W), 0);
  assert.equal(L.lastLogged(b([{ d: "2026-11-02", p: 1 }, { d: "2026-11-12", p: 9 }, { d: "2026-11-05", p: 4 }])), "2026-11-12");
  assert.equal(L.lastLogged(b([])), "");
});

/* ---------------- reading what's stored ---------------- */

test("stored books are cleaned, and anything unreadable is kept as it was", () => {
  const stored = [
    { id: "ok", title: "  A  Book ", author: "X", totalPages: "250", currentPage: 400, status: "nonsense", rating: 9, startDate: "2026-02-30", cover: "http://evil/x.png", log: [{ d: "2026-11-01", p: 3 }, { d: "bad", p: 1 }, null, { d: "2026-11-02", p: -4 }] },
    { id: "ok", title: "Duplicate id" }, { title: "No id" }, { id: "t", title: "" }, null, 5, "text", { id: "x", title: "Y", deletedAt: 123 }
  ];
  const r = L.readList("books", stored);
  assert.deepEqual(r.items.map((b) => b.id), ["ok", "x"]);
  const b = r.items[0];
  assert.deepEqual([b.title, b.totalPages, b.currentPage, b.status, b.rating, b.startDate, b.cover], ["A Book", 250, 250, "want", 0, "", ""]);
  assert.deepEqual(b.log, [{ d: "2026-11-01", p: 3 }]);
  assert.equal(r.items[1].deletedAt, 123);
  assert.deepEqual(r.kept, [stored[1], stored[2], stored[3], 5, "text"].filter((x) => x !== undefined), "what couldn't be read is returned untouched (null is dropped)");
  assert.deepEqual(L.readList("books", "nope"), { items: [], kept: [] });
  assert.deepEqual(L.readList("books", null), { items: [], kept: [] });
});

test("a cover must be a small embedded image", () => {
  const ok = "data:image/jpeg;base64," + "A".repeat(200);
  assert.equal(L.coverOk(ok), true);
  ["data:image/svg+xml;base64,AAAA", "data:text/html;base64,AAAA", "https://example.com/a.jpg", "data:image/jpeg;base64,", "data:image/jpeg;base64," + "A".repeat(L.MAX_COVER_CHARS), "", null, 5].forEach((c) => assert.equal(L.coverOk(c), false, String(c).slice(0, 40)));
  assert.equal(book({ cover: ok }).cover, ok);
});

test("research, notes, actions and reviews are read safely", () => {
  const r = research({ status: "completed", completedAt: "2026-11-05", priority: "urgent", sources: [{ id: "s1", url: "example.com/a", kind: "weird" }, { id: "s2", url: "javascript:1" }, { id: "s1", url: "https://dup.example.com" }, { url: "https://noid.example.com" }] });
  assert.deepEqual([r.priority, r.completedAt, r.sources.length, r.sources[0].url, r.sources[0].kind, r.sources[0].title], ["medium", "2026-11-05", 1, "https://example.com/a", "article", "example.com"]);
  assert.equal(research({ status: "researching", completedAt: "2026-11-05" }).completedAt, "", "only a completed project has a completion date");
  assert.equal(L.readNote({ id: "n", text: "   " }), null, "an empty note isn't a note");
  const n = note({ type: "weird", tags: "A, b", bookIds: ["b1", "b1", 5, ""], important: "yes" });
  assert.deepEqual([n.type, n.tags, n.bookIds, n.important], ["note", ["a", "b"], ["b1"], false]);
  const a = action({ status: "todo", implementedAt: "2026-11-01", sourceType: "other", sourceId: "zzz", sourceLabel: "A podcast" });
  assert.deepEqual([a.implementedAt, a.sourceId, a.sourceLabel], ["", "", "A podcast"]);
  assert.equal(action({ status: "done", implementedAt: "2026-11-01" }).implementedAt, "2026-11-01");
  assert.equal(L.readAction({ id: "a", lesson: "" }), null);
  assert.equal(L.readReview({ id: "wk", weekStart: "bad" }), null);
  assert.equal(L.readReview({ id: "wk_2026-11-09", weekStart: "2026-11-09", reflection: "ok" }).reflection, "ok");
});

/* ---------------- checking forms ---------------- */

test("book form: required title, whole-number pages, sensible dates, and what each status implies", () => {
  const ok = (i, ctx) => { const r = L.checkBook(i, ctx || { today: TODAY }); assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
  const bad = (i, field) => { const r = L.checkBook(i, { today: TODAY }); assert.equal(r.ok, false); assert.ok(r.errors[field], field + ": " + JSON.stringify(r.errors)); return r.errors; };
  const base = { title: "Deep Work", author: "Cal Newport", category: "Focus", totalPages: "296", currentPage: "0", status: "want" };
  assert.deepEqual(ok(base), { title: "Deep Work", author: "Cal Newport", category: "Focus", totalPages: 296, currentPage: 0, status: "want", startDate: "", endDate: "", rating: 0, cover: "" });
  bad(Object.assign({}, base, { title: "   " }), "title");
  bad(Object.assign({}, base, { totalPages: "abc" }), "totalPages");
  bad(Object.assign({}, base, { totalPages: "0" }), "totalPages");
  bad(Object.assign({}, base, { totalPages: "12.5" }), "totalPages");
  bad(Object.assign({}, base, { currentPage: "-3" }), "currentPage");
  bad(Object.assign({}, base, { currentPage: "400" }), "currentPage");
  bad(Object.assign({}, base, { status: "finished" }), "status");
  bad(Object.assign({}, base, { startDate: "2026-02-30" }), "startDate");
  bad(Object.assign({}, base, { startDate: "2026-11-10", endDate: "2026-11-01", status: "completed" }), "endDate");
  bad(Object.assign({}, base, { rating: "6" }), "rating");
  bad(Object.assign({}, base, { cover: "https://example.com/x.png" }), "cover");
  assert.equal(Object.keys(bad(Object.assign({}, base, { title: "", totalPages: "x", status: "?" }), "title")).length, 3, "every problem is reported at once");
  assert.deepEqual(ok({ title: "No total", totalPages: "", currentPage: "50", status: "reading" }), { title: "No total", author: "", category: "", totalPages: 0, currentPage: 50, status: "reading", startDate: TODAY, endDate: "", rating: 0, cover: "" }, "reading: the start date is filled in with today; no total is fine");
  assert.equal(ok(Object.assign({}, base, { status: "reading", startDate: "2026-10-01" })).startDate, "2026-10-01", "a start date you typed is kept");
  const c = ok(Object.assign({}, base, { status: "completed", currentPage: "120", rating: "4" }));
  assert.deepEqual([c.endDate, c.currentPage, c.rating, c.startDate], [TODAY, 296, 4, ""], "completed: finish date today, last page, and the start date is NOT invented");
  assert.equal(ok(Object.assign({}, base, { status: "paused", endDate: "2026-11-01", startDate: "2026-10-01" })).endDate, "", "only a completed book has a finish date");
});

test("quick status changes fill in what follows, and nothing is invented", () => {
  let b = L.withStatus(book({ status: "want", currentPage: 0 }), "reading", TODAY, NOW);
  assert.deepEqual([b.status, b.startDate], ["reading", TODAY]);
  b = L.withStatus(book({ status: "reading", currentPage: 120, startDate: "2026-10-20", log: [{ d: "2026-10-20", p: 0 }] }), "completed", TODAY, NOW);
  assert.deepEqual([b.status, b.endDate, b.currentPage, b.startDate, b.log[b.log.length - 1]], ["completed", TODAY, 300, "2026-10-20", { d: "2026-10-20", p: 0 }], "the bar fills, but pages never logged are not counted as read on the day you tapped Completed");
  b = L.withStatus(book({ status: "reading", totalPages: 0, currentPage: 7 }), "completed", TODAY, NOW);
  assert.deepEqual([b.endDate, b.currentPage], [TODAY, 7], "no total: the page is left as it is");
  b = L.withStatus(b, "paused", TODAY, NOW);
  assert.equal(b.endDate, "", "no longer completed: no finish date");
  assert.equal(L.withStatus(book(), "bogus", TODAY, NOW).status, "reading", "an unknown status changes nothing");
  const a = L.withActionStatus(action(), "done", TODAY, NOW);
  assert.deepEqual([a.status, a.implementedAt], ["done", TODAY]);
  assert.equal(L.withActionStatus(a, "doing", TODAY, NOW).implementedAt, "");
  assert.equal(L.withActionStatus(Object.assign({}, a, { implementedAt: "2026-11-01" }), "done", TODAY, NOW).implementedAt, "2026-11-01", "an earlier implemented date is kept");
  let r = L.withResearchStatus(research({ status: "analyzing" }), "completed", TODAY, NOW);
  assert.deepEqual([r.status, r.completedAt], ["completed", TODAY]);
  assert.equal(L.withResearchStatus(Object.assign({}, r, { completedAt: "2026-11-02" }), "completed", TODAY, NOW).completedAt, "2026-11-02", "an earlier completed date is kept");
  assert.equal(L.withResearchStatus(r, "analyzing", TODAY, NOW).completedAt, "", "taken out of Completed: no completed date");
  assert.equal(L.withResearchStatus(research(), "bogus", TODAY, NOW).status, "researching", "an unknown status changes nothing");
});

test("research and source forms", () => {
  const r = L.checkResearch({ title: "  Cold plunges ", category: "Health", question: "Do they help recovery?", priority: "high", status: "completed" }, { today: TODAY });
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.title, r.value.completedAt, r.value.priority], ["Cold plunges", TODAY, "high"]);
  assert.equal(L.checkResearch({ title: "x", priority: "high", status: "researching", completedAt: "2026-01-01" }, { today: TODAY }).value.completedAt, "");
  const e = L.checkResearch({ title: "", priority: "none", status: "done" }, {});
  assert.deepEqual(Object.keys(e.errors).sort(), ["priority", "status", "title"]);
  assert.equal(L.checkSource({ url: "example.com/read", kind: "article" }).value.title, "example.com", "a missing title becomes the site name");
  assert.equal(L.checkSource({ url: "javascript:alert(1)", kind: "article" }).ok, false);
  assert.equal(L.checkSource({ url: "https://a.example.com", kind: "carrier-pigeon" }).ok, false);
});

test("note form: text required, tags cleaned, links checked, source only inside a linked project", () => {
  const books = [book({ id: "b1" })], res = [research({ id: "r1", sources: [{ id: "s1", url: "https://a.example.com" }] }), research({ id: "r2" })];
  const ctx = { today: TODAY, books: books, research: res };
  assert.equal(L.checkNote({ type: "takeaway", text: "  " }, ctx).errors.text.length > 0, true);
  assert.ok(L.checkNote({ type: "x", text: "hi" }, ctx).errors.type);
  assert.ok(L.checkNote({ type: "note", text: "hi", bookIds: ["gone"] }, ctx).errors.bookIds);
  assert.ok(L.checkNote({ type: "note", text: "hi", researchIds: ["gone"] }, ctx).errors.researchIds);
  const v = L.checkNote({ type: "finding", text: "Sleep helps", evidence: "Study X", tags: "Sleep, #focus", bookIds: ["b1"], researchIds: ["r1"], sourceId: "s1", important: true, page: " 42 " }, ctx).value;
  assert.deepEqual([v.tags, v.sourceId, v.important, v.page, v.evidence, v.day], [["sleep", "focus"], "s1", true, "42", "Study X", TODAY]);
  assert.equal(L.checkNote({ type: "finding", text: "t", researchIds: ["r2"], sourceId: "s1" }, ctx).value.sourceId, "", "a source that isn't in a linked project is dropped");
  assert.equal(L.checkNote({ type: "takeaway", text: "t", evidence: "ignored" }, ctx).value.evidence, "", "only findings carry evidence");
  assert.equal(L.checkNote({ type: "takeaway", text: "t", sourceId: "s1" }, ctx).value.sourceId, "", "no linked project: no source");
  assert.equal(L.checkNote({ type: "note", text: "t" }).ok, true, "without lists to check against, links aren't checked");
});

test("action form: lesson required, source must exist, done gets an implemented date", () => {
  const ctx = { today: TODAY, books: [book({ id: "b1" })], research: [research({ id: "r1" })], notes: [note({ id: "n1" })] };
  assert.ok(L.checkAction({ lesson: " ", status: "todo" }, ctx).errors.lesson);
  assert.ok(L.checkAction({ lesson: "x", status: "later" }, ctx).errors.status);
  assert.ok(L.checkAction({ lesson: "x", status: "todo", sourceType: "book", sourceId: "" }, ctx).errors.sourceId);
  assert.ok(L.checkAction({ lesson: "x", status: "todo", sourceType: "book", sourceId: "gone" }, ctx).errors.sourceId);
  assert.ok(L.checkAction({ lesson: "x", status: "todo", targetDate: "2026-02-30" }, ctx).errors.targetDate);
  const a = L.checkAction({ lesson: "Do the thing", plan: "Every morning", status: "done", sourceType: "research", sourceId: "r1", targetDate: "2026-11-20" }, ctx).value;
  assert.deepEqual([a.status, a.implementedAt, a.sourceType, a.sourceId, a.targetDate], ["done", TODAY, "research", "r1", "2026-11-20"]);
  const o = L.checkAction({ lesson: "x", status: "todo", sourceType: "other", sourceId: "ignored", sourceLabel: "A podcast" }, ctx).value;
  assert.deepEqual([o.sourceId, o.sourceLabel, o.implementedAt], ["", "A podcast", ""]);
  assert.equal(L.checkAction({ lesson: "x", status: "todo", sourceType: "bogus" }, ctx).value.sourceType, "none");
});

test("weekly review form: only a Monday names a week", () => {
  assert.equal(L.checkReview({ weekStart: "2026-11-09", reflection: " Good week " }).value.reflection, "Good week");
  assert.ok(L.checkReview({ weekStart: "2026-11-10" }).errors.weekStart);
  assert.ok(L.checkReview({ weekStart: "nope" }).errors.weekStart);
  assert.ok(L.checkReview(null).errors.weekStart);
});

/* ---------------- deleting ---------------- */

test("deleting keeps a tombstone for 30 days, restoring brings it back, and purge drops old ones", () => {
  const b = book();
  const t = L.tombstone(b, NOW);
  assert.deepEqual([t.deletedAt, t.updatedAt], [NOW, NOW]);
  assert.deepEqual(L.live([b, t, null, undefined]).map((x) => x.id), ["b1"].slice(0, 1));
  const r = L.restore(t, NOW + 5);
  assert.equal("deletedAt" in r, false);
  assert.equal(r.updatedAt, NOW + 5);
  const old = Object.assign({}, b, { id: "old", deletedAt: NOW - 31 * DAY }), recent = Object.assign({}, b, { id: "recent", deletedAt: NOW - 29 * DAY });
  assert.deepEqual(L.purge([b, old, recent], NOW).map((x) => x.id), ["b1", "recent"]);
});

/* ---------------- search, filter, sort ---------------- */

const BOOKS = () => [
  book({ id: "b1", title: "Atomic Habits", author: "James Clear", category: "Self-improvement", status: "reading", totalPages: 300, currentPage: 150, rating: 0, createdAt: 10, updatedAt: 500 }),
  book({ id: "b2", title: "Deep Work", author: "Cal Newport", category: "Focus", status: "completed", totalPages: 200, currentPage: 200, rating: 5, createdAt: 20, updatedAt: 300 }),
  book({ id: "b3", title: "The Pragmatic Programmer", author: "Hunt & Thomas", category: "Technology", status: "want", totalPages: 0, currentPage: 0, createdAt: 30, updatedAt: 100 }),
  book({ id: "b4", title: "Zero to One", author: "Peter Thiel", category: "self-improvement", status: "paused", totalPages: 100, currentPage: 40, rating: 3, createdAt: 5, updatedAt: 400 })
];

test("books: search, status, category and sort", () => {
  const ids = (f) => L.filterBooks(BOOKS(), f).map((b) => b.id);
  assert.deepEqual(ids({}), ["b1", "b4", "b2", "b3"], "most recently updated first");
  assert.deepEqual(ids({ q: "habits" }), ["b1"]);
  assert.deepEqual(ids({ q: "cal newport" }), ["b2"], "search looks at the author too");
  assert.deepEqual(ids({ q: "work deep" }), ["b2"], "every word must appear, in any order");
  assert.deepEqual(ids({ q: "nothing like this" }), []);
  assert.deepEqual(ids({ q: "habits newport" }), [], "words from two different books match neither");
  assert.deepEqual(ids({ status: "reading" }), ["b1"]);
  assert.deepEqual(ids({ category: "Self-improvement" }).sort(), ["b1", "b4"], "category matching ignores case");
  assert.deepEqual(ids({ sort: "title" }), ["b1", "b2", "b3", "b4"]);
  assert.deepEqual(ids({ sort: "progress" }), ["b2", "b1", "b4", "b3"], "books with no known progress go last");
  assert.deepEqual(ids({ sort: "rating" }), ["b2", "b4", "b1", "b3"]);
  assert.deepEqual(ids({ sort: "added" }), ["b3", "b2", "b1", "b4"]);
  const gone = BOOKS(); gone[0] = L.tombstone(gone[0], NOW);
  assert.deepEqual(L.filterBooks(gone, {}).map((b) => b.id), ["b4", "b2", "b3"], "deleted books never show");
});

test("research: search covers the question, conclusion and sources; sort by priority", () => {
  const list = [
    research({ id: "r1", title: "Sleep and focus", priority: "high", status: "researching", updatedAt: 3, question: "Does sleep affect focus?" }),
    research({ id: "r2", title: "Cold exposure", priority: "low", status: "planned", updatedAt: 9, question: "", conclusion: "Probably helps recovery", sources: [{ id: "s", title: "Huberman episode", url: "https://hub.example.com/ep" }] }),
    research({ id: "r3", title: "Index funds", priority: "medium", status: "completed", category: "Finance", updatedAt: 6, question: "" })
  ];
  const ids = (f) => L.filterResearch(list, f).map((r) => r.id);
  assert.deepEqual(ids({}), ["r2", "r3", "r1"]);
  assert.deepEqual(ids({ sort: "priority" }), ["r1", "r3", "r2"]);
  assert.deepEqual(ids({ q: "recovery" }), ["r2"]);
  assert.deepEqual(ids({ q: "huberman" }), ["r2"], "source titles are searched");
  assert.deepEqual(ids({ q: "hub.example.com" }), ["r2"], "and their addresses");
  assert.deepEqual(ids({ q: "does sleep" }), ["r1"]);
  assert.deepEqual(ids({ status: "completed" }), ["r3"]);
  assert.deepEqual(ids({ active: true }), ["r1"], "active means researching or analyzing");
  assert.deepEqual(ids({ priority: "high" }), ["r1"]);
  assert.deepEqual(ids({ category: "finance" }), ["r3"]);
  assert.deepEqual(ids({ sort: "title" }), ["r2", "r3", "r1"]);
});

test("notes: search, tag, type, book, project, category, dates, starred, and sort", () => {
  const state = { books: BOOKS(), research: [research({ id: "r1", title: "Sleep and focus", category: "Health" })] };
  const notes = [
    note({ id: "n1", type: "takeaway", text: "Habits compound", tags: ["habits", "mindset"], bookIds: ["b1"], day: "2026-11-09", createdAt: Date.parse("2026-11-09T14:00:00Z"), important: true }),
    note({ id: "n2", type: "quote", text: "You do not rise to the level of your goals", title: "Ch. 1", page: "27", tags: ["habits"], bookIds: ["b1"], day: "2026-11-02", createdAt: Date.parse("2026-11-02T14:00:00Z") }),
    note({ id: "n3", type: "finding", text: "Sleep under 6h hurts attention", evidence: "Meta-analysis", researchIds: ["r1"], tags: ["sleep"], day: "2026-10-20", createdAt: Date.parse("2026-10-20T14:00:00Z") }),
    note({ id: "n4", type: "note", text: "Loose idea about focus", category: "Focus", day: "2026-11-05", createdAt: Date.parse("2026-11-05T14:00:00Z") })
  ];
  const ids = (f) => L.filterNotes(notes, state, f).map((n) => n.id);
  assert.deepEqual(ids({}), ["n1", "n4", "n2", "n3"]);
  assert.deepEqual(ids({ sort: "oldest" }), ["n3", "n2", "n4", "n1"]);
  assert.deepEqual(ids({ sort: "type" }), ["n1", "n2", "n3", "n4"].sort((a, b) => ["takeaway", "chapter", "quote", "reflection", "finding", "note"].indexOf({ n1: "takeaway", n2: "quote", n3: "finding", n4: "note" }[a]) - ["takeaway", "chapter", "quote", "reflection", "finding", "note"].indexOf({ n1: "takeaway", n2: "quote", n3: "finding", n4: "note" }[b])));
  assert.deepEqual(ids({ q: "habits" }).sort(), ["n1", "n2"], "text, and tags");
  assert.deepEqual(ids({ q: "atomic" }).sort(), ["n1", "n2"], "the title of a linked book is searched");
  assert.deepEqual(ids({ q: "sleep and focus" }), ["n3"], "and of a linked project");
  assert.deepEqual(ids({ q: "meta-analysis" }), ["n3"], "evidence is searched");
  assert.deepEqual(ids({ q: "quote" }), ["n2"], "the type's name is searched");
  assert.deepEqual(ids({ tag: "habits" }).sort(), ["n1", "n2"]);
  assert.deepEqual(ids({ type: "finding" }), ["n3"]);
  assert.deepEqual(ids({ bookId: "b1" }).sort(), ["n1", "n2"]);
  assert.deepEqual(ids({ researchId: "r1" }), ["n3"]);
  assert.deepEqual(ids({ important: true }), ["n1"]);
  assert.deepEqual(ids({ category: "Self-improvement" }).sort(), ["n1", "n2"], "a note without a category takes its book's");
  assert.deepEqual(ids({ category: "health" }), ["n3"], "or its research project's");
  assert.deepEqual(ids({ category: "focus" }), ["n4"], "its own wins");
  assert.deepEqual(ids({ from: "2026-11-01", to: "2026-11-06" }), ["n4", "n2"]);
  assert.deepEqual(ids({ from: "2026-11-09" }), ["n1"]);
  assert.deepEqual(ids({ to: "2026-10-31" }), ["n3"]);
  assert.deepEqual(ids({ to: "2026-11-02" }), ["n2", "n3"], "the end date is included");
  assert.deepEqual(ids({ type: "takeaway", tag: "habits", bookId: "b1" }), ["n1"], "filters combine");
  assert.deepEqual(ids({ q: "habits", tag: "sleep" }), []);
  const gone = notes.slice(); gone[0] = L.tombstone(gone[0], NOW);
  assert.ok(!L.filterNotes(gone, state, {}).some((n) => n.id === "n1"));
});

test("tags and categories are collected from what exists, most used first", () => {
  const notes = [note({ id: "a", tags: ["x", "y"] }), note({ id: "b", tags: ["y"] }), L.tombstone(note({ id: "c", tags: ["z", "y"] }), NOW)];
  assert.deepEqual(L.allTags(notes), [{ tag: "y", count: 2 }, { tag: "x", count: 1 }]);
  assert.deepEqual(L.allCategories({ books: BOOKS(), research: [research({ category: "Health" })], notes: [note({ id: "q", category: "focus" })] }), ["Focus", "Health", "Self-improvement", "Technology"], "each category once, ignoring case, sorted");
});

test("actions: search, status, and the date order", () => {
  const state = { books: BOOKS(), research: [], notes: [] };
  const list = [
    action({ id: "a1", lesson: "Read 10 pages daily", status: "doing", targetDate: "2026-11-20", createdAt: 1 }),
    action({ id: "a2", lesson: "Plan the week", status: "todo", targetDate: "2026-11-12", sourceType: "book", sourceId: "b2", createdAt: 2 }),
    action({ id: "a3", lesson: "Journal", status: "done", implementedAt: "2026-11-01", createdAt: 3 }),
    action({ id: "a4", lesson: "Walk after lunch", status: "todo", createdAt: 4, sourceType: "other", sourceLabel: "A podcast" })
  ];
  const ids = (f) => L.filterActions(list, state, f).map((a) => a.id);
  assert.deepEqual(ids({}), ["a2", "a1", "a4", "a3"], "soonest target date first; the ones with no date after, newest first");
  assert.deepEqual(ids({ sort: "newest" }), ["a4", "a3", "a2", "a1"]);
  assert.deepEqual(ids({ sort: "status" }), ["a4", "a2", "a1", "a3"]);
  assert.deepEqual(ids({ status: "todo" }), ["a2", "a4"]);
  assert.deepEqual(ids({ q: "deep work" }), ["a2"], "the title of the book it came from is searched");
  assert.deepEqual(ids({ q: "podcast" }), ["a4"]);
  assert.deepEqual(L.actionsFor(list, "book", "b2").map((a) => a.id), ["a2"]);
  assert.deepEqual(L.notesFor([note({ id: "n1", bookIds: ["b1"] }), note({ id: "n2", researchIds: ["r1"] })], "research", "r1").map((n) => n.id), ["n2"]);
});

/* ---------------- the dashboard ---------------- */

test("dashboard numbers are counted from the records, and are zero when there are none", () => {
  assert.deepEqual(L.stats({}), { booksReading: 0, activeResearch: 0, takeaways: 0, implemented: 0, booksCompleted: 0 });
  assert.deepEqual(L.stats(null), { booksReading: 0, activeResearch: 0, takeaways: 0, implemented: 0, booksCompleted: 0 });
  const state = {
    books: BOOKS().concat([L.tombstone(book({ id: "bx", status: "reading" }), NOW)]),
    research: [research({ id: "r1", status: "researching" }), research({ id: "r2", status: "analyzing" }), research({ id: "r3", status: "planned" }), research({ id: "r4", status: "completed" }), L.tombstone(research({ id: "r5", status: "researching" }), NOW)],
    notes: [note({ id: "n1", type: "takeaway" }), note({ id: "n2", type: "takeaway" }), note({ id: "n3", type: "quote" }), L.tombstone(note({ id: "n4", type: "takeaway" }), NOW)],
    actions: [action({ id: "a1", status: "done" }), action({ id: "a2", status: "done" }), action({ id: "a3", status: "doing" }), L.tombstone(action({ id: "a4", status: "done" }), NOW)]
  };
  assert.deepEqual(L.stats(state), { booksReading: 1, activeResearch: 2, takeaways: 2, implemented: 2, booksCompleted: 1 }, "deleted records are not counted");
  assert.deepEqual(L.currentBooks(state).map((b) => b.id), ["b1"]);
  assert.deepEqual(L.activeResearch(state).map((r) => r.id), ["r1", "r2"].sort((a, b) => 0));
  assert.equal(L.recentNotes(state, 2).length, 2);
  assert.deepEqual(L.recentNotes(state, 10).map((n) => n.id).sort(), ["n1", "n2", "n3"]);
});

test("upcoming learning tasks: not finished, by date, flagged when overdue", () => {
  const state = { actions: [
    action({ id: "late", status: "doing", targetDate: "2026-11-05", createdAt: 1 }), action({ id: "soon", status: "todo", targetDate: "2026-11-11", createdAt: 2 }),
    action({ id: "today", status: "todo", targetDate: TODAY, createdAt: 3 }), action({ id: "none", status: "todo", createdAt: 4 }), action({ id: "done", status: "done", targetDate: "2026-11-01", createdAt: 5 }),
    L.tombstone(action({ id: "gone", status: "todo", targetDate: "2026-11-02" }), NOW)
  ] };
  const up = L.upcomingActions(state, 10, TODAY);
  assert.deepEqual(up.map((a) => [a.id, a.overdue, a.dueInDays]), [["late", true, -4], ["today", false, 0], ["soon", false, 2], ["none", false, null]]);
  assert.equal(L.upcomingActions(state, 2, TODAY).length, 2);
});

/* ---------------- the weekly review ---------------- */

function reviewState() {
  return {
    books: [
      book({ id: "b1", title: "Atomic Habits", status: "reading", currentPage: 55, startDate: "2026-11-02", log: [{ d: "2026-11-02", p: 0 }, { d: "2026-11-10", p: 30 }, { d: "2026-11-13", p: 55 }] }),
      book({ id: "b2", title: "Deep Work", status: "completed", totalPages: 200, currentPage: 200, startDate: "2026-10-01", endDate: "2026-11-12", log: [{ d: "2026-10-01", p: 0 }, { d: "2026-11-05", p: 150 }, { d: "2026-11-12", p: 200 }] }),
      book({ id: "b3", title: "Stalled Book", status: "reading", currentPage: 10, log: [{ d: "2026-10-20", p: 10 }] }),
      book({ id: "b4", title: "Brand new", status: "reading", currentPage: 0, log: [] })
    ],
    research: [
      research({ id: "r1", title: "Sleep", status: "completed", completedAt: "2026-11-11", sources: [{ id: "s1", url: "https://a.example.com", addedAt: Date.parse("2026-11-10T12:00:00Z") }, { id: "s2", url: "https://b.example.com", addedAt: Date.parse("2026-10-01T12:00:00Z") }] }),
      research({ id: "r2", title: "Cold exposure", status: "planned", priority: "high" })
    ],
    notes: [
      note({ id: "n1", type: "takeaway", text: "Big lesson", important: true, day: "2026-11-10", createdAt: Date.parse("2026-11-10T14:00:00Z") }),
      note({ id: "n2", type: "takeaway", text: "Smaller lesson", day: "2026-11-12", createdAt: Date.parse("2026-11-12T14:00:00Z") }),
      note({ id: "n3", type: "finding", text: "Found it", researchIds: ["r1"], day: "2026-11-11", createdAt: Date.parse("2026-11-11T14:00:00Z") }),
      note({ id: "n4", type: "quote", text: "Last week's quote", day: "2026-11-03", createdAt: Date.parse("2026-11-03T14:00:00Z") })
    ],
    actions: [
      action({ id: "a1", lesson: "Done thing", status: "done", implementedAt: "2026-11-13" }), action({ id: "a2", lesson: "Old done", status: "done", implementedAt: "2026-11-03" }),
      action({ id: "a3", lesson: "Overdue one", status: "todo", targetDate: "2026-11-05" }), action({ id: "a4", lesson: "Due this week", status: "doing", targetDate: "2026-11-14" }),
      action({ id: "a5", lesson: "Far away", status: "todo", targetDate: "2026-12-30" })
    ],
    reviews: []
  };
}

test("weekly review: every figure comes from the records", () => {
  const rv = L.weeklyReview(reviewState(), "2026-11-09", "2026-11-15");
  assert.deepEqual(rv.week, { start: "2026-11-09", end: "2026-11-15" });
  assert.deepEqual(rv.reading.perBook, [{ id: "b2", title: "Deep Work", pages: 50 }, { id: "b1", title: "Atomic Habits", pages: 55 }].sort((a, b) => b.pages - a.pages));
  assert.equal(rv.reading.pages, 105);
  assert.deepEqual(rv.reading.finished.map((b) => b.id), ["b2"]);
  assert.deepEqual(rv.reading.started.map((b) => b.id), []);
  assert.deepEqual(rv.research.completed.map((r) => r.id), ["r1"]);
  assert.equal(rv.research.findingsAdded, 1);
  assert.equal(rv.research.sourcesAdded, 1, "only the source added this week");
  assert.deepEqual(rv.notes, { total: 3, byType: { takeaway: 2, finding: 1 } }, "last week's quote isn't counted");
  assert.deepEqual(rv.lessons.starred.map((n) => n.id), ["n1"]);
  assert.deepEqual(rv.lessons.takeaways.map((n) => n.id).sort(), ["n1", "n2"]);
  assert.deepEqual(rv.implemented.map((a) => a.id), ["a1"]);
  assert.equal(rv.empty, false);
});

test("weekly review: what to focus on next is explained, and a quiet week says so", () => {
  const rv = L.weeklyReview(reviewState(), "2026-11-09", "2026-11-13");   // Friday
  const by = (kind) => rv.focus.filter((f) => f.kind === kind).map((f) => f.id);
  assert.deepEqual(by("action"), ["a3", "a4"], "overdue first, then due within a week; the far-away one isn't pushed");
  assert.match(rv.focus.find((f) => f.id === "a3").reason, /Overdue: it was due 2026-11-05/);
  assert.match(rv.focus.find((f) => f.id === "a4").reason, /Due 2026-11-14/);
  assert.deepEqual(by("book").sort(), ["b3", "b4"], "a book with no update for a week, and one with none yet; not the one updated on Friday");
  assert.match(rv.focus.find((f) => f.id === "b3").reason, /No page update for 24 days/);
  assert.match(rv.focus.find((f) => f.id === "b4").reason, /haven't logged a page/);
  assert.deepEqual(by("research"), ["r2"]);
  assert.ok(rv.focus.every((f) => f.title && f.reason));
  const quiet = L.weeklyReview({ books: [], research: [], notes: [], actions: [], reviews: [] }, "2026-11-09", "2026-11-15");
  assert.equal(quiet.empty, true);
  assert.deepEqual([quiet.reading.pages, quiet.notes.total, quiet.focus.length, quiet.saved], [0, 0, 0, null]);
  const nothingThatWeek = L.weeklyReview(reviewState(), "2026-09-07", "2026-11-15");
  assert.equal(nothingThatWeek.reading.pages, 0);
  assert.equal(nothingThatWeek.notes.total, 0);
  assert.equal(nothingThatWeek.implemented.length, 0);
});

test("weekly review: a saved reflection is attached to its week only", () => {
  const s = reviewState();
  s.reviews = [L.readReview({ id: "wk_2026-11-09", weekStart: "2026-11-09", reflection: "Solid", focusNext: "Finish Deep Work" }), L.tombstone(L.readReview({ id: "wk_2026-11-02", weekStart: "2026-11-02", reflection: "deleted" }), NOW)];
  assert.equal(L.weeklyReview(s, "2026-11-09", TODAY).saved.reflection, "Solid");
  assert.equal(L.weeklyReview(s, "2026-11-02", TODAY).saved, null, "a deleted review is gone");
  assert.equal(L.weeklyReview(s, "2026-11-16", TODAY).saved, null);
});
