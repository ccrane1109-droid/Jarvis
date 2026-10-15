/* ==========================================================================
   Content-idea spec shared by the server (functions/lib/ai.js) and the
   browser (js/content-intelligence.js, which loads this file directly from
   the site): model prices, the idea schema, the strategist prompt, brief
   validation, and output clean-up. One copy, so both paths ask Claude for
   exactly the same thing and price it the same way.

   Plain data and pure functions only: no requires, no network.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisIdeaSpec = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Anthropic first-party prices in USD per 1M tokens (from Anthropic's model
  // table, cached 2026-10-06). Haiku's price applies to prompts up to 100K
  // tokens, which these prompts stay well under.
  const MODEL_PRICES = {
    "claude-opus-5-5": { input: 4, output: 20 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5 }
  };
  // Sonnet 5.5 is the owner's chosen default (about half Opus's price).
  const DEFAULT_MODEL = "claude-sonnet-5-5";
  // Output cap for one idea-generation request; also the worst-case basis for
  // the budget check and the cost estimate shown in the app.
  const AI_MAX_OUTPUT_TOKENS = 16000;
  const PLATFORMS = ["instagram", "tiktok", "both"];
  const STAGES = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"];

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
      lines.push("- Competitor @" + s.handle + " profile snapshot, " + s.date + " (" + (s.source || "InsightSocial") + "): " + JSON.stringify(s.metrics));
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

  function priceFor(model) { return MODEL_PRICES[model] || null; }

  // Token counts come from Claude's response. Cache tokens (if any) are
  // priced at the full input rate, which can only overestimate.
  function estimateCostUsd(model, usage) {
    const p = priceFor(model) || MODEL_PRICES[DEFAULT_MODEL];
    const u = usage || {};
    const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const output = u.output_tokens || 0;
    return (input * p.input + output * p.output) / 1e6;
  }

  // Most a single request could cost if it used every allowed output token.
  function worstCaseCostUsd(model, inputTokens, maxOutputTokens) {
    const p = priceFor(model) || MODEL_PRICES[DEFAULT_MODEL];
    return (inputTokens * p.input + maxOutputTokens * p.output) / 1e6;
  }

  // Rough, deliberately high token estimate for the budget pre-check.
  function approxInputTokens(userMessage) {
    return Math.ceil((SYSTEM_PROMPT.length + String(userMessage || "").length) / 3) + 500;
  }

  return {
    MODEL_PRICES: MODEL_PRICES, DEFAULT_MODEL: DEFAULT_MODEL, AI_MAX_OUTPUT_TOKENS: AI_MAX_OUTPUT_TOKENS,
    PLATFORMS: PLATFORMS, STAGES: STAGES, IDEA_SCHEMA: IDEA_SCHEMA, SYSTEM_PROMPT: SYSTEM_PROMPT,
    cleanString: cleanString, validateBrief: validateBrief, buildUserMessage: buildUserMessage, sanitizeIdea: sanitizeIdea,
    priceFor: priceFor, estimateCostUsd: estimateCostUsd, worstCaseCostUsd: worstCaseCostUsd, approxInputTokens: approxInputTokens
  };
});
