import type { SegmentKind, SessionAnalysis, TurnAnalysis } from "@/lib/types";
import { CULPRIT_SHORT } from "./format";

export interface BlockLayout {
  x0: number;
  x1: number;
  kind: SegmentKind;
  label: string;
}

export interface BandLayout {
  row: number;
  turn: TurnAnalysis;
  y: number;
  h: number;
  x0: number;
  /** Right edge of the whole prompt. */
  x1: number;
  /** End of the cache-served region. */
  cachedX: number;
  /** Crack position (break turns only): where the prompt actually diverged. */
  crackX: number | null;
  /**
   * Start of the re-billed region (break turns only). Usually equals cachedX: tokens between
   * hotX and crackX are byte-identical to the previous turn but missed the cache anyway.
   */
  hotX: number | null;
  /** End of the prefix shared with the previous turn (for guides). */
  sharedX: number;
  blocks: BlockLayout[];
  crack: { x: number; y: number }[];
  branch: { x: number; y: number }[];
  chip: string | null;
}

export interface RiverLayout {
  width: number;
  height: number;
  gutter: number;
  top: number;
  bandH: number;
  gap: number;
  pitch: number;
  maxTokens: number;
  scale: number;
  bands: BandLayout[];
  ticks: { x: number; label: string }[];
}

export interface LayoutOptions {
  width: number;
  gutter: number;
  rightPad: number;
  top: number;
  bandH: number;
  gap: number;
  bottomPad?: number;
}

export function bandMetrics(n: number, mobile: boolean): { bandH: number; gap: number } {
  if (mobile) {
    if (n <= 12) return { bandH: 12, gap: 6 };
    if (n <= 30) return { bandH: 8, gap: 4 };
    const pitch = Math.max(3, Math.floor(1600 / n));
    return { bandH: Math.max(2, pitch - 1), gap: pitch > 3 ? 1 : 1 };
  }
  if (n <= 12) return { bandH: 22, gap: 10 };
  if (n <= 24) return { bandH: 16, gap: 8 };
  if (n <= 48) return { bandH: 11, gap: 6 };
  const pitch = Math.max(3, Math.floor(3000 / n));
  return { bandH: Math.max(2, pitch - (pitch > 6 ? 3 : 1)), gap: pitch > 6 ? 3 : 1 };
}

