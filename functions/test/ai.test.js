"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Anthropic = require("@anthropic-ai/sdk").default;
const ai = require("../lib/ai");
const settingsLib = require("../lib/settings");
const { OWNER, fakeDb, deps } = require("./helpers");

const usagePath = `users/${OWNER}/marketingUsage/2026-10`;
const settingsPath = `users/${OWNER}/marketing/settings`;

function idea(title) {
  return {
    title, platform: "tiktok", objective: "Awareness", targetAudience: "Young Christians who love streetwear",
    awarenessStage: "unaware", contentPillar: "Faith", hook: "What your hoodie says before you do",
    script: "Full script here", shots: ["Close-up of embroidery"], caption: "Wear the Word #gratiel", cta: "Follow for drops",
    researchBasis: [{ point: "Competitor posts frequently", kind: "verified", source: "@x profile snapshot, 2026-10-14" }, { point: "Story-led hooks hold attention", kind: "hypothesis", source: "Strategist judgment" }],
    whyItMightWork: "Pairs identity with faith."
  };
}

function fakeClaude(responses) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (req) => {
      calls.push(req);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    } } }
  };
}

function okResponse(ideas, extra) {
  return Object.assign({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ideas }) }], usage: { input_tokens: 2000, output_tokens: 3000 } }, extra || {});
}

function apiError(Cls, status) {
  const e = Object.create(Cls.prototype);
  e.status = status;
  e.message = "api error";
  return e;
}

test("settings are clamped and defaulted safely", () => {
  const s = settingsLib.sanitizeSettings({ monthlyBudgetUsd: -5, insightPlanMonthlyUsd: "abc", aiModel: "gpt-4", watchlist: ["@A", "a", "bad handle", 5], contentPillars: ["  Faith  ", ""], monthlyCreditCap: 1e9 });
  assert.equal(s.monthlyBudgetUsd, 0);
  assert.equal(s.insightPlanMonthlyUsd, 10, "invalid value falls back to the $10 plan default");
  assert.equal(s.aiModel, "claude-opus-5-5");
  assert.deepEqual(s.watchlist, ["a"]);
  assert.deepEqual(s.contentPillars, ["Faith"]);
  assert.equal(s.monthlyCreditCap, 100000);
});

test("cost estimate uses the model's per-token prices", () => {
  assert.equal(settingsLib.estimateCostUsd("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(settingsLib.estimateCostUsd("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 0.6);
  assert.equal(settingsLib.aiAllowanceUsd({ monthlyBudgetUsd: 20, insightPlanMonthlyUsd: 15 }), 5);
  assert.equal(settingsLib.aiAllowanceUsd({ monthlyBudgetUsd: 20, insightPlanMonthlyUsd: 25 }), 0);
});

test("only the owner can generate, and a missing Claude key is explained", async () => {
  await assert.rejects(ai.generateIdeas("intruder", {}, deps({ anthropic: fakeClaude([]) })), (e) => e.code === "permission-denied");
  await assert.rejects(ai.generateIdeas(OWNER, {}, deps({ anthropic: null })), (e) => e.code === "failed-precondition" && /Claude API key/.test(e.message));
});

test("generates ideas with structured output, fallback, research context and records cost", async () => {
  const db = fakeDb({
    [settingsPath]: { watchlist: ["rival"], brandProfile: "Gratiel makes faith-inspired hoodies.", aiModel: "claude-opus-5-5" },
    [`users/${OWNER}/marketingSnapshots/rival`]: { latest: { date: "2026-10-14", metrics: { followers: 4200 } } },
    [`users/${OWNER}/marketingFindings/f1`]: { text: "Customers ask about sizing", kind: "verified", source: "DM screenshots", createdAt: "2026-10-10" }
  });
  const claude = fakeClaude([okResponse([idea("One"), idea("Two"), idea("Three"), idea("Extra")])]);
  const res = await ai.generateIdeas(OWNER, { platform: "tiktok", awarenessStage: "unaware", contentPillar: "Faith", goal: "Launch the new hoodie", count: 3, avoidTitles: ["Old idea"] }, deps({ db, anthropic: claude }));
  assert.equal(res.ok, true);
  assert.equal(res.ideas.length, 3, "trimmed to the requested count");
  assert.deepEqual(res.researchUsed, { snapshots: 1, findings: 1 });
  const req = claude.calls[0];
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.output_config.effort, "medium");
  assert.equal(req.output_config.format.type, "json_schema");
  const msg = req.messages[0].content;
  assert.match(msg, /Competitor @rival profile snapshot, 2026-10-14 \(InsightSocial\): \{"followers":4200\}/);
  assert.match(msg, /Audience note \(verified, source: DM screenshots\): Customers ask about sizing/);
  assert.match(msg, /Gratiel makes faith-inspired hoodies/);
  assert.match(msg, /Avoid repeating these existing ideas: Old idea/);
  const usage = db.store.get(usagePath);
  assert.equal(usage.aiRequests, 1);
  assert.equal(usage.aiInputTokens, 2000);
  assert.equal(usage.aiOutputTokens, 3000);
  assert.ok(Math.abs(usage.aiCostUsd - 0.068) < 1e-9);
  assert.ok(Math.abs(res.costUsd - 0.068) < 1e-9);
});

