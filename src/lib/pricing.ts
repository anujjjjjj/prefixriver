// Pricing table (USD per 1M tokens). Edit the PRICING array to add or update models.

import type { ModelPricing, Provider } from "./types";

const ANTHROPIC_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
const OPENAI_URL = "https://developers.openai.com/api/docs/pricing";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Anthropic: 5m write = 1.25x input, 1h write = 2x input, read = 0.1x input
 * (0.05x on Opus/Sonnet 5.5, 0.025x on Fable/Mythos 5.1).
 */
function anthropic(id: string, label: string, input: number, output: number, minCacheable: number, readMultiplier = 0.1): ModelPricing {
  return {
    id,
    label,
    provider: "anthropic",
    input,
    cacheWrite5m: round(input * 1.25),
    cacheWrite1h: round(input * 2),
    cacheRead: round(input * readMultiplier),
    output,
    minCacheable,
    sourceUrl: ANTHROPIC_URL,
  };
}

/**
 * OpenAI: caching is automatic. Models before GPT-5.6 have no write surcharge;
 * GPT-5.6 and later charge 1.25x input for cache writes (pass cacheWrite).
 */
function openai(id: string, label: string, input: number, cacheRead: number, output: number, cacheWrite = input): ModelPricing {
  return { id, label, provider: "openai", input, cacheWrite5m: cacheWrite, cacheWrite1h: cacheWrite, cacheRead, output, minCacheable: 1024, sourceUrl: OPENAI_URL };
}

// Checked 2026-10-18 against the official pricing pages (short-context, standard tier).
export const PRICING: ModelPricing[] = [
  // Anthropic
  anthropic("claude-fable-5-1", "Claude Fable 5.1", 10, 50, 512, 0.025),
  anthropic("claude-fable-5", "Claude Fable 5", 10, 50, 512),
  anthropic("claude-opus-5-5", "Claude Opus 5.5", 4, 20, 512, 0.05),
  anthropic("claude-opus-5", "Claude Opus 5", 5, 25, 512),
  anthropic("claude-opus-4-8", "Claude Opus 4.8", 5, 25, 1024),
  anthropic("claude-opus-4-7", "Claude Opus 4.7", 5, 25, 2048),
  anthropic("claude-opus-4-6", "Claude Opus 4.6", 5, 25, 4096),
  anthropic("claude-opus-4-5", "Claude Opus 4.5", 5, 25, 4096),
  anthropic("claude-opus-4-", "Claude Opus 4.x (newer)", 5, 25, 4096),
  anthropic("claude-opus-4-1", "Claude Opus 4.1", 15, 75, 1024),
  anthropic("claude-opus-4-2025", "Claude Opus 4", 15, 75, 1024),
  anthropic("claude-opus-4", "Claude Opus 4", 15, 75, 1024),
  anthropic("claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 10, 512, 0.05),
  anthropic("claude-sonnet-5", "Claude Sonnet 5", 2, 10, 1024),
  anthropic("claude-sonnet-4-6", "Claude Sonnet 4.6", 3, 15, 1024),
  anthropic("claude-sonnet-4", "Claude Sonnet 4 / 4.5", 3, 15, 1024),
  anthropic("claude-haiku-4-5", "Claude Haiku 4.5", 1, 5, 4096),
  anthropic("claude-3-5-haiku", "Claude 3.5 Haiku", 0.8, 4, 2048),
  // OpenAI
  openai("gpt-6.1-sol", "GPT-6.1 Sol", 2, 0.1, 10, 2.5),
  openai("gpt-6-sol", "GPT-6 Sol", 2, 0.2, 10, 2.5),
  openai("gpt-6-astra", "GPT-6 Astra", 10, 1, 50, 12.5),
  openai("gpt-6-luna", "GPT-6 Luna", 0.1, 0.01, 0.5, 0.125),
  openai("gpt-5.6-sol", "GPT-5.6 Sol", 4, 0.4, 20, 5),
  openai("gpt-5.6-terra", "GPT-5.6 Terra", 2, 0.2, 12, 2.5),
  openai("gpt-5.6-luna", "GPT-5.6 Luna", 0.2, 0.02, 1.2, 0.25),
  openai("gpt-5.5", "GPT-5.5", 5, 0.5, 30),
  openai("gpt-5.4-mini", "GPT-5.4 mini", 0.75, 0.075, 4.5),
  openai("gpt-5.4", "GPT-5.4", 2.5, 0.25, 15),
  openai("gpt-5.2", "GPT-5.2", 1.75, 0.175, 14),
  openai("gpt-5.1", "GPT-5.1", 1.25, 0.125, 10),
  openai("gpt-5", "GPT-5", 1.25, 0.125, 10),
  openai("gpt-5-mini", "GPT-5 mini", 0.25, 0.025, 2),
  openai("gpt-4.1-mini", "GPT-4.1 mini", 0.4, 0.1, 1.6),
  openai("gpt-4.1", "GPT-4.1", 2, 0.5, 8),
  openai("gpt-4o-mini", "GPT-4o mini", 0.15, 0.075, 0.6),
  openai("gpt-4o", "GPT-4o", 2.5, 1.25, 10),
];

export const PRICING_SOURCES: { provider: Provider; label: string; url: string; checked: string }[] = [
  { provider: "anthropic", label: "Anthropic API pricing", url: ANTHROPIC_URL, checked: "2026-10-18" },
  { provider: "openai", label: "OpenAI API pricing", url: OPENAI_URL, checked: "2026-10-18" },
];

const FALLBACK: Record<Provider, string> = { anthropic: "claude-sonnet-4", openai: "gpt-4.1" };

function byId(id: string): ModelPricing {
  const row = PRICING.find((p) => p.id === id);
  if (!row) throw new Error(`pricing table is missing fallback row ${id}`);
  return row;
}

export function pricingFor(model: string): ModelPricing {
  const m = model.toLowerCase().replace(/^.*\//, "").replace(/^(?:[a-z]{2}\.)?anthropic\./, "");
  let best: ModelPricing | undefined;
  for (const p of PRICING) {
    if (m.startsWith(p.id) && (!best || p.id.length > best.id.length)) best = p;
  }
  if (best) return best;
  return byId(FALLBACK[m.startsWith("claude") ? "anthropic" : "openai"]);
}
