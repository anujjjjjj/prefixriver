// Built-in demo sessions. Everything is generated deterministically from TypeScript objects and
// serialized into the capture formats the parsers accept, so the samples exercise the real pipeline.

import { analyzeSession } from "./engine";
import { parseCapture } from "./parsers";
import type { NormalizedRequest, SampleSession } from "./types";

type Json = Record<string, unknown>;

// -------------------------------------------------------------- text sources

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERBS = ["modify", "create", "delete", "rename", "refactor", "review", "debug", "document", "migrate", "benchmark"];
const OBJECTS = ["a source file", "a configuration file", "a database migration", "a public API", "a build script", "a dependency manifest", "a test fixture", "a CI workflow", "a shared utility", "an environment template"];
const PRACTICES = [
  "read the surrounding code and match its conventions",
  "search the repository for existing usages",
  "confirm the file exists and is tracked by git",
  "look for related tests that describe the expected behavior",
  "check git status so unrelated local changes are not overwritten",
  "verify the change against the project's documented style rules",
];
const FOLLOWUPS = ["making any edit", "proposing a plan", "running the test suite", "creating a commit", "reporting back to the user", "touching anything that is generated"];
const REASONS = [
  "because silent regressions are far more expensive than a short clarifying question",
  "since reviewers rely on small, focused diffs they can verify quickly",
  "so the user can follow your reasoning without reading every tool call",
  "because the repository may contain conventions that are not written down anywhere",
  "to keep the working tree in a state the user can easily revert",
];

function ruleLines(seed: number, targetChars: number, title: string): string {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const lines: string[] = [`# ${title}`];
  let chars = lines[0].length;
  for (let n = 1; chars < targetChars; n++) {
    const line = `${n}. When you ${pick(VERBS)} ${pick(OBJECTS)}, ${pick(PRACTICES)} before ${pick(FOLLOWUPS)}, ${pick(REASONS)}.`;
    lines.push(line);
    chars += line.length + 1;
  }
  return lines.join("\n");
}

const AGENT_CORE = `You are an interactive command line agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

# Tone and style
You should be concise, direct, and to the point. Your output is displayed on a command line interface, so keep responses short and use GitHub-flavored markdown only where it helps. Output text to communicate with the user; never use tools such as shell echo to talk to the user. Do not add unnecessary preamble or postamble, such as explaining your code after you have edited it, unless the user asks. Prefer one-word or one-line answers when they fully answer the question.

# Proactiveness
You are allowed to be proactive, but only when the user asks you to do something. Strike a balance between doing the right thing when asked, including taking actions and follow-up actions, and not surprising the user with actions you take without asking. If the user asks how to approach something, answer the question first and do not immediately jump into taking actions.

# Following conventions
When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns. Never assume that a given library is available, even if it is well known. Whenever you write code that uses a library or framework, first check that this codebase already uses it by looking at neighboring files or the package manifest.

# Code style
Do not add comments to the code you write unless the user asks you to or the code is complex and requires extra context. Never introduce code that exposes or logs secrets and keys, and never commit secrets to the repository.

# Task management
You have access to a todo list tool to plan and track your work. Use it very frequently to make sure you are tracking tasks and giving the user visibility into your progress. Mark todos as completed as soon as you are done with a task; do not batch up multiple tasks before marking them as completed.

# Doing tasks
The user will primarily request software engineering tasks: fixing bugs, adding functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended: use the search tools to understand the codebase and the user's query; implement the solution using all tools available to you; verify the solution with tests if possible, never assuming a specific test framework; and run the lint and typecheck commands if they were provided, since they are essential for ensuring correctness.

# Tool usage policy
When doing file search, prefer the Task tool in order to reduce context usage. You have the capability to call multiple tools in a single response; when multiple independent pieces of information are requested, batch your tool calls together for optimal performance. Always use dedicated file tools rather than shell commands such as cat, grep or sed when a dedicated tool exists.

# Git safety
Only create commits when the user explicitly asks. Never update the git config, never run destructive commands such as force pushes or hard resets unless explicitly requested, never skip hooks, and never use interactive flags that require input. Before running a commit, inspect the staged diff and the recent history so the message matches the repository's style.

# Code references
When referencing specific functions or pieces of code include the pattern file_path:line_number so the user can navigate to the source location easily.`;

const AGENT_SAFETY = `You must refuse to write code or explain code that may be used maliciously, even if the user claims it is for educational purposes. Assist with defensive security tasks only. Before starting work, think about what the code you are editing is supposed to do based on the filenames and directory structure; if it seems malicious, refuse to work on it or answer questions about it.`;

