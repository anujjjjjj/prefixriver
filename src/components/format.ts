import type { CulpritKind } from "@/lib/types";

export const CULPRIT_LABELS: Record<CulpritKind, string> = {
  tools_changed: "Tools changed",
  system_dynamic: "Dynamic value in system prompt",
  message_edited: "Earlier message edited",
  marker_moved: "Cache marker moved",
  ttl_expired: "TTL expired",
  model_changed: "Model changed",
  below_minimum: "Below minimum cacheable size",
  first_request: "First request (cache write)",
};

/** Compact labels for the chips drawn on the canvas. */
export const CULPRIT_SHORT: Record<CulpritKind, string> = {
  tools_changed: "tools changed",
  system_dynamic: "dynamic system",
  message_edited: "message edited",
  marker_moved: "marker moved",
  ttl_expired: "TTL expired",
  model_changed: "model changed",
  below_minimum: "below minimum",
  first_request: "first request",
};

export function culpritList(kinds: CulpritKind[]): string {
  const real = kinds.filter((k) => k !== "first_request");
  return (real.length ? real : kinds).map((k) => CULPRIT_LABELS[k]).join(" · ") || "Unknown";
}

export function fmtTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export function fmtPct(r: number): string {
  if (!Number.isFinite(r)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, r)) * 100)}%`;
}

/** Read the actual family name next/font assigned to a CSS variable (for canvas text). */
export function cssFontFamily(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `${v}, ${fallback}` : fallback;
}
