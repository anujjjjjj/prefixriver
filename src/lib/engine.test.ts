import { describe, expect, it } from "vitest";
import { approxTokens } from "./canonical";
import { FIX_HINTS, analyzeSession } from "./engine";
import type { CulpritKind, NormalizedRequest, Provider, Segment, SegmentKind } from "./types";

// ---------------------------------------------------------------- builders

/** Text of exactly `tokens` tokens (ASCII), starting with `head`. */
const pad = (head: string, tokens: number) => head + ".".repeat(Math.max(0, tokens * 4 - head.length));

function seg(kind: SegmentKind, label: string, text: string, cacheMarker = false): Segment {
  return { kind, label, text, tokens: approxTokens(text), cacheMarker };
}

interface ReqOpts {
  provider?: Provider;
  model?: string;
  ts?: number; // seconds
  ttl?: number;
}

function req(index: number, segments: Segment[], o: ReqOpts = {}): NormalizedRequest {
  return {
    index,
    provider: o.provider ?? "anthropic",
    model: o.model ?? "claude-sonnet-4-5",
    timestamp: o.ts === undefined ? undefined : o.ts * 1000,
    segments,
    totalTokens: segments.reduce((a, s) => a + s.tokens, 0),
    ttlSeconds: o.ttl ?? 300,
  };
}

interface Shape {
  tools?: [string, string][]; // name, text
  systemText?: string;
  systemMarker?: boolean;
  messages?: string[]; // texts, role alternates user/assistant
  lastMarker?: boolean;
  markers?: number[]; // explicit marker positions among message indices (overrides lastMarker)
}

/** Valid-JSON tool definition of exactly `tokens` tokens. */
function tool(name: string, desc: string, tokens = 300): [string, string] {
  const overhead = JSON.stringify({ description: "", name }).length;
  const description = desc + ".".repeat(tokens * 4 - overhead - desc.length);
  return [name, JSON.stringify({ description, name })];
}

const TOOL_A = tool("Bash", "run shell");
const TOOL_B = tool("Read", "read file");
const SYS = pad("You are a coding agent. ", 1500);

/** tools(2x300) + system(1500, marker) + messages. */
function anth(index: number, shape: Shape, o: ReqOpts = {}): NormalizedRequest {
  const tools = shape.tools ?? [TOOL_A, TOOL_B];
  const msgs = shape.messages ?? ["m0"];
  const segs: Segment[] = [
    ...tools.map(([n, t], i) => seg("tools", `tools[${i}] ${n}`, t)),
    seg("system", "system", shape.systemText ?? SYS, shape.systemMarker ?? true),
    ...msgs.map((t, i) => {
      const marked = shape.markers ? shape.markers.includes(i) : shape.lastMarker !== false && i === msgs.length - 1;
      return seg("message", `messages[${i}] ${i % 2 === 0 ? "user" : "assistant"}`, t, marked);
    }),
  ];
  return req(index, segs, o);
}

const m = (n: number, tokens = 100) => pad(`msg-${n} `, tokens);
const hist = (n: number) => Array.from({ length: n }, (_, i) => m(i));

// ------------------------------------------------------------------- tests