/** Deterministic PRNG so cracks are stable per turn across renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function niceStep(maxTokens: number, px: number): number {
  const minPx = 90;
  const steps = [1, 2, 5];
  for (let mag = 100; mag < 1e9; mag *= 10) {
    for (const s of steps) {
      const step = s * mag;
      if ((step / maxTokens) * px >= minPx) return step;
    }
  }
  return maxTokens;
}

function tickLabel(v: number): string {
  if (v >= 1_000_000) return `${v / 1_000_000}M`;
  if (v >= 1000) return `${v / 1000}k`;
  return String(v);
}

export function computeLayout(analysis: SessionAnalysis, o: LayoutOptions): RiverLayout {
  const turns = analysis.turns;
  const maxTokens = Math.max(1, ...turns.map((t) => t.request.totalTokens));
  const usable = Math.max(10, o.width - o.gutter - o.rightPad);
  const scale = usable / maxTokens;
  const pitch = o.bandH + o.gap;
  const X = (tok: number) => o.gutter + Math.max(0, Math.min(maxTokens, tok)) * scale;

  const bands: BandLayout[] = turns.map((turn, row) => {
    const y = o.top + row * pitch;
    const total = turn.request.totalTokens;
    const blocks: BlockLayout[] = [];
    let acc = 0;
    for (const seg of turn.request.segments) {
      const bx0 = X(acc);
      acc += seg.tokens;
      blocks.push({ x0: bx0, x1: X(acc), kind: seg.kind, label: seg.label });
    }
    const x1 = X(total);
    const cachedX = X(Math.min(turn.cachedTokens, total));
    let crackX: number | null = null;
    const crack: { x: number; y: number }[] = [];
    const branch: { x: number; y: number }[] = [];
    if (turn.isBreak) {
      const off = turn.breakTokenOffset >= 0 ? turn.breakTokenOffset : turn.cachedTokens;
      crackX = Math.min(x1, Math.max(o.gutter, X(off)));
      const rnd = mulberry32(turn.index * 9973 + 17);
      const ext = Math.min(6, o.gap * 0.8 + 1);
      const y0 = y - ext;
      const y1 = y + o.bandH + ext;
      const steps = Math.max(3, Math.round((y1 - y0) / 4));
      const amp = Math.max(1.5, Math.min(4, o.bandH / 5));
      for (let i = 0; i <= steps; i++) {
        const jitter = i === 0 || i === steps ? (rnd() - 0.5) * amp : (rnd() - 0.5) * 2 * amp;
        crack.push({ x: crackX + jitter, y: y0 + ((y1 - y0) * i) / steps });
      }
      if (o.bandH >= 12) {
        const mid = crack[Math.floor(steps / 2)];
        let bx = mid.x;
        let by = mid.y;
        branch.push({ x: bx, y: by });
        for (let i = 0; i < 3; i++) {
          bx += 2 + rnd() * 3;
          by += (rnd() - 0.3) * 4;
          branch.push({ x: bx, y: by });
        }
      }
    }
    const hotX = crackX === null ? null : Math.min(cachedX, crackX);
    const sharedX = X(Math.min(turn.sharedPrefixTokens, total));
    const kinds = turn.culprits.filter((k) => k !== "first_request");
    const chip = turn.isBreak && kinds.length ? CULPRIT_SHORT[kinds[0]] + (kinds.length > 1 ? ` +${kinds.length - 1}` : "") : null;
    return { row, turn, y, h: o.bandH, x0: o.gutter, x1, cachedX, crackX, hotX, sharedX, blocks, crack, branch, chip };
  });

  const step = niceStep(maxTokens, usable);
  const ticks: { x: number; label: string }[] = [];
  for (let v = 0; v <= maxTokens; v += step) ticks.push({ x: X(v), label: tickLabel(v) });

  const height = o.top + turns.length * pitch - o.gap + (o.bottomPad ?? 12);
  return { width: o.width, height, gutter: o.gutter, top: o.top, bandH: o.bandH, gap: o.gap, pitch, maxTokens, scale, bands, ticks };
}

export const KIND_RGB: Record<SegmentKind, string> = {
  tools: "165, 180, 252",
  system: "94, 234, 212",
  message: "125, 211, 252",
};

export interface StaticDrawOptions {
  glow: boolean;
  labels: boolean;
  monoFont: string;
  /** Draw the faint prefix guides between bands (export card draws them statically). */
  guides?: boolean;
  axis?: boolean;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, rr);
  else ctx.rect(x, y, w, h);
}

export function drawGuide(ctx: CanvasRenderingContext2D, prev: BandLayout, cur: BandLayout, alpha = 1) {
  const right = Math.min(cur.sharedX, prev.x1);
  if (right - cur.x0 < 2) return;
  const gy0 = prev.y + prev.h;
  const gy1 = cur.y;
  if (gy1 - gy0 < 1) return;
  const g = ctx.createLinearGradient(0, gy0, 0, gy1);
  g.addColorStop(0, `rgba(94, 234, 212, ${0.1 * alpha})`);
  g.addColorStop(0.5, `rgba(56, 189, 248, ${0.05 * alpha})`);
  g.addColorStop(1, `rgba(94, 234, 212, ${0.1 * alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(cur.x0 + 2, gy0, right - cur.x0 - 4, gy1 - gy0);
  ctx.fillStyle = `rgba(94, 234, 212, ${0.28 * alpha})`;
  ctx.fillRect(right - 1, gy0, 1, gy1 - gy0);
}

export function drawAxis(ctx: CanvasRenderingContext2D, L: RiverLayout, monoFont: string) {
  ctx.save();
  ctx.font = `10px ${monoFont}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const t of L.ticks) {
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fillRect(Math.round(t.x), L.top - 6, 1, L.height - L.top);
    ctx.fillStyle = "rgba(154,164,184,0.7)";
    ctx.fillText(t.label, t.x + 4, L.top - 8);
  }
  ctx.restore();
}