function buildSystemPrompt(seed: number, targetTokens: number, extraTitle: string): string {
  const base = AGENT_CORE.length;
  const rules = ruleLines(seed, targetTokens * 4 - base, extraTitle);
  return `${AGENT_CORE}\n\n${rules}`;
}

// --------------------------------------------------------------------- tools

interface ToolSpec {
  name: string;
  description: string;
  props: Record<string, { type: string; description: string }>;
  required: string[];
}

const USAGE_NOTES = [
  "Prefer absolute paths and never rely on the current working directory persisting between calls.",
  "If the result is large, narrow the request instead of retrying with the same arguments.",
  "Errors are returned as plain text; read them carefully before deciding on the next step.",
  "Never use this tool to communicate with the user; use plain text output instead.",
  "Parallelize independent calls in a single response whenever possible to reduce latency.",
  "Respect .gitignore and any permission rules configured by the user for this workspace.",
];

function describeTool(spec: ToolSpec, notes: number): string {
  const extra = USAGE_NOTES.slice(0, notes).map((n, i) => `${i + 1}. ${n}`).join("\n");
  return `${spec.description}\n\nUsage notes:\n${extra}`;
}

const CODING_TOOLS: ToolSpec[] = [
  { name: "Bash", description: "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures. Before executing the command, verify that the parent directory exists and quote any paths that contain spaces.", props: { command: { type: "string", description: "The command to execute" }, timeout: { type: "number", description: "Optional timeout in milliseconds (max 600000)" }, description: { type: "string", description: "Clear, concise description of what this command does in 5-10 words" } }, required: ["command"] },
  { name: "Read", description: "Reads a file from the local filesystem. You can access any file directly by using this tool. By default it reads up to 2000 lines starting from the beginning of the file; results are returned using cat -n format with line numbers starting at 1.", props: { file_path: { type: "string", description: "The absolute path to the file to read" }, offset: { type: "number", description: "The line number to start reading from" }, limit: { type: "number", description: "The number of lines to read" } }, required: ["file_path"] },
  { name: "Edit", description: "Performs exact string replacements in files. You must use the Read tool at least once in the conversation before editing. The edit will fail if old_string is not unique in the file; provide a larger string with more surrounding context or use replace_all.", props: { file_path: { type: "string", description: "The absolute path to the file to modify" }, old_string: { type: "string", description: "The text to replace" }, new_string: { type: "string", description: "The text to replace it with" }, replace_all: { type: "boolean", description: "Replace all occurrences of old_string" } }, required: ["file_path", "old_string", "new_string"] },
  { name: "Write", description: "Writes a file to the local filesystem, overwriting the existing file if there is one. Prefer editing existing files; never proactively create documentation files unless explicitly requested by the user.", props: { file_path: { type: "string", description: "The absolute path to the file to write" }, content: { type: "string", description: "The content to write to the file" } }, required: ["file_path", "content"] },
  { name: "Glob", description: "Fast file pattern matching tool that works with any codebase size. Supports glob patterns like **/*.js or src/**/*.ts and returns matching file paths sorted by modification time.", props: { pattern: { type: "string", description: "The glob pattern to match files against" }, path: { type: "string", description: "The directory to search in" } }, required: ["pattern"] },
  { name: "Grep", description: "A powerful search tool built on ripgrep. Supports full regex syntax, file type filtering and glob filtering. Always use Grep for search tasks; never invoke grep or rg as a Bash command.", props: { pattern: { type: "string", description: "The regular expression pattern to search for" }, path: { type: "string", description: "File or directory to search in" }, glob: { type: "string", description: "Glob pattern to filter files" }, output_mode: { type: "string", description: "content, files_with_matches or count" } }, required: ["pattern"] },
  { name: "TodoWrite", description: "Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks and demonstrate thoroughness to the user.", props: { todos: { type: "array", description: "The updated todo list" } }, required: ["todos"] },
  { name: "Task", description: "Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has its own set of tools; the agent returns a single message back to you when it is done.", props: { description: { type: "string", description: "A short description of the task" }, prompt: { type: "string", description: "The task for the agent to perform" }, subagent_type: { type: "string", description: "The type of specialized agent to use" } }, required: ["description", "prompt"] },
  { name: "WebFetch", description: "Fetches content from a specified URL and processes it using a small model. Takes a URL and a prompt as input, converts HTML to markdown, and returns the model's response about the content.", props: { url: { type: "string", description: "The URL to fetch content from" }, prompt: { type: "string", description: "The prompt to run on the fetched content" } }, required: ["url", "prompt"] },
];

