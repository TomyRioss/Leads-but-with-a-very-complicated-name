"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { VEST_INTERVAL_MS, isVesting, receiveVesting, startVesting, stepVesting, type Vesting } from "./live-metrics-vesting";
import "./live-metrics.css";

type MetricKey = "leads" | "pains" | "categories";
type Stats = Record<MetricKey, number>;
type VestingState = Record<MetricKey, Vesting>;
type LiveMetricsProps = { labels: Record<MetricKey, string> };

const POLL_MS = 15_000;
const TWEEN_MS = 1_600;
const KEYS: MetricKey[] = ["leads", "pains", "categories"];

function isVisible() {
  return document.visibilityState === "visible";
}

/** Counts up from the last painted value to `value` with a slow ease-out; writes the DOM directly (no React render per frame). */
function TweenNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const painted = useRef(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = painted.current;
    if (value <= from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      painted.current = Math.max(from, value);
      node.textContent = format(painted.current);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      painted.current = Math.round(from + (value - from) * eased);
      node.textContent = format(painted.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, format]);

  return <span ref={ref}>{format(value)}</span>;
}

/**
 * Live landing counters. Polls /api/stats every 15 s while visible (cached 30 s, ORQ-1-0122).
 * Increases are vested: at most +10 per metric every 5 s; the first load shows the real value directly.
 */
export function LiveMetrics({ labels }: LiveMetricsProps) {
  const locale = useLocale();
  const [vesting, setVesting] = useState<VestingState | null>(null);
  const [visible, setVisible] = useState(true);
  const [announced, setAnnounced] = useState("");
  const pending = vesting !== null && KEYS.some((key) => isVesting(vesting[key]));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isVisible()) return;
      try {
        const response = await fetch("/api/stats");
        if (!response.ok) return;
        const stats = await response.json() as Stats;
        if (cancelled) return;
        setVesting((current) => Object.fromEntries(KEYS.map((key) => [
          key,
          current ? receiveVesting(current[key], Number(stats[key]) || 0) : startVesting(Number(stats[key]) || 0),
        ])) as VestingState);
      } catch {
        // Keep the last value if the network fails.
      }
    }
    function onVisibility() {
      setVisible(isVisible());
      void load();
    }
    void load();
    const timer = window.setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Vesting ticks only run while something is pending and the tab is visible.
  useEffect(() => {
    if (!pending || !visible) return;
    const timer = window.setInterval(() => {
      setVesting((current) => current && Object.fromEntries(KEYS.map((key) => [key, stepVesting(current[key])])) as VestingState);
    }, VEST_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pending, visible]);

  const numberLocale = locale === "es" ? "es-AR" : "en-US";
  const format = useCallback((value: number) => value.toLocaleString(numberLocale), [numberLocale]);

  // Screen readers: announce once the queue settles, not on every tick.
  useEffect(() => {
    if (!vesting || pending) return;
    const text = KEYS.map((key) => `+${vesting[key].shown.toLocaleString(numberLocale)} ${labels[key]}`).join(", ");
    const timer = window.setTimeout(() => setAnnounced(text), 0);
    return () => window.clearTimeout(timer);
  }, [vesting, pending, labels, numberLocale]);

  return (
    <>
      <ul className="lp-metrics">
        {KEYS.map((key) => (
          <li key={key}>
            <strong className="lm-value" aria-hidden="true">+{vesting ? <TweenNumber value={vesting[key].shown} format={format} /> : "—"}</strong>
            <span>{labels[key]}</span>
          </li>
        ))}
      </ul>
      <p className="lm-sr" aria-live="polite">{announced}</p>
    </>
  );
}
