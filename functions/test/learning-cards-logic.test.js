"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const S = require("../../js/learning-srs");
const K = require("../../js/learning-cards-logic");

const TODAY = "2026-11-09";
const card = (o) => K.read(Object.assign({ id: "c1", question: "What is a habit loop?", answer: "Cue, craving, response, reward.", createdAt: 1, updatedAt: 1 }, o));
const note = (o) => L.readNote(Object.assign({ id: "n1", type: "takeaway", text: "Small habits compound.", day: TODAY, createdAt: 1, updatedAt: 1 }, o));

test("a card needs a question and an answer, and unreadable ones are kept, not shown", () => {
  assert.equal(L.KEYS.cards, "jarvisLearnCards");
  assert.equal(L.PREFIX.cards, "cd");
  assert.equal(card({}).question, "What is a habit loop?");
  assert.equal(card({ answer: "  " }), null);
  assert.equal(card({ question: "" }), null);
  assert.equal(K.read({ question: "q", answer: "a" }), null, "no id");
  const r = L.readList("cards", [{ id: "a", question: "q", answer: "a" }, { id: "b", question: "only a question" }, "junk"]);
  assert.deepEqual([r.items.length, r.kept.length], [1, 2]);
  const c = card({ srs: S.start(TODAY), tags: ["#Habits", "habits"], bookIds: ["b1", "b1"], chapter: "  Ch 3 ", inbox: true });
  assert.deepEqual([c.srs.on, c.tags, c.bookIds, c.chapter, c.inbox], [true, ["habits"], ["b1"], "Ch 3", true]);
  assert.equal(JSON.stringify(card({})).includes("srs"), false, "nothing extra is stored for a card with no schedule");
});

test("card form: both sides required, links checked, scheduled or practice-only", () => {
  const ctx = { today: TODAY, books: [{ id: "b1" }], research: [{ id: "r1" }] };
  assert.deepEqual(K.check({ question: "", answer: "" }, ctx).errors, { question: "Write the question.", answer: "Write the answer, so you can check yourself." });
  assert.equal(K.check({ question: "q", answer: "a", bookIds: ["gone"] }, ctx).errors.bookIds, "One of the linked books no longer exists.");
  assert.equal(K.check({ question: "q", answer: "a", researchIds: ["gone"] }, ctx).errors.researchIds, "One of the linked research projects no longer exists.");
  const sched = K.check({ question: "q", answer: "a", remember: true, bookIds: ["b1"], researchIds: ["r1"], chapter: "Ch 2", tags: "habits, memory" }, ctx).value;
  assert.deepEqual([sched.srs.due, sched.bookIds, sched.researchIds, sched.chapter, sched.tags], ["2026-11-10", ["b1"], ["r1"], "Ch 2", ["habits", "memory"]]);
  assert.equal(K.check({ question: "q", answer: "a", remember: false }, ctx).value.srs, undefined, "practice only: no schedule");
  const existing = S.pause(S.start("2026-11-01"));
  assert.deepEqual(K.check({ question: "q2", answer: "a", remember: true }, Object.assign({}, ctx, { existingSrs: existing })).value.srs, existing, "editing the wording keeps a paused schedule as it was");
  assert.equal(K.check({ question: "q", answer: "a", remember: false }, Object.assign({}, ctx, { existingSrs: existing })).value.srs.on, false, "taking it out of the schedule keeps its history");
  assert.equal(K.check({ question: "q", answer: "a", inbox: true }, ctx).value.inbox, true);
});

