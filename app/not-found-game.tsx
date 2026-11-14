"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const COPY = {
  es: {
    scanning: "Buscando",
    results: (n: number) => `${n} ${n === 1 ? "resultado" : "resultados"}`,
    idle: "El radar no encuentra esta página, pero detectó un lead suelto. Atrapalo: hacé clic, tocalo o enfocalo con Tab y apretá Enter.",
    caught: [
      "¡Lo atrapaste! Primer lead del día. Ojo, que vuelve a escaparse.",
      "Dos de dos. Así se prospecta.",
      "Tres. Leadtita está tomando nota de tu técnica.",
      "Ya podés cobrar comisión. ¿Probamos con leads de verdad en Buscar leads?",
    ],
    streak: (n: number) => `${n} leads atrapados. Este radar ya es tuyo.`,
    target: "Atrapar el lead",
    reset: "Reiniciar radar",
    radar: "Radar de búsqueda",
  },
  en: {
    scanning: "Searching",
    results: (n: number) => `${n} ${n === 1 ? "result" : "results"}`,
    idle: "The radar can't find this page, but it spotted a stray lead. Catch it: click, tap, or Tab to it and press Enter.",
    caught: [
      "Got it! First lead of the day. Careful, it escapes again.",
      "Two for two. That's prospecting.",
      "Three. Leadtita is taking notes on your technique.",
      "You've earned a commission. Want real leads? Try Search leads.",
    ],
    streak: (n: number) => `${n} leads caught. This radar is yours now.`,
    target: "Catch the lead",
    reset: "Reset radar",
    radar: "Search radar",
  },
};

type Vec = { x: number; y: number; vx: number; vy: number };

export function NotFoundGame() {
  const pathname = usePathname() || "/";
  const t = pathname === "/en" || pathname.startsWith("/en/") ? COPY.en : COPY.es;
  const radarRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLButtonElement>(null);
  const state = useRef<Vec>({ x: 0, y: 0, vx: 0.9, vy: -0.6 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const caughtRef = useRef(0);
  const [caught, setCaught] = useState(0);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    const radar = radarRef.current;
    const target = targetRef.current;
    if (!radar || !target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const place = () => {
      const s = state.current;
      target.style.transform = `translate(${s.x}px, ${s.y}px)`;
    };
    // El punto arranca donde lo dejó el CSS (versión sin JS) y desde ahí lo maneja transform.
    const size = radar.clientWidth;
    state.current.x = size * 0.64;
    state.current.y = size * 0.38;
    target.style.left = "0";
    target.style.top = "0";
    place();
    if (reduced) return;

    let frame = 0;
    const tick = () => {
      const s = state.current;
      const r = radar.clientWidth / 2;
      const speed = 1 + caughtRef.current * 0.35;
      // Huye del puntero cuando está cerca (mouse); en touch no hay hover y solo deambula.
      const p = pointer.current;
      if (p) {
        const dx = s.x - p.x;
        const dy = s.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 80 && dist > 0) {
          const push = ((80 - dist) / 80) * 0.5 * Math.min(speed, 2.2);
          s.vx += (dx / dist) * push;
          s.vy += (dy / dist) * push;
        }
      }
      // Deriva suave para que no sea una línea recta.
      s.vx += (Math.random() - 0.5) * 0.08;
      s.vy += (Math.random() - 0.5) * 0.08;
      const v = Math.hypot(s.vx, s.vy) || 1;
      const max = 1.6 * speed;
      if (v > max) { s.vx = (s.vx / v) * max; s.vy = (s.vy / v) * max; }
      s.x += s.vx;
      s.y += s.vy;
      // Rebote dentro del círculo del radar.
      const cx = s.x - r;
      const cy = s.y - r;
      const limit = r * 0.84;
      const d = Math.hypot(cx, cy);
      if (d > limit) {
        const nx = cx / d;
        const ny = cy / d;
        s.x = r + nx * limit;
        s.y = r + ny * limit;
        const dot = s.vx * nx + s.vy * ny;
        s.vx -= 2 * dot * nx;
        s.vy -= 2 * dot * ny;
      }
      place();
      frame = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (document.visibilityState === "visible") frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    pointer.current = { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function catchLead() {
    const radar = radarRef.current;
    caughtRef.current += 1;
    setCaught(caughtRef.current);
    setPop(false);
    requestAnimationFrame(() => setPop(true));
    if (!radar) return;
    // Reaparece en otro lugar del radar, como un lead que se vuelve a escapar.
    const r = radar.clientWidth / 2;
    const angle = Math.random() * Math.PI * 2;
    const dist = r * (0.3 + Math.random() * 0.5);
    const s = state.current;
    s.x = r + Math.cos(angle) * dist;
    s.y = r + Math.sin(angle) * dist;
    s.vx = Math.cos(angle + Math.PI / 2) * 1.4;
    s.vy = Math.sin(angle + Math.PI / 2) * 1.4;
    if (targetRef.current) targetRef.current.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }

  function reset() {
    caughtRef.current = 0;
    setCaught(0);
    setPop(false);
  }

  const status = caught === 0 ? t.idle : caught <= t.caught.length ? t.caught[caught - 1] : t.streak(caught);

  return (
    <section className="nf-radar-card" aria-label={t.radar}>
      <div className="nf-radar-head">
        <span className="nf-radar-query">{t.scanning} {pathname}…</span>
        <span className="nf-radar-count" data-hit={caught > 0}>{t.results(caught)}</span>
      </div>
      <div ref={radarRef} className="nf-radar" onPointerMove={onPointerMove} onPointerLeave={() => { pointer.current = null; }}>
        <div className="nf-sweep" aria-hidden="true" />
        <button ref={targetRef} type="button" className="nf-target" style={{ left: "64%", top: "38%" }} data-caught={pop} aria-label={t.target} onClick={catchLead}>
          <span aria-hidden="true" />
        </button>
      </div>
      <p className="nf-status" role="status" aria-live="polite">{caught > 0 ? <strong>{status}</strong> : status}</p>
      {caught > 0 && <button type="button" className="nf-reset" onClick={reset}>{t.reset}</button>}
    </section>
  );
}
