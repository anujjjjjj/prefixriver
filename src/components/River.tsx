"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionAnalysis } from "@/lib/types";
import { BandDetail, BreakDetail } from "./BreakDetail";
import { cssFontFamily, fmtPct } from "./format";
import {
  bandMetrics,
  computeLayout,
  drawAxis,
  drawBand,
  drawChip,
  drawCrackPath,
  drawGuide,
  type RiverLayout,
} from "./river-geometry";

export interface RiverProps {
  analysis: SessionAnalysis;
  wastedByIndex: Map<number, number>;
  /** Number of turns currently visible (scrubber position). */
  revealed: number;
  focusedRow: number | null;
  onSelectRow: (row: number | null) => void;
  isMobile: boolean;
  reducedMotion: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

type Hover = { row: number; kind: "break" | "band" } | null;

const APPEAR_MS = 620;
const CRACK_MS = 260;
const MAX_PARTICLES = 240;

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export default function River({
  analysis,
  wastedByIndex,
  revealed,
  focusedRow,
  onSelectRow,
  isMobile,
  reducedMotion,
}: RiverProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [hover, setHover] = useState<Hover>(null);

  const layout: RiverLayout | null = useMemo(() => {
    if (width <= 0) return null;
    const { bandH, gap } = bandMetrics(analysis.turns.length, isMobile);
    return computeLayout(analysis, {
      width,
      gutter: isMobile ? 24 : 40,
      rightPad: isMobile ? 6 : 14,
      top: 22,
      bandH,
      gap,
      bottomPad: 14,
    });
  }, [analysis, width, isMobile]);

  // Animation state lives in refs; the RAF loop reads them every frame.
  const layoutRef = useRef(layout);
  const revealedRef = useRef(revealed);
  const focusedRef = useRef(focusedRow);
  const hoverRef = useRef<Hover>(null);
  const appearAt = useRef(new Map<number, number>());
  const openAt = useRef(new Map<number, number>());
  const particles = useRef<Particle[]>([]);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const dprRef = useRef(1);
  const dirty = useRef(true);
  const visibleRef = useRef(true);
  const fontsRef = useRef({ mono: "ui-monospace, monospace", ui: "ui-sans-serif, system-ui, sans-serif" });

  // Measure container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    const io = new IntersectionObserver((entries) => {
      visibleRef.current = entries[entries.length - 1]?.isIntersecting ?? true;
      dirty.current = true;
    });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Build the static layer (bands, glow, labels) once per layout change.
  useEffect(() => {
    layoutRef.current = layout;
    const canvas = canvasRef.current;
    if (!layout || !canvas) return;
    fontsRef.current = {
      mono: cssFontFamily("--font-code", "ui-monospace, monospace"),
      ui: cssFontFamily("--font-ui", "ui-sans-serif, system-ui, sans-serif"),
    };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    dprRef.current = dpr;
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.height = `${layout.height}px`;

    const off = staticRef.current ?? document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const sctx = off.getContext("2d");
    if (sctx) {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, layout.width, layout.height);
      for (const b of layout.bands) {
        drawBand(sctx, b, { glow: !isMobile, labels: true, monoFont: fontsRef.current.mono });
      }
    }
    staticRef.current = off;
    dirty.current = true;
  }, [layout, isMobile, fontsReady]);

  // Reset animation state for a new session (declared before the reveal effect so it runs first).
  useEffect(() => {
    appearAt.current.clear();
    openAt.current.clear();
    particles.current = [];
  }, [analysis]);

  // Track reveal changes: new rows get an appear timestamp, hidden rows reset.
  useEffect(() => {
    revealedRef.current = revealed;
    const now = performance.now();
    const n = analysis.turns.length;
    for (let r = 0; r < n; r++) {
      if (r < revealed) {
        if (!appearAt.current.has(r)) appearAt.current.set(r, reducedMotion ? -1e9 : now);
      } else {
        appearAt.current.delete(r);
        openAt.current.delete(r);
      }
    }
    dirty.current = true;
  }, [revealed, analysis, reducedMotion]);

  useEffect(() => {
    focusedRef.current = focusedRow;
    dirty.current = true;
    const L = layoutRef.current;
    const el = wrapRef.current;
    if (focusedRow === null || !L || !el) return;
    const b = L.bands[focusedRow];
    if (!b) return;
    const rect = el.getBoundingClientRect();
    const top = rect.top + b.y;
    if (top < 80 || top > window.innerHeight - 160) {
      window.scrollTo({
        top: window.scrollY + top - window.innerHeight / 3,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [focusedRow, reducedMotion]);

  useEffect(() => {
    hoverRef.current = hover;
    dirty.current = true;
  }, [hover]);

  // The render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    const fancy = !isMobile && !reducedMotion;

    const spawn = (x: number, y: number) => {
      if (!fancy) return;
      const ps = particles.current;
      for (let i = 0; i < 16 && ps.length < MAX_PARTICLES; i++) {
        const a = (Math.random() - 0.5) * Math.PI * 1.4;
        const sp = 60 + Math.random() * 200;
        const max = 450 + Math.random() * 500;
        ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: max, max });
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last);
      last = now;
      const L = layoutRef.current;
      const off = staticRef.current;
      if (!L || !off || !visibleRef.current) return;
      if (reducedMotion && !dirty.current) return;
      dirty.current = false;

      const dpr = dprRef.current;
      const W = L.width;
      const rev = Math.min(revealedRef.current, L.bands.length);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, L.height);
      drawAxis(ctx, L, fontsRef.current.mono);

      const half = L.gap / 2;
      const progressOf = (r: number) => {
        const t0 = appearAt.current.get(r);
        if (t0 === undefined) return 0;
        return easeOut((now - t0) / APPEAR_MS);
      };

      // Guides first so the bands sit on top of them.
      for (let r = 1; r < rev; r++) drawGuide(ctx, L.bands[r - 1], L.bands[r], progressOf(r));

      // Blit fully-arrived rows in one go; animating rows clip their width.
      let full = 0;
      while (full < rev && progressOf(full) >= 1) full++;
      if (full > 0) {
        const yEnd = full === L.bands.length ? L.height : L.bands[full - 1].y + L.bandH + half;
        ctx.drawImage(off, 0, 0, W * dpr, yEnd * dpr, 0, 0, W, yEnd);
      }
      for (let r = full; r < rev; r++) {
        const b = L.bands[r];
        const p = progressOf(r);
        if (p <= 0) continue;
        const y0 = r === 0 ? 0 : b.y - half;
        const y1 = b.y + b.h + half;
        const rx = b.x0 + (b.x1 - b.x0 + 24) * p;
        ctx.globalAlpha = Math.min(1, p * 1.6);
        ctx.drawImage(off, 0, y0 * dpr, rx * dpr, (y1 - y0) * dpr, 0, y0, rx, y1 - y0);
        ctx.globalAlpha = 1;
      }

      const t = now / 1000;
      const SW = 140;
      let cool: CanvasGradient | null = null;
      let heat: CanvasGradient | null = null;
      if (!reducedMotion) {
        cool = ctx.createLinearGradient(0, 0, SW, 0);
        cool.addColorStop(0, "rgba(255,255,255,0)");
        cool.addColorStop(0.5, "rgba(224,255,250,0.38)");
        cool.addColorStop(1, "rgba(255,255,255,0)");
        heat = ctx.createLinearGradient(0, 0, SW * 0.6, 0);
        heat.addColorStop(0, "rgba(255,200,120,0)");
        heat.addColorStop(0.5, "rgba(255,214,150,0.4)");
        heat.addColorStop(1, "rgba(255,200,120,0)");
      }

      for (let r = 0; r < rev; r++) {
        const b = L.bands[r];
        const p = progressOf(r);
        if (p <= 0) continue;
        const revealX = b.x0 + (b.x1 - b.x0 + 24) * p;
        const cachedEnd = Math.min(b.cachedX, b.crackX ?? b.x1, revealX);

        if (cool && cachedEnd - b.x0 > 8 && b.h >= 3) {
          const sx = ((t * 170 + r * 46) % (W + SW)) - SW;
          const ix0 = Math.max(sx, b.x0 + 2);
          const ix1 = Math.min(sx + SW, cachedEnd - 2);
          if (ix1 > ix0) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.translate(sx, 0);
            ctx.fillStyle = cool;
            ctx.fillRect(ix0 - sx, b.y + 1, ix1 - ix0, b.h - 2);
            ctx.restore();
          }
        }

        if (b.crackX !== null && revealX >= b.crackX) {
          let o = openAt.current.get(r);
          if (o === undefined) {
            o = reducedMotion ? -1e9 : now;
            openAt.current.set(r, o);
            spawn(b.crackX, b.y + b.h / 2);
          }
          const since = now - o;
          const hotEnd = Math.min(b.x1, revealX);
          if (heat && hotEnd - b.crackX > 6) {
            const flicker = 0.65 + 0.35 * Math.sin(t * 9 + r * 1.7);
            const span = hotEnd - b.crackX;
            const sx = b.crackX + ((t * 260 + r * 31) % (span + SW * 0.6)) - SW * 0.6;
            const ix0 = Math.max(sx, b.crackX + 1);
            const ix1 = Math.min(sx + SW * 0.6, hotEnd - 2);
            if (ix1 > ix0) {
              ctx.save();
              ctx.globalCompositeOperation = "lighter";
              ctx.globalAlpha = flicker;
              ctx.translate(sx, 0);
              ctx.fillStyle = heat;
              ctx.fillRect(ix0 - sx, b.y + 1, ix1 - ix0, b.h - 2);
              ctx.restore();
            }
          }
          if (!reducedMotion && since < 480) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `rgba(255, 237, 213, ${0.55 * (1 - since / 480)})`;
            ctx.fillRect(b.crackX, b.y, Math.max(0, hotEnd - b.crackX), b.h);
            ctx.restore();
          }
          const cp = reducedMotion ? 1 : easeOut(since / CRACK_MS);
          const wobble = reducedMotion ? 0 : 0.35 * Math.sin(t * 14 + r);
          drawCrackPath(ctx, b, cp, { glow: !isMobile, width: (b.h >= 10 ? 1.7 : 1.2) + wobble });
          if (!isMobile && b.h >= 14 && since > CRACK_MS * 0.5) {
            drawChip(ctx, b, W, fontsRef.current.ui, reducedMotion ? 1 : Math.min(1, (since - CRACK_MS * 0.5) / 300));
          }
        }
      }

      // Hover / focus emphasis.
      const hv = hoverRef.current;
      const fr = focusedRef.current;
      const outline = (row: number, strong: boolean) => {
        const b = L.bands[row];
        if (!b || row >= rev) return;
        ctx.save();
        ctx.strokeStyle = strong ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(b.x0 - 2.5, b.y - 2.5, b.x1 - b.x0 + 5, b.h + 5, Math.min(8, b.h / 2 + 2));
        else ctx.rect(b.x0 - 2.5, b.y - 2.5, b.x1 - b.x0 + 5, b.h + 5);
        ctx.stroke();
        if (strong && b.crackX !== null) {
          const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 5);
          ctx.strokeStyle = `rgba(251, 146, 60, ${0.35 + 0.45 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(b.crackX, b.y + b.h / 2, Math.max(8, b.h * 0.75) + pulse * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      };
      if (hv && hv.row !== fr) outline(hv.row, false);
      if (fr !== null) outline(fr, true);

      // Sparks.
      const ps = particles.current;
      if (ps.length) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        for (let i = ps.length - 1; i >= 0; i--) {
          const q = ps[i];
          q.life -= dt;
          if (q.life <= 0) {
            ps.splice(i, 1);
            continue;
          }
          const k = dt / 1000;
          q.vy += 260 * k;
          q.vx *= 0.985;
          q.x += q.vx * k;
          q.y += q.vy * k;
          const a = q.life / q.max;
          ctx.strokeStyle = a > 0.6 ? `rgba(255, 237, 213, ${a})` : `rgba(251, 146, 60, ${a})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - q.vx * 0.025, q.y - q.vy * 0.025);
          ctx.stroke();
        }
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isMobile, reducedMotion]);

  // Hit testing.
  const hitTest = useCallback((clientX: number, clientY: number): Hover => {
    const L = layoutRef.current;
    const canvas = canvasRef.current;
    if (!L || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const row = Math.floor((y - L.top + L.gap / 2) / L.pitch);
    if (row < 0 || row >= Math.min(revealedRef.current, L.bands.length)) return null;
    const b = L.bands[row];
    if (x < b.x0 - 6 || x > b.x1 + 10) return null;
    if (b.crackX !== null && x >= b.crackX - 10) return { row, kind: "break" };
    return { row, kind: "band" };
  }, []);

  const positionTip = useCallback((clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const r = wrap.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const tw = tip.offsetWidth || 300;
    let left = x + 18;
    if (left + tw > r.width) left = Math.max(0, x - 18 - tw);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(y + 18)}px)`;
  }, []);

  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const h = hitTest(e.clientX, e.clientY);
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setHover((prev) => (prev?.row === h?.row && prev?.kind === h?.kind ? prev : h));
    positionTip(e.clientX, e.clientY);
  };

  // Re-position after the tooltip content (and therefore size) changes.
  useEffect(() => {
    if (hover && lastPointer.current) positionTip(lastPointer.current.x, lastPointer.current.y);
  }, [hover, positionTip]);

  const onClick = (e: React.MouseEvent) => {
    const h = hitTest(e.clientX, e.clientY);
    if (h?.kind === "break") onSelectRow(h.row);
    else if (!h) onSelectRow(null);
  };

  // Pinned tooltip (from break list / click) anchored at the crack.
  const pinned = !isMobile && focusedRow !== null && !hover && layout?.bands[focusedRow]?.crackX != null;
  const pinStyle = useMemo(() => {
    if (!pinned || !layout || focusedRow === null) return undefined;
    const b = layout.bands[focusedRow];
    const tw = 340;
    let left = (b.crackX ?? b.x0) + 16;
    if (left + tw > layout.width) left = Math.max(0, (b.crackX ?? b.x0) - 16 - tw);
    return { transform: `translate(${Math.round(left)}px, ${Math.round(b.y + b.h + 10)}px)` };
  }, [pinned, layout, focusedRow]);

  const turns = analysis.turns;
  const hoverTurn = hover ? turns[hover.row] : null;
  const pinnedTurn = pinned && focusedRow !== null ? turns[focusedRow] : null;
  const label = `Cache river: ${turns.length} turns, ${analysis.totals.breaks} cache breaks, ${fmtPct(analysis.totals.hitRate)} hit rate. Use the break list below for details.`;

  return (
    <div ref={wrapRef} className="relative w-full" data-testid="river">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`block w-full ${hover?.kind === "break" ? "cursor-pointer" : "cursor-crosshair"}`}
        style={{ height: layout?.height ?? 240 }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      />
      {hoverTurn && hover && (
        <div
          ref={tipRef}
          data-testid={hover.kind === "break" ? "crack-tooltip" : "band-tooltip"}
          role="tooltip"
          className={`pointer-events-none absolute left-0 top-0 z-20 rounded-xl border hairline bg-[#0a0d16]/95 shadow-2xl shadow-black/60 backdrop-blur-md ${
            hover.kind === "break" ? "w-[340px] p-4" : "w-auto p-3"
          }`}
        >
          {hover.kind === "break" ? (
            <BreakDetail turn={hoverTurn} row={hover.row} wastedUsd={wastedByIndex.get(hoverTurn.index) ?? 0} />
          ) : (
            <BandDetail turn={hoverTurn} row={hover.row} />
          )}
        </div>
      )}
      {pinnedTurn && focusedRow !== null && (
        <div
          data-testid="crack-tooltip"
          role="dialog"
          aria-label={`Cache break details for turn ${focusedRow + 1}`}
          className="absolute left-0 top-0 z-20 w-[340px] rounded-xl border border-ember/25 bg-[#0a0d16]/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-md"
          style={pinStyle}
        >
          <button
            type="button"
            onClick={() => onSelectRow(null)}
            className="absolute right-2.5 top-2.5 rounded-md px-1.5 text-ink-faint hover:text-ink"
            aria-label="Close details"
          >
            ×
          </button>
          <div className="pr-5">
            <BreakDetail turn={pinnedTurn} row={focusedRow} wastedUsd={wastedByIndex.get(pinnedTurn.index) ?? 0} />
          </div>
        </div>
      )}
    </div>
  );
}
