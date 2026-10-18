import { describe, expect, it } from "vitest";
import {
  approxTokens,
  collectCacheControls,
  hasCacheControl,
  stableStringify,
} from "./canonical";

describe("stableStringify", () => {
  it("sorts object keys at every depth", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is insensitive to key order", () => {
    expect(stableStringify({ x: 1, y: [1, 2] })).toBe(stableStringify({ y: [1, 2], x: 1 }));
  });

  it("keeps array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("strips cache_control keys at any depth", () => {
    const v = { type: "text", text: "hi", cache_control: { type: "ephemeral" }, n: [{ cache_control: {}, a: 1 }] };
    expect(stableStringify(v)).toBe('{"n":[{"a":1}],"text":"hi","type":"text"}');
  });

  it("can keep cache_control when asked", () => {
    expect(stableStringify({ a: 1, cache_control: { type: "ephemeral" } }, { stripCacheControl: false })).toBe(
      '{"a":1,"cache_control":{"type":"ephemeral"}}',
    );
  });

  it("drops undefined and handles primitives/null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(undefined)).toBe("null");
  });
});

describe("cache_control detection", () => {
  it("detects nested cache_control", () => {
    expect(hasCacheControl({ content: [{ type: "text", cache_control: { type: "ephemeral" } }] })).toBe(true);
    expect(hasCacheControl({ content: [{ type: "text" }] })).toBe(false);
    expect(hasCacheControl("str")).toBe(false);
    expect(hasCacheControl(null)).toBe(false);
  });

  it("ignores null cache_control", () => {
    expect(hasCacheControl({ cache_control: null })).toBe(false);
  });

  it("collects all cache_control objects", () => {
    const found = collectCacheControls([{ cache_control: { type: "ephemeral", ttl: "1h" } }, { a: { cache_control: { type: "ephemeral" } } }]);
    expect(found).toHaveLength(2);
    expect(found[0].ttl).toBe("1h");
  });
});

describe("approxTokens", () => {
  it("is ceil(bytes/4) with min 1", () => {
    expect(approxTokens("")).toBe(1);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
  });

  it("counts utf8 bytes not chars", () => {
    expect(approxTokens("€€")).toBe(2); // 6 bytes
  });
});
