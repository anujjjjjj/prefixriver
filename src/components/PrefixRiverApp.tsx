"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { analyzeSession } from "@/lib/engine";
import { CaptureParseError, parseCaptureDetailed } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import type { SessionAnalysis } from "@/lib/types";
import Hero from "./Hero";
import InputPanel, { type ParseSummary } from "./InputPanel";

const AnalysisView = dynamic(() => import("./AnalysisView"), {
  ssr: false,
  loading: () => <div className="glass h-[520px] rounded-2xl" />,
});

interface Loaded {
  key: number;
  analysis: SessionAnalysis;
  name: string;
  title: string;
  hasUsage: boolean;
}

const FORMAT_LABEL: Record<string, string> = {
  json: "JSON request",
  "json-array": "JSON array",
  jsonl: "JSONL",
  har: "HAR",
};

export default function PrefixRiverApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingScroll = useRef(false);
  const keyRef = useRef(0);

  const analyze = useCallback((text: string, source: string, opts: { sampleId?: string; title?: string; scroll?: boolean } = {}) => {
    if (!text.trim()) {
      setSummary(null);
      setError("Nothing to analyze yet. Paste one or more request bodies (JSON, JSONL or HAR), drop a file, or try a sample above.");
      return;
    }
    setBusy(true);
    setError(null);
    // Yield a frame so the busy state paints before heavy parsing on large captures.
    window.setTimeout(() => {
      let next: Loaded | null = null;
      let nextSummary: ParseSummary | null = null;
      let err: string | null = null;
      try {
        const parsed = parseCaptureDetailed(text);
        if (!parsed.requests.length) {
          err =
            parsed.skipped > 0
              ? `Found ${parsed.skipped} entries, but none looked like an Anthropic or OpenAI request body.`
              : "No LLM requests found in this input.";
        } else {
          const analysis = analyzeSession(parsed.requests);
          keyRef.current += 1;
          next = {
            key: keyRef.current,
            analysis,
            name: opts.sampleId ?? source.replace(/\.[a-z0-9]+$/i, ""),
            title: opts.title ?? source,
            hasUsage: parsed.requests.some((r) => r.usage && (r.usage.inputTokens !== undefined || r.usage.cacheReadTokens !== undefined)),
          };
          nextSummary = {
            format: FORMAT_LABEL[parsed.format] ?? parsed.format,
            requests: parsed.requests.length,
            skipped: parsed.skipped,
            source: opts.title ? `Sample: ${opts.title}` : source,
          };
        }
      } catch (e) {
        err =
          e instanceof CaptureParseError
            ? e.message
            : `Couldn't analyze this capture${e instanceof Error && e.message ? `: ${e.message}` : "."}`;
      }
      startTransition(() => {
        setBusy(false);
        if (err || !next) {
          setError(err ?? "Couldn't analyze this capture.");
          setSummary(null);
          return;
        }
        setError(null);
        setSummary(nextSummary);
        setLoaded(next);
        setActiveSample(opts.sampleId ?? null);
        pendingScroll.current = !!opts.scroll;
      });
    }, 20);
  }, []);

  const loadSample = useCallback(
    (id: string, scroll = false) => {
      const s = SAMPLES.find((x) => x.id === id);
      if (!s) return;
      analyze(s.raw, s.title, { sampleId: s.id, title: s.title, scroll });
    },
    [analyze],
  );

  // After a sample loads from the hero, glide down to the river.
  useEffect(() => {
    if (!loaded || !pendingScroll.current) return;
    pendingScroll.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => {
      document.getElementById("river-section")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [loaded]);

  const onLoadCapture = () => {
    document.getElementById("analyze")?.scrollIntoView({ behavior: "smooth", block: "start" });
    fileInputRef.current?.click();
  };

  return (
    <>
      <Hero onTrySample={() => loadSample(SAMPLES[0]?.id ?? "claude-code", true)} onLoadCapture={onLoadCapture} busy={busy} />
      <main className="relative z-10 mx-auto w-full max-w-6xl space-y-6 px-4 pb-24 sm:px-6">
        <InputPanel
          samples={SAMPLES}
          activeSample={activeSample}
          busy={busy}
          error={error}
          summary={summary}
          onAnalyze={(text, source) => analyze(text, source)}
          onSample={(id) => loadSample(id)}
          fileInputRef={fileInputRef}
        />
        <div id="river-section" className="scroll-mt-4">
          {loaded ? (
            <AnalysisView key={loaded.key} analysis={loaded.analysis} name={loaded.name} title={loaded.title} hasUsage={loaded.hasUsage} />
          ) : (
            <EmptyState />
          )}
        </div>
      </main>
    </>
  );
}

function EmptyState() {
  return (
    <section aria-label="No capture loaded" className="relative overflow-hidden rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <div aria-hidden className="mx-auto mb-6 flex max-w-sm flex-col gap-2 opacity-60">
        {[0.45, 0.6, 0.75].map((w, i) => (
          <div key={i} className="flex h-2.5 gap-1">
            <div className="rounded-full bg-gradient-to-r from-glacier/50 to-glacier-2/50" style={{ width: `${w * 70}%` }} />
            <div className="rounded-full bg-white/15" style={{ width: `${w * 30}%` }} />
          </div>
        ))}
      </div>
      <p className="text-base text-ink">Your river appears here.</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-dim">
        Each turn becomes a band. Cached prefix glows cool; the moment the prefix stops matching, the band cracks and runs hot.
      </p>
    </section>
  );
}
