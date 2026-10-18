// Prefix-cache analysis: finds where consecutive requests diverge, what the cache would
// have served, and why the cache broke.

import { approxTokens } from "./canonical";
import { pricingFor } from "./pricing";
import type { CulpritKind, DiffDetail, NormalizedRequest, Segment, SessionAnalysis, TurnAnalysis } from "./types";

export interface AnalyzeOptions {
  /** Minimum cacheable prefix in tokens. Defaults to the model's minimum from the pricing table (1024 for most). */
  minCacheable?: number;
}

export const FIX_HINTS: Record<CulpritKind, string> = {
  tools_changed: "Load all tools up front (or defer via a stable tool-search stub) and keep tools[] byte-identical and in a fixed order.",
  system_dynamic: "Move dynamic values (dates, session ids, cwd) out of the system prompt into the latest user message, or round them to the day.",
  message_edited: "Keep earlier messages immutable: append new turns instead of rewriting, summarizing or truncating history that is already cached.",
  marker_moved: "Keep cache_control breakpoints on stable positions (end of tools/system) plus the latest message, and never drop the trailing breakpoint.",
  ttl_expired: "Send a cheap keep-alive request before the TTL lapses, or use the 1h cache TTL (ttl: \"1h\") for sessions with long idle gaps.",
  model_changed: "Stay on one model per session; caches are per model, so switch models only at a natural session boundary.",
  below_minimum: "The cacheable prefix is shorter than the model's minimum cacheable length, so nothing is cached; grow the stable prefix or accept uncached pricing.",
  first_request: "Nothing to fix: the first request must write the cache.",
};

const OPENAI_BLOCK = 128;
const OPENAI_TTL_SECONDS = 600;
const EXCERPT_BEFORE = 20;
const EXCERPT_AFTER = 40;

