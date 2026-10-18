// Core contract shared by parsers, engine, cost model and UI.

export type Provider = "anthropic" | "openai";

/** Section of the canonical provider render order: tools -> system -> messages. */
export type SegmentKind = "tools" | "system" | "message";

/** One contiguous, serialized chunk of the prompt in render order. */
export interface Segment {
  kind: SegmentKind;
  /** Human label e.g. "tools[3] Bash", "system", "messages[4] user". */
  label: string;
  /** Stable canonical serialization of this chunk (JSON with sorted keys, cache_control stripped). */
  text: string;
  /** Approximate tokens (bytes/4, min 1). */
  tokens: number;
  /** True if this chunk carries an Anthropic cache_control breakpoint. */
  cacheMarker: boolean;
}

/** A normalized LLM request (one turn of the session). */
export interface NormalizedRequest {
  index: number;
  provider: Provider;
  model: string;
  /** ms since epoch, if known (from HAR startedDateTime, JSONL ts field, etc). */
  timestamp?: number;
  segments: Segment[];
  totalTokens: number;
  /** Optional usage reported by provider (if present in capture). */
  usage?: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
  };
  /** Anthropic cache TTL in seconds for this request (300 default, 3600 if ttl:"1h"). */
  ttlSeconds: number;
}

export type CulpritKind =
  | "tools_changed"
  | "system_dynamic"
  | "message_edited"
  | "marker_moved"
  | "ttl_expired"
  | "model_changed"
  | "below_minimum"
  | "first_request";

export interface DiffDetail {
  /** Path-ish label of where it diverged, e.g. "tools[3] Bash" or "system". */
  where: string;
  /** Short excerpt around divergence from the previous request ("" if added). */
  before: string;
  /** Short excerpt around divergence in the current request ("" if removed). */
  after: string;
  /** One-line human summary, e.g. "tools[]: +LSP" or "system: 2026-10-18T07:01 -> 07:03". */
  summary: string;
}

/** Analysis of request i relative to request i-1. */
export interface TurnAnalysis {
  index: number;
  request: NormalizedRequest;
  /** Tokens of the prompt prefix identical to previous request (cacheable reuse). */
  sharedPrefixTokens: number;
  /** Tokens estimated to be served from cache (respects markers, min size, TTL, model). */
  cachedTokens: number;
  /** Tokens that had to be (re)written to cache or processed uncached. */
  uncachedTokens: number;
  /** Tokens newly appended beyond previous request (normal growth, not waste). */
  appendedTokens: number;
  /** Tokens that WOULD have been cache hits but were re-billed because of the break. */
  wastedTokens: number;
  /** Did a cache break happen at this turn? (false for normal append-only growth). */
  isBreak: boolean;
  /** Index into request.segments where divergence started (or -1). */
  breakSegmentIndex: number;
  /** Approx token offset in request where divergence started (or -1). */
  breakTokenOffset: number;
  culprits: CulpritKind[];
  diff?: DiffDetail;
  fixHint?: string;
  /** Seconds since previous request, if both have timestamps. */
  gapSeconds?: number;
}

export interface SessionAnalysis {
  provider: Provider;
  model: string;
  turns: TurnAnalysis[];
  totals: {
    promptTokens: number;
    cachedTokens: number;
    uncachedTokens: number;
    wastedTokens: number;
    breaks: number;
    hitRate: number; // cachedTokens / promptTokens, 0..1
  };
}

export interface ModelPricing {
  id: string; // matching prefix, e.g. "claude-sonnet-4"
  label: string;
  provider: Provider;
  /** USD per 1M tokens */
  input: number;
  cacheWrite5m: number; // for openai equals input (no write surcharge)
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** Minimum cacheable prompt length in tokens. */
  minCacheable: number;
  sourceUrl: string;
}

export interface CostBreakdown {
  pricing: ModelPricing;
  actualUsd: number; // what this session costs for prompt input
  idealUsd: number; // if no breaks happened
  wastedUsd: number; // actual - ideal
  savedUsd: number; // vs no caching at all
  perTurn: { index: number; actualUsd: number; wastedUsd: number; savedUsd: number }[];
}

export interface SampleSession {
  id: string;
  title: string;
  blurb: string;
  /** Raw capture text in a supported format (JSONL/HAR/JSON) to exercise the parsers. */
  raw: string;
  format: "jsonl" | "har" | "json";
}
