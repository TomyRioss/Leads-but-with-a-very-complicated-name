import type { Metadata } from "next";
import PricingPage from "./pricing-page";

export const metadata: Metadata = {
  title: "Planes y precios | Leadta",
  description: "Desde $15 USD/mes, escalado a tu volumen de búsquedas.",
};

export default function Page() {
  return <PricingPage />;
}
