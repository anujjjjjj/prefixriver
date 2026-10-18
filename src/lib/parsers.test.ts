import { describe, expect, it } from "vitest";
import { CaptureParseError, parseCapture, parseCaptureDetailed } from "./parsers";

const anthropicReq = {
  model: "claude-sonnet-4-5",
  system: [
    { type: "text", text: "You are an agent." },
    { type: "text", text: "Be terse.", cache_control: { type: "ephemeral", ttl: "1h" } },
  ],
  tools: [
    { name: "Bash", description: "run", input_schema: { type: "object", properties: {} } },
    { name: "Read", description: "read", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } },
  ],
  messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
    { role: "user", content: [{ type: "text", text: "go", cache_control: { type: "ephemeral" } }] },
  ],
};

const openaiChat = {
  model: "gpt-4.1",
  messages: [
    { role: "system", content: "sys prompt" },
    { role: "developer", content: "dev prompt" },
    { role: "user", content: "hi" },
  ],
  tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
};

describe("parseCapture: single requests", () => {
  it("parses an Anthropic request into ordered segments", () => {
    const [r] = parseCapture(JSON.stringify(anthropicReq));
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-5");
    expect(r.segments.map((s) => [s.kind, s.label])).toEqual([
      ["tools", "tools[0] Bash"],
      ["tools", "tools[1] Read"],
      ["system", "system[0]"],
      ["system", "system[1]"],
      ["message", "messages[0] user"],
      ["message", "messages[1] assistant"],
      ["message", "messages[2] user"],
    ]);
    expect(r.segments.map((s) => s.cacheMarker)).toEqual([false, true, false, true, false, false, true]);
    expect(r.ttlSeconds).toBe(3600);
    expect(r.totalTokens).toBe(r.segments.reduce((a, s) => a + s.tokens, 0));
    expect(r.index).toBe(0);
  });

  it("does not include cache_control in segment text", () => {
    const [r] = parseCapture(JSON.stringify(anthropicReq));
    expect(r.segments.some((s) => s.text.includes("cache_control"))).toBe(false);
  });

  it("defaults ttl to 300 without 1h", () => {
    const req = { ...anthropicReq, system: "plain", messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] }] };
    const [r] = parseCapture(JSON.stringify(req));
    expect(r.ttlSeconds).toBe(300);
    expect(r.segments.find((s) => s.kind === "system")?.label).toBe("system");
  });

  it("parses OpenAI chat completions with system/developer as system kind", () => {
    const [r] = parseCapture(JSON.stringify(openaiChat));
    expect(r.provider).toBe("openai");
    expect(r.segments.map((s) => [s.kind, s.label])).toEqual([
      ["tools", "tools[0] get_weather"],
      ["system", "system"],
      ["system", "system[1]"],
      ["message", "messages[2] user"],
    ]);
    expect(r.ttlSeconds).toBe(300);
  });

  it("parses OpenAI Responses with instructions and string input", () => {
    const [r] = parseCapture(JSON.stringify({ model: "gpt-5", instructions: "be nice", input: "hi", tools: [{ type: "function", name: "f", parameters: {} }] }));
    expect(r.provider).toBe("openai");
    expect(r.segments.map((s) => [s.kind, s.label])).toEqual([
      ["tools", "tools[0] f"],
      ["system", "system"],
      ["message", "messages[0] user"],
    ]);
  });

  it("parses OpenAI Responses with array input", () => {
    const [r] = parseCapture(
      JSON.stringify({
        model: "gpt-5",
        input: [
          { role: "user", content: "a" },
          { type: "function_call_output", call_id: "1", output: "ok" },
        ],
      }),
    );
    expect(r.segments.map((s) => s.label)).toEqual(["messages[0] user", "messages[1] function_call_output"]);
  });

  it("detects anthropic via top-level system field even without markers", () => {
    const [r] = parseCapture(JSON.stringify({ model: "x", system: "s", messages: [{ role: "user", content: "hi" }] }));
    expect(r.provider).toBe("anthropic");
  });

  it("detects anthropic via tools with input_schema", () => {
    const [r] = parseCapture(JSON.stringify({ model: "x", tools: [{ name: "a", input_schema: {} }], messages: [{ role: "user", content: "hi" }] }));
    expect(r.provider).toBe("anthropic");
  });

  it("defaults to openai when nothing indicates anthropic", () => {
    const [r] = parseCapture(JSON.stringify({ model: "x", messages: [{ role: "user", content: "hi" }] }));
    expect(r.provider).toBe("openai");
  });
});

