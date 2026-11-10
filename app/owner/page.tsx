import type { Metadata } from "next";
import OwnerPanel from "./owner-panel";

export const metadata: Metadata = {
  title: "Panel owner | Leadta",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <OwnerPanel />;
}
