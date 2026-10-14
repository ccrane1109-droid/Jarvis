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

const MAX_OUTPUT_TOKENS = settingsLib.AI_MAX_OUTPUT_TOKENS;
const PLATFORMS = ["instagram", "tiktok", "both"];
const STAGES = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"];
// Models with server-side refusal fallback on the Claude API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const IDEA_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          platform: { type: "string", enum: PLATFORMS },
          objective: { type: "string" },
          targetAudience: { type: "string" },
          awarenessStage: { type: "string", enum: STAGES },
          contentPillar: { type: "string" },
          hook: { type: "string" },
          script: { type: "string" },
          shots: { type: "array", items: { type: "string" } },
          caption: { type: "string" },
          cta: { type: "string" },
          researchBasis: {
            type: "array",
            items: {
              type: "object",
              properties: {
                point: { type: "string" },
                kind: { type: "string", enum: ["verified", "hypothesis"] },
                source: { type: "string" }
              },
              required: ["point", "kind", "source"],
              additionalProperties: false
            }
          },
          whyItMightWork: { type: "string" }
        },
        required: ["title", "platform", "objective", "targetAudience", "awarenessStage", "contentPillar", "hook", "script", "shots", "caption", "cta", "researchBasis", "whyItMightWork"],
        additionalProperties: false
      }
    }
  },
  required: ["ideas"],
  additionalProperties: false
};

const SYSTEM_PROMPT = [
  "You are a senior content strategist for Gratiel, a Christian streetwear clothing brand. You write original short-form video ideas for Instagram Reels and TikTok that help Gratiel grow.",
  "",
  "Ground rules:",
  "- Facts and numbers may come only from the research section of the request. Never invent statistics, view counts, follower numbers, trends, quotes or customer feedback.",
  "- In researchBasis, mark a point \"verified\" only when it comes directly from the provided research, and name that source (for example \"@handle profile snapshot, 2026-10-14\" or \"Audience note\"). Everything else, including your own reasoning about what might work, is \"hypothesis\" with source \"Strategist judgment\".",
  "- Competitors are context only. Never copy or closely imitate their content, captions or hooks.",
  "- Faith content should feel sincere and respectful, never gimmicky or preachy.",
  "- Scripts must be complete and natural to say on camera; aim for 15-45 seconds unless the brief says otherwise. Include on-screen text cues in the script where useful.",
  "- Captions should be ready to post and include a few relevant hashtags.",
  "- Every idea must be distinct from the others and from any titles listed under \"Avoid repeating\"."
].join("\n");

function cleanString(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }

function validateBrief(data) {
  const d = data && typeof data === "object" ? data : {};
  const platform = PLATFORMS.indexOf(d.platform) !== -1 ? d.platform : "both";
  const awarenessStage = STAGES.indexOf(d.awarenessStage) !== -1 ? d.awarenessStage : "any";
  const count = Math.min(3, Math.max(1, Math.round(Number(d.count) || 1)));
  return {
    platform: platform,
    awarenessStage: awarenessStage,
    contentPillar: cleanString(d.contentPillar, 60),
    goal: cleanString(d.goal, 600),
    count: count,
    avoidTitles: Array.isArray(d.avoidTitles) ? d.avoidTitles.map(function (t) { return cleanString(t, 120); }).filter(Boolean).slice(0, 20) : []
  };
}

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

function buildUserMessage(brief, settings, research) {
  const lines = [];
  lines.push("Create " + brief.count + " video idea" + (brief.count === 1 ? "" : "s") + " for Gratiel.");
  lines.push("Platform: " + brief.platform + (brief.platform === "both" ? " (Instagram Reels and TikTok)" : ""));
  lines.push("Audience awareness stage: " + (brief.awarenessStage === "any" ? "your choice per idea" : brief.awarenessStage));
  if (brief.contentPillar) lines.push("Content pillar: " + brief.contentPillar);
  lines.push("Content pillars Gratiel uses: " + settings.contentPillars.join(", "));
  if (brief.goal) lines.push("Goal / notes from the owner: " + brief.goal);
  lines.push("");
  lines.push("Brand profile (from the owner):");
  lines.push(settings.brandProfile || "Not provided yet. Gratiel is a Christian streetwear brand; don't assume anything else about products or prices.");
  lines.push("");
  lines.push("Research (the only facts you may cite):");
  if (!research.snapshots.length && !research.findings.length) {
    lines.push("None available yet. Mark every researchBasis point as hypothesis.");
  }
  research.snapshots.forEach(function (s) {
    lines.push("- Competitor @" + s.handle + " profile snapshot, " + s.date + " (InsightSocial): " + JSON.stringify(s.metrics));
  });
  research.findings.forEach(function (f) {
    lines.push("- Audience note (" + f.kind + (f.source ? ", source: " + f.source : "") + "): " + f.text);
  });
  if (brief.avoidTitles.length) {
    lines.push("");
    lines.push("Avoid repeating these existing ideas: " + brief.avoidTitles.join(" | "));
  }
  return lines.join("\n");
}

function sanitizeIdea(raw) {
  const i = raw && typeof raw === "object" ? raw : {};
  return {
    title: cleanString(i.title, 160),
    platform: PLATFORMS.indexOf(i.platform) !== -1 ? i.platform : "both",
    objective: cleanString(i.objective, 600),
    targetAudience: cleanString(i.targetAudience, 600),
    awarenessStage: STAGES.indexOf(i.awarenessStage) !== -1 ? i.awarenessStage : "unaware",
    contentPillar: cleanString(i.contentPillar, 60),
    hook: cleanString(i.hook, 400),
    script: cleanString(i.script, 6000),
    shots: Array.isArray(i.shots) ? i.shots.map(function (s) { return cleanString(s, 300); }).filter(Boolean).slice(0, 20) : [],
    caption: cleanString(i.caption, 2200),
    cta: cleanString(i.cta, 300),
    researchBasis: Array.isArray(i.researchBasis) ? i.researchBasis.slice(0, 10).map(function (r) {
      return { point: cleanString(r && r.point, 500), kind: r && r.kind === "verified" ? "verified" : "hypothesis", source: cleanString(r && r.source, 200) };
    }).filter(function (r) { return r.point; }) : [],
    whyItMightWork: cleanString(i.whyItMightWork, 1200)
  };
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
  const approxInputTokens = Math.ceil((SYSTEM_PROMPT.length + userMessage.length) / 3) + 500;
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
