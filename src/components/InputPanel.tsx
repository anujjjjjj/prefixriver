"use client";

import { useRef, useState } from "react";
import type { SampleSession } from "@/lib/types";

export interface ParseSummary {
  format: string;
  requests: number;
  skipped: number;
  source: string;
}

interface InputPanelProps {
  samples: SampleSession[];
  activeSample: string | null;
  busy: boolean;
  error: string | null;
  summary: ParseSummary | null;
  onAnalyze: (text: string, source: string) => void;
  onSample: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

const MAX_BYTES = 200 * 1024 * 1024;

export default function InputPanel({ samples, activeSample, busy, error, summary, onAnalyze, onSample, fileInputRef }: InputPanelProps) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const readFile = async (file: File) => {
    setFileError(null);
    if (file.size > MAX_BYTES) {
      setFileError(`${file.name} is ${(file.size / 1e6).toFixed(0)} MB — that's larger than this tool will try to read in a browser tab.`);
      return;
    }
    try {
      const content = await file.text();
      onAnalyze(content, file.name);
    } catch {
      setFileError(`Couldn't read ${file.name}.`);
    }
  };

  const shownError = fileError ?? error;

  return (
    <section id="analyze" data-testid="input-panel" aria-labelledby="input-heading" className="glass scroll-mt-6 rounded-2xl p-5 sm:p-7">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">Input</div>
          <h2 id="input-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
            Load a capture
          </h2>
        </div>
        <p className="text-xs text-ink-faint">Parsed in this tab. Nothing is uploaded.</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Sample sessions">
        <span className="mr-1 text-xs text-ink-faint">Samples</span>
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`sample-${s.id}`}
            aria-pressed={activeSample === s.id}
            onClick={() => onSample(s.id)}
            className="chip"
            title={s.blurb}
          >
            {s.title}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current++;
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void readFile(f);
          }}
          className={`relative flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition ${
            dragging ? "border-glacier/70 bg-glacier/[0.06]" : "border-white/15 bg-white/[0.015]"
          }`}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className={dragging ? "text-glacier" : "text-ink-faint"}>
            <path d="M18 24V8m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 22v4a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div className="text-sm text-ink">
            Drop a capture here, or{" "}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="font-medium text-glacier underline decoration-glacier/40 underline-offset-2 hover:decoration-glacier">
              choose a file
            </button>
          </div>
          <div className="font-mono text-[11px] text-ink-faint">.json · .jsonl · .har · .txt</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.jsonl,.har,.txt,application/json,text/plain"
            className="sr-only"
            data-testid="file-input"
            aria-label="Choose a capture file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFileError(null);
            onAnalyze(text, "pasted capture");
          }}
        >
          <label htmlFor="paste-input" className="sr-only">
            Paste request JSON, JSONL or HAR
          </label>
          <textarea
            id="paste-input"
            data-testid="paste-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={'Paste request bodies — one JSON per line, a JSON array, or a HAR export.\n\n{"model":"claude-sonnet-4-5","system":"…","tools":[…],"messages":[…]}'}
            className="min-h-[200px] w-full flex-1 resize-y rounded-xl border hairline bg-black/30 p-3.5 font-mono text-[12px] leading-relaxed text-ink placeholder:text-ink-faint/80 focus:border-glacier/40 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-faint tnum">{text ? `${(text.length / 1024).toFixed(1)} KB` : ""}</span>
            <button type="submit" data-testid="analyze-btn" className="btn-primary" disabled={busy}>
              {busy ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>
      </div>

      <div aria-live="polite" className="mt-4 min-h-[1.5rem]">
        {shownError ? (
          <div data-testid="parse-error" role="alert" className="flex gap-3 rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-100">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="mt-0.5 shrink-0 text-rose-300">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 4.5v4M8 11v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>{shownError}</span>
          </div>
        ) : summary ? (
          <div data-testid="parse-summary" className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-ink-dim tnum">
            <span className="inline-flex items-center gap-1.5 text-teal-200">
              <span className="h-1.5 w-1.5 rounded-full bg-glacier shadow-[0_0_8px_#5eead4]" aria-hidden />
              {summary.source}
            </span>
            <span>
              format <span className="text-ink">{summary.format}</span>
            </span>
            <span>
              <span className="text-ink">{summary.requests}</span> {summary.requests === 1 ? "request" : "requests"}
            </span>
            {summary.skipped > 0 && (
              <span className="text-amber-200">
                {summary.skipped} skipped {summary.skipped === 1 ? "line" : "lines"}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
