"use strict";

// The second round of Learning rules: pages counted once, spaced repetition on notes, new kinds of note, research checklists,
// source status, templates, archiving, the review's new boxes, the inbox and registering new kinds of record.

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const S = require("../../js/learning-srs");

const TODAY = "2026-11-09";
const NOW = Date.parse("2026-11-09T15:00:00Z");
const book = (o) => L.readBook(Object.assign({ id: "b1", title: "Atomic Habits", totalPages: 300, currentPage: 0, status: "reading", createdAt: 1, updatedAt: 1, log: [] }, o));
const note = (o) => L.readNote(Object.assign({ id: "n1", type: "takeaway", text: "Small habits compound.", tags: [], day: TODAY, createdAt: NOW, updatedAt: NOW }, o));
const research = (o) => L.readResearch(Object.assign({ id: "r1", title: "Sleep and focus", priority: "medium", status: "researching", createdAt: 1, updatedAt: 1, sources: [] }, o));
const log = (...pairs) => pairs.map(([d, p]) => ({ d, p }));

test("each page is counted once: corrections and re-reading add nothing", () => {
  const b = book({ log: log(["2026-11-01", 100], ["2026-11-02", 120], ["2026-11-03", 110], ["2026-11-04", 130]) });
  assert.deepEqual(L.dailyPages(b), [{ d: "2026-11-01", pages: 0 }, { d: "2026-11-02", pages: 20 }, { d: "2026-11-03", pages: 0 }, { d: "2026-11-04", pages: 10 }], "100 -> 120 -> corrected to 110 -> 130 is 30 pages in all, not 40");
  assert.equal(L.pagesInRange(b, "2026-11-01", "2026-11-30"), 30);
  assert.equal(L.pagesInRange(b, "2026-11-03", "2026-11-04"), 10, "a range counts only the days inside it");
  assert.equal(L.pagesInRange(b, "2026-11-05", "2026-11-30"), 0);
  assert.deepEqual(L.dailyPages(book({ log: [] })), [], "no log, no pages");
  assert.deepEqual(L.dailyPages(book({ log: log(["2026-11-01", 50]) })), [{ d: "2026-11-01", pages: 0 }], "the first update is only the starting point");
  const restart = book({ log: log(["2026-11-01", 200], ["2026-11-02", 5], ["2026-11-03", 150]) });
  assert.equal(L.pagesInRange(restart, "2026-11-01", "2026-11-30"), 0, "going back to the start and re-reading up to the old page adds nothing");
  assert.equal(L.pagesInRange(null, "2026-11-01", "2026-11-30"), 0);
  assert.equal(L.pagesInRange(book({ log: log(["2026-11-01", 10], ["2026-11-01", 25]) }), "2026-11-01", "2026-11-01"), 15, "two updates one day (an unreadable old log can hold them): one day");
});

test("a page typed wrong and fixed the same day is not counted either way", () => {
  let b = book({ currentPage: 0, log: log(["2026-11-01", 100]) });
  b = L.withPage(b, 150, "2026-11-02", NOW);          // typo
  b = L.withPage(b, 105, "2026-11-02", NOW);          // fixed the same day: the day's entry is replaced
  assert.deepEqual(b.log, log(["2026-11-01", 100], ["2026-11-02", 105]));
  assert.equal(L.pagesInRange(b, "2026-11-01", "2026-11-30"), 5);
});

test("new kinds of note, and notes keep the new fields when they are read back", () => {
  ["idea", "question", "opinion"].forEach((t) => assert.equal(note({ type: t }).type, t, t));
  assert.equal(note({ type: "made-up" }).type, "note", "an unknown kind falls back to a plain note");
  const r = note({ srs: S.start(TODAY), linkIds: ["n2", "n2", "n3"], inbox: true });
  assert.deepEqual([r.srs.on, r.srs.due, r.linkIds, r.inbox], [true, "2026-11-10", ["n2", "n3"], true]);
  const plain = note({});
  assert.deepEqual([plain.srs, plain.inbox, plain.linkIds], [undefined, undefined, []], "an old note has none of them");
  assert.equal(JSON.stringify(plain).includes("srs"), false, "and stores nothing extra");
  assert.equal(note({ srs: "garbage" }).srs, undefined, "a damaged schedule is dropped rather than shown");
});

