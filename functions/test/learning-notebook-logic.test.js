"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const N = require("../../js/learning-notebook-logic");

const TODAY = "2026-11-11";
const book = (o) => Object.assign({ id: "b1", title: "Atomic Habits", status: "reading", totalPages: 300, currentPage: 100, log: [{ d: "2026-11-02", p: 40 }, { d: "2026-11-05", p: 100 }] }, o);
const entry = (o) => Object.assign({ id: "bn1", bookId: "b1", day: "2026-11-03", pages: "", chapter: "", notes: "", takeaways: "", lessons: "", quotes: "", createdAt: 1000, updatedAt: 1000 }, o);
const note = (o) => Object.assign({ id: "nt1", type: "note", title: "", text: "An older note", bookIds: ["b1"], createdAt: Date.parse("2026-10-30T15:00:00"), updatedAt: 1, day: "" }, o);

test("a reading session is a registered record kind with its own key and id prefix", () => {
  assert.equal(L.KEYS.entries, "jarvisLearnBookNotes");
  assert.equal(L.PREFIX.entries, "bn");
  assert.ok(L.kinds().includes("entries"), "the store will load it");
  const r = L.readList("entries", [entry({ chapter: "Chapter 1" }), { id: "bad" }, "junk", null, entry({ id: "bn2", bookId: "" })]);
  assert.equal(r.items.length, 1, "only records that can be sessions are read");
  assert.equal(r.items[0].chapter, "Chapter 1");
});

test("reading a stored session cleans it and keeps what it does not understand out", () => {
  const r = N.read({ id: "x", bookId: "b1", day: "2026-11-03", pages: "  45 – 62 ", chapter: "Ch\u0007 4", notes: "line one\r\nline two  \n", pinned: true, extra: "ignored", createdAt: 5, updatedAt: 6 });
  assert.equal(r.pages, "45 – 62");
  assert.equal(r.chapter, "Ch 4");
  assert.equal(r.notes, "line one\nline two");
  assert.equal(r.pinned, true);
  assert.equal(r.extra, undefined);
  assert.equal(N.read({ id: "x", bookId: "b1", day: "2026-11-03" }).pinned, undefined, "not pinned unless it says so");
  for (const bad of [null, "s", 5, [], {}, { id: "x" }, { id: "x", bookId: "b1" }, { id: "x", bookId: "b1", day: "11/03/2026" }, { id: "", bookId: "b1", day: "2026-11-03" }]) assert.equal(N.read(bad), null, JSON.stringify(bad));
  assert.equal(N.read({ id: "x", bookId: "b1", day: "2026-11-03" }).notes, "", "a session with no text is kept, not thrown away");
  assert.equal(N.read({ id: "x", bookId: "b1", day: "2026-11-03", notes: "x".repeat(30000) }).notes.length, N.LIMIT.notes, "very long text is cut, not refused");
});

test("checking a session being typed", () => {
  const ctx = { today: TODAY, books: [{ id: "b1" }, { id: "gone", deletedAt: 5 }] };
  const ok = N.check({ bookId: "b1", day: "2026-11-11", pages: " 10-20 ", chapter: "  Chapter 2 ", notes: "n", takeaways: "t", lessons: "l", quotes: "q" }, ctx);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { bookId: "b1", day: "2026-11-11", pages: "10-20", chapter: "Chapter 2", notes: "n", takeaways: "t", lessons: "l", quotes: "q" });
  assert.match(N.check({ day: TODAY }, ctx).errors.bookId, /Choose the book/);
  assert.match(N.check({ bookId: "nope", day: TODAY }, ctx).errors.bookId, /no longer exists/);
  assert.match(N.check({ bookId: "gone", day: TODAY }, ctx).errors.bookId, /no longer exists/, "a deleted book is not a book");
  assert.match(N.check({ bookId: "b1", day: "" }, ctx).errors.day, /Choose the day/);
  assert.match(N.check({ bookId: "b1", day: "2026-11-12" }, ctx).errors.day, /hasn't happened/);
  assert.equal(N.check({ bookId: "b1", day: "2026-01-01" }, ctx).ok, true, "an earlier day is fine (catching up on notes)");
  assert.equal(N.check(null, ctx).ok, false);
});

test("empty means nothing written yet, and the date alone is not something to save", () => {
  assert.equal(N.isEmpty({ bookId: "b1", day: TODAY }), true);
  assert.equal(N.isEmpty({ bookId: "b1", day: TODAY, notes: "" }), true);
  for (const f of ["pages", "chapter", "notes", "takeaways", "lessons", "quotes"]) assert.equal(N.isEmpty({ [f]: "x" }), false, f);
  assert.equal(N.same(entry({ notes: "a" }), entry({ notes: "a", updatedAt: 99 })), true, "timestamps do not make two sessions different");
  assert.equal(N.same(entry({ notes: "a" }), entry({ notes: "b" })), false);
});