test("cards: search, topic, book, project, schedule status, and sort", () => {
  const cards = [
    card({ id: "a", question: "Define opportunity cost", answer: "The next best alternative given up.", tags: ["economics"], bookIds: ["b1"], createdAt: 1, srs: Object.assign(S.start("2026-11-01"), { due: "2026-11-05" }) }),
    card({ id: "b", question: "What is anchoring?", answer: "Relying on the first number seen.", tags: ["psychology"], researchIds: ["r1"], createdAt: 3, srs: Object.assign(S.start("2026-11-01"), { due: "2026-11-20" }) }),
    card({ id: "c", question: "Zeigarnik effect?", answer: "Unfinished tasks stay in mind.", tags: ["psychology"], createdAt: 2 }),
    card({ id: "d", question: "Paused card", answer: "x", createdAt: 4, srs: S.pause(S.start("2026-11-01")) })
  ];
  const state = { books: [L.readBook({ id: "b1", title: "Thinking Fast and Slow", createdAt: 1, updatedAt: 1 })], research: [L.readResearch({ id: "r1", title: "Pricing psychology", createdAt: 1, updatedAt: 1 })] };
  const ids = (f) => K.filter(cards, state, f, TODAY).map((x) => x.id);
  assert.deepEqual(ids({}), ["d", "b", "c", "a"], "newest first");
  assert.deepEqual(ids({ q: "anchoring" }), ["b"]);
  assert.deepEqual(ids({ q: "thinking fast" }), ["a"], "search covers the books a card is linked to");
  assert.deepEqual(ids({ q: "pricing" }), ["b"], "and projects");
  assert.deepEqual(ids({ tag: "psychology" }), ["b", "c"]);
  assert.deepEqual(ids({ bookId: "b1" }), ["a"]);
  assert.deepEqual(ids({ researchId: "r1" }), ["b"]);
  assert.deepEqual(ids({ status: "due" }), ["a"], "due today or earlier, and not paused");
  assert.deepEqual(ids({ status: "scheduled" }), ["b", "a"], "scheduled and not paused");
  assert.deepEqual(ids({ status: "paused" }), ["d"]);
  assert.deepEqual(ids({ status: "practice" }), ["c"], "practice-only: not in the review schedule");
  assert.deepEqual(ids({ sort: "due" }), ["a", "b", "d", "c"], "soonest review first, then paused ones, then cards with no schedule");
  assert.deepEqual(ids({ sort: "question" }), ["a", "d", "b", "c"].sort((x, y) => cards.find((c) => c.id === x).question.localeCompare(cards.find((c) => c.id === y).question)));
});

test("accuracy is a real percentage or nothing at all", () => {
  assert.equal(K.accuracy(card({})), null);
  assert.equal(K.accuracy(card({ srs: S.start(TODAY) })), null, "scheduled but never answered");
  let s = S.start("2026-11-01");
  ["good", "forgot", "easy", "hard"].forEach((g, i) => { s = S.grade(s, g, "2026-11-0" + (i + 2)); });
  assert.equal(K.accuracy(card({ srs: s })), 75);
  const sorted = K.filter([card({ id: "x", srs: s }), card({ id: "never" }), card({ id: "bad", srs: S.grade(S.start("2026-11-01"), "forgot", "2026-11-02") })], {}, { sort: "hardest" }, TODAY);
  assert.deepEqual(sorted.map((c) => c.id), ["bad", "x", "never"], "hardest first; never answered last");
});

test("shuffling is a real shuffle, keeps everything, and does not change the original", () => {
  const list = [1, 2, 3, 4, 5, 6];
  const a = K.shuffle(list, () => 0);
  assert.deepEqual(a, [2, 3, 4, 5, 6, 1], "a fixed 'random' gives a fixed order (so this can be tested)");
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6]);
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const b = K.shuffle(list, rand);
  assert.deepEqual(b.slice().sort(), list, "nothing lost or doubled");
  assert.notDeepEqual(b, list);
  assert.deepEqual(K.shuffle([], rand), []);
});

test("study queues: due review (lessons and cards together) or practice by topic", () => {
  const due = (d) => Object.assign(S.start("2026-11-01"), { due: d });
  const state = {
    notes: [note({ id: "n1", srs: due("2026-11-06") }), note({ id: "n2", srs: due("2026-11-20") }), note({ id: "n3" })],
    cards: [card({ id: "c1", srs: due("2026-11-04") }), card({ id: "c2", srs: due("2026-11-09") }), card({ id: "c3", tags: ["psych"] }), card({ id: "c4", tags: ["psych"], srs: due("2026-11-01") })]
  };
  assert.deepEqual(K.queue(state, { mode: "due" }, TODAY).map((x) => x.kind + ":" + x.id), ["cards:c4", "cards:c1", "notes:n1", "cards:c2"], "most overdue first; later ones and unscheduled ones left out");
  assert.equal(K.queue(state, { mode: "due", limit: 2 }, TODAY).length, 2);
  assert.deepEqual(K.queue(state, { mode: "practice", tag: "psych", shuffle: false }, TODAY).map((x) => x.id).sort(), ["c3", "c4"], "practice picks cards by topic, including ones not in the schedule");
  assert.equal(K.queue(state, { mode: "practice", shuffle: false, limit: 3 }, TODAY).length, 3);
  assert.equal(K.queue(state, { mode: "practice", onlyDue: true, shuffle: false }, TODAY).length, 3, "'only due' practice lists the due cards");
  assert.ok(K.queue(state, { mode: "practice" }, TODAY).every((x) => x.kind === "cards"), "practice is flashcards only");
  assert.deepEqual(K.queue({ notes: [], cards: [] }, { mode: "due" }, TODAY), []);
});
