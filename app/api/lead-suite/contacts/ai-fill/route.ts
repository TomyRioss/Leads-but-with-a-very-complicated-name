import { NextResponse } from "next/server";
import { errorTranslator } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";
import { recordAiUsage } from "@/lib/server/ai-usage";
import { CONTACT_CHANNELS, CONTACT_STATUSES } from "@/lib/lead-suite";
import { parseContactFields, requireUser, type ContactFields } from "../validate";

// Mismo modelo económico que el agente de Lead Suite. La IA solo propone cambios: nunca guarda.
const MODEL = "deepseek/deepseek-v4.1-flash";
const MAX_INSTRUCTION = 300;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60_000;
const FIELDS = ["channel", "contactedAt", "status", "message", "notes"] as const;

// ponytail: límite en memoria por instancia; moverlo a la base si hace falta un tope estricto entre instancias.
const usage = new Map<string, number[]>();

function allow(userId: string) {
  const now = Date.now();
  const recent = (usage.get(userId) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  usage.set(userId, recent);
  return true;
}

/** "2026-11-13 15:30 (GMT-03:00)" en la zona del usuario, para resolver "ayer a las 18". */
function localNow(timeZone: string, now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long", timeZoneName: "longOffset",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${parts.timeZoneName})`;
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Propone cambios para el formulario de contacto a partir de una instrucción corta. Gratis, con límite por hora. */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const t = errorTranslator(request);
  const body = await request.json().catch(() => null) as { instruction?: unknown; current?: unknown; timeZone?: unknown; leadName?: unknown } | null;
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const current = parseContactFields(body?.current ?? {}, true);
  if (!instruction || instruction.length > MAX_INSTRUCTION || !current || !validTimeZone(body?.timeZone)) {
    return NextResponse.json({ error: t("generic") }, { status: 400 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: uiError(t("openRouterKeyMissing"), t("generic")) }, { status: 503 });
  if (!allow(auth.userId)) return NextResponse.json({ error: t("generic") }, { status: 429 });

  const leadName = typeof body?.leadName === "string" ? body.leadName.slice(0, 120) : "";
  const system = [
    "You edit the fields of ONE logged sales contact for the user. You never save anything: you only propose field values.",
    `Current date/time in the user's time zone: ${localNow(body!.timeZone as string, new Date())}. Resolve relative dates ("ayer a las 18", "today 3pm") in that zone and return contactedAt as ISO 8601 with that offset. Never return a future date.`,
    `channel must be one of: ${CONTACT_CHANNELS.join(", ")}. status must be one of: ${CONTACT_STATUSES.join(", ")} ("me respondió" = replied, "reunión" = meeting, "cerramos/ganado" = won, "no le interesa/perdido" = lost).`,
    "Return null for every field the instruction does not ask to change. Keep the user's language for message and notes. Do not invent content that the instruction does not give.",
    'Reply only with JSON: {"channel":...,"contactedAt":...,"status":...,"message":...,"notes":...}.',
  ].join(" ");
  const nullable = (extra: Record<string, unknown> = {}) => ({ type: ["string", "null"], ...extra });
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        provider: { require_parameters: true, sort: "price" },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "lead_contact_changes",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                channel: nullable({ enum: [...CONTACT_CHANNELS, null] }),
                contactedAt: nullable(),
                status: nullable({ enum: [...CONTACT_STATUSES, null] }),
                message: nullable(),
                notes: nullable(),
              },
              required: [...FIELDS],
            },
          },
        },
        plugins: [{ id: "response-healing" }],
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ lead: leadName, current, instruction }) },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    });
    if (!response.ok) throw new Error(`OpenRouter responded ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const payload = await response.json() as { choices?: { message?: { content?: unknown } }[]; usage?: unknown };
    void recordAiUsage({ feature: "contact_ai_fill", model: MODEL, userId: auth.userId, usage: payload.usage });
    const content = payload.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? JSON.parse(content) as Record<string, unknown> : null;
    if (!raw || typeof raw !== "object") throw new Error("Invalid model output.");
    // Solo campos no nulos, con las mismas reglas que guardar; se descartan los que no cambian nada.
    const proposed = Object.fromEntries(FIELDS.filter((key) => raw[key] !== null && raw[key] !== undefined).map((key) => [key, raw[key]]));
    const valid = parseContactFields(proposed, true);
    if (!valid) throw new Error("Model proposed invalid fields.");
    const changes: Partial<ContactFields> = {};
    for (const key of FIELDS) {
      const next = valid[key];
      if (next === undefined) continue;
      const same = key === "contactedAt" && current.contactedAt
        ? Math.abs(Date.parse(next) - Date.parse(current.contactedAt)) < 60_000
        : next === current[key];
      if (!same) (changes as Record<string, string>)[key] = next;
    }
    return NextResponse.json({ changes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lead Suite ai-fill failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}
