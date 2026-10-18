"use client";

import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/lib/cost";
import type { CostBreakdown, CulpritKind, SessionAnalysis } from "@/lib/types";
import { CULPRIT_LABELS, cssFontFamily, fmtPct } from "./format";
import { computeLayout, drawBand, drawChip, drawCrackPath, drawGuide } from "./river-geometry";

interface ExportButtonProps {
  analysis: SessionAnalysis;
  cost: CostBreakdown;
  name: string;
  title: string;
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://prefixriver.vercel.app").replace(/^https?:\/\//, "").replace(/\/$/, "");

function topCulprit(analysis: SessionAnalysis, cost: CostBreakdown): CulpritKind | null {
  const usd = new Map(cost.perTurn.map((t) => [t.index, t.wastedUsd]));
  const agg = new Map<CulpritKind, number>();
  for (const t of analysis.turns) {
    if (!t.isBreak) continue;
    for (const c of t.culprits) {
      if (c === "first_request") continue;
      agg.set(c, (agg.get(c) ?? 0) + (usd.get(t.index) ?? 0) + t.wastedTokens * 1e-9);
    }
  }
  let best: CulpritKind | null = null;
  let bestV = -1;
  for (const [k, v] of agg) if (v > bestV) [best, bestV] = [k, v];
  return best;
}

async function renderCard(analysis: SessionAnalysis, cost: CostBreakdown, title: string): Promise<Blob> {
  await document.fonts?.ready;
  const ui = cssFontFamily("--font-ui", "ui-sans-serif, system-ui, sans-serif");
  const mono = cssFontFamily("--font-code", "ui-monospace, monospace");
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  // Background.
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(260, -40, 0, 260, -40, 700);
  g1.addColorStop(0, "rgba(56,189,248,0.16)");
  g1.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(1050, 600, 0, 1050, 600, 520);
  g2.addColorStop(0, "rgba(244,63,94,0.10)");
  g2.addColorStop(1, "rgba(244,63,94,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

  // Wordmark.
  const glyph = (x: number, y: number) => {
    const bar = (bx: number, by: number, w: number, c0: string, c1: string) => {
      const g = ctx.createLinearGradient(bx, 0, bx + w, 0);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 6, 3);
      ctx.fill();
    };
    bar(x, y, 18, "#5eead4", "#38bdf8");
    bar(x, y + 10, 24, "#5eead4", "#38bdf8");
    bar(x, y + 20, 13, "#5eead4", "#38bdf8");
    bar(x + 16, y + 20, 12, "#fb923c", "#f43f5e");
  };
  glyph(64, 62);
  ctx.fillStyle = "#e6ebf5";
  ctx.font = `700 30px ${ui}`;
  ctx.textBaseline = "middle";
  ctx.fillText("PrefixRiver", 104, 76);
  ctx.font = `500 13px ${mono}`;
  ctx.fillStyle = "rgba(154,164,184,0.9)";
  ctx.textAlign = "right";
  ctx.fillText("PROMPT CACHE REPORT", W - 64, 76);
  ctx.textAlign = "left";
  ctx.font = `400 17px ${ui}`;
  ctx.fillStyle = "rgba(200,208,224,0.85)";
  const shortTitle = title.length > 64 ? `${title.slice(0, 63)}…` : title;
  ctx.fillText(`${shortTitle} · ${analysis.turns.length} turns · ${analysis.model}`, 64, 124);

  // Mini river.
  const area = { x: 52, y: 156, w: 720, h: 380 };
  const n = analysis.turns.length;
  const pitch = Math.min(34, (area.h - 10) / Math.max(1, n));
  const bandH = Math.max(1.5, pitch * 0.66);
  const L = computeLayout(analysis, { width: area.w, gutter: 34, rightPad: 10, top: 6, bandH, gap: pitch - bandH, bottomPad: 0 });
  ctx.save();
  ctx.translate(area.x, area.y);
  for (let i = 1; i < L.bands.length; i++) drawGuide(ctx, L.bands[i - 1], L.bands[i]);
  for (const b of L.bands) drawBand(ctx, b, { glow: true, labels: bandH >= 9, monoFont: mono });
  for (const b of L.bands) drawCrackPath(ctx, b, 1, { glow: true, width: bandH >= 10 ? 1.8 : 1.2 });
  if (bandH >= 14) for (const b of L.bands) drawChip(ctx, b, area.w, ui);
  ctx.restore();

  // Stats column.
  const sx = 812;
  const stat = (label: string, value: string, y: number, color: string | [string, string], size = 46) => {
    ctx.font = `500 12px ${mono}`;
    ctx.fillStyle = "rgba(154,164,184,0.9)";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label.toUpperCase(), sx, y);
    ctx.font = `600 ${size}px ${mono}`;
    if (Array.isArray(color)) {
      const w = ctx.measureText(value).width;
      const g = ctx.createLinearGradient(sx, 0, sx + w, 0);
      g.addColorStop(0, color[0]);
      g.addColorStop(1, color[1]);
      ctx.fillStyle = g;
    } else ctx.fillStyle = color;
    ctx.fillText(value, sx, y + size + 4);
  };
  stat("Cache hit rate", fmtPct(analysis.totals.hitRate), 184, ["#5eead4", "#38bdf8"], 56);
  stat("Wasted on breaks", formatUsd(cost.wastedUsd), 288, ["#fb923c", "#f43f5e"]);
  stat("Cache breaks", String(analysis.totals.breaks), 380, "#e6ebf5", 40);
  const tc = topCulprit(analysis, cost);
  ctx.font = `500 12px ${mono}`;
  ctx.fillStyle = "rgba(154,164,184,0.9)";
  ctx.fillText("TOP CULPRIT", sx, 466);
  ctx.font = `600 22px ${ui}`;
  ctx.fillStyle = tc ? "#fed7aa" : "#99f6e4";
  ctx.fillText(tc ? CULPRIT_LABELS[tc] : "None — cache-friendly", sx, 496);

