import { describe, expect, it } from "vitest";
import { computeCost } from "./cost";
import { analyzeSession } from "./engine";
import { parseCaptureDetailed } from "./parsers";
import { SAMPLES } from "./samples";
import type { CulpritKind, SessionAnalysis } from "./types";

function load(id: string) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) throw new Error(`missing sample ${id}`);
  const parsed = parseCaptureDetailed(sample.raw);
  return { sample, parsed, analysis: analyzeSession(parsed.requests) };
}

const breaks = (a: SessionAnalysis) => Object.fromEntries(a.turns.filter((t) => t.isBreak).map((t) => [t.index, t.culprits[0]])) as Record<number, CulpritKind>;

describe("SAMPLES", () => {
  it("exposes the three sessions with unique ids and matching formats", () => {
    expect(SAMPLES.map((s) => s.id)).toEqual(["claude-code", "openai-agent", "healthy"]);
    expect(SAMPLES.map((s) => s.format)).toEqual(["jsonl", "har", "jsonl"]);
    for (const s of SAMPLES) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.blurb.length).toBeGreaterThan(10);
    }
  });

  it("every sample parses cleanly with 10-14 turns and usage on every turn", () => {
    for (const s of SAMPLES) {
      const { parsed } = load(s.id);
      expect(parsed.skipped).toBe(0);
      expect(parsed.format).toBe(s.format === "har" ? "har" : "jsonl");
      expect(parsed.requests.length).toBeGreaterThanOrEqual(10);
      expect(parsed.requests.length).toBeLessThanOrEqual(14);
      for (const r of parsed.requests) {
        expect(r.timestamp).toBeTypeOf("number");
        expect(r.usage?.inputTokens).toBeTypeOf("number");
      }
    }
  });

  it("claude-code: LSP tool load, dynamic time and idle gap are the only breaks", () => {
    const { parsed, analysis } = load("claude-code");
    expect(analysis.provider).toBe("anthropic");
    expect(analysis.model).toBe("claude-opus-4-8");
    expect(parsed.requests).toHaveLength(12);
    expect(breaks(analysis)).toEqual({ 5: "tools_changed", 7: "system_dynamic", 10: "ttl_expired" });
    expect(analysis.turns[5].diff?.summary).toBe("tools[]: +mcp__lsp__diagnostics");
    expect(analysis.turns[7].diff?.summary).toMatch(/^system: 2026-10-18T07:01:12Z → 2026-10-18T07:\d\d:\d\dZ$/);
    expect(analysis.turns[10].gapSeconds).toBeGreaterThan(420);
    for (const i of [5, 7, 10]) expect(analysis.turns[i].wastedTokens).toBeGreaterThan(1000);
    const systemTokens = parsed.requests[0].segments.filter((s) => s.kind === "system").reduce((a, s) => a + s.tokens, 0);
    expect(systemTokens).toBeGreaterThan(3000);
    expect(systemTokens).toBeLessThan(6500);
    const gaps = analysis.turns.slice(1).map((t) => t.gapSeconds ?? 0);
    expect(gaps.filter((g) => g < 20 || g > 60)).toEqual([gaps[9]]);
  });

  it("claude-code: reported usage roughly agrees with the engine", () => {
    const { analysis } = load("claude-code");
    for (const t of analysis.turns) {
      expect(t.request.usage?.cacheReadTokens ?? 0).toBe(t.cachedTokens);
    }
  });

  it("openai-agent: history rewrite then model switch", () => {
    const { analysis } = load("openai-agent");
    expect(analysis.provider).toBe("openai");
    expect(analysis.model).toBe("gpt-4.1");
    expect(breaks(analysis)).toEqual({ 6: "message_edited", 9: "model_changed" });
    expect(analysis.turns[9].diff?.summary).toBe("model: gpt-4.1 → gpt-4o");
    expect(analysis.turns[6].cachedTokens).toBeGreaterThan(1024);
    expect(analysis.turns[6].wastedTokens).toBeGreaterThan(0);
    const t = analysis.turns[5].request.usage;
    expect(t?.cacheReadTokens).toBe(analysis.turns[5].cachedTokens);
  });

  it("healthy: append-only with a single marker_moved break and a high hit rate", () => {
    const { analysis } = load("healthy");
    expect(analysis.model).toBe("claude-sonnet-4-6");
    expect(breaks(analysis)).toEqual({ 9: "marker_moved" });
    expect(analysis.totals.hitRate).toBeGreaterThan(0.7);
    expect(analysis.turns[9].diff?.summary).toBe("cache_control moved");
  });

  it("produces costs where breaks cost money", () => {
    const cc = computeCost(load("claude-code").analysis);
    expect(cc.wastedUsd).toBeGreaterThan(0);
    expect(cc.actualUsd).toBeGreaterThan(cc.idealUsd);
    const oa = computeCost(load("openai-agent").analysis);
    expect(oa.wastedUsd).toBeGreaterThan(0);
    expect(oa.savedUsd).toBeGreaterThan(0);
  });
});
