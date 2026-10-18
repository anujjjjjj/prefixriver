import { describe, expect, it } from "vitest";
import { approxTokens } from "./canonical";
import { computeCost, formatUsd } from "./cost";
import { analyzeSession } from "./engine";
import { pricingFor } from "./pricing";
import type { NormalizedRequest, Provider, Segment } from "./types";

const text = (tokens: number, salt = "x") => salt + ".".repeat(tokens * 4 - salt.length);
const seg = (kind: Segment["kind"], label: string, tokens: number, marker = false, salt = "x"): Segment => {
  const t = text(tokens, salt);
  return { kind, label, text: t, tokens: approxTokens(t), cacheMarker: marker };
};
const req = (index: number, segments: Segment[], provider: Provider = "anthropic", model = "claude-sonnet-4-5"): NormalizedRequest => ({
  index,
  provider,
  model,
  segments,
  totalTokens: segments.reduce((a, s) => a + s.tokens, 0),
  ttlSeconds: 300,
});

describe("computeCost (anthropic, claude-sonnet-4-5: in 3, write5m 3.75, read 0.3 per 1M)", () => {
  // r0: system 1000 + msg 500 = 1500 | r1: + msg 200 = 1700 | r2: system rewritten, + msg 300 = 2000
  const mk = (sys: string, n: number) => {
    const msgs = [seg("message", "messages[0] user", 500, n === 1), seg("message", "messages[1] assistant", 200, n === 2), seg("message", "messages[2] user", 300, n === 3)].slice(0, n);
    const marked = msgs.map((m, i) => ({ ...m, cacheMarker: i === n - 1 }));
    return req(n - 1, [seg("system", "system", 1000, false, sys), ...marked]);
  };

  it("matches a hand-computed session including a break", () => {
    const a = analyzeSession([mk("a", 1), mk("a", 2), mk("b", 3)]);
    expect(a.turns.map((t) => t.cachedTokens)).toEqual([0, 1500, 0]);
    expect(a.turns[2].wastedTokens).toBe(1700);

    const c = computeCost(a);
    expect(c.pricing.id).toBe("claude-sonnet-4");
    // turn 0: 1500 written * 3.75                         = 5625  / 1e6
    // turn 1: 1500 read * 0.3 + 200 written * 3.75        = 1200  / 1e6
    // turn 2: 2000 written * 3.75                         = 7500  / 1e6
    expect(c.perTurn[0].actualUsd).toBeCloseTo(0.005625, 9);
    expect(c.perTurn[1].actualUsd).toBeCloseTo(0.0012, 9);
    expect(c.perTurn[2].actualUsd).toBeCloseTo(0.0075, 9);
    expect(c.actualUsd).toBeCloseTo(0.014325, 9);
    // ideal turn 2: 1700 read * 0.3 + 300 written * 3.75 = 1635 / 1e6
    expect(c.perTurn[2].wastedUsd).toBeCloseTo(0.005865, 9);
    expect(c.idealUsd).toBeCloseTo(0.00846, 9);
    expect(c.wastedUsd).toBeCloseTo(0.005865, 9);
    // saved vs no caching: turn0 9e-3... 1500*3=4500, turn1 5100, turn2 6000 (per 1e6)
    expect(c.perTurn[0].savedUsd).toBeCloseTo(-0.001125, 9);
    expect(c.perTurn[1].savedUsd).toBeCloseTo(0.0039, 9);
    expect(c.perTurn[2].savedUsd).toBeCloseTo(-0.0015, 9);
    expect(c.savedUsd).toBeCloseTo(0.001275, 9);
    expect(c.perTurn.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it("uses the 1h write rate when the request ttl is 3600", () => {
    const r = mk("a", 1);
    r.ttlSeconds = 3600;
    const c = computeCost(analyzeSession([r]));
    expect(c.actualUsd).toBeCloseTo((1500 * 6) / 1e6, 9);
  });

  it("charges uncached input rate for marker-less requests", () => {
    const r = req(0, [seg("system", "system", 2000), seg("message", "messages[0] user", 100)]);
    const c = computeCost(analyzeSession([r]));
    expect(c.actualUsd).toBeCloseTo((2100 * 3) / 1e6, 9);
    expect(c.savedUsd).toBeCloseTo(0, 9);
  });

  it("accepts an explicit pricing override", () => {
    const c = computeCost(analyzeSession([mk("a", 1)]), pricingFor("claude-opus-4-1"));
    expect(c.pricing.id).toBe("claude-opus-4-1");
    expect(c.actualUsd).toBeCloseTo((1500 * 18.75) / 1e6, 9);
  });
});

describe("computeCost (openai gpt-4.1: in 2, cached 0.5 per 1M)", () => {
  it("bills cached tokens at the read rate and the rest at input", () => {
    const m = (n: number) => seg("message", `messages[${n}] user`, n === 0 ? 2000 : 1000, false, `m${n}`);
    const r0 = req(0, [m(0)], "openai", "gpt-4.1");
    const r1 = req(1, [m(0), m(1)], "openai", "gpt-4.1");
    const a = analyzeSession([r0, r1]);
    expect(a.turns[1].cachedTokens).toBe(1920);
    const c = computeCost(a);
    expect(c.perTurn[0].actualUsd).toBeCloseTo(0.004, 9); // 2000 * 2
    expect(c.perTurn[1].actualUsd).toBeCloseTo((1920 * 0.5 + 1080 * 2) / 1e6, 9); // 3120
    expect(c.wastedUsd).toBe(0);
    expect(c.savedUsd).toBeCloseTo((3000 * 2 - 3120) / 1e6, 9);
  });

  it("prices each turn with its own model when none is forced", () => {
    const m = (n: number) => seg("message", `messages[${n}] user`, 2000, false, `m${n}`);
    const a = analyzeSession([req(0, [m(0)], "openai", "gpt-4.1"), req(1, [m(0), m(1)], "openai", "gpt-4o")]);
    const c = computeCost(a);
    expect(c.perTurn[1].actualUsd).toBeCloseTo((4000 * 2.5) / 1e6, 9); // model changed: no cache, gpt-4o input
  });
});

describe("formatUsd", () => {
  it("formats by magnitude", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1.27)).toBe("$1.27");
    expect(formatUsd(1234)).toBe("$1,234");
    expect(formatUsd(1234567.8)).toBe("$1,234,568");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-0.0015)).toBe("-$0.0015");
    expect(formatUsd(0.000001)).toBe("<$0.0001");
  });
});
