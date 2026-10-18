"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
export const useIsMobile = () => useMediaQuery("(max-width: 767px)");

/** Eases a displayed number toward `target` (tick-up counters). */
export function useTweenedNumber(target: number, duration = 650, disabled = false): number {
  const [value, setValue] = useState(disabled ? target : 0);
  const fromRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (disabled) {
      setValue(target);
      return;
    }
    fromRef.current = valueRef.current;
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * e);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, disabled]);

  return value;
}
