"use client";

import { useId } from "react";
import AmbientRiver from "./AmbientRiver";

export function Wordmark({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const g = `wm-g-${uid}`;
  const e = `wm-e-${uid}`;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
        <defs>
          <linearGradient id={g} x1="0" x2="1">
            <stop offset="0" stopColor="#5eead4" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
          <linearGradient id={e} x1="0" x2="1">
            <stop offset="0" stopColor="#fb923c" />
            <stop offset="1" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
        <rect x="6" y="12" width="32" height="9" rx="4.5" fill={`url(#${g})`} />
        <rect x="6" y="27.5" width="44" height="9" rx="4.5" fill={`url(#${g})`} />
        <rect x="6" y="43" width="24" height="9" rx="4.5" fill={`url(#${g})`} />
        <rect x="36" y="43" width="22" height="9" rx="4.5" fill={`url(#${e})`} />
        <path d="M33.5 38 L31 44 L35 46.5 L31.5 55" fill="none" stroke="#fff7ed" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-[-0.03em] text-ink">PrefixRiver</span>
    </span>
  );
}

interface HeroProps {
  onTrySample: () => void;
  onLoadCapture: () => void;
  busy: boolean;
}

export default function Hero({ onTrySample, onLoadCapture, busy }: HeroProps) {
  return (
    <header className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]">
        <AmbientRiver />
      </div>
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6" aria-label="Primary">
        <a href="#" aria-label="PrefixRiver home" className="rounded-md">
          <Wordmark />
        </a>
        <div className="flex items-center gap-5 text-sm text-ink-dim">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#analyze" className="hidden hover:text-ink sm:inline">
            Analyze
          </a>
        </div>
      </nav>

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-24">
        <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-glacier/25 bg-glacier/[0.06] px-3 py-1 text-xs text-teal-100">
          <span className="h-1.5 w-1.5 rounded-full bg-glacier shadow-[0_0_8px_#5eead4]" aria-hidden />
          100% local · nothing leaves your browser · no API keys
        </div>
        <h1
          className="animate-rise mt-6 max-w-4xl text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-6xl lg:text-[76px]"
          style={{ animationDelay: "60ms" }}
        >
          See exactly where your agent&apos;s <span className="text-glacier-grad">prompt cache</span>{" "}
          <span className="text-ember-grad">breaks</span> — and what each break costs.
        </h1>
        <p className="animate-rise mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-dim sm:text-lg" style={{ animationDelay: "120ms" }}>
          Paste Anthropic or OpenAI request JSON, JSONL logs or a HAR export. PrefixRiver diffs every turn against the last, finds the edit that
          invalidated the cached prefix, and prices the tokens you paid for twice.
        </p>
        <div className="animate-rise mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
          <button type="button" className="btn-primary" onClick={onTrySample} disabled={busy} data-testid="try-sample">
            Try a sample
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <path d="M8 3v10m0 0 4-4m-4 4L4 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="btn-ghost" onClick={onLoadCapture} data-testid="load-capture">
            Load your capture
          </button>
        </div>
      </div>
    </header>
  );
}
