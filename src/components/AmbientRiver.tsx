"use client";

import { useEffect, useRef } from "react";
import { mulberry32 } from "./river-geometry";

/** Decorative, slow-flowing mini river behind the hero. */
export default function AmbientRiver() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rnd = mulberry32(7);
    const rows = Array.from({ length: 14 }, (_, i) => ({
      len: 0.35 + i * 0.045 + rnd() * 0.05,
      cached: i === 0 ? 0 : 0.3 + i * 0.04,
      crack: i === 6 || i === 11 ? 0.22 + rnd() * 0.2 : null,
      phase: rnd() * 1000,
    }));
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw(performance.now());
    };

    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;
      const bandH = Math.max(5, Math.min(10, h / 40));
      const pitch = bandH * 2.4;
      const total = rows.length * pitch;
      const y0 = (h - total) / 2;
      const x0 = w * 0.06;
      const span = w * 0.92;
      ctx.globalCompositeOperation = "lighter";
      rows.forEach((r, i) => {
        const y = y0 + i * pitch;
        const len = span * r.len;
        const cachedEnd = x0 + span * Math.min(r.len, r.crack ?? r.cached);
        // cached
        if (cachedEnd > x0) {
          const g = ctx.createLinearGradient(x0, 0, cachedEnd, 0);
          g.addColorStop(0, "rgba(94,234,212,0.0)");
          g.addColorStop(0.25, "rgba(94,234,212,0.22)");
          g.addColorStop(1, "rgba(56,189,248,0.28)");
          ctx.fillStyle = g;
          ctx.fillRect(x0, y, cachedEnd - x0, bandH);
          const sx = x0 + ((t * 60 + r.phase) % (span + 200)) - 200;
          const a = Math.max(sx, x0);
          const b = Math.min(sx + 200, cachedEnd);
          if (b > a) {
            const s = ctx.createLinearGradient(sx, 0, sx + 200, 0);
            s.addColorStop(0, "rgba(255,255,255,0)");
            s.addColorStop(0.5, "rgba(224,255,250,0.16)");
            s.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = s;
            ctx.fillRect(a, y, b - a, bandH);
          }
        }
        const end = x0 + len;
        if (r.crack !== null) {
          const g = ctx.createLinearGradient(cachedEnd, 0, end, 0);
          const flick = 0.18 + 0.06 * Math.sin(t * 3 + i);
          g.addColorStop(0, `rgba(251,146,60,${flick + 0.06})`);
          g.addColorStop(1, `rgba(244,63,94,0.0)`);
          ctx.fillStyle = g;
          ctx.fillRect(cachedEnd + 2, y, end - cachedEnd - 2, bandH);
          ctx.strokeStyle = "rgba(255,237,213,0.45)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cachedEnd, y - 4);
          ctx.lineTo(cachedEnd - 2, y + bandH * 0.4);
          ctx.lineTo(cachedEnd + 2, y + bandH * 0.65);
          ctx.lineTo(cachedEnd - 1, y + bandH + 4);
          ctx.stroke();
        } else if (end > cachedEnd) {
          const g = ctx.createLinearGradient(cachedEnd, 0, end, 0);
          g.addColorStop(0, "rgba(226,232,240,0.12)");
          g.addColorStop(1, "rgba(226,232,240,0)");
          ctx.fillStyle = g;
          ctx.fillRect(cachedEnd + 2, y, end - cachedEnd - 2, bandH);
        }
      });
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      if (visible) draw(now);
      raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver((e) => (visible = e[e.length - 1]?.isIntersecting ?? true));
    io.observe(canvas);
    resize();
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
