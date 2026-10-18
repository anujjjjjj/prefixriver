// Cost model: prices each analyzed turn and compares it with the "no breaks" ideal.

import { pricingFor } from "./pricing";
import type { CostBreakdown, ModelPricing, SessionAnalysis, TurnAnalysis } from "./types";

const PER_MILLION = 1e6;

interface TurnCost {
  actual: number;
  ideal: number;
  uncachedBaseline: number;
}

function anthropicTurnCost(turn: TurnAnalysis, p: ModelPricing): TurnCost {
  const { request } = turn;
  const write = request.ttlSeconds >= 3600 ? p.cacheWrite1h : p.cacheWrite5m;

  let lastMarkerEnd = 0;
  let running = 0;
  for (const s of request.segments) {
    running += s.tokens;
    if (s.cacheMarker) lastMarkerEnd = running;
  }
  // Prefixes shorter than the model minimum are never written to the cache.
  if (lastMarkerEnd < p.minCacheable) lastMarkerEnd = 0;

  const cached = turn.cachedTokens;
  const written = Math.max(0, lastMarkerEnd - cached);
  const plain = Math.max(0, request.totalTokens - cached - written);

  // Ideal: the wasted tokens were cache reads instead, taken from the written region first.
  const fromWritten = Math.min(turn.wastedTokens, written);
  const fromPlain = Math.min(turn.wastedTokens - fromWritten, plain);

  return {
    actual: (cached * p.cacheRead + written * write + plain * p.input) / PER_MILLION,
    ideal: ((cached + fromWritten + fromPlain) * p.cacheRead + (written - fromWritten) * write + (plain - fromPlain) * p.input) / PER_MILLION,
    uncachedBaseline: (request.totalTokens * p.input) / PER_MILLION,
  };
}

function openaiTurnCost(turn: TurnAnalysis, p: ModelPricing): TurnCost {
  const total = turn.request.totalTokens;
  const cached = turn.cachedTokens;
  const idealCached = Math.min(total, cached + turn.wastedTokens);
  return {
    actual: (cached * p.cacheRead + (total - cached) * p.input) / PER_MILLION,
    ideal: (idealCached * p.cacheRead + (total - idealCached) * p.input) / PER_MILLION,
    uncachedBaseline: (total * p.input) / PER_MILLION,
  };
}

/**
 * Prices the prompt side of every turn. Without `pricing`, each turn is priced with its own model's
 * table entry (so mid-session model switches are billed correctly).
 */
export function computeCost(analysis: SessionAnalysis, pricing?: ModelPricing): CostBreakdown {
  const perTurn: CostBreakdown["perTurn"] = [];
  let actualUsd = 0;
  let idealUsd = 0;
  let savedUsd = 0;

  for (const turn of analysis.turns) {
    const p = pricing ?? pricingFor(turn.request.model);
    const c = turn.request.provider === "anthropic" ? anthropicTurnCost(turn, p) : openaiTurnCost(turn, p);
    const wasted = Math.max(0, c.actual - c.ideal);
    const saved = c.uncachedBaseline - c.actual;
    perTurn.push({ index: turn.index, actualUsd: c.actual, wastedUsd: wasted, savedUsd: saved });
    actualUsd += c.actual;
    idealUsd += c.ideal;
    savedUsd += saved;
  }

  return {
    pricing: pricing ?? pricingFor(analysis.model),
    actualUsd,
    idealUsd,
    wastedUsd: perTurn.reduce((a, t) => a + t.wastedUsd, 0),
    savedUsd,
    perTurn,
  };
}

export function formatUsd(n: number): string {
  if (n < 0) return `-${formatUsd(-n)}`;
  if (n === 0) return "$0.00";
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 1 || n.toFixed(4) === "1.0000") return `$${n.toFixed(2)}`;
  if (n < 0.00005) return "<$0.0001";
  return `$${n.toFixed(4)}`;
}