const LSP_TOOL: ToolSpec = {
  name: "mcp__lsp__diagnostics",
  description: "Returns language server diagnostics (errors, warnings and hints) for a file or for the entire workspace, including the source, severity, range and a short message for each problem.",
  props: { uri: { type: "string", description: "File URI to fetch diagnostics for; omit for the whole workspace" }, severity: { type: "string", description: "Minimum severity: error, warning, information or hint" }, max_results: { type: "number", description: "Maximum number of diagnostics to return" } },
  required: [],
};

const API_TOOLS: ToolSpec[] = [
  { name: "read_file", description: "Read the contents of a text file in the project workspace and return it with line numbers.", props: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] },
  { name: "write_file", description: "Create or overwrite a text file in the project workspace.", props: { path: { type: "string", description: "Workspace-relative path" }, content: { type: "string", description: "Full file content" } }, required: ["path", "content"] },
  { name: "run_shell", description: "Run a shell command inside the sandboxed workspace and return stdout, stderr and the exit code.", props: { command: { type: "string", description: "Command line to run" } }, required: ["command"] },
  { name: "search_code", description: "Search the repository for a regular expression and return matching lines with file and line number.", props: { pattern: { type: "string", description: "Regular expression" }, glob: { type: "string", description: "Optional glob filter" } }, required: ["pattern"] },
  { name: "list_dir", description: "List the entries of a directory in the workspace, marking directories with a trailing slash.", props: { path: { type: "string", description: "Workspace-relative directory" } }, required: ["path"] },
  { name: "run_tests", description: "Run the project's test suite or a single test file and return a summary of failures.", props: { target: { type: "string", description: "Optional test file or pattern" } }, required: [] },
];

const anthropicTool = (t: ToolSpec, notes: number): Json => ({
  name: t.name,
  description: describeTool(t, notes),
  input_schema: { type: "object", properties: t.props, required: t.required },
});

const openaiTool = (t: ToolSpec, notes: number): Json => ({
  type: "function",
  function: { name: t.name, description: describeTool(t, notes), parameters: { type: "object", properties: t.props, required: t.required } },
});

// ------------------------------------------------------------ conversation

const FUNCS = ["parseConfig", "loadSession", "mergeOptions", "renderRow", "resolvePath", "retryRequest", "flushQueue", "hashKey", "formatBytes", "validateInput"];
const MODULES = ["src/config.ts", "src/session.ts", "src/net/client.ts", "src/ui/table.ts", "src/util/path.ts", "src/queue.ts", "src/util/hash.ts", "src/validate.ts"];

/** Plausible tool output: roughly `lines` lines of source-like text. */
function fakeOutput(seed: number, lines: number): string {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const fn = pick(FUNCS);
    switch (Math.floor(r() * 4)) {
      case 0:
        out.push(`${String(i + 1).padStart(4)}  export function ${fn}(input: Options, ctx: Context): Result {`);
        break;
      case 1:
        out.push(`${String(i + 1).padStart(4)}    const value = ctx.cache.get(${JSON.stringify(fn)}) ?? await ${pick(FUNCS)}(input, ctx);`);
        break;
      case 2:
        out.push(`${String(i + 1).padStart(4)}    if (!value.ok) throw new ${pick(["ConfigError", "NetworkError", "ValidationError"])}(\`${fn} failed: \${value.reason}\`);`);
        break;
      default:
        out.push(`${String(i + 1).padStart(4)}  // ${pick(MODULES)}: ${pick(["handles retries", "normalizes paths", "keeps ordering stable", "defers to the scheduler"])}`);
    }
  }
  return out.join("\n");
}

interface Step {
  tool: string;
  input: Json;
  note: string;
  result: string;
}

function makeSteps(seed: number, count: number, tools: string[]): Step[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const tool = tools[i % tools.length];
    const file = MODULES[Math.floor(r() * MODULES.length)];
    const input: Json = tool === "Bash" || tool === "run_shell" ? { command: `npx vitest run ${file.replace("src/", "test/").replace(".ts", ".test.ts")}` } : tool === "Grep" || tool === "search_code" ? { pattern: FUNCS[Math.floor(r() * FUNCS.length)] } : { [tool === "Read" || tool === "Edit" || tool === "Write" ? "file_path" : "path"]: `/work/${file}` };
    return {
      tool,
      input,
      note: `Step ${i + 1}: inspecting ${file} to continue with the fix.`,
      result: `${file}\n${fakeOutput(seed * 100 + i, 28 + Math.floor(r() * 40))}`,
    };
  });
}