  // Footer.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(64, 556, W - 128, 1);
  ctx.font = `500 14px ${mono}`;
  ctx.fillStyle = "rgba(154,164,184,0.9)";
  ctx.textBaseline = "middle";
  ctx.fillText(SITE, 64, 584);
  ctx.textAlign = "right";
  ctx.fillText("100% local · nothing left the browser", W - 64, 584);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/png"));
}

export default function ExportButton({ analysis, cost, name, title }: ExportButtonProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileName = `prefixriver-${name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "capture"}.png`;

  useEffect(() => {
    if (!url) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUrl(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url]);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCard(analysis, cost, title);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setUrl(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setUrl(null);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button ref={triggerRef} type="button" data-testid="export-btn" onClick={onExport} disabled={busy} className="btn-ghost !py-2 text-sm">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Rendering…" : "Export share card"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-rose-300">
          {error}
        </span>
      )}
      {url && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={close}
          role="presentation"
        >
          <div
            data-testid="export-preview"
            role="dialog"
            aria-modal="true"
            aria-label="Share card preview"
            className="glass animate-rise w-full max-w-3xl rounded-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-ink">Share card downloaded</div>
                <div className="font-mono text-xs text-ink-faint">{fileName} · 1200×630</div>
              </div>
              <div className="flex gap-2">
                <a href={url} download={fileName} className="btn-ghost !py-1.5 text-sm">
                  Download again
                </a>
                <button ref={closeRef} type="button" onClick={close} className="btn-ghost !py-1.5 text-sm" aria-label="Close preview">
                  Close
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview */}
            <img src={url} alt="PrefixRiver share card for this session" width={1200} height={630} className="h-auto w-full rounded-xl border hairline" />
          </div>
        </div>
      )}
    </>
  );
}
