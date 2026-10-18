"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { computeCost, formatUsd } from "@/lib/cost";
import { PRICING, pricingFor } from "@/lib/pricing";
import type { SessionAnalysis } from "@/lib/types";
import { BreakDetail } from "./BreakDetail";
import BreakList from "./BreakList";
import Scrubber from "./Scrubber";
import { fmtPct, fmtTokens } from "./format";
import { useIsMobile, useReducedMotion } from "./hooks";

const River = dynamic(() => import("./River"), {
  ssr: false,
  loading: () => <div className="h-[280px] w-full animate-pulse rounded-xl bg-white/[0.02]" />,
});
const CostPanel = dynamic(() => import("./CostPanel"), {
  ssr: false,
  loading: () => <div className="glass h-[520px] rounded-2xl" />,
});
const ExportButton = dynamic(() => import("./ExportButton"), { ssr: false });

const STEP_MS = 700;

interface AnalysisViewProps {
  analysis: SessionAnalysis;
  name: string;
  title: string;
  hasUsage: boolean;
}

export default function AnalysisView({ analysis, name, title, hasUsage }: AnalysisViewProps) {
  const reducedMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const n = analysis.turns.length;

  const [pricingId, setPricingId] = useState(() => pricingFor(analysis.model).id);
  const pricing = useMemo(() => PRICING.find((p) => p.id === pricingId) ?? pricingFor(analysis.model), [pricingId, analysis.model]);
  const cost = useMemo(() => computeCost(analysis, pricing), [analysis, pricing]);
  const wastedByIndex = useMemo(() => new Map(cost.perTurn.map((t) => [t.index, t.wastedUsd])), [cost]);

  // Auto-play once from turn 1 unless reduced motion asks for a static view.
  const [current, setCurrent] = useState(() => (reducedMotion || n <= 1 ? n : 1));
  const [playing, setPlaying] = useState(() => !reducedMotion && n > 1);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCurrent((c) => Math.min(n, c + 1));
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, n]);

  useEffect(() => {
    if (playing && current >= n) setPlaying(false);
  }, [playing, current, n]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    setFocusedRow(null);
    if (current >= n) setCurrent(1);
    setPlaying(true);
  };

  const onScrub = (v: number) => {
    setPlaying(false);
    setCurrent(v);
    if (focusedRow !== null && focusedRow >= v) setFocusedRow(null);
  };

  const selectRow = useCallback(
    (row: number | null) => {
      setFocusedRow(row);
      if (row !== null) {
        setPlaying(false);
        setCurrent((c) => Math.max(c, row + 1));
      }
    },
    [],
  );

  useEffect(() => {
    if (focusedRow === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocusedRow(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedRow]);

  const live = useMemo(() => {
    let saved = 0;
    let wasted = 0;
    const byIndex = new Map(cost.perTurn.map((t) => [t.index, t]));
    for (let i = 0; i < Math.min(current, n); i++) {
      const t = byIndex.get(analysis.turns[i].index);
      if (t) {
        saved += t.savedUsd;
        wasted += t.wastedUsd;
      }
    }
    return { saved, wasted };
  }, [cost, current, n, analysis]);

  const breaks = useMemo(() => analysis.turns.map((turn, row) => ({ turn, row })).filter((b) => b.turn.isBreak), [analysis]);
  const focusedTurn = focusedRow !== null ? analysis.turns[focusedRow] : null;

  return (
    <div className="space-y-6">
      <section aria-labelledby="river-heading" className="glass relative z-20 min-w-0 rounded-2xl p-4 sm:p-7">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="eyebrow">The river · {title}</div>
            <h2 id="river-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-[28px]">
              {analysis.totals.breaks === 0 ? (
                <>The cache held for all {n} turns.</>
              ) : (
                <>
                  {analysis.totals.breaks} {analysis.totals.breaks === 1 ? "break" : "breaks"} re-billed{" "}
                  <span className="text-ember-grad">{fmtTokens(analysis.totals.wastedTokens)} tokens</span> ·{" "}
                  <span className="text-ember-grad">{formatUsd(cost.wastedUsd)}</span>
                </>
              )}
            </h2>
            <p className="mt-1 font-mono text-xs text-ink-faint tnum">
              {n} turns · {fmtTokens(analysis.totals.promptTokens)} prompt tokens · {fmtPct(analysis.totals.hitRate)} served from cache · {analysis.model}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Legend />
            <ExportButton analysis={analysis} cost={cost} name={name} title={title} />
          </div>
        </div>

        <River
          analysis={analysis}
          wastedByIndex={wastedByIndex}
          revealed={current}
          focusedRow={focusedRow}
          onSelectRow={selectRow}
          isMobile={isMobile}
          reducedMotion={reducedMotion}
        />

        <div className="mt-5 border-t hairline pt-5">
          <Scrubber
            total={n}
            value={current}
            onChange={onScrub}
            playing={playing}
            onTogglePlay={togglePlay}
            saved={live.saved}
            wasted={live.wasted}
            reducedMotion={reducedMotion}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section aria-labelledby="breaks-heading" className="glass min-w-0 rounded-2xl p-5 sm:p-7">
          <div className="eyebrow">Where it broke</div>
          <h2 id="breaks-heading" className="mb-4 mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
            Cache breaks
          </h2>
          <BreakList breaks={breaks} wastedByIndex={wastedByIndex} focusedRow={focusedRow} onSelect={selectRow} />
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            A break is any turn where the previous prompt prefix stopped matching, so tokens that should have been cheap cache reads were billed again.
            Select one to see the diff and the fix.
          </p>
        </section>
        <CostPanel
          analysis={analysis}
          cost={cost}
          pricingId={pricing.id}
          onPricingChange={setPricingId}
          hasUsage={hasUsage}
          reducedMotion={reducedMotion}
        />
      </div>

      {isMobile && focusedTurn && focusedRow !== null && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setFocusedRow(null)} role="presentation">
          <div
            data-testid="crack-tooltip"
            role="dialog"
            aria-modal="true"
            aria-label={`Cache break details for turn ${focusedRow + 1}`}
            className="animate-sheet max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border-t hairline bg-[#0a0d16] p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" aria-hidden />
            <BreakDetail turn={focusedTurn} row={focusedRow} wastedUsd={wastedByIndex.get(focusedTurn.index) ?? 0} />
            <button type="button" onClick={() => setFocusedRow(null)} className="btn-ghost mt-5 w-full justify-center">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-4 rounded-full ${cls}`} aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-dim">
      {item("bg-gradient-to-r from-glacier to-glacier-2 shadow-[0_0_10px_rgba(94,234,212,0.6)]", "cached")}
      {item("bg-slate-300/60", "new")}
      {item("bg-gradient-to-r from-ember to-ember-2 shadow-[0_0_10px_rgba(244,63,94,0.6)]", "re-billed")}
    </div>
  );
}