describe("analyzeSession: basics", () => {
  it("marks the first request and reports session metadata", () => {
    const a = analyzeSession([anth(0, { messages: hist(1) })]);
    expect(a.provider).toBe("anthropic");
    expect(a.model).toBe("claude-sonnet-4-5");
    expect(a.turns).toHaveLength(1);
    const t = a.turns[0];
    expect(t.culprits).toEqual(["first_request"]);
    expect(t.isBreak).toBe(false);
    expect(t.cachedTokens).toBe(0);
    expect(t.uncachedTokens).toBe(t.request.totalTokens);
    expect(t.wastedTokens).toBe(0);
    expect(t.breakSegmentIndex).toBe(-1);
  });

  it("treats append-only growth as healthy and caches up to the previous last marker", () => {
    const r0 = anth(0, { messages: hist(1) });
    const r1 = anth(1, { messages: hist(3) });
    const [, t1] = analyzeSession([r0, r1]).turns;
    // r0 total = 600 + 1500 + 100 = 2200 and its last marker is the last message.
    expect(r0.totalTokens).toBe(2200);
    expect(t1.isBreak).toBe(false);
    expect(t1.culprits).toEqual([]);
    expect(t1.sharedPrefixTokens).toBe(2200);
    expect(t1.cachedTokens).toBe(2200);
    expect(t1.appendedTokens).toBe(200);
    expect(t1.uncachedTokens).toBe(200);
    expect(t1.wastedTokens).toBe(0);
    expect(t1.breakSegmentIndex).toBe(-1);
    expect(t1.breakTokenOffset).toBe(-1);
  });

  it("caches only up to the previous marker when the marker sits mid-prompt", () => {
    const r0 = anth(0, { messages: hist(2), markers: [] }); // only system marker
    const r1 = anth(1, { messages: hist(4), markers: [3] });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.cachedTokens).toBe(2100); // tools 600 + system 1500
    expect(t1.isBreak).toBe(false);
  });

  it("treats marker-less anthropic requests as uncached, without flagging a break", () => {
    const mk = (n: number) => anth(n, { messages: hist(n + 1), systemMarker: false, lastMarker: false });
    const [, t1, t2] = analyzeSession([mk(0), mk(1), mk(2)]).turns;
    expect(t1.cachedTokens).toBe(0);
    expect(t1.isBreak).toBe(false);
    expect(t1.culprits).toEqual([]);
    expect(t2.wastedTokens).toBe(0);
  });

  it("computes the char-level shared prefix inside the diverging segment", () => {
    const base = pad("AAAAAAAA", 100);
    const r0 = anth(0, { messages: [base] });
    const edited = "AAAAAAAA" + "B" + base.slice(9);
    const r1 = anth(1, { messages: [edited] });
    const [, t1] = analyzeSession([r0, r1]).turns;
    // identical segments: 600 + 1500; common chars in the diverging one: 8 -> 2 tokens
    expect(t1.sharedPrefixTokens).toBe(2100 + 2);
    expect(t1.breakSegmentIndex).toBe(3);
    expect(t1.breakTokenOffset).toBe(2102);
  });

  it("records gapSeconds when timestamps exist", () => {
    const [, t1] = analyzeSession([anth(0, { messages: hist(1) }, { ts: 100 }), anth(1, { messages: hist(2) }, { ts: 130 })]).turns;
    expect(t1.gapSeconds).toBe(30);
    const [, u1] = analyzeSession([anth(0, { messages: hist(1) }), anth(1, { messages: hist(2) })]).turns;
    expect(u1.gapSeconds).toBeUndefined();
  });

  it("returns an empty analysis for no requests", () => {
    const a = analyzeSession([]);
    expect(a.turns).toEqual([]);
    expect(a.totals.hitRate).toBe(0);
  });
});

describe("analyzeSession: tools", () => {
  const LSP = tool("mcp__lsp__diagnostics", "lsp", 400);

  it("flags a tool added mid-session as tools_changed with +name", () => {
    const r0 = anth(0, { messages: hist(3) });
    const r1 = anth(1, { messages: hist(4), tools: [TOOL_A, TOOL_B, LSP] });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits[0]).toBe("tools_changed");
    expect(t1.diff?.summary).toContain("+mcp__lsp__diagnostics");
    expect(t1.diff?.summary).toBe("tools[]: +mcp__lsp__diagnostics");
    expect(t1.diff?.where).toBe("tools[2] mcp__lsp__diagnostics");
    expect(t1.diff?.before).toBe("");
    expect(t1.diff?.after).toContain("mcp__lsp__diagnostics");
    // previous markers are system and last message, both after the inserted tool: nothing is reusable.
    expect(t1.cachedTokens).toBe(0);
    expect(t1.wastedTokens).toBe(r0.totalTokens);
    expect(t1.breakSegmentIndex).toBe(2);
    expect(t1.breakTokenOffset).toBe(600);
    expect(t1.fixHint).toBe(FIX_HINTS.tools_changed);
  });

  it("flags a removed tool with -name", () => {
    const r0 = anth(0, { messages: hist(3), tools: [TOOL_A, TOOL_B, LSP] });
    const r1 = anth(1, { messages: hist(4), tools: [TOOL_A, TOOL_B] });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.culprits[0]).toBe("tools_changed");
    expect(t1.diff?.summary).toBe("tools[]: -mcp__lsp__diagnostics");
    expect(t1.diff?.after).toBe("");
  });

  it("reports which field changed inside a tool definition", () => {
    const r0 = anth(0, { messages: hist(3) });
    const changed = tool("Read", "read a file!");
    const r1 = anth(1, { messages: hist(4), tools: [TOOL_A, changed] });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.culprits[0]).toBe("tools_changed");
    expect(t1.diff?.summary).toBe("tools[1] Read: description changed");
  });

  it("flags reordered tools", () => {
    const r0 = anth(0, { messages: hist(3) });
    const r1 = anth(1, { messages: hist(4), tools: [TOOL_B, TOOL_A] });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.culprits[0]).toBe("tools_changed");
    expect(t1.diff?.summary).toBe("tools[]: reordered");
  });
});

