"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Local currency (detected from the visitor's country) vs USD. Amounts arrive pre-formatted from the server.
const UsdContext = createContext<[boolean, (usd: boolean) => void]>([false, () => undefined]);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const state = useState(false); // local currency by default
  return <UsdContext value={state}>{children}</UsdContext>;
}

export function CurrencyToggle({ local, label }: { local: string; label: string }) {
  const [usd, setUsd] = useContext(UsdContext);
  const option = (code: string, active: boolean) => (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setUsd(code === "USD")}
      className={`cursor-pointer rounded-full border-0 px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lime-dark) ${active ? "bg-(--ash-950) text-(--paper)" : "bg-transparent text-(color:--muted) hover:text-(color:--ink)"}`}
    >
      {code}
    </button>
  );
  return (
    <div role="group" aria-label={label} className="mx-auto mt-8 flex w-fit gap-0.5 rounded-full border border-(--line) bg-(--ash-50) p-0.5">
      {option(local, !usd)}
      {option("USD", usd)}
    </div>
  );
}

export function PlanAmount({ local, usd }: { local: string; usd: string }) {
  return useContext(UsdContext)[0] ? usd : local;
}
