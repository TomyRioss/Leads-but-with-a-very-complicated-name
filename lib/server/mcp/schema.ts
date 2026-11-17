// Pure helpers of the MCP server (no imports, so the selfcheck runs them without the app).

export type Scope = "read" | "write" | "credits" | "send";

/** Same 15-char PocketBase id the app validates everywhere. */
export const RECORD_PATTERN = "^[a-zA-Z0-9]{15}$";

const REF_IDS: Record<string, string> = {
  L: "Lead record id from search_leads, list_leads, list_leads_view or get_lead.",
  C: "Contact record id from lead_history or list_contacts.",
  B: "Batch record id from list_batches.",
};

/** Deep copy of a chat tool JSON schema where short refs (L1, C1, B1) become record ids. `drop` removes top-level properties. */
export function toMcpSchema(schema: unknown, drop: string[] = []): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value);
    const ref = typeof out.pattern === "string" ? /^\^([LCB])\\d\{1,3\}\$$/.exec(out.pattern) : null;
    if (ref) Object.assign(out, { pattern: RECORD_PATTERN, description: REF_IDS[ref[1]] });
    return out;
  };
  const copy = walk(schema) as Record<string, unknown>;
  if (drop.length && copy.properties && typeof copy.properties === "object") {
    const properties = { ...(copy.properties as Record<string, unknown>) };
    for (const key of drop) delete properties[key];
    copy.properties = properties;
    if (Array.isArray(copy.required)) copy.required = copy.required.filter((key) => !drop.includes(key as string));
  }
  return copy;
}

export const CONFIRM_HINT = "Returns a confirmation_token; call confirm_change after the user approves.";

/** Chat tool description without chat-UI wording (cards, short refs); proposals get the confirm hint. */
export function toMcpDescription(description: string, proposal: boolean) {
  const text = description
    .replace(/\s*\([^()]*\bcard\b[^()]*\)/gi, "")
    .replace(/[^.]*\bcards?\b[^.]*\.\s*/gi, "")
    .replace(/\s*\([LCBD] refs?\)/g, "")
    .replace(/\s*Uses the lead's email unless `to` is given\./g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return proposal ? `${text} ${CONFIRM_HINT}` : text;
}

const SEND_KINDS = new Set(["send_email", "send_email_batch", "send_whatsapp_batch", "create_meeting"]);
const CREDIT_KINDS = new Set(["search_businesses", "search_people", "topup_batch"]);

/** Scope a signed change needs at confirm time (also checked when it's proposed). */
export function scopeForKind(kind: string, credits: number): Scope {
  if (SEND_KINDS.has(kind)) return "send";
  if (CREDIT_KINDS.has(kind) || (kind === "analyze_pains" && credits > 0)) return "credits";
  return "write";
}