test("one idea per line: bullets and numbers are stripped, blank lines dropped", () => {
  assert.deepEqual(N.items("- one\n* two\n• three\n2) four\n5. five\n\n   \nsix"), ["one", "two", "three", "four", "five", "six"]);
  assert.deepEqual(N.items("2026 was a year\n-not a bullet"), ["2026 was a year", "-not a bullet"], "a number or a dash with no space is part of the sentence");
  assert.deepEqual(N.items(""), []);
  assert.deepEqual(N.items(null), []);
  assert.equal(N.preview(entry({ notes: "", takeaways: "- Small habits compound\n- Second" })), "Small habits compound");
  assert.equal(N.preview(entry({ notes: "First line\nsecond", takeaways: "T" })), "First line");
  assert.equal(N.preview(entry({})), "");
  assert.equal(N.preview(entry({ notes: "x".repeat(300) }), 20).length, 20);
});

test("a book's sessions come back oldest first, the way a notebook is read; other books' and deleted ones are left out", () => {
  const list = [
    entry({ id: "c", day: "2026-11-05", createdAt: 30 }), entry({ id: "a", day: "2026-11-03", createdAt: 10 }), entry({ id: "b", day: "2026-11-03", createdAt: 20 }),
    entry({ id: "z", bookId: "other", day: "2026-11-01" }), entry({ id: "d", day: "2026-11-04", deletedAt: 5 })
  ];
  assert.deepEqual(N.forBook(list, "b1").map((x) => x.id), ["a", "b", "c"], "by day, then in the order they were written");
  assert.deepEqual(N.forBook(null, "b1"), []);
});

test("the notebook: sessions and older notes about the book are together, in date order, and nothing else is", () => {
  const S = {
    entries: [entry({ id: "s1", day: "2026-11-03", notes: "Day three" }), entry({ id: "s2", day: "2026-11-09", notes: "Day nine" })],
    notes: [note({ id: "n1", day: "2026-11-06" }), note({ id: "n2", bookIds: ["other"] }), note({ id: "n3", day: "2026-11-01", deletedAt: 9 }), note({ id: "n4", day: "", createdAt: Date.parse("2026-10-30T15:00:00") })],
    actions: []
  };
  const nb = N.notebook(book(), S);
  assert.deepEqual(nb.timeline.map((x) => x.id), ["n4", "s1", "n1", "s2"], "an older note with no day is placed by the day it was made");
  assert.equal(nb.totalSessions, 2);
  assert.equal(nb.totalNotes, 2, "older notes linked to the book are counted separately from sessions");
  assert.equal(nb.counts.notebook, 4);
  assert.equal(nb.timeline[0].kind, "note");
  assert.equal(nb.timeline[1].kind, "session");
  assert.equal(nb.lastDay, "2026-11-09", "the last read day comes from the sessions and the page log, whichever is later");
  assert.equal(N.notebook(book({ log: [{ d: "2026-11-10", p: 120 }] }), S).lastDay, "2026-11-10");
  assert.equal(N.notebook(book({ id: "empty", log: [] }), S).lastDay, "");
});

test("grouping by date puts the sessions of one day together, oldest day first", () => {
  const S = { entries: [entry({ id: "a", day: "2026-11-03", createdAt: 1, notes: "x" }), entry({ id: "b", day: "2026-11-03", createdAt: 2, notes: "y" }), entry({ id: "c", day: "2026-11-05", notes: "z" })], notes: [], actions: [] };
  const g = N.notebook(book(), S, { view: "date" }).groups;
  assert.deepEqual(g.map((x) => [x.key, x.items.map((i) => i.id)]), [["2026-11-03", ["a", "b"]], ["2026-11-05", ["c"]]]);
  assert.equal(g[0].kind, "date");
});

test("grouping by chapter: natural order, 'No chapter' last, older notes use a chapter written in their page field", () => {
  const S = {
    entries: [entry({ id: "a", chapter: "Chapter 10", day: "2026-11-09" }), entry({ id: "b", chapter: "chapter 2", day: "2026-11-03" }), entry({ id: "c", chapter: "Chapter 2", day: "2026-11-04" }), entry({ id: "d", chapter: "", day: "2026-11-05" })],
    notes: [note({ id: "n1", page: "Ch 1", day: "2026-11-01" }), note({ id: "n2", page: "45", day: "2026-11-02" })], actions: []
  };
  const g = N.notebook(book(), S, { view: "chapter" }).groups;
  assert.deepEqual(g.map((x) => x.label), ["Ch 1", "chapter 2", "Chapter 10", "No chapter"], "Chapter 2 comes before Chapter 10; the label is the first spelling used");
  assert.deepEqual(g[1].items.map((i) => i.id), ["b", "c"], "chapter names that differ only in capitals are one chapter, oldest session first");
  assert.deepEqual(g[3].items.map((i) => i.id), ["n2", "d"], "a note whose page field is only a number has no chapter");
  assert.equal(g[3].kind, "none");
  assert.equal(N.noteChapter({ page: "p. 45" }), "p. 45", "words in the field make it a chapter or section label");
});

