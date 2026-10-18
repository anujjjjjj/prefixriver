import { describe, expect, it } from "vitest";
import { PRICING, PRICING_SOURCES, pricingFor } from "./pricing";

describe("pricingFor", () => {
  it("matches the longest id prefix", () => {
    expect(pricingFor("claude-opus-4-1-20250805").input).toBe(15);
    expect(pricingFor("claude-opus-4-5").input).toBe(5);
    expect(pricingFor("claude-opus-4-5").minCacheable).toBe(4096);
    expect(pricingFor("claude-opus-4-20250514").input).toBe(15);
    expect(pricingFor("gpt-5-mini-2025").input).toBe(0.25);
    expect(pricingFor("gpt-5").input).toBe(1.25);
  });

  it("covers sonnet 4 and 4.5 with one row", () => {
    expect(pricingFor("claude-sonnet-4-5").id).toBe("claude-sonnet-4");
    expect(pricingFor("claude-sonnet-4-20250514").cacheRead).toBeCloseTo(0.3);
  });

  it("derives anthropic cache multipliers", () => {
    const p = pricingFor("claude-haiku-4-5");
    expect([p.input, p.cacheWrite5m, p.cacheWrite1h, p.cacheRead, p.output]).toEqual([1, 1.25, 2, 0.1, 5]);
    const h = pricingFor("claude-3-5-haiku-20241022");
    expect([h.input, h.cacheWrite5m, h.cacheWrite1h, h.cacheRead]).toEqual([0.8, 1, 1.6, 0.08]);
    expect(h.minCacheable).toBe(2048);
  });

  it("openai rows have no write surcharge", () => {
    const p = pricingFor("gpt-4.1");
    expect([p.input, p.cacheWrite5m, p.cacheWrite1h, p.cacheRead, p.output]).toEqual([2, 2, 2, 0.5, 8]);
    expect(pricingFor("gpt-4o").cacheRead).toBe(1.25);
  });

  it("falls back per provider", () => {
    expect(pricingFor("claude-future-9").provider).toBe("anthropic");
    expect(pricingFor("some-llm").provider).toBe("openai");
  });

  it("is case-insensitive and ignores routing prefixes", () => {
    expect(pricingFor("Anthropic/Claude-Haiku-4-5").id).toBe("claude-haiku-4-5");
  });

  it("has sources for both providers and a url on every row", () => {
    expect(PRICING_SOURCES.map((s) => s.provider).sort()).toEqual(["anthropic", "openai"]);
    for (const p of PRICING) expect(p.sourceUrl).toMatch(/^https:/);
  });
});

describe("current models (checked 2026-10-18)", () => {
  it("prices current Claude models from the official table", () => {
    const s5 = pricingFor("claude-sonnet-5");
    expect([s5.input, s5.cacheWrite5m, s5.cacheWrite1h, s5.cacheRead, s5.output]).toEqual([2, 2.5, 4, 0.2, 10]);
    expect(s5.minCacheable).toBe(1024);
    const s55 = pricingFor("claude-sonnet-5-5");
    expect([s55.input, s55.cacheRead]).toEqual([2, 0.1]);
    expect(s55.minCacheable).toBe(512);
    const o55 = pricingFor("claude-opus-5-5");
    expect([o55.input, o55.cacheWrite5m, o55.cacheRead, o55.output]).toEqual([4, 5, 0.2, 20]);
    expect(pricingFor("claude-opus-4-8").minCacheable).toBe(1024);
    expect(pricingFor("claude-opus-4-7").minCacheable).toBe(2048);
    expect(pricingFor("claude-opus-4-6").minCacheable).toBe(4096);
    expect(pricingFor("claude-sonnet-4-6").cacheRead).toBeCloseTo(0.3);
    const f = pricingFor("claude-fable-5-1");
    expect([f.input, f.cacheRead]).toEqual([10, 0.25]);
  });

  it("prices current OpenAI models incl. cache-write surcharge on gpt-5.6+", () => {
    const sol = pricingFor("gpt-6.1-sol");
    expect([sol.input, sol.cacheWrite5m, sol.cacheRead, sol.output]).toEqual([2, 2.5, 0.1, 10]);
    const s56 = pricingFor("gpt-5.6-sol");
    expect([s56.input, s56.cacheWrite5m, s56.cacheRead, s56.output]).toEqual([4, 5, 0.4, 20]);
    expect(pricingFor("gpt-5.5").cacheRead).toBe(0.5);
    expect(pricingFor("gpt-5.4-mini").input).toBe(0.75);
    expect(pricingFor("gpt-4.1-mini").input).toBe(0.4);
  });

  it("cites the developer pricing page for OpenAI", () => {
    expect(PRICING_SOURCES.find((s) => s.provider === "openai")?.url).toBe("https://developers.openai.com/api/docs/pricing");
  });
});
