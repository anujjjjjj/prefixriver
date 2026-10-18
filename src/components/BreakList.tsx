"use client";

import { formatUsd } from "@/lib/cost";
import type { TurnAnalysis } from "@/lib/types";
import { culpritList, fmtTokens } from "./format";

interface BreakListProps {
  breaks: { row: number; turn: TurnAnalysis }[];
  wastedByIndex: Map<number, number>;
  focusedRow: number | null;
  onSelect: (row: number) => void;
}

export default function BreakList({ breaks, wastedByIndex, focusedRow, onSelect }: BreakListProps) {
  if (!breaks.length) {
    return (
      <div data-testid="break-list" className="rounded-xl border border-glacier/20 bg-glacier/[0.04] px-4 py-3 text-sm text-teal-100">
        No cache breaks. Every turn reused the previous prefix — this agent is cache-friendly.
      </div>
    );
  }
  return (
    <ul data-testid="break-list" className="grid gap-2" aria-label="Cache breaks">
      {breaks.map(({ row, turn }) => {
        const active = focusedRow === row;
        return (
          <li key={row}>
            <button
              type="button"
              data-testid={`break-item-${row}`}
              aria-pressed={active}
              onClick={() => onSelect(row)}
              className={`group flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition ${
                active
                  ? "border-ember/50 bg-ember/[0.08]"
                  : "hairline bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
              }`}
            >
              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
                <svg width="14" height="18" viewBox="0 0 14 18">
                  <path d="M8 1 L4 8 L9 10 L5 17" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="w-14 shrink-0 font-mono text-xs text-ink-faint tnum">Turn {row + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{culpritList(turn.culprits)}</span>
              <span className="hidden font-mono text-xs text-ink-dim tnum sm:inline">{fmtTokens(turn.wastedTokens)} tok</span>
              <span className="w-16 text-right font-mono text-sm text-orange-300 tnum">{formatUsd(wastedByIndex.get(turn.index) ?? 0)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
