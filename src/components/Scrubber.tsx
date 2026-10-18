"use client";

import { formatUsd } from "@/lib/cost";
import { useTweenedNumber } from "./hooks";

interface ScrubberProps {
  total: number;
  value: number;
  onChange: (v: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  saved: number;
  wasted: number;
  reducedMotion: boolean;
}

export default function Scrubber({ total, value, onChange, playing, onTogglePlay, saved, wasted, reducedMotion }: ScrubberProps) {
  const savedT = useTweenedNumber(saved, 500, reducedMotion);
  const wastedT = useTweenedNumber(wasted, 500, reducedMotion);
  const pct = total > 1 ? ((value - 1) / (total - 1)) * 100 : 100;

  return (
    <div data-testid="scrubber" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex flex-1 items-center gap-4">
        <button
          type="button"
          data-testid="play-btn"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause replay" : "Replay session turn by turn"}
          aria-pressed={playing}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-glacier/40 bg-glacier/10 text-glacier transition hover:bg-glacier/20"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M4 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="turn-scrub" className="flex justify-between font-mono text-[11px] text-ink-faint tnum">
            <span>Turn</span>
            <span>
              <span className="text-ink">{value}</span> / {total}
            </span>
          </label>
          <input
            id="turn-scrub"
            type="range"
            className="scrub"
            min={1}
            max={Math.max(1, total)}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ ["--pct" as string]: `${pct}%` }}
            aria-valuetext={`Turn ${value} of ${total}`}
          />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="min-w-[132px] rounded-xl border border-glacier/20 bg-glacier/[0.05] px-3.5 py-2">
          <div className="eyebrow !text-[10px] !text-teal-200/80">Saved so far</div>
          <div data-testid="live-saved" className="font-mono text-lg font-medium text-glacier-grad tnum">
            {formatUsd(savedT)}
          </div>
        </div>
        <div className="min-w-[132px] rounded-xl border border-ember/25 bg-ember/[0.06] px-3.5 py-2">
          <div className="eyebrow !text-[10px] !text-orange-200/80">Wasted so far</div>
          <div data-testid="live-wasted" className="font-mono text-lg font-medium text-ember-grad tnum">
            {formatUsd(wastedT)}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {!playing && `Turn ${value} of ${total}: ${formatUsd(saved)} saved, ${formatUsd(wasted)} wasted.`}
      </p>
    </div>
  );
}