test("pinned sessions and starred older notes come first and are not listed twice", () => {
  const S = { entries: [entry({ id: "a", day: "2026-11-03", pinned: true }), entry({ id: "b", day: "2026-11-04" })], notes: [note({ id: "n1", day: "2026-11-02", important: true })], actions: [] };
  const nb = N.notebook(book(), S);
  assert.deepEqual(nb.pinned.map((x) => x.id), ["n1", "a"]);
  assert.deepEqual(nb.groups.reduce((a, g) => a.concat(g.items.map((i) => i.id)), []), ["b"], "the pinned ones leave the timeline");
  assert.equal(nb.counts.notebook, 3, "but they still count");
});

test("searching a book: every word must be in the session or note, case does not matter, and every list follows it", () => {
  const S = {
    entries: [
      entry({ id: "a", chapter: "Habit loops", notes: "The cue, craving, response and reward", takeaways: "- Habits are a loop", lessons: "- Put the cue where I will see it", quotes: "- You do not rise to the level of your goals" }),
      entry({ id: "b", day: "2026-11-05", chapter: "Identity", notes: "Who I want to become", takeaways: "- Every action is a vote" })
    ],
    notes: [note({ id: "n1", type: "takeaway", text: "Environment beats motivation" })], actions: []
  };
  const all = N.notebook(book(), S);
  assert.equal(all.counts.notebook, 3);
  const q = N.notebook(book(), S, { q: "  CRAVING   cue " });
  assert.deepEqual(q.timeline.map((x) => x.id), ["a"]);
  assert.equal(q.totalSessions, 2, "the total does not shrink with the search");
  assert.deepEqual(N.notebook(book(), S, { q: "vote" }).lessons.map((x) => x.text), ["Every action is a vote"]);
  assert.deepEqual(N.notebook(book(), S, { q: "rise level" }).quotes.map((x) => x.text), ["You do not rise to the level of your goals"]);
  assert.deepEqual(N.notebook(book(), S, { q: "see it" }).ideas.map((x) => x.text), ["Put the cue where I will see it"]);
  assert.equal(N.notebook(book(), S, { q: "identity" }).timeline.length, 1, "the chapter name is searched too");
  assert.equal(N.notebook(book(), S, { q: "motivation" }).timeline[0].id, "n1", "older notes are searched");
  assert.equal(N.notebook(book(), S, { q: "zzzz" }).counts.notebook, 0);
  assert.equal(N.matches({ kind: "session", record: entry({ notes: "alpha" }) }, ""), true, "no words, no filter");
});

test("key lessons, quotes and ideas to apply are gathered from the sessions and from older notes of the matching kind", () => {
  const S = {
    entries: [
      entry({ id: "a", day: "2026-11-03", chapter: "Ch 1", takeaways: "- One\n- Two", quotes: "- A quote", lessons: "- Do the thing\n- Do the other thing" }),
      entry({ id: "b", day: "2026-11-05", takeaways: "Three" })
    ],
    notes: [note({ id: "n1", type: "takeaway", title: "Old lesson", text: "Details", day: "2026-11-01" }), note({ id: "n2", type: "quote", text: "Old quote", day: "2026-11-02" }), note({ id: "n3", type: "reflection", text: "not a lesson" })],
    actions: [{ id: "ac1", lesson: "Do the thing", sourceType: "book", sourceId: "b1", status: "todo", plan: "" }, { id: "ac2", lesson: "Elsewhere", sourceType: "book", sourceId: "other" }, { id: "ac3", lesson: "Gone", sourceType: "book", sourceId: "b1", deletedAt: 5 }]
  };
  const nb = N.notebook(book(), S);
  assert.deepEqual(nb.lessons.map((x) => x.text), ["Old lesson — Details", "One", "Two", "Three"], "lessons are in date order, one per line");
  assert.deepEqual(nb.lessons.map((x) => x.kind), ["note", "session", "session", "session"]);
  assert.deepEqual(nb.quotes.map((x) => x.text), ["Old quote", "A quote"]);
  assert.deepEqual(nb.ideas.map((x) => x.text), ["Do the other thing"], "a lesson that already became an action is not listed as an idea again");
  assert.deepEqual(nb.actions.map((a) => a.id), ["ac1"], "only this book's live actions");
  assert.equal(nb.counts.actions, 2, "ideas to plan plus tracked actions");
  assert.equal(nb.lessons[1].chapter, "Ch 1");
  assert.equal(nb.lessons[1].day, "2026-11-03");
  assert.equal(nb.lessons[1].from, "a", "each line knows which session it came from");
});

test("damaged or missing lists do not break the notebook", () => {
  assert.doesNotThrow(() => N.notebook(book(), null));
  assert.doesNotThrow(() => N.notebook(book(), { entries: "x", notes: 5, actions: {} }));
  const nb = N.notebook(book(), { entries: [null, 3, entry({ id: "ok", notes: "fine" })], notes: [null], actions: [null] });
  assert.equal(nb.totalSessions, 1);
  assert.equal(nb.counts.notebook, 1);
  assert.equal(N.notebook(null, {}).totalSessions, 0);
});