// ------------------------------------------------------------------ helpers

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function commonSuffixLength(a: string, b: string, maxLen: number): number {
  let i = 0;
  while (i < maxLen && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

function excerpt(text: string, pos: number): string {
  const start = Math.max(0, pos - EXCERPT_BEFORE);
  const end = Math.min(text.length, pos + EXCERPT_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function clip(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m${rest}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
}

/** Cumulative token count through (and including) segment i. */
function cumulative(segs: Segment[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const s of segs) out.push((sum += s.tokens));
  return out;
}

function markerIndexes(segs: Segment[]): number[] {
  const out: number[] = [];
  segs.forEach((s, i) => {
    if (s.cacheMarker) out.push(i);
  });
  return out;
}

function openaiCacheable(tokens: number, min: number): number {
  if (tokens < min) return 0;
  return min + Math.floor((tokens - min) / OPENAI_BLOCK) * OPENAI_BLOCK;
}

// --------------------------------------------------------- dynamic detection

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DYNAMIC_PATTERNS: RegExp[] = [
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  new RegExp(`\\b(?:${MONTHS})[a-z]*\\.? \\d{1,2}(?:,? \\d{4})?\\b`, "i"),
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/i,
  /\b1[5-9]\d{8}(?:\d{3})?\b/,
  /\b\d{5,}\b/,
];
const ID_CONTEXT = /(?:session|request|trace|run|conversation|nonce|token|id)[ _-]?(?:id)?["'\s:=]*$/i;
const DELIM = /[\s"'\\,;()[\]{}<>=]/;

function firstDynamic(s: string): string | undefined {
  let best: RegExpExecArray | undefined;
  for (const re of DYNAMIC_PATTERNS) {
    const mt = re.exec(s);
    if (mt && (!best || mt.index < best.index)) best = mt;
  }
  return best?.[0];
}

interface TextChange {
  pos: number;
  before: string;
  after: string;
  /** Changed region widened to whole whitespace/quote-delimited words. */
  wordBefore: string;
  wordAfter: string;
  contextBefore: string;
}

function textChange(a: string, b: string): TextChange {
  const pre = commonPrefixLength(a, b);
  const suf = commonSuffixLength(a, b, Math.min(a.length, b.length) - pre);
  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  let left = pre;
  while (left > 0 && !DELIM.test(a[left - 1])) left--;
  let right = 0;
  while (right < suf && !DELIM.test(a[a.length - suf + right])) right++;
  const head = a.slice(left, pre);
  const tail = a.slice(a.length - suf, a.length - suf + right);
  return {
    pos: pre,
    before: midA,
    after: midB,
    wordBefore: head + midA + tail,
    wordAfter: head + midB + tail,
    contextBefore: a.slice(Math.max(0, pre - 30), pre),
  };
}

function looksDynamic(c: TextChange): boolean {
  const side = (mid: string, word: string) => mid === "" || firstDynamic(word) !== undefined || (/\d/.test(word) && ID_CONTEXT.test(c.contextBefore) && word.length >= 4);
  return (c.before !== "" || c.after !== "") && side(c.before, c.wordBefore) && side(c.after, c.wordAfter);
}

function dynamicSummary(c: TextChange, label: string): string {
  const pick = (word: string) => (word.length <= 48 ? word : (firstDynamic(word) ?? clip(word)));
  return `${label}: ${pick(c.wordBefore)} → ${pick(c.wordAfter)}`;
}

// ------------------------------------------------------------- tool diffing

function toolNameOf(label: string): string {
  return label.replace(/^tools\[\d+\] /, "");
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function toolBody(text: string): Record<string, unknown> | undefined {
  const v = parseJson(text);
  if (!v) return undefined;
  const fn = v.function;
  return typeof fn === "object" && fn !== null && !Array.isArray(fn) ? (fn as Record<string, unknown>) : v;
}

function changedToolFields(a: string, b: string): string[] {
  const x = toolBody(a);
  const y = toolBody(b);
  if (!x || !y) return ["definition"];
  const fields = new Set<string>();
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) fields.add(k === "input_schema" || k === "parameters" ? "schema" : k);
  }
  return fields.size ? [...fields] : ["definition"];
}

function toolPreview(seg: Segment): string {
  const body = toolBody(seg.text);
  const desc = body && typeof body.description === "string" ? body.description : seg.text;
  return `${toolNameOf(seg.label)}: ${clip(desc, 50)}`;
}

function diffTools(prev: Segment[], cur: Segment[], k: number): { diff: DiffDetail } {
  const pTools = prev.filter((s) => s.kind === "tools");
  const cTools = cur.filter((s) => s.kind === "tools");
  const pNames = pTools.map((s) => toolNameOf(s.label));
  const cNames = cTools.map((s) => toolNameOf(s.label));
  const added = cTools.filter((s) => !pNames.includes(toolNameOf(s.label)));
  const removed = pTools.filter((s) => !cNames.includes(toolNameOf(s.label)));

  if (added.length || removed.length) {
    const summary = `tools[]: ${[...added.map((s) => `+${toolNameOf(s.label)}`), ...removed.map((s) => `-${toolNameOf(s.label)}`)].join(", ")}`;
    return {
      diff: {
        where: (added[0] ?? removed[0]).label,
        before: removed.length ? toolPreview(removed[0]) : "",
        after: added.length ? toolPreview(added[0]) : "",
        summary,
      },
    };
  }

  const p = prev[k];
  const c = cur[k];
  if (p?.kind === "tools" && c?.kind === "tools" && toolNameOf(p.label) === toolNameOf(c.label)) {
    const change = textChange(p.text, c.text);
    const fields = changedToolFields(p.text, c.text);
    return {
      diff: {
        where: c.label,
        before: excerpt(p.text, change.pos),
        after: excerpt(c.text, change.pos),
        summary: `${c.label}: ${fields.join(", ")} changed`,
      },
    };
  }
  return {
    diff: { where: "tools[]", before: p ? excerpt(p.text, 0) : "", after: c ? excerpt(c.text, 0) : "", summary: "tools[]: reordered" },
  };
}

// ------------------------------------------------------- content divergence

interface Divergence {
  /** Segment index where the two requests first differ. */
  index: number;
  sharedTokens: number;
}

function findDivergence(prev: Segment[], cur: Segment[]): Divergence | undefined {
  let k = 0;
  let tokens = 0;
  while (k < prev.length && k < cur.length && prev[k].text === cur[k].text) {
    tokens += prev[k].tokens;
    k++;
  }
  if (k === prev.length) return undefined; // identical or pure append
  if (k < cur.length) {
    const common = commonPrefixLength(prev[k].text, cur[k].text);
    if (common > 0) tokens += approxTokens(prev[k].text.slice(0, common));
  }
  return { index: k, sharedTokens: tokens };
}

function classifyContent(prev: Segment[], cur: Segment[], k: number): { culprit: CulpritKind; diff: DiffDetail } {
  const p = prev[k] as Segment | undefined;
  const c = cur[k] as Segment | undefined;

  if (p?.kind === "tools" || c?.kind === "tools") return { culprit: "tools_changed", diff: diffTools(prev, cur, k).diff };

  if (p?.kind === "system" || c?.kind === "system") {
    if (p && c && p.kind === "system" && c.kind === "system") {
      const ch = textChange(p.text, c.text);
      const where = c.label;
      if (looksDynamic(ch)) {
        return { culprit: "system_dynamic", diff: { where, before: excerpt(p.text, ch.pos), after: excerpt(c.text, ch.pos), summary: dynamicSummary(ch, "system") } };
      }
      return { culprit: "message_edited", diff: { where, before: excerpt(p.text, ch.pos), after: excerpt(c.text, ch.pos), summary: `${where === "system" ? "system" : where} edited` } };
    }
    const seg = (c ?? p) as Segment;
    const added = c?.kind === "system";
    return {
      culprit: "message_edited",
      diff: { where: seg.label, before: added ? "" : excerpt(seg.text, 0), after: added ? excerpt(seg.text, 0) : "", summary: `${seg.label} ${added ? "added" : "removed"}` },
    };
  }

  if (p && c) {
    const ch = textChange(p.text, c.text);
    return { culprit: "message_edited", diff: { where: c.label, before: excerpt(p.text, ch.pos), after: excerpt(c.text, ch.pos), summary: `${c.label} edited` } };
  }
  const seg = (p ?? c) as Segment;
  return {
    culprit: "message_edited",
    diff: { where: seg.label, before: p ? excerpt(p.text, 0) : "", after: c ? excerpt(c.text, 0) : "", summary: `${seg.label} ${p ? "removed" : "added"}` },
  };
}

// ----------------------------------------------------------------- per turn

function firstTurn(req: NormalizedRequest): TurnAnalysis {
  return {
    index: 0,
    request: req,
    sharedPrefixTokens: 0,
    cachedTokens: 0,
    uncachedTokens: req.totalTokens,
    appendedTokens: req.totalTokens,
    wastedTokens: 0,
    isBreak: false,
    breakSegmentIndex: -1,
    breakTokenOffset: -1,
    culprits: ["first_request"],
    fixHint: FIX_HINTS.first_request,
  };
}

function analyzePair(prev: NormalizedRequest, cur: NormalizedRequest, index: number, opts: AnalyzeOptions): TurnAnalysis {
  const min = opts.minCacheable ?? pricingFor(cur.model).minCacheable;
  const openai = cur.provider === "openai";
  const gapSeconds = prev.timestamp !== undefined && cur.timestamp !== undefined ? (cur.timestamp - prev.timestamp) / 1000 : undefined;
  const ttl = openai ? OPENAI_TTL_SECONDS : prev.ttlSeconds;

  const div = findDivergence(prev.segments, cur.segments);
  const sharedPrefixTokens = div ? div.sharedTokens : Math.min(prev.totalTokens, cur.totalTokens);
  // Segments [0, wholeSegments) are byte-identical in both requests.
  const wholeSegments = div ? div.index : prev.segments.length;

  // What the previous request left in the cache, and what this request can actually read from it.
  const prevCum = cumulative(prev.segments);
  const curMarkers = markerIndexes(cur.segments);
  const prevMarkers = markerIndexes(prev.segments);
  let prevCacheEnd = 0;
  let cached = 0;
  let cachedSegment = -1;
  let belowMinimum = false;

  if (openai) {
    prevCacheEnd = openaiCacheable(prev.totalTokens, min);
    cached = openaiCacheable(sharedPrefixTokens, min);
    belowMinimum = prev.totalTokens < min;
  } else if (prevMarkers.length) {
    const lastEnd = prevCum[prevMarkers[prevMarkers.length - 1]];
    prevCacheEnd = lastEnd >= min ? lastEnd : 0;
    belowMinimum = lastEnd < min;
    // Lookback: a request breakpoint at q finds the nearest earlier cache entry, so the hit is the
    // last previous marker m < wholeSegments with some current marker q >= m.
    const maxCur = curMarkers.length ? curMarkers[curMarkers.length - 1] : -1;
    const hit = [...prevMarkers].reverse().find((mi) => mi < wholeSegments && mi <= maxCur);
    if (hit !== undefined && prevCum[hit] >= min) {
      cached = prevCum[hit];
      cachedSegment = hit;
    }
  }
  cached = Math.min(cached, cur.totalTokens);

  const culprits: CulpritKind[] = [];
  let primary: DiffDetail | undefined;
  const note = (kind: CulpritKind, diff: DiffDetail) => {
    culprits.push(kind);
    primary ??= diff;
  };

  const modelChanged = cur.model !== prev.model || cur.provider !== prev.provider;
  const expired = gapSeconds !== undefined && gapSeconds > ttl && prevCacheEnd > 0;
  if (modelChanged) {
    note("model_changed", { where: "model", before: prev.model, after: cur.model, summary: `model: ${prev.model} → ${cur.model}` });
  }
  if (expired && gapSeconds !== undefined) {
    note("ttl_expired", {
      where: "idle gap",
      before: `${fmtDuration(gapSeconds)} since previous request`,
      after: `TTL ${fmtDuration(ttl)}`,
      summary: `idle ${fmtDuration(gapSeconds)} > ${fmtDuration(ttl)} TTL`,
    });
  }
  const fullMiss = modelChanged || expired;
  if (fullMiss) cached = 0;

  const contentBreak = div !== undefined && sharedPrefixTokens < prevCacheEnd;
  if (contentBreak && div) {
    const { culprit, diff } = classifyContent(prev.segments, cur.segments, div.index);
    note(culprit, diff);
  } else if (!fullMiss && cached < prevCacheEnd && !openai) {
    const lastPrev = prev.segments[prevMarkers[prevMarkers.length - 1]];
    const lastCur = curMarkers.length ? cur.segments[curMarkers[curMarkers.length - 1]] : undefined;
    note("marker_moved", {
      where: lastPrev.label,
      before: `cache_control at ${lastPrev.label}`,
      after: lastCur ? `cache_control at ${lastCur.label}` : "no cache_control",
      summary: lastCur ? "cache_control moved" : "cache_control removed",
    });
  }

  const isBreak = modelChanged || expired || contentBreak || culprits.includes("marker_moved");
  if (!isBreak && belowMinimum && cached === 0) {
    const have = openai ? prev.totalTokens : prevCum[prevMarkers[prevMarkers.length - 1]];
    note("below_minimum", { where: "prefix", before: `${have} tokens`, after: `minimum ${min}`, summary: `prefix ${have} tokens < ${min} minimum` });
  }

  let breakSegmentIndex = -1;
  let breakTokenOffset = -1;
  if (isBreak) {
    if (contentBreak && div) {
      breakSegmentIndex = div.index;
      breakTokenOffset = div.sharedTokens;
    } else if (fullMiss) {
      breakSegmentIndex = 0;
      breakTokenOffset = 0;
    } else {
      breakSegmentIndex = Math.min(cachedSegment + 1, cur.segments.length - 1);
      breakTokenOffset = cached;
    }
  }

  return {
    index,
    request: cur,
    sharedPrefixTokens,
    cachedTokens: cached,
    uncachedTokens: cur.totalTokens - cached,
    appendedTokens: Math.max(0, cur.totalTokens - prev.totalTokens),
    wastedTokens: isBreak ? Math.max(0, prevCacheEnd - cached) : 0,
    isBreak,
    breakSegmentIndex,
    breakTokenOffset,
    culprits,
    diff: primary,
    fixHint: culprits.length ? FIX_HINTS[culprits[0]] : undefined,
    gapSeconds,
  };
}

// --------------------------------------------------------------------- main

export function analyzeSession(reqs: NormalizedRequest[], opts: AnalyzeOptions = {}): SessionAnalysis {
  const turns = reqs.map((r, i) => (i === 0 ? firstTurn(r) : analyzePair(reqs[i - 1], r, i, opts)));
  const promptTokens = turns.reduce((a, t) => a + t.request.totalTokens, 0);
  const cachedTokens = turns.reduce((a, t) => a + t.cachedTokens, 0);
  return {
    provider: reqs[0]?.provider ?? "anthropic",
    model: reqs[0]?.model ?? "unknown",
    turns,
    totals: {
      promptTokens,
      cachedTokens,
      uncachedTokens: promptTokens - cachedTokens,
      wastedTokens: turns.reduce((a, t) => a + t.wastedTokens, 0),
      breaks: turns.filter((t) => t.isBreak).length,
      hitRate: promptTokens ? cachedTokens / promptTokens : 0,
    },
  };
}