// --------------------------------------------------------------- serialization

interface BuiltTurn {
  ts: number;
  body: Json;
}

const fmtIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function withUsage(turns: BuiltTurn[]): { turn: BuiltTurn; usage: Json }[] {
  const text = turns.map((t) => JSON.stringify({ timestamp: t.ts, request: t.body })).join("\n");
  const reqs: NormalizedRequest[] = parseCapture(text);
  const analysis = analyzeSession(reqs);
  return turns.map((turn, i) => {
    const t = analysis.turns[i];
    const r = reqs[i];
    const out = 120 + ((i * 97) % 380);
    if (r.provider === "anthropic") {
      let end = 0;
      let run = 0;
      for (const s of r.segments) {
        run += s.tokens;
        if (s.cacheMarker) end = run;
      }
      const creation = Math.max(0, end - t.cachedTokens);
      return { turn, usage: { input_tokens: Math.max(0, r.totalTokens - t.cachedTokens - creation), cache_creation_input_tokens: creation, cache_read_input_tokens: t.cachedTokens, output_tokens: out } };
    }
    return { turn, usage: { prompt_tokens: r.totalTokens, completion_tokens: out, total_tokens: r.totalTokens + out, prompt_tokens_details: { cached_tokens: t.cachedTokens } } };
  });
}

function toJsonl(turns: BuiltTurn[]): string {
  return withUsage(turns)
    .map(({ turn, usage }) => JSON.stringify({ timestamp: fmtIso(turn.ts), request: turn.body, response: { usage } }))
    .join("\n");
}

function toHar(turns: BuiltTurn[], url: string): string {
  const entries = withUsage(turns).map(({ turn, usage }) => ({
    startedDateTime: new Date(turn.ts).toISOString(),
    time: 1800,
    request: {
      method: "POST",
      url,
      httpVersion: "HTTP/2",
      headers: [{ name: "content-type", value: "application/json" }],
      postData: { mimeType: "application/json", text: JSON.stringify(turn.body) },
    },
    response: { status: 200, statusText: "OK", content: { mimeType: "application/json", text: JSON.stringify({ object: "chat.completion", model: turn.body.model, usage }) } },
  }));
  return JSON.stringify({ log: { version: "1.2", creator: { name: "PrefixRiver sample", version: "1" }, entries } }, null, 1);
}

const START = Date.parse("2026-10-18T07:01:12Z");

function timeline(gaps: number[]): number[] {
  const out = [START];
  for (const g of gaps) out.push(out[out.length - 1] + g * 1000);
  return out;
}

// ----------------------------------------------------- Anthropic message builder

function anthropicMessages(steps: Step[], turn: number, task: string): Json[] {
  const msgs: Json[] = [{ role: "user", content: [{ type: "text", text: task }] }];
  for (let i = 0; i < turn; i++) {
    const s = steps[i];
    const id = `toolu_01${String(i).padStart(2, "0")}Hk${(i * 7919).toString(36).padStart(6, "x")}`;
    msgs.push({ role: "assistant", content: [{ type: "text", text: s.note }, { type: "tool_use", id, name: s.tool, input: s.input }] });
    msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: s.result }] });
  }
  return msgs;
}

function markLastBlock(msg: Json): void {
  const content = msg.content as Json[];
  content[content.length - 1].cache_control = { type: "ephemeral" };
}

// ------------------------------------------------------------------- sample A

function claudeCodeSample(): SampleSession {
  const gaps = [34, 41, 27, 52, 38, 45, 29, 48, 36, 452, 31];
  const times = timeline(gaps);
  const steps = makeSteps(11, 12, ["Read", "Grep", "Edit", "Bash", "Glob"]);
  const mainPrompt = buildSystemPrompt(101, 17000, "Additional working agreements");
  const task = "The retry logic in src/net/client.ts gives up after the first 503. Find out why, fix it, and make sure the tests in test/net still pass.";

  const turns: BuiltTurn[] = times.map((ts, t) => {
    const clock = fmtIso(t >= 7 ? times[7] : times[0]);
    const tools = [...CODING_TOOLS, ...(t >= 5 ? [LSP_TOOL] : [])].map((spec) => anthropicTool(spec, 4));
    (tools[tools.length - 1] as Json).cache_control = { type: "ephemeral" };
    const system: Json[] = [
      { type: "text", text: "You are Claude Code, an interactive CLI tool that helps users with software engineering tasks." },
      { type: "text", text: `${AGENT_SAFETY}\n\n${mainPrompt}\n\n# Environment\nWorking directory: /work/api-gateway\nPlatform: linux\nCurrent time: ${clock}\n`, cache_control: { type: "ephemeral" } },
    ];
    const messages = anthropicMessages(steps, t, task);
    markLastBlock(messages[messages.length - 1]);
    return { ts, body: { model: "claude-opus-4-8", max_tokens: 8192, system, tools, messages } };
  });

  return {
    id: "claude-code",
    title: "Claude Code session (Anthropic, JSONL)",
    blurb: "12-turn coding session: an LSP tool is loaded mid-session, the system prompt clock ticks over, and a 7+ minute idle gap outlives the 5 minute cache.",
    format: "jsonl",
    raw: toJsonl(turns),
  };
}

