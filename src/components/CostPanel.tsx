"use client";

import { useMemo } from "react";
import { formatUsd } from "@/lib/cost";
import { PRICING, PRICING_SOURCES } from "@/lib/pricing";
import type { CostBreakdown, Provider, SessionAnalysis } from "@/lib/types";
import { culpritList, fmtPct, fmtTokens } from "./format";
import { useTweenedNumber } from "./hooks";

interface CostPanelProps {
  analysis: SessionAnalysis;
  cost: CostBreakdown;
  pricingId: string;
  onPricingChange: (id: string) => void;
  reducedMotion: boolean;
}

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

function HitRateGauge({ rate, reducedMotion }: { rate: number; reducedMotion: boolean }) {
  const v = useTweenedNumber(Math.max(0, Math.min(1, rate)), 1100, reducedMotion);
  const R = 62;
  const C = 2 * Math.PI * R;
  const arc = 0.75; // 270deg sweep
  const len = C * arc;
  return (
    <div data-testid="hit-rate" className="relative grid h-[168px] w-[168px] place-items-center" role="img" aria-label={`Cache hit rate ${fmtPct(rate)}`}>
      <svg width="168" height="168" viewBox="0 0 168 168" className="absolute inset-0" aria-hidden>
        <defs>
          <linearGradient id="gauge" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0" stopColor="#5eead4" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
          <filter id="gaugeglow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <g transform="rotate(135 84 84)">
          <circle cx="84" cy="84" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${len} ${C}`} />
          <circle cx="84" cy="84" r={R} fill="none" stroke="url(#gauge)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${len * v} ${C}`} filter="url(#gaugeglow)" opacity="0.6" />
          <circle cx="84" cy="84" r={R} fill="none" stroke="url(#gauge)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${len * v} ${C}`} />
        </g>
      </svg>
      <div className="text-center">
        <div className="font-mono text-4xl font-semibold tracking-tight text-ink tnum">{Math.round(v * 100)}%</div>
        <div className="eyebrow mt-0.5 !text-[10px] !tracking-[0.1em]">hit rate</div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, testId, sub }: { label: string; value: number; tone: "ember" | "glacier" | "plain"; testId?: string; sub?: string }) {
  const cls = tone === "ember" ? "text-ember-grad" : tone === "glacier" ? "text-glacier-grad" : "text-ink";
  return (
    <div className="rounded-xl border hairline bg-white/[0.02] px-4 py-3">
      <div className="eyebrow !text-[10px]">{label}</div>
      <div data-testid={testId} className={`mt-1 font-mono text-2xl font-semibold tracking-tight tnum ${cls}`}>
        {formatUsd(value)}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}

export default function CostPanel({ analysis, cost, pricingId, onPricingChange, reducedMotion }: CostPanelProps) {
  const groups = useMemo(() => {
    const m = new Map<Provider, typeof PRICING>();
    for (const p of PRICING) m.set(p.provider, [...(m.get(p.provider) ?? []), p]);
    return [...m.entries()];
  }, []);
  const p = cost.pricing;
  const sources = PRICING_SOURCES.filter((s) => s.provider === p.provider);
  const ranked = useMemo(() => {
    const byIndex = new Map(cost.perTurn.map((t) => [t.index, t]));
    return analysis.turns
      .map((turn, row) => ({ turn, row, usd: byIndex.get(turn.index)?.wastedUsd ?? 0 }))
      .filter((r) => r.turn.isBreak)
      .sort((a, b) => b.usd - a.usd);
  }, [analysis, cost]);
  const pctOfActual = cost.actualUsd > 0 ? cost.wastedUsd / cost.actualUsd : 0;
  const knownIds = new Set(PRICING.map((x) => x.id));

  return (
    <section data-testid="cost-panel" aria-labelledby="cost-heading" className="glass min-w-0 rounded-2xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">Cost model</div>
          <h2 id="cost-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
            What the breaks cost
          </h2>
        </div>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          <span>Price as model</span>
          <select
            data-testid="model-select"
            value={pricingId}
            onChange={(e) => onPricingChange(e.target.value)}
            className="min-w-[220px] rounded-lg border hairline bg-[#0b0f1a] px-3 py-2 font-mono text-sm text-ink focus-visible:outline-2"
          >
            {!knownIds.has(pricingId) && <option value={pricingId}>{p.label}</option>}
            {groups.map(([prov, list]) => (
              <optgroup key={prov} label={PROVIDER_LABEL[prov]}>
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="flex justify-center">
          <HitRateGauge rate={analysis.totals.hitRate} reducedMotion={reducedMotion} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Wasted on cache breaks" value={cost.wastedUsd} tone="ember" testId="cost-wasted" sub={`${fmtPct(pctOfActual)} of prompt spend`} />
          <Stat label="Saved by caching" value={cost.savedUsd} tone="glacier" testId="cost-saved" sub="vs. no caching" />
          <Stat label="Actual prompt cost" value={cost.actualUsd} tone="plain" testId="cost-actual" />
          <Stat label="Ideal cost" value={cost.idealUsd} tone="plain" testId="cost-ideal" sub="if no breaks happened" />
        </div>
      </div>

      {ranked.length > 0 && (
        <div className="mt-7">
          <h3 className="eyebrow mb-2">Breaks ranked by cost</h3>
          <div className="overflow-x-auto rounded-xl border hairline">
            <table className="w-full text-sm" data-testid="break-table">
              <thead>
                <tr className="border-b hairline text-left text-xs text-ink-faint">
                  <th scope="col" className="px-3 py-2 font-medium">Turn</th>
                  <th scope="col" className="px-3 py-2 font-medium">Culprit</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Re-billed</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">$</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => (
                  <tr key={r.row} className="border-b hairline last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-ink-dim tnum">{r.row + 1}</td>
                    <td className="px-3 py-2 text-ink">{culpritList(r.turn.culprits)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-ink-dim tnum">{fmtTokens(r.turn.wastedTokens)}</td>
                    <td className="px-3 py-2 text-right font-mono text-orange-300 tnum">{formatUsd(r.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-7 rounded-xl border hairline bg-black/20 p-4 text-xs leading-relaxed text-ink-dim">
        <div className="eyebrow mb-2 !text-[10px]">Pricing assumptions · {p.label}</div>
        <dl className="grid grid-cols-3 gap-3 font-mono tnum">
          <div>
            <dt className="text-ink-faint">Input</dt>
            <dd className="text-ink">${p.input}/1M</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Cache write</dt>
            <dd className="text-ink">
              ${p.cacheWrite5m}/1M
              {p.provider === "openai" && p.cacheWrite5m !== p.input && <span className="text-ink-faint"> · not applied</span>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Cache read</dt>
            <dd className="text-ink">${p.cacheRead}/1M</dd>
          </div>
        </dl>
        <p className="mt-3">
          Source:{" "}
          {sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ", "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline decoration-sky-300/30 underline-offset-2 hover:decoration-sky-300">
                {s.label}
              </a>{" "}
              <span className="text-ink-faint">(checked {s.checked})</span>
            </span>
          ))}
        </p>
        <p className="mt-2 text-ink-faint">
          Token counts are estimated from request bytes (~4 bytes/token). Provider usage in a capture is not used for these estimates. Output
          tokens are not included.
          {p.provider === "openai" && (
            <>
              {" "}
              Cache writes are priced at the input rate; the 1.25× write surcharge on GPT-5.6+ explicit breakpoints is not modeled.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
