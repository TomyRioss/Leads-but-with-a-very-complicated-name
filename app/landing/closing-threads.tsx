"use client";

import { useEffect, useRef, useState } from "react";
import WebThreads from "./web-threads";

/**
 * Hilos verticales que nacen en el borde superior (centro) y se abren hacia abajo.
 * Con angle=90, WebThreads recorre el largo en x = 0.5 ± 0.5/aspect: el borde superior depende de la proporción,
 * así que se mide el contenedor y se ubica ahí el pinch. El spread escala con aspect² para que el abanico llegue a los lados.
 */
export function ClosingThreads() {
  const ref = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(Math.round((width / height) * 100) / 100);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {aspect ? (
        <WebThreads
          colors={["#1b6b00", "#2eff00"]}
          angle={90}
          pinch={0.5 + 0.5 / aspect}
          position={0.5}
          spread={aspect * aspect * 0.16}
          frequency={4}
          threadCount={12}
          taper={0.5}
          mirror={false}
          glow={0.04}
          thickness={1.6}
          brightness={3.2}
          pulses={0.4}
          falloff={0.5}
          mouseInteraction={false}
          lightMode
        />
      ) : null}
    </div>
  );
}
