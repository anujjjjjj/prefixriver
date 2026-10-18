import { PRICING_SOURCES } from "@/lib/pricing";
import { Wordmark } from "./Hero";

const STEPS = [
  {
    title: "Capture",
    body: "Log the request bodies your agent sends — a JSONL of payloads, a JSON array, or a HAR export from your browser or proxy.",
  },
  {
    title: "Diff the prefix",
    body: "Each request is serialized in provider render order (tools → system → messages) and compared to the previous one to find where the shared prefix ends.",
  },
  {
    title: "Price the breaks",
    body: "Tokens that should have been cache reads but were re-billed are priced with the model's input, cache-write and cache-read rates.",
  },
];

export default function Footer() {
  return (
    <footer className="relative z-10 border-t hairline">
      <div id="how" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-16 sm:px-6">
        <div className="eyebrow">How it works</div>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border hairline bg-white/[0.015] p-5">
              <div className="font-mono text-xs text-glacier tnum">0{i + 1}</div>
              <div className="mt-2 text-lg font-semibold tracking-[-0.02em] text-ink">{s.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid gap-6 border-t hairline pt-8 text-sm text-ink-dim sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="space-y-2">
            <Wordmark />
            <p className="max-w-xl text-ink-faint">
              Privacy: PrefixRiver runs entirely in your browser. Captures are parsed in memory in this tab and never uploaded — there is no server, no
              analytics on your data and no API key. Close the tab and it&apos;s gone.
            </p>
          </div>
          <div className="space-y-1.5 sm:text-right">
            <div className="eyebrow">Pricing sources</div>
            {PRICING_SOURCES.map((s) => (
              <div key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">
                  {s.label}
                </a>{" "}
                <span className="font-mono text-xs text-ink-faint">checked {s.checked}</span>
              </div>
            ))}
            <div className="pt-2 font-mono text-xs text-ink-faint">MIT licensed</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
