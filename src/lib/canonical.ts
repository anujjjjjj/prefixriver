// Stable serialization + cache_control detection + token approximation.

export interface CacheControl {
  type?: string;
  ttl?: string;
  [key: string]: unknown;
}

const CACHE_KEY = "cache_control";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON serialization with sorted keys; `cache_control` stripped unless told otherwise. */
export function stableStringify(value: unknown, opts: { stripCacheControl?: boolean } = {}): string {
  const strip = opts.stripCacheControl ?? true;
  const walk = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : walk(x))).join(",")}]`;
    if (isPlainObject(v)) {
      const parts: string[] = [];
      for (const k of Object.keys(v).sort()) {
        if (strip && k === CACHE_KEY) continue;
        if (v[k] === undefined) continue;
        parts.push(`${JSON.stringify(k)}:${walk(v[k])}`);
      }
      return `{${parts.join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  };
  return walk(value);
}

/** All non-null cache_control objects found anywhere inside `value`. */
export function collectCacheControls(value: unknown): CacheControl[] {
  const out: CacheControl[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isPlainObject(v)) {
      for (const [k, child] of Object.entries(v)) {
        if (k === CACHE_KEY) {
          if (isPlainObject(child)) out.push(child as CacheControl);
          else if (child) out.push({});
        } else walk(child);
      }
    }
  };
  walk(value);
  return out;
}

export function hasCacheControl(value: unknown): boolean {
  return collectCacheControls(value).length > 0;
}

const encoder = new TextEncoder();

export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(encoder.encode(text).length / 4));
}