/** Draws one band fully (no animation). */
export function drawBand(ctx: CanvasRenderingContext2D, b: BandLayout, o: StaticDrawOptions) {
  const { y, h, x0, x1 } = b;
  const w = x1 - x0;
  if (w <= 0) return;
  const r = Math.min(6, h / 2);
  const crack = b.crackX;
  const hot = b.hotX;

  ctx.save();
  // Glow passes (outside the clip so they bloom).
  if (o.glow) {
    ctx.globalCompositeOperation = "lighter";
    if (b.cachedX - x0 > 1) {
      ctx.shadowColor = "rgba(56, 189, 248, 0.75)";
      ctx.shadowBlur = Math.min(18, h * 0.9 + 4);
      ctx.fillStyle = "rgba(94, 234, 212, 0.18)";
      roundRectPath(ctx, x0, y, (hot ?? b.cachedX) - x0, h, r);
      ctx.fill();
    }
    if (hot !== null && x1 - hot > 1) {
      ctx.shadowColor = "rgba(244, 63, 94, 0.8)";
      ctx.shadowBlur = Math.min(20, h + 4);
      ctx.fillStyle = "rgba(251, 146, 60, 0.2)";
      roundRectPath(ctx, hot, y, x1 - hot, h, r);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }

  roundRectPath(ctx, x0, y, w, h, r);
  ctx.clip();

  // Base: segment blocks tinted by kind.
  for (const blk of b.blocks) {
    ctx.fillStyle = `rgba(${KIND_RGB[blk.kind]}, 0.16)`;
    ctx.fillRect(blk.x0, y, Math.max(0.5, blk.x1 - blk.x0), h);
  }

  // Neutral (newly processed) tokens — only on turns that didn't break. On a break everything
  // past the cache hit was paid for again, so it runs hot instead.
  if (hot === null && x1 - b.cachedX > 0.5) {
    ctx.fillStyle = "rgba(226, 232, 240, 0.42)";
    ctx.fillRect(b.cachedX, y, x1 - b.cachedX, h);
  }

  // Cached prefix.
  const cachedEnd = hot ?? b.cachedX;
  if (cachedEnd - x0 > 0.5) {
    const g = ctx.createLinearGradient(x0, 0, Math.max(x0 + 1, cachedEnd), 0);
    g.addColorStop(0, "rgba(94, 234, 212, 0.85)");
    g.addColorStop(1, "rgba(56, 189, 248, 0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y, cachedEnd - x0, h);
    // Subtle per-kind hue variation inside the cache.
    ctx.globalCompositeOperation = "soft-light";
    for (const blk of b.blocks) {
      if (blk.x0 >= cachedEnd) break;
      ctx.fillStyle = `rgba(${KIND_RGB[blk.kind]}, 0.5)`;
      ctx.fillRect(blk.x0, y, Math.min(blk.x1, cachedEnd) - blk.x0, h);
    }
    ctx.globalCompositeOperation = "source-over";
    // Top sheen.
    const s = ctx.createLinearGradient(0, y, 0, y + h);
    s.addColorStop(0, "rgba(255,255,255,0.28)");
    s.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(x0, y, cachedEnd - x0, h);
  }

  // Re-billed but identical: bytes before the divergence that still missed the cache
  // (the breakpoint sat after the change). Dimmer, striped hot.
  if (hot !== null && crack !== null && crack - hot > 0.5) {
    ctx.fillStyle = "rgba(251, 146, 60, 0.5)";
    ctx.fillRect(hot, y, crack - hot, h);
    if (h >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(hot, y, crack - hot, h);
      ctx.clip();
      ctx.strokeStyle = "rgba(5, 7, 13, 0.35)";
      ctx.lineWidth = Math.max(1, Math.min(2.5, h / 6));
      const pitch = Math.max(4, Math.min(8, h / 2));
      ctx.beginPath();
      for (let sx = hot - h; sx < crack + h; sx += pitch) {
        ctx.moveTo(sx, y + h);
        ctx.lineTo(sx + h, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Hot region past the divergence.
  if (crack !== null && x1 - crack > 0.5) {
    const g = ctx.createLinearGradient(crack, 0, x1, 0);
    g.addColorStop(0, "rgba(251, 146, 60, 0.95)");
    g.addColorStop(1, "rgba(244, 63, 94, 0.95)");
    ctx.fillStyle = g;
    ctx.fillRect(crack, y, x1 - crack, h);
  }
  if (hot !== null && x1 - hot > 0.5) {
    const s = ctx.createLinearGradient(0, y, 0, y + h);
    s.addColorStop(0, "rgba(255,237,213,0.3)");
    s.addColorStop(0.55, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(hot, y, x1 - hot, h);
  }

  // Segment separators.
  if (h >= 4) {
    ctx.fillStyle = "rgba(5, 7, 13, 0.55)";
    for (let i = 1; i < b.blocks.length; i++) {
      const blk = b.blocks[i];
      const prevW = b.blocks[i - 1].x1 - b.blocks[i - 1].x0;
      if (prevW >= 3) ctx.fillRect(Math.round(blk.x0) - 0.5, y, 1, h);
    }
  }
  ctx.restore();

  if (o.labels && h >= 8) {
    ctx.save();
    ctx.font = `${Math.min(11, h - 2)}px ${o.monoFont}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = b.turn.isBreak ? "rgba(253, 186, 116, 0.95)" : "rgba(154, 164, 184, 0.8)";
    ctx.fillText(String(b.row + 1).padStart(2, "0"), x0 - 10, y + h / 2 + 0.5);
    ctx.restore();
  }
}

export function drawCrackPath(
  ctx: CanvasRenderingContext2D,
  b: BandLayout,
  progress: number,
  opts: { glow: boolean; width?: number; alpha?: number },
) {
  if (!b.crack.length || progress <= 0) return;
  const alpha = opts.alpha ?? 1;
  const n = b.crack.length - 1;
  // Grow outward from the middle.
  const mid = n / 2;
  const span = mid * progress;
  const from = Math.max(0, Math.floor(mid - span));
  const to = Math.min(n, Math.ceil(mid + span));
  ctx.save();
  ctx.lineJoin = "miter";
  ctx.lineCap = "round";
  if (opts.glow) {
    ctx.shadowColor = "rgba(251, 146, 60, 0.95)";
    ctx.shadowBlur = 10;
  }
  const stroke = (pts: { x: number; y: number }[], w: number, color: string) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  const pts = b.crack.slice(from, to + 1);
  stroke(pts, (opts.width ?? 1.6) + 1.6, `rgba(251, 113, 60, ${0.55 * alpha})`);
  ctx.shadowBlur = 0;
  stroke(pts, opts.width ?? 1.6, `rgba(255, 247, 237, ${alpha})`);
  if (progress >= 1 && b.branch.length) stroke(b.branch, 1, `rgba(255, 237, 213, ${0.8 * alpha})`);
  ctx.restore();
}

export function drawChip(ctx: CanvasRenderingContext2D, b: BandLayout, width: number, font: string, alpha = 1) {
  if (!b.chip || b.crackX === null) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `500 10.5px ${font}`;
  const tw = ctx.measureText(b.chip).width;
  const cw = tw + 14;
  const ch = Math.min(16, b.h - 2);
  let cx = b.crackX + 9;
  if (cx + cw > width - 4) cx = b.crackX - 9 - cw;
  const cy = b.y + (b.h - ch) / 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(cx, cy, cw, ch, ch / 2);
  else ctx.rect(cx, cy, cw, ch);
  ctx.fillStyle = "rgba(10, 6, 8, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(251, 146, 60, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#fed7aa";
  ctx.textBaseline = "middle";
  ctx.fillText(b.chip, cx + 7, cy + ch / 2 + 0.5);
  ctx.restore();
}