test("note form: spaced repetition on, off and left alone", () => {
  const ctx = { today: TODAY, books: [], research: [], notes: [] };
  const base = { type: "takeaway", text: "Compound effects win." };
  assert.equal(L.checkNote(base, ctx).value.srs, undefined, "not asked for: not scheduled");
  const on = L.checkNote(Object.assign({}, base, { remember: true }), ctx).value;
  assert.deepEqual([on.srs.on, on.srs.due, on.srs.step], [true, "2026-11-10", 0], "ticked: first review tomorrow");
  const existing = S.pause(S.grade(S.start("2026-11-01"), "good", "2026-11-02"));
  const kept = L.checkNote(Object.assign({}, base, { remember: true }), Object.assign({}, ctx, { existingSrs: existing })).value;
  assert.deepEqual(kept.srs, existing, "editing a lesson that is already scheduled and paused changes nothing about its schedule");
  const off = L.checkNote(Object.assign({}, base, { remember: false }), Object.assign({}, ctx, { existingSrs: existing })).value;
  assert.deepEqual([off.srs.on, off.srs.reviews.length], [false, 1], "unticked: switched off, history kept");
  const unchanged = L.checkNote(base, Object.assign({}, ctx, { existingSrs: existing })).value;
  assert.deepEqual(unchanged.srs, existing, "a form that says nothing leaves the schedule alone");
  const q = L.checkNote({ type: "question", text: "Why?", remember: true }, ctx).value;
  assert.equal(q.srs, undefined, "a question is not something to remember");
  const opinion = L.checkNote({ type: "opinion", text: "I think X.", evidence: "because", remember: true }, ctx).value;
  assert.deepEqual([opinion.srs.on, opinion.evidence], [true, "because"], "opinions can be reviewed and can say why");
  assert.equal(L.checkNote({ type: "takeaway", text: "x", inbox: true }, ctx).value.inbox, true, "Quick Capture marks it to organise later");
  assert.equal(L.checkNote({ type: "takeaway", text: "x" }, ctx).value.inbox, undefined, "saving from the full form clears that");
});

test("links between notes: never to itself, never to one that is gone", () => {
  const ctx = { today: TODAY, notes: [{ id: "n2" }, { id: "n3" }], selfId: "n1" };
  assert.deepEqual(L.checkNote({ type: "note", text: "x", linkIds: ["n1", "n2", "gone", "n3", "n2"] }, ctx).value.linkIds, ["n2", "n3"]);
  assert.deepEqual(L.checkNote({ type: "note", text: "x", linkIds: ["a"] }, { today: TODAY }).value.linkIds, ["a"], "when the list of notes is not known the ids are kept");
});

test("research: checklist progress, ticking, and what a form can and cannot change", () => {
  const items = L.cleanChecklist([{ id: "c1", text: "Find sources" }, { text: "  " }, { id: "c1", text: "Duplicate id" }, { text: "Read them", done: true }, "junk"], TODAY);
  assert.deepEqual(items.map((x) => [x.text, x.done, x.doneAt]), [["Find sources", false, ""], ["Duplicate id", false, ""], ["Read them", true, TODAY]], "blank and malformed items are dropped; a ticked one with no date gets today");
  assert.equal(new Set(items.map((x) => x.id)).size, items.length, "ids stay unique");
  const r = research({ checklist: items });
  assert.deepEqual(L.checklistProgress(r), { done: 1, total: 3, pct: 33 });
  assert.deepEqual(L.checklistProgress(research({})), { done: 0, total: 0, pct: null }, "no checklist: no percentage, not 0%");
  const t = L.toggleChecklistItem(r, "c1", "2026-11-10", NOW);
  assert.deepEqual([t.checklist[0].done, t.checklist[0].doneAt, t.updatedAt], [true, "2026-11-10", NOW]);
  assert.equal(L.toggleChecklistItem(t, "c1", "2026-11-11", NOW).checklist[0].done, false, "ticking again unticks it");
  assert.equal(r.checklist[0].done, false, "the original is not changed");
  const withList = L.checkResearch({ title: "T", priority: "low", status: "planned", checklist: [{ text: "One" }] }, { today: TODAY }).value;
  assert.equal(withList.checklist.length, 1);
  const withoutList = L.checkResearch({ title: "T", priority: "low", status: "planned" }, { today: TODAY }).value;
  assert.equal("checklist" in withoutList, false, "a form that does not mention the checklist never wipes it");
  assert.equal(L.readResearch(Object.assign({}, r, { checklist: [{ id: "x", text: "", done: true }, null] })).checklist.length, 0, "unreadable items are not shown");
});

test("research templates: three, each with a starting question and a checklist, nothing saved by itself", () => {
  assert.deepEqual(L.TEMPLATES.map((t) => t.key), ["business", "psychology", "general"]);
  assert.deepEqual(L.TEMPLATES.map((t) => t.label), ["Business and Market Research", "Consumer Psychology Research", "General Learning Research"]);
  L.TEMPLATES.forEach((t) => { assert.ok(t.question && t.purpose && t.category, t.key); assert.ok(t.checklist.length >= 6, t.key); });
  const list = L.checklistFromTemplate("business", (i) => "id" + i);
  assert.equal(list.length, L.TEMPLATES[0].checklist.length);
  assert.deepEqual([list[0].id, list[0].done, list[0].doneAt], ["id0", false, ""]);
  assert.deepEqual(L.checklistFromTemplate("nope"), []);
});

