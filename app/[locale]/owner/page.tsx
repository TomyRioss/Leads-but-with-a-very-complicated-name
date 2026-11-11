import type { Metadata } from "next";
import { Suspense } from "react";
import OwnerPanel from "./owner-panel";

export const metadata: Metadata = {
  title: "Panel owner | Leadta",
  robots: { index: false, follow: false },
};

// The panel reads the active section with useSearchParams(), which must sit inside Suspense.
export default function Page() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-(--ash-100) text-(color:--muted)"><p role="status" className="text-[13px]">Cargando…</p></main>}>
      <OwnerPanel />
    </Suspense>
  );
}
