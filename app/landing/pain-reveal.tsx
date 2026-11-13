"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

export function PainReveal({ label, result, serviceLabel, service }: { label: string; result: string; serviceLabel: string; service: string }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return (
      <span className="lp-pain-cell" role="status">
        <span className="lp-pain-chip">{result}</span>
        <small className="lp-service"><b>{serviceLabel}</b> {service}</small>
      </span>
    );
  }
  return (
    <button type="button" className="lp-pain-btn" onClick={() => setRevealed(true)}>
      <Sparkles size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