test("sources: not reviewed / reading / reviewed, and a note on how far to trust them", () => {
  const r = research({ sources: [{ id: "s1", title: "A", url: "https://a.example.com", kind: "article", note: "", addedAt: 1 }, { id: "s2", title: "B", url: "https://b.example.com", kind: "paper", state: "reviewed", credibility: "Peer reviewed, small sample", addedAt: 2 }, { id: "s3", title: "C", url: "https://c.example.com", state: "weird" }] });
  assert.deepEqual(r.sources.map((s) => s.state), ["unreviewed", "reviewed", "unreviewed"], "an old source defaults to not reviewed");
  assert.equal(r.sources[1].credibility, "Peer reviewed, small sample");
  const c = L.checkSource({ url: "example.com/x", kind: "article", state: "reading", credibility: "  Blog, no citations " }).value;
  assert.deepEqual([c.state, c.credibility], ["reading", "Blog, no citations"]);
  assert.equal(L.checkSource({ url: "example.com/x", kind: "article" }).value.state, "unreviewed");
  assert.deepEqual(L.SOURCE_STATE.map((x) => x.label), ["Not reviewed", "Reading", "Reviewed"]);
  assert.equal(L.filterResearch([r], { q: "small sample" }).length, 1, "credibility notes are searchable");
});

test("archiving: only completed projects, hidden unless asked for, and un-archived when reopened", () => {
  const done = research({ id: "d", status: "completed", completedAt: "2026-11-01" });
  assert.equal(L.withArchived(done, true, NOW).archived, true);
  assert.equal(L.withArchived(research({}), true, NOW).archived, undefined, "a project in progress cannot be archived");
  const list = [L.withArchived(done, true, NOW), research({ id: "a" }), research({ id: "c", status: "completed", completedAt: "2026-11-02" })];
  const ids = (f) => L.filterResearch(list, f).map((r) => r.id).sort();
  assert.deepEqual(ids({}), ["a", "c"], "archived are hidden by default");
  assert.deepEqual(ids({ archived: "show" }), ["a", "c", "d"]);
  assert.deepEqual(ids({ archived: "only" }), ["d"]);
  assert.equal(L.withResearchStatus(list[0], "analyzing", TODAY, NOW).archived, undefined, "reopening un-archives");
  assert.equal(L.checkResearch({ title: "T", priority: "low", status: "researching", archived: true }, { today: TODAY }).value.archived, undefined, "the form cannot archive something that is not completed");
  assert.equal(L.checkResearch({ title: "T", priority: "low", status: "completed", archived: true }, { today: TODAY }).value.archived, true);
});

test("the weekly review keeps the old two boxes and adds two", () => {
  const old = L.readReview({ id: "wk_2026-11-02", weekStart: "2026-11-02", reflection: "Old lesson", focusNext: "Old focus", createdAt: 1, updatedAt: 1 });
  assert.deepEqual([old.reflection, old.struggled, old.applied, old.focusNext], ["Old lesson", "", "", "Old focus"], "a review saved before keeps its words; the new boxes are empty");
  const v = L.checkReview({ weekStart: "2026-11-02", reflection: "A", struggled: "B", applied: "C", focusNext: "D" }).value;
  assert.deepEqual([v.reflection, v.struggled, v.applied, v.focusNext], ["A", "B", "C", "D"]);
});

test("the inbox collects what was captured but not organised, across notes, actions and cards", () => {
  const state = {
    notes: [note({ id: "n1", inbox: true, createdAt: 3 }), note({ id: "n2", createdAt: 9 }), note({ id: "n3", inbox: true, createdAt: 7, deletedAt: 1 })],
    actions: [L.readAction({ id: "a1", lesson: "Do it", status: "todo", inbox: true, createdAt: 5, updatedAt: 5 })],
    cards: [{ id: "c1", inbox: true, createdAt: 8 }]
  };
  assert.deepEqual(L.inboxItems(state).map((x) => x.kind + ":" + x.record.id), ["cards:c1", "actions:a1", "notes:n1"], "newest first; deleted and organised ones left out");
  assert.deepEqual(L.inboxItems({}), []);
  assert.equal(L.filterNotes(state.notes, state, { inbox: true }).length, 1);
  assert.equal(L.filterNotes([note({ srs: S.start(TODAY) }), note({ id: "x" })], {}, { remember: true }).length, 1, "notes with a review schedule can be listed");
});

test("another module can register its own kind of record", () => {
  const before = L.kinds().length;
  L.registerKind({ kind: "widgets", key: "jarvisLearnWidgets", prefix: "wg", read: (raw) => (raw && raw.id ? { id: raw.id } : null) });
  assert.equal(L.kinds().length, before + 1);
  assert.deepEqual([L.KEYS.widgets, L.PREFIX.widgets], ["jarvisLearnWidgets", "wg"]);
  const r = L.readList("widgets", [{ id: "a" }, { nope: 1 }, { id: "a" }]);
  assert.deepEqual([r.items.length, r.kept.length], [1, 2], "unreadable and duplicate records are kept as they were, like every other kind");
  delete L.KEYS.widgets; delete L.PREFIX.widgets;
});