// ------------------------------------------------------------------- sample B

function openaiSample(): SampleSession {
  const gaps = [14, 22, 18, 31, 26, 19, 37, 24, 16, 28, 21];
  const times = timeline(gaps);
  const steps = makeSteps(23, 12, ["search_code", "read_file", "run_tests", "write_file", "list_dir", "run_shell"]);
  const system = `${buildSystemPrompt(202, 4200, "Operating rules for the repository assistant")}\n\n${AGENT_SAFETY}`;
  const task = "Our checkout service double-charges when the webhook retries. Track the cause down and patch it with a regression test.";

  const turns: BuiltTurn[] = times.map((ts, t) => {
    const messages: Json[] = [{ role: "system", content: system }, { role: "user", content: task }];
    for (let i = 0; i < t; i++) {
      const s = steps[i];
      const id = `call_${(i * 104729 + 1299709).toString(36)}${i}`;
      // From turn 6 the harness compacts the first tool result to save context (a history rewrite).
      const content = t >= 6 && i === 1 ? "[tool output compacted: 41 lines omitted to save context]" : s.result;
      messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: s.tool, arguments: JSON.stringify(s.input) } }] });
      messages.push({ role: "tool", tool_call_id: id, content });
    }
    return { ts, body: { model: t >= 9 ? "gpt-4o" : "gpt-4.1", temperature: 0, tools: API_TOOLS.map((spec) => openaiTool(spec, 3)), messages } };
  });

  return {
    id: "openai-agent",
    title: "OpenAI agent (Chat Completions, HAR)",
    blurb: "12-turn agent loop recorded as a HAR: an old tool result is compacted at turn 6 and the model is swapped to gpt-4o at turn 9.",
    format: "har",
    raw: toHar(turns, "https://api.openai.com/v1/chat/completions"),
  };
}

// ------------------------------------------------------------------- sample C

function healthySample(): SampleSession {
  const gaps = [18, 25, 31, 22, 40, 19, 27, 35, 21, 29, 33, 24, 38];
  const times = timeline(gaps);
  const steps = makeSteps(37, 14, ["Read", "Grep", "Edit", "Bash"]);
  const mainPrompt = buildSystemPrompt(303, 3600, "House rules");
  const task = "Add pagination to the /orders endpoint and update the OpenAPI spec to match.";

  const turns: BuiltTurn[] = times.map((ts, t) => {
    const moved = t === 9;
    const tools = CODING_TOOLS.slice(0, 7).map((spec) => anthropicTool(spec, 6));
    if (moved) (tools[tools.length - 1] as Json).cache_control = { type: "ephemeral" };
    const system: Json[] = [
      { type: "text", text: "You are a careful senior engineer working inside the user's repository." },
      moved ? { type: "text", text: `${mainPrompt}\n\n${AGENT_SAFETY}` } : { type: "text", text: `${mainPrompt}\n\n${AGENT_SAFETY}`, cache_control: { type: "ephemeral" } },
    ];
    const messages = anthropicMessages(steps, t, task);
    if (!moved) markLastBlock(messages[messages.length - 1]);
    return { ts, body: { model: "claude-sonnet-4-6", max_tokens: 4096, system, tools, messages } };
  });

  return {
    id: "healthy",
    title: "Well-behaved session (Anthropic, JSONL)",
    blurb: "14 append-only turns with a high hit rate; the only blemish is one turn where the cache_control breakpoint was moved to the tool list.",
    format: "jsonl",
    raw: toJsonl(turns),
  };
}

export const SAMPLES: SampleSession[] = [claudeCodeSample(), openaiSample(), healthySample()];