describe("analyzeSession: system prompt", () => {
  const withTime = (time: string, extra = "") => pad(`Rules. Current time: ${time}\\nMore rules ${extra}`, 1500);

  it("flags a changing timestamp as system_dynamic and shows both values", () => {
    const r0 = anth(0, { messages: hist(3), systemText: withTime("2026-10-18T07:01:12Z") });
    const r1 = anth(1, { messages: hist(4), systemText: withTime("2026-10-18T07:03:40Z") });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits[0]).toBe("system_dynamic");
    expect(t1.diff?.summary).toBe("system: 2026-10-18T07:01:12Z → 2026-10-18T07:03:40Z");
    expect(t1.diff?.where).toBe("system");
    expect(t1.diff?.before).toContain("07:01:12");
    expect(t1.diff?.after).toContain("07:03:40");
    expect(t1.diff?.before.length).toBeLessThan(90);
    expect(t1.cachedTokens).toBe(0); // marker sat on the (changed) system block
    expect(t1.wastedTokens).toBe(r0.totalTokens);
    expect(t1.fixHint).toBe(FIX_HINTS.system_dynamic);
  });

  it("recognises uuids and session ids as dynamic", () => {
    const mk = (id: string) => pad(`Session ${id} started. Other text.`, 1500);
    const r0 = anth(0, { messages: hist(2), systemText: mk("3f2b8c1e-9d4a-4e7b-a1c2-5d6e7f8a9b0c") });
    const r1 = anth(1, { messages: hist(3), systemText: mk("aa11bb22-9d4a-4e7b-a1c2-5d6e7f8a9b0c") });
    expect(analyzeSession([r0, r1]).turns[1].culprits[0]).toBe("system_dynamic");

    const mk2 = (id: string) => pad(`session_id: ${id}\\nmore`, 1500);
    const q0 = anth(0, { messages: hist(2), systemText: mk2("abc12345") });
    const q1 = anth(1, { messages: hist(3), systemText: mk2("zzz99999") });
    expect(analyzeSession([q0, q1]).turns[1].culprits[0]).toBe("system_dynamic");
  });

  it("treats a non-dynamic system edit as message_edited located at system", () => {
    const mk = (w: string) => pad(`Be ${w} when answering.`, 1500);
    const r0 = anth(0, { messages: hist(2), systemText: mk("terse") });
    const r1 = anth(1, { messages: hist(3), systemText: mk("verbose") });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits[0]).toBe("message_edited");
    expect(t1.diff?.where).toBe("system");
    expect(t1.diff?.summary).toBe("system edited");
  });
});

describe("analyzeSession: messages", () => {
  it("flags an earlier edited message as message_edited", () => {
    const h0 = hist(5);
    const h1 = [...h0.slice(0, 2), "REWRITTEN " + h0[2].slice(10), ...h0.slice(3), m(5)];
    const r0 = anth(0, { messages: h0 });
    const r1 = anth(1, { messages: h1 });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits).toEqual(["message_edited"]);
    expect(t1.diff?.summary).toBe("messages[2] user edited");
    expect(t1.diff?.where).toBe("messages[2] user");
    // system marker precedes the edit so tools+system are still cached
    expect(t1.cachedTokens).toBe(2100);
    expect(t1.wastedTokens).toBe(r0.totalTokens - 2100);
    expect(t1.fixHint).toBe(FIX_HINTS.message_edited);
  });

  it("flags history truncation (messages removed) as message_edited", () => {
    const r0 = anth(0, { messages: hist(6) });
    const r1 = anth(1, { messages: hist(3) });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits[0]).toBe("message_edited");
    expect(t1.diff?.summary).toBe("messages[3] assistant removed");
  });
});

