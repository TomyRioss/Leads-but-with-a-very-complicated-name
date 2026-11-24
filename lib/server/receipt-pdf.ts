import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { receiptCopy } from "@/lib/server/email-templates";
import type { Locale } from "@/lib/server/locale";

export type ReceiptData = { locale: Locale; name?: string; email: string; planName: string; credits: number; amount: string; date: string; reference: string };

// Standard Helvetica only encodes Latin-1: anything else (emoji, CJK in a name) would throw, so it is dropped.
const latin1 = (value: string) => [...value].filter((char) => char.charCodeAt(0) <= 0xff).join("");

/** One-page A4 payment receipt (brand lime accent, Helvetica). */
export async function renderReceiptPdf(input: ReceiptData) {
  const c = receiptCopy[input.locale === "en" ? "en" : "es"];
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.125, 0.137, 0.125);
  const muted = rgb(0.404, 0.431, 0.404);
  const left = 56;
  const right = 539;

  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: rgb(0.788, 0.914, 0.31) });
  page.drawText("Leadta", { x: left, y: 740, size: 28, font: bold, color: ink });
  page.drawText(latin1(c.receipt), { x: left, y: 706, size: 14, font: regular, color: muted });

  const rows: [string, string][] = [
    [c.customer, [input.name, input.email].filter(Boolean).join(" · ")],
    [c.plan, input.planName],
    [c.credits, String(input.credits)],
    [c.amount, input.amount],
    [c.date, input.date],
    [c.reference, input.reference],
  ];
  let y = 650;
  for (const [label, value] of rows) {
    page.drawText(latin1(label), { x: left, y, size: 11, font: regular, color: muted });
    page.drawText(latin1(value), { x: 210, y, size: 11, font: bold, color: ink, maxWidth: right - 210 });
    y -= 12;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.84) });
    y -= 22;
  }
  page.drawText(latin1(c.renewal), { x: left, y: y - 8, size: 10, font: regular, color: muted, maxWidth: right - left, lineHeight: 14 });
  page.drawText("leadta.app · support@leadta.app", { x: left, y: 56, size: 10, font: regular, color: muted });
  return pdf.save();
}
