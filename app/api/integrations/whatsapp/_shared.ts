import QRCode from "qrcode";
import type { WhatsAppSession } from "@/lib/server/whatsapp";
import { getPlanLimits } from "@/lib/server/usage-limits";

// Utilidades de las rutas de WhatsApp (el prefijo _ las excluye del router).

/** Lo que ve el cliente: el QR crudo se convierte en PNG del lado del servidor; el cupo mensual es el del plan del usuario. */
export async function toClientState(session: WhatsAppSession, userId: string) {
  const [qrDataUrl, limits] = await Promise.all([
    session.status === "qr" && session.qr
      ? QRCode.toDataURL(session.qr, { margin: 1, width: 264, color: { dark: "#202320", light: "#fafbf8" } })
      : null,
    getPlanLimits(userId),
  ]);
  return { configured: true, status: session.status, qrDataUrl, phone: session.phone, sentThisMonth: session.sentThisMonth ?? 0, monthlyLimit: limits.whatsappMonthly, queued: session.queued };
}

export const notConfiguredState = { configured: false, status: "disconnected", qrDataUrl: null, phone: null, sentThisMonth: 0, monthlyLimit: 0, queued: 0 } as const;