describe("analyzeSession: ttl and model", () => {
  it("flags a miss after the 5 minute TTL", () => {
    const r0 = anth(0, { messages: hist(3) }, { ts: 1000 });
    const r1 = anth(1, { messages: hist(4) }, { ts: 1000 + 432 });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.gapSeconds).toBe(432);
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits).toEqual(["ttl_expired"]);
    expect(t1.diff?.summary).toBe("idle 7m12s > 5m TTL");
    expect(t1.cachedTokens).toBe(0);
    expect(t1.wastedTokens).toBe(r0.totalTokens);
    expect(t1.fixHint).toBe(FIX_HINTS.ttl_expired);
  });

  it("does not flag a gap within the TTL, and honours 1h ttl", () => {
    const [, ok] = analyzeSession([anth(0, { messages: hist(1) }, { ts: 0 }), anth(1, { messages: hist(2) }, { ts: 300 })]).turns;
    expect(ok.culprits).toEqual([]);
    const [, hour] = analyzeSession([anth(0, { messages: hist(1) }, { ts: 0, ttl: 3600 }), anth(1, { messages: hist(2) }, { ts: 432, ttl: 3600 })]).turns;
    expect(hour.isBreak).toBe(false);
    expect(hour.cachedTokens).toBeGreaterThan(0);
  });

  it("flags model change as a full miss", () => {
    const r0 = anth(0, { messages: hist(3) });
    const r1 = anth(1, { messages: hist(4) }, { model: "claude-opus-4-1" });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits).toEqual(["model_changed"]);
    expect(t1.diff?.summary).toBe("model: claude-sonnet-4-5 → claude-opus-4-1");
    expect(t1.cachedTokens).toBe(0);
    expect(t1.wastedTokens).toBe(r0.totalTokens);
  });

  it("lists model_changed before other culprits", () => {
    const r0 = anth(0, { messages: hist(3) }, { ts: 0 });
    const r1 = anth(1, { messages: hist(4), tools: [TOOL_A] }, { model: "claude-opus-4-1", ts: 900 });
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.culprits.slice(0, 3)).toEqual(["model_changed", "ttl_expired", "tools_changed"]);
  });
});

describe("analyzeSession: minimum cacheable size and markers", () => {
  const tiny = (n: number) => anth(n, { tools: [tool("T", "t", 10)], systemText: pad("sys", 50), messages: [m(0, 20), ...(n ? [m(1, 20)] : [])] });

  it("reports below_minimum when the cacheable prefix is under the minimum", () => {
    const [, t1] = analyzeSession([tiny(0), tiny(1)]).turns;
    expect(t1.cachedTokens).toBe(0);
    expect(t1.culprits).toEqual(["below_minimum"]);
    expect(t1.isBreak).toBe(false);
    expect(t1.wastedTokens).toBe(0);
    expect(t1.diff?.summary).toContain("1024");
  });

  it("lets minCacheable be overridden", () => {
    const [, t1] = analyzeSession([tiny(0), tiny(1)], { minCacheable: 50 }).turns;
    expect(t1.cachedTokens).toBeGreaterThan(0);
    expect(t1.culprits).toEqual([]);
  });

  it("uses the model-specific minimum by default (opus 4.5 needs 4096)", () => {
    const o = { model: "claude-opus-4-5" };
    const [, t1] = analyzeSession([anth(0, { messages: hist(2) }, o), anth(1, { messages: hist(3) }, o)]).turns;
    expect(t1.culprits).toEqual(["below_minimum"]);
    expect(t1.cachedTokens).toBe(0);
  });

  it("flags marker_moved when the previous cached position is no longer a breakpoint", () => {
    const r0 = anth(0, { messages: hist(3) });
    const r1 = anth(1, { messages: hist(4), systemMarker: false, lastMarker: false, tools: [TOOL_A, TOOL_B] });
    // give the second tool a marker; it is earlier than every previous marker
    r1.segments[1] = { ...r1.segments[1], cacheMarker: true };
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits).toEqual(["marker_moved"]);
    expect(t1.diff?.summary).toBe("cache_control moved");
    expect(t1.cachedTokens).toBe(0);
    expect(t1.wastedTokens).toBe(r0.totalTokens);
    expect(t1.fixHint).toBe(FIX_HINTS.marker_moved);
  });

  it("flags marker_moved with a partial hit when only later markers were dropped", () => {
    const r0 = anth(0, { messages: hist(3) });
    const r1 = anth(1, { messages: hist(4), lastMarker: false }); // system marker kept
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.culprits).toEqual(["marker_moved"]);
    expect(t1.cachedTokens).toBe(2100);
    expect(t1.wastedTokens).toBe(r0.totalTokens - 2100);
  });

  it("does not flag the normal rolling marker", () => {
    const rs = [1, 2, 3, 4].map((n, i) => anth(i, { messages: hist(n) }));
    const a = analyzeSession(rs);
    expect(a.turns.slice(1).every((t) => !t.isBreak)).toBe(true);
  });
});

