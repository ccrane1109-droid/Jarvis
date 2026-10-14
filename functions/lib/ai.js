/* ==========================================================================
   AI content ideas for Gratiel (Claude, server side).

   The Claude API key is a Firebase secret. Before each call the server
   checks that this month's estimated AI spend plus the worst case for the
   request stays within the AI share of the monthly budget (budget minus
   the InsightSocial plan fee). The prompt only contains research the
   server actually holds (competitor snapshots, the owner's audience notes,
   the brand profile), and the model must label every supporting point as
   verified (from that research) or hypothesis.
   ========================================================================== */

"use strict";

const Anthropic = require("@anthropic-ai/sdk").default;
const settingsLib = require("./settings");
const insight = require("./insight");
const spec = require("./idea-spec");

const MAX_OUTPUT_TOKENS = spec.AI_MAX_OUTPUT_TOKENS;
const { IDEA_SCHEMA, SYSTEM_PROMPT, cleanString, validateBrief, buildUserMessage, sanitizeIdea } = spec;
// Models with server-side refusal fallback on the Claude API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

async function buildResearchContext(db, uid, settings) {
  const snapshots = [];
  for (const handle of settings.watchlist) {
    const snap = await db.doc("users/" + uid + "/marketingSnapshots/" + handle).get();
    if (snap.exists && snap.data().latest) {
      const latest = snap.data().latest;
      snapshots.push({ handle: handle, date: latest.date, metrics: latest.metrics || {} });
    }
  }
  const findingsSnap = await db.collection("users/" + uid + "/marketingFindings").get();
  const findings = findingsSnap.docs.map(function (d) { return d.data(); })
    .filter(function (f) { return f && typeof f.text === "string"; })
    .sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); })
    .slice(0, 30)
    .map(function (f) {
      return { kind: f.kind === "verified" ? "verified" : "hypothesis", text: cleanString(f.text, 400), source: cleanString(f.source, 200) };
    });
  return { snapshots: snapshots, findings: findings };
}

function mapApiError(err) {
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    if (err.status === 401 || err.status === 403) return new insight.InsightError("failed-precondition", "The Claude API key on the server was rejected.");
    if (err.status === 429) return new insight.InsightError("resource-exhausted", "Claude is rate-limiting requests right now. Try again in a minute.");
    if (err.status >= 500) return new insight.InsightError("unavailable", "Claude is temporarily unavailable. Try again shortly.");
    return new insight.InsightError("internal", "Claude rejected the request (HTTP " + err.status + ").");
  }
  if (err instanceof Anthropic.APIError) return new insight.InsightError("unavailable", "Couldn't reach Claude. Try again shortly.");
  return null;
}

async function recordAiUsage(deps, uid, month, usage, costUsd, now) {
  await deps.db.doc("users/" + uid + "/marketingUsage/" + month).set({
    aiRequests: deps.increment(1),
    aiInputTokens: deps.increment((usage && usage.input_tokens) || 0),
    aiOutputTokens: deps.increment((usage && usage.output_tokens) || 0),
    aiCostUsd: deps.increment(costUsd),
    updatedAt: now.toISOString()
  }, { merge: true });
}

async function generateIdeas(uid, data, deps) {
  insight.requireOwner(uid, deps);
  if (!deps.anthropic) throw new insight.InsightError("failed-precondition", "The Claude API key isn't set on the server yet.");

  const brief = validateBrief(data);
  const now = deps.now();
  const month = settingsLib.monthKey(now);
  const [settings, usage] = await Promise.all([settingsLib.readSettings(deps.db, uid), settingsLib.readUsage(deps.db, uid, month)]);
  const research = await buildResearchContext(deps.db, uid, settings);
  const userMessage = buildUserMessage(brief, settings, research);

  const model = settings.aiModel;
  const allowance = settingsLib.aiAllowanceUsd(settings);
  const approxInputTokens = spec.approxInputTokens(userMessage);
  const worstCase = settingsLib.worstCaseCostUsd(model, approxInputTokens, MAX_OUTPUT_TOKENS);
  if (usage.aiCostUsd + worstCase > allowance) {
    throw new insight.InsightError("resource-exhausted",
      "This could exceed your AI budget: $" + usage.aiCostUsd.toFixed(2) + " of $" + allowance.toFixed(2) + " used this month, and one generation can cost up to $" + worstCase.toFixed(2) + ". Raise the budget or switch to a cheaper model in Settings.");
  }

  const request = {
    model: model,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: "medium", format: { type: "json_schema", schema: IDEA_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }]
  };
  if (FALLBACK_MODELS.has(model)) {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }

  let response;
  try {
    response = await deps.anthropic.beta.messages.create(request);
  } catch (err) {
    const mapped = mapApiError(err);
    if (mapped) throw mapped;
    throw err;
  }

  const costUsd = settingsLib.estimateCostUsd(settingsLib.priceFor(response.model) ? response.model : model, response.usage);
  await recordAiUsage(deps, uid, month, response.usage, costUsd, now);
  deps.log.info("generateIdeas", { model: response.model, stopReason: response.stop_reason, costUsd: Number(costUsd.toFixed(4)) });

  if (response.stop_reason === "refusal") {
    return { ok: false, error: "Claude declined this request" + (response.stop_details && response.stop_details.category ? " (" + response.stop_details.category + ")" : "") + ". Try rewording the goal.", costUsd: costUsd };
  }
  if (response.stop_reason === "max_tokens") {
    return { ok: false, error: "The response ran out of room before finishing. Try asking for fewer ideas.", costUsd: costUsd };
  }
  const textBlock = (response.content || []).find(function (b) { return b.type === "text"; });
  let parsed = null;
  try { parsed = JSON.parse(textBlock ? textBlock.text : ""); } catch (e) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.ideas)) {
    return { ok: false, error: "Claude's response couldn't be read as ideas. Try again.", costUsd: costUsd };
  }
  const ideas = parsed.ideas.map(sanitizeIdea).filter(function (i) { return i.title && i.script; }).slice(0, brief.count);
  return {
    ok: true,
    ideas: ideas,
    model: response.model || model,
    costUsd: costUsd,
    generatedAt: now.toISOString(),
    researchUsed: { snapshots: research.snapshots.length, findings: research.findings.length }
  };
}

module.exports = { generateIdeas, validateBrief, sanitizeIdea, buildUserMessage, IDEA_SCHEMA, SYSTEM_PROMPT, MAX_OUTPUT_TOKENS };
