# PrefixRiver

See exactly where your AI agent's prompt cache breaks, and what each break costs.

PrefixRiver is a 100% client-side web app. Paste or drop a capture of an agent's LLM requests (Anthropic Messages, OpenAI Chat Completions / Responses; single JSON, JSONL or HAR) and it renders every turn as a river of token blocks in provider render order (tools, then system, then messages). The cached prefix glows; every cache break cracks the river, names the culprit, shows the exact diff and prices the re-billed tokens.

Nothing is uploaded. There are no API keys and no server routes for your data.

## Features

- **Ingest**: Anthropic and OpenAI request JSON, JSON arrays, JSONL (raw requests or `{timestamp, request, response}` wrappers) and HAR exports. Three built-in sample sessions, including a Claude Code-style session where a tool loads mid-session and a timestamp in the system prompt busts the cache.
- **Prefix engine**: longest common prefix between consecutive requests in canonical order, approximate token counts (~4 bytes/token), `cache_control` breakpoints, minimum cacheable sizes, TTL expiry from timestamps, model switches, OpenAI 128-token cache increments.
- **Culprits + fixes**: tools changed, dynamic value in system prompt, earlier message edited, cache marker moved, TTL expired, model changed, below minimum size; each with a concrete fix hint.
- **The river**: canvas visualization with animated cracks, hover diffs and a timeline scrubber that replays the session with a live saved/wasted counter.
- **Cost panel**: dollars wasted per break using published Anthropic and OpenAI cache pricing (sources linked in the UI), hit-rate gauge, PNG share card export.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest unit tests
npm run lint
npm run typecheck
npm run build && npm start
```

## Accuracy notes

Token counts are estimated from byte length unless the capture carries provider `usage` blocks. Cache behaviour is modelled from the public provider documentation (breakpoints, lookback, minimum sizes, TTLs); the providers' own diagnostics remain the source of truth for any single request. Pricing lives in `src/lib/pricing.ts` with source links and a checked date.

## License

MIT