describe("analyzeSession: openai", () => {
  const oa = (index: number, msgs: string[], o: ReqOpts = {}) =>
    req(
      index,
      [seg("system", "system", pad("sys", 800)), ...msgs.map((t, i) => seg("message", `messages[${i}] ${i % 2 ? "assistant" : "user"}`, t, true))],
      { provider: "openai", model: "gpt-4.1", ...o },
    );

  it("caches the shared prefix in 128-token increments once >= 1024", () => {
    const r0 = oa(0, [m(0, 1500)]); // 2300 tokens
    const r1 = oa(1, [m(0, 1500), m(1, 100)]);
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.sharedPrefixTokens).toBe(2300);
    expect(t1.cachedTokens).toBe(2304 - 128); // floor(2300/128)*128 = 2176
    expect(t1.cachedTokens).toBe(2176);
    expect(t1.isBreak).toBe(false);
  });

  it("ignores cache markers and does not cache below 1024 tokens", () => {
    const small = (n: number) => req(n, [seg("system", "system", pad("s", 300)), ...Array.from({ length: n + 1 }, (_, i) => seg("message", `messages[${i}] user`, m(i, 100)))], { provider: "openai", model: "gpt-4.1" });
    const [, t1] = analyzeSession([small(0), small(1)]).turns;
    expect(t1.cachedTokens).toBe(0);
    expect(t1.culprits).toEqual(["below_minimum"]);
  });

  it("flags edits to earlier messages and wastes the lost 128-blocks", () => {
    const r0 = oa(0, [m(0, 1000), m(1, 1000), m(2, 500)]); // 800+2500 = 3300
    const r1 = oa(1, [m(0, 1000), "EDITED " + m(1, 1000).slice(7), m(2, 500)]);
    const [, t1] = analyzeSession([r0, r1]).turns;
    expect(t1.isBreak).toBe(true);
    expect(t1.culprits[0]).toBe("message_edited");
    // shared = 800 + 1000 + 1 (common prefix 0 chars => 0) = 1800 -> floor(1800/128)*128 = 1792
    expect(t1.sharedPrefixTokens).toBe(1800);
    expect(t1.cachedTokens).toBe(1792);
    // previous cacheable: floor(3300/128)*128 = 3200
    expect(t1.wastedTokens).toBe(3200 - 1792);
  });

  it("uses a 10 minute nominal ttl", () => {
    const r0 = oa(0, [m(0, 1500)], { ts: 0 });
    const r1 = oa(1, [m(0, 1500), m(1, 10)], { ts: 540 });
    const r2 = oa(2, [m(0, 1500), m(1, 10), m(2, 10)], { ts: 540 + 700 });
    const a = analyzeSession([r0, r1, r2]);
    expect(a.turns[1].isBreak).toBe(false);
    expect(a.turns[2].culprits).toEqual(["ttl_expired"]);
    expect(a.turns[2].diff?.summary).toBe("idle 11m40s > 10m TTL");
  });

  it("flags model changes", () => {
    const r0 = oa(0, [m(0, 1500)]);
    const r1 = oa(1, [m(0, 1500), m(1, 10)], { model: "gpt-4o" });
    expect(analyzeSession([r0, r1]).turns[1].culprits).toEqual(["model_changed"]);
  });
});

describe("analyzeSession: totals and hints", () => {
  it("sums totals and computes hitRate", () => {
    const r0 = anth(0, { messages: hist(1) });
    const r1 = anth(1, { messages: hist(3) });
    const r2 = anth(2, { messages: hist(3), tools: [TOOL_A] });
    const a = analyzeSession([r0, r1, r2]);
    const prompt = r0.totalTokens + r1.totalTokens + r2.totalTokens;
    expect(a.totals.promptTokens).toBe(prompt);
    expect(a.totals.cachedTokens).toBe(a.turns.reduce((s, t) => s + t.cachedTokens, 0));
    expect(a.totals.uncachedTokens).toBe(prompt - a.totals.cachedTokens);
    expect(a.totals.breaks).toBe(1);
    expect(a.totals.wastedTokens).toBe(a.turns[2].wastedTokens);
    expect(a.totals.hitRate).toBeCloseTo(a.totals.cachedTokens / prompt, 10);
  });

  it("has a fix hint for every culprit kind", () => {
    const kinds: CulpritKind[] = ["tools_changed", "system_dynamic", "message_edited", "marker_moved", "ttl_expired", "model_changed", "below_minimum", "first_request"];
    for (const k of kinds) expect(FIX_HINTS[k].length).toBeGreaterThan(10);
    expect(FIX_HINTS.tools_changed).toBe("Load all tools up front (or defer via a stable tool-search stub) and keep tools[] byte-identical and in a fixed order.");
  });
});
