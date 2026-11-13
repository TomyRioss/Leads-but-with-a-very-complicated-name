"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Star } from "lucide-react";

type Lead = { name: string; rating: string; pain: string; service: string };

type RadarFeedProps = {
  leads: Lead[];
  radarLabel: string;
  range: string;
  feedLabel: string;
  serviceLabel: string;
};

const STEP_MS = 1200;
const DOTS = 6;
const STEP_DEG = 360 / DOTS;
const FEED_ROWS = 5; // 4 visibles + 1 que sale por abajo
const RADII = [0.45, 0.78, 0.55, 0.85, 0.4, 0.7];

// El punto d se detecta a mitad del paso en que el barrido cruza su ángulo.
const dotAngle = (d: number) => d * STEP_DEG - STEP_DEG / 2;
const detectedAt = (d: number) => (d === 0 ? DOTS : d);

const dotStyle = (d: number) => {
  const rad = (dotAngle(d) * Math.PI) / 180;
  const r = RADII[d];
  return { "--x": `${(50 + r * 50 * Math.sin(rad)).toFixed(2)}%`, "--y": `${(50 - r * 50 * Math.cos(rad)).toFixed(2)}%` } as CSSProperties;
};

const initials = (name: string) =>
  name
    .split(" ")
    .filter((word) => /^\p{Lu}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (onChange: () => void) => {
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const getReduced = () => window.matchMedia(REDUCED_QUERY).matches;
const getReducedServer = () => false;

export function RadarFeed({ leads, radarLabel, range, feedLabel, serviceLabel }: RadarFeedProps) {
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getReducedServer);
  const [inView, setInView] = useState(false);
  // Arranca con un ciclo completo hecho: todos los puntos detectados y el feed lleno.
  const [step, setStep] = useState(DOTS);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduced) return;
    const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  }, [inView, reduced]);

  const count = leads.length;
  const at = (index: number) => leads[((index % count) + count) % count];
  const rows = Array.from({ length: FEED_ROWS }, (_, k) => ({ index: step - k, lead: at(step - k) }));
  const newest = rows[0].lead;

  return (
    <div ref={rootRef} className="lp-radar-card" data-static={reduced}>
      <figure className="lp-radar-figure" aria-label={radarLabel}>
        <div className="lp-radar" aria-hidden="true">
          <span className="lp-radar-ring lp-radar-ring-1" />
          <span className="lp-radar-ring lp-radar-ring-2" />
          <span className="lp-radar-ring lp-radar-ring-3" />
          <span className="lp-radar-sweep" style={{ transform: `rotate(${step * STEP_DEG}deg)` }} />
          {Array.from({ length: DOTS }, (_, d) => {
            const first = detectedAt(d);
            const age = step < first ? -1 : (step - first) % DOTS;
            return <span key={d} className="lp-radar-dot" data-age={age} style={dotStyle(d)} />;
          })}
          <span className="lp-radar-core" />
        </div>
        <figcaption className="lp-radar-range">{range}</figcaption>
      </figure>
      <div className="lp-feed">
        <p className="lp-feed-label">{feedLabel}</p>
        <div className="lp-feed-window" aria-hidden="true">
          <ul className="lp-feed-track" key={step}>
            {rows.map(({ index, lead }) => (
              <li key={index} className="lp-feed-row">
                <span className="lp-feed-avatar">{initials(lead.name)}</span>
                <strong className="lp-feed-name">{lead.name}</strong>
                <span className="lp-feed-pain">{lead.pain}</span>
                <span className="lp-feed-rating"><Star size={12} aria-hidden="true" />{lead.rating}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="lp-feed-service" key={`s${step}`} aria-hidden="true">
          <b>{serviceLabel}</b> {newest.service}
        </p>
        <ul className="sr-only">
          {leads.map((lead) => (
            <li key={lead.name}>{lead.name} · {lead.rating} · {lead.pain} · {serviceLabel} {lead.service}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
