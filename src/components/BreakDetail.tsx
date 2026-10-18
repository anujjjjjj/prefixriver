"use client";

import { FIX_HINTS } from "@/lib/engine";
import { formatUsd } from "@/lib/cost";
import type { TurnAnalysis } from "@/lib/types";
import { CULPRIT_LABELS, fmtTokens } from "./format";

function excerpt(s: string, max = 220): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function BreakDetail({
  turn,
  row,
  wastedUsd,
  testIdPrefix = "",
}: {
  turn: TurnAnalysis;
  row: number;
  wastedUsd: number;
  /** Prefix for the diff testids, so a second copy on the page doesn't collide with the tooltip. */
  testIdPrefix?: string;
}) {
  // Ignore rounding-level gaps (a handful of tokens) between the cache hit end and the divergence point.
  const rebilledShared = turn.breakTokenOffset - turn.cachedTokens >= 32;
  const culprits = turn.culprits.filter((c) => c !== "first_request");
  const hint = turn.fixHint ?? (culprits[0] ? FIX_HINTS[culprits[0]] : undefined);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="eyebrow">Turn {row + 1} · cache break</span>
        {turn.gapSeconds !== undefined && (
          <span className="font-mono text-[11px] text-ink-faint tnum">+{Math.round(turn.gapSeconds)}s gap</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(culprits.length ? culprits : turn.culprits).map((c) => (
          <span
            key={c}
            className="rounded-full border border-ember/40 bg-ember/10 px-2 py-0.5 text-xs font-medium text-orange-200"
          >
            {CULPRIT_LABELS[c]}
          </span>
        ))}
      </div>
      {turn.diff && (
        <div className="space-y-1.5">
          <div className="text-sm text-ink">
            <span className="font-mono text-xs text-ink-faint">at </span>
            <span className="font-mono text-[13px] text-sky-200">{turn.diff.where}</span>
          </div>
          <p className="text-[13px] leading-snug text-ink-dim">{turn.diff.summary}</p>
          <div className="overflow-hidden rounded-lg border hairline bg-black/40 font-mono text-[11.5px] leading-relaxed">
            <div data-testid={`${testIdPrefix}diff-before`} className="flex gap-2 bg-rose-500/10 px-2.5 py-1.5 text-rose-200">
              <span aria-hidden className="select-none text-rose-400">−</span>
              <span className="sr-only">Before:</span>
              <span className="break-all">{turn.diff.before ? excerpt(turn.diff.before) : <em className="text-rose-300/60">(nothing)</em>}</span>
            </div>
            <div data-testid={`${testIdPrefix}diff-after`} className="flex gap-2 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-200">
              <span aria-hidden className="select-none text-emerald-400">+</span>
              <span className="sr-only">After:</span>
              <span className="break-all">{turn.diff.after ? excerpt(turn.diff.after) : <em className="text-emerald-300/60">(nothing)</em>}</span>
            </div>
          </div>
        </div>
      )}
      {rebilledShared && (
        <p className="flex gap-2 text-[12.5px] leading-snug text-orange-100/90">
          <span aria-hidden className="mt-1 h-2.5 w-3.5 shrink-0 rounded-sm bg-[repeating-linear-gradient(135deg,rgba(251,146,60,0.75)_0_2px,rgba(251,146,60,0.3)_2px_4px)]" />
          <span>
            Shared bytes before the change were re-billed too: the cache breakpoint sat after it.{" "}
            <span className="font-mono text-[11px] text-ink-faint tnum">({fmtTokens(turn.breakTokenOffset - turn.cachedTokens)} identical tok)</span>
          </span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border hairline bg-white/[0.02] px-3 py-2">
          <div className="eyebrow !text-[10px]">Re-billed</div>
          <div className="font-mono text-base text-orange-200 tnum">{fmtTokens(turn.wastedTokens)} tok</div>
        </div>
        <div className="rounded-lg border hairline bg-white/[0.02] px-3 py-2">
          <div className="eyebrow !text-[10px]">Wasted</div>
          <div className="font-mono text-base tnum text-ember-grad">{formatUsd(wastedUsd)}</div>
        </div>
      </div>
      {hint && (
        <p className="rounded-lg border border-glacier/20 bg-glacier/[0.06] px-3 py-2 text-[13px] leading-snug text-teal-100">
          <span className="font-semibold text-glacier">Fix · </span>
          {hint}
        </p>
      )}
    </div>
  );
}

export function BandDetail({ turn, row }: { turn: TurnAnalysis; row: number }) {
  return (
    <div className="space-y-1.5">
      <div className="eyebrow">Turn {row + 1}</div>
      <div className="flex gap-4 font-mono text-[12px] tnum">
        <span className="text-teal-200">{fmtTokens(turn.cachedTokens)} cached</span>
        <span className="text-slate-200">{fmtTokens(turn.uncachedTokens)} new</span>
      </div>
      <div className="font-mono text-[11px] text-ink-faint tnum">{fmtTokens(turn.request.totalTokens)} prompt tokens</div>
    </div>
  );
}