test("Haiku requests don't send the fallback beta (not supported for it)", async () => {
  const claude = fakeClaude([okResponse([idea("A")], { model: "claude-haiku-5-5" })]);
  await ai.generateIdeas(OWNER, { count: 1 }, deps({ db: fakeDb({ [settingsPath]: { aiModel: "claude-haiku-5-5" } }), anthropic: claude }));
  assert.equal(claude.calls[0].fallbacks, undefined);
  assert.equal(claude.calls[0].betas, undefined);
});

test("budget: blocks before calling Claude when the worst case would exceed the AI allowance", async () => {
  const db = fakeDb({ [settingsPath]: { monthlyBudgetUsd: 20, insightPlanMonthlyUsd: 19.9 }, [usagePath]: { aiCostUsd: 0 } });
  const claude = fakeClaude([]);
  await assert.rejects(ai.generateIdeas(OWNER, { count: 1 }, deps({ db, anthropic: claude })), (e) => e.code === "resource-exhausted" && /AI budget/.test(e.message));
  assert.equal(claude.calls.length, 0);
});

test("refusal, truncation and unreadable output are reported (and still costed)", async () => {
  const claude = fakeClaude([
    okResponse([], { stop_reason: "refusal", stop_details: { category: "general_harms" }, content: [] }),
    okResponse([], { stop_reason: "max_tokens" }),
    okResponse([], { content: [{ type: "text", text: "not json" }] })
  ]);
  const d = deps({ anthropic: claude });
  const a = await ai.generateIdeas(OWNER, { count: 1 }, d);
  const b = await ai.generateIdeas(OWNER, { count: 1 }, d);
  const c = await ai.generateIdeas(OWNER, { count: 1 }, d);
  assert.match(a.error, /declined this request \(general_harms\)/);
  assert.match(b.error, /ran out of room/);
  assert.match(c.error, /couldn't be read/);
  [a, b, c].forEach((r) => assert.equal(r.ok, false));
  assert.equal(d.db.store.get(usagePath).aiRequests, 3);
});

test("Claude API errors map to clear messages by status", async () => {
  const claude = fakeClaude([apiError(Anthropic.AuthenticationError, 401), apiError(Anthropic.RateLimitError, 429), apiError(Anthropic.InternalServerError, 529), apiError(Anthropic.APIConnectionError, undefined)]);
  const d = deps({ anthropic: claude });
  await assert.rejects(ai.generateIdeas(OWNER, {}, d), (e) => e.code === "failed-precondition" && /rejected/.test(e.message));
  await assert.rejects(ai.generateIdeas(OWNER, {}, d), (e) => e.code === "resource-exhausted" && /rate-limiting/.test(e.message));
  await assert.rejects(ai.generateIdeas(OWNER, {}, d), (e) => e.code === "unavailable" && /temporarily unavailable/.test(e.message));
  await assert.rejects(ai.generateIdeas(OWNER, {}, d), (e) => e.code === "unavailable" && /Couldn't reach Claude/.test(e.message));
});

test("brief is validated and ideas are sanitized", () => {
  const b = ai.validateBrief({ platform: "myspace", awarenessStage: "??", count: 99, goal: "x".repeat(2000) });
  assert.equal(b.platform, "both");
  assert.equal(b.awarenessStage, "any");
  assert.equal(b.count, 3);
  assert.equal(b.goal.length, 600);
  const i = ai.sanitizeIdea({ title: "T", platform: "fax", awarenessStage: "x", researchBasis: [{ point: "p", kind: "made-up" }], shots: "nope" });
  assert.equal(i.platform, "both");
  assert.equal(i.awarenessStage, "unaware");
  assert.equal(i.researchBasis[0].kind, "hypothesis");
  assert.deepEqual(i.shots, []);
});

test("idea schema requires every field and allows no extras", () => {
  const item = ai.IDEA_SCHEMA.properties.ideas.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required.slice().sort(), Object.keys(item.properties).sort());
});

test("the shared spec labels manual competitor numbers by their source", () => {
  const spec = require("../lib/idea-spec");
  const brief = spec.validateBrief({ count: 1 });
  const msg = spec.buildUserMessage(brief, { contentPillars: ["Faith"], brandProfile: "" }, {
    snapshots: [{ handle: "rival", date: "2026-10-14", metrics: { followers: 10 }, source: "entered by the owner" }],
    findings: []
  });
  assert.match(msg, /@rival profile snapshot, 2026-10-14 \(entered by the owner\): \{"followers":10\}/);
  assert.equal(spec.IDEA_SCHEMA, ai.IDEA_SCHEMA, "server uses the shared schema");
});