describe("parseCapture: arrays and JSONL", () => {
  it("parses a JSON array of requests", () => {
    const rs = parseCapture(JSON.stringify([openaiChat, openaiChat]));
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => r.index)).toEqual([0, 1]);
    expect(parseCaptureDetailed(JSON.stringify([openaiChat])).format).toBe("json-array");
  });

  it("parses JSONL of raw requests", () => {
    const text = [anthropicReq, anthropicReq].map((r) => JSON.stringify(r)).join("\n");
    const d = parseCaptureDetailed(text);
    expect(d.format).toBe("jsonl");
    expect(d.requests).toHaveLength(2);
    expect(d.skipped).toBe(0);
  });

  it("parses wrapper lines with timestamps and anthropic usage", () => {
    const line = {
      timestamp: "2026-10-18T07:00:00Z",
      request: anthropicReq,
      response: { usage: { input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 20, output_tokens: 7 } },
    };
    const line2 = { ts: 1_790_000_000_000, body: anthropicReq };
    const line3 = { time: 1_790_000_000, request: anthropicReq };
    const rs = parseCapture([line, line2, line3].map((l) => JSON.stringify(l)).join("\n"));
    expect(rs[0].timestamp).toBe(Date.parse("2026-10-18T07:00:00Z"));
    expect(rs[0].usage).toEqual({ inputTokens: 10, cacheReadTokens: 500, cacheWriteTokens: 20, outputTokens: 7 });
    expect(rs[1].timestamp).toBe(1_790_000_000_000);
    expect(rs[2].timestamp).toBe(1_790_000_000_000);
  });

  it("parses OpenAI usage variants", () => {
    const a = { ts: 1, request: openaiChat, response: { usage: { prompt_tokens: 2000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 1536 } } } };
    const b = { ts: 2, request: openaiChat, response: { usage: { input_tokens: 900, output_tokens: 3, input_tokens_details: { cached_tokens: 512 } } } };
    const rs = parseCapture([a, b].map((l) => JSON.stringify(l)).join("\n"));
    expect(rs[0].usage).toEqual({ inputTokens: 2000, cacheReadTokens: 1536, outputTokens: 5 });
    expect(rs[1].usage).toEqual({ inputTokens: 900, cacheReadTokens: 512, outputTokens: 3 });
  });

  it("skips garbage lines and counts them", () => {
    const text = [JSON.stringify(openaiChat), "not json {{", "", JSON.stringify({ hello: "world" }), JSON.stringify(openaiChat)].join("\n");
    const d = parseCaptureDetailed(text);
    expect(d.requests).toHaveLength(2);
    expect(d.skipped).toBe(2);
  });

  it("tolerates CRLF line endings", () => {
    const text = [JSON.stringify(openaiChat), JSON.stringify(openaiChat)].join("\r\n");
    expect(parseCapture(text)).toHaveLength(2);
  });
});

describe("parseCapture: HAR", () => {
  const entry = (url: string, body: unknown, resp?: unknown, extra: Record<string, unknown> = {}) => ({
    startedDateTime: "2026-10-18T07:00:05.000Z",
    request: { method: "POST", url, headers: [], postData: { mimeType: "application/json", text: JSON.stringify(body) } },
    response: { status: 200, content: { mimeType: "application/json", text: resp === undefined ? undefined : JSON.stringify(resp) } },
    ...extra,
  });

  it("extracts requests, timestamps and usage", () => {
    const har = {
      log: {
        entries: [
          entry("https://api.openai.com/v1/chat/completions", openaiChat, { usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens: 4 } }),
          { startedDateTime: "2026-10-18T07:00:00Z", request: { method: "GET", url: "https://example.com/logo.png" }, response: {} },
          entry("https://api.anthropic.com/v1/messages", anthropicReq),
          entry("https://api.openai.com/v1/responses", { model: "gpt-5", input: "hi" }),
          entry("https://proxy.local/anything", openaiChat),
        ],
      },
    };
    const d = parseCaptureDetailed(JSON.stringify(har));
    expect(d.format).toBe("har");
    expect(d.requests).toHaveLength(4);
    expect(d.skipped).toBe(1);
    expect(d.requests[0].timestamp).toBe(Date.parse("2026-10-18T07:00:05.000Z"));
    expect(d.requests[0].usage).toEqual({ inputTokens: 100, cacheReadTokens: 0, outputTokens: 4 });
    expect(d.requests[1].provider).toBe("anthropic");
    expect(d.requests[3].provider).toBe("openai");
  });

  it("reads usage from SSE streamed responses", () => {
    const sse =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":900,"cache_creation_input_tokens":0}}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}\n\n';
    const har = {
      log: {
        entries: [
          {
            startedDateTime: "2026-10-18T07:00:05Z",
            request: { method: "POST", url: "https://api.anthropic.com/v1/messages", postData: { text: JSON.stringify(anthropicReq) } },
            response: { content: { text: sse } },
          },
        ],
      },
    };
    const [r] = parseCapture(JSON.stringify(har));
    expect(r.usage).toEqual({ inputTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 42 });
  });
});

describe("parseCapture: errors", () => {
  it("throws CaptureParseError on empty input", () => {
    expect(() => parseCapture("   ")).toThrow(CaptureParseError);
  });

  it("throws on unparseable input", () => {
    expect(() => parseCapture("hello world")).toThrow(CaptureParseError);
  });

  it("throws on valid JSON that is not a request", () => {
    expect(() => parseCapture('{"foo":1}')).toThrow(/request/i);
  });

  it("throws on empty HAR", () => {
    expect(() => parseCapture(JSON.stringify({ log: { entries: [] } }))).toThrow(CaptureParseError);
  });

  it("throws on empty array", () => {
    expect(() => parseCapture("[]")).toThrow(CaptureParseError);
  });
});
