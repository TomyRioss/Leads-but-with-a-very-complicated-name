import type { AnalysisDetail, AnalysisEvidence, AnalysisFinding, PainProposal } from "./types";

export const MAX_PAIN_TAGS = 4;
export const MAX_PAIN_TAG_LENGTH = 48;
export const MAX_PAIN_REPORT_LENGTH = 900;
const MAX_FINDINGS = 3;

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Normaliza etiquetas: recorta, quita vacías/duplicadas (sin distinguir mayúsculas) y limita cantidad y largo. */
export function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;\n]+/) : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const tag = truncate(clean(item, 200).replace(/^[-•*\s]+/, ""), MAX_PAIN_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_PAIN_TAGS) break;
  }
  return tags;
}

export type PainModelOutput = {
  tags: string[];
  report: string;
  findings: { title: string; detail: string; source_ids: string[]; tag: string }[];
  limitations: string;
  proposals: PainProposal[];
};

/** Normaliza propuestas A/B: máximo una por variante, con servicio y mensaje no vacíos. */
export function normalizeProposals(value: unknown): PainProposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: PainProposal[] = [];
  for (const [index, item] of value.slice(0, 2).entries()) {
    if (!item || typeof item !== "object") continue;
    const input = item as Record<string, unknown>;
    const service = clean(input.service, 120);
    const message = typeof input.message === "string" ? input.message.trim().slice(0, 1200) : "";
    if (service && message) proposals.push({ variant: index === 0 ? "A" : "B", service, message });
  }
  return proposals;
}

/**
 * Valida y normaliza el objeto devuelto por el modelo para dolores.
 * Acepta también el formato anterior (summary + findings) como entrada degradada.
 * Devuelve null si no tiene ninguna forma utilizable.
 */
export function normalizePainOutput(value: unknown): PainModelOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const hasShape = Array.isArray(input.tags) || typeof input.report === "string" || typeof input.summary === "string" || Array.isArray(input.findings);
  if (!hasShape) return null;
  const findings = (Array.isArray(input.findings) ? input.findings : []).slice(0, MAX_FINDINGS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const finding = item as Record<string, unknown>;
    const ids = Array.isArray(finding.source_ids) ? finding.source_ids.filter((id): id is string => typeof id === "string").slice(0, 6) : [];
    return [{ title: clean(finding.title, 100), detail: clean(finding.detail, 500), source_ids: ids, tag: clean(finding.tag, MAX_PAIN_TAG_LENGTH) }];
  });
  const report = clean(input.report, MAX_PAIN_REPORT_LENGTH) || clean(input.summary, MAX_PAIN_REPORT_LENGTH);
  const tags = normalizeTags(input.tags).length ? normalizeTags(input.tags) : normalizeTags(findings.map((finding) => finding.title));
  return { tags, report, findings, limitations: clean(input.limitations, 400), proposals: normalizeProposals(input.proposals) };
}

/** Extrae el primer objeto JSON válido de un texto (con o sin Markdown) y lo normaliza para dolores. */
export function parsePainContent(content: string): PainModelOutput | null {
  const attempt = (candidate: string) => {
    try {
      return normalizePainOutput(JSON.parse(candidate));
    } catch {
      return null;
    }
  };
  const direct = attempt(content.trim());
  if (direct) return direct;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const parsed = attempt(content.slice(start, index + 1));
        if (parsed) return parsed;
        start = -1;
      }
    }
  }
  return null;
}

/** Resuelve citas contra las fuentes reales: descarta hallazgos cuyos IDs no existan. */
export function resolveFindings(findings: PainModelOutput["findings"], sourcesById: Map<string, AnalysisEvidence>): AnalysisFinding[] {
  return findings.flatMap((finding) => {
    const citations = finding.source_ids.flatMap((id) => {
      const source = sourcesById.get(id);
      return source ? [{ ...source, text: source.text.slice(0, 360) }] : [];
    });
    return citations.length ? [{ title: finding.title, detail: finding.detail, sources: citations, ...(finding.tag ? { tag: finding.tag } : {}) }] : [];
  });
}

const stems = (value: string) => new Set((value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{4,}/g) ?? []).map((word) => word.slice(0, 5)));

/**
 * Hallazgos que respaldan una etiqueta de dolor.
 * Usa `finding.tag` si el análisis lo trae; en análisis anteriores cae a coincidencia de palabras y luego a la misma posición.
 */
export function findingsForTag(findings: AnalysisFinding[], tags: string[], tag: string): AnalysisFinding[] {
  const key = tag.trim().toLowerCase();
  if (findings.some((finding) => finding.tag)) return findings.filter((finding) => finding.tag?.trim().toLowerCase() === key);
  const tagStems = stems(tag);
  const matched = findings.filter((finding) => [...stems(`${finding.title} ${finding.detail}`)].some((stem) => tagStems.has(stem)));
  if (matched.length) return matched;
  const index = tags.findIndex((item) => item.trim().toLowerCase() === key);
  return index >= 0 && findings[index] ? [findings[index]] : [];
}

/** Una respuesta de dolores es útil si trae al menos una etiqueta o un reporte con evidencia citada. */
export function hasPainResult(detail: Pick<AnalysisDetail, "tags" | "report" | "findings">) {
  return Boolean((detail.tags?.length ?? 0) > 0 || detail.report?.trim() || detail.findings.length > 0);
}

export type PainView = { tags: string[]; report: string; hasContent: boolean };

/**
 * Vista unificada para la tabla. Compatible con el formato anterior:
 * - detalle con findings sin tags/report → tags desde los títulos, reporte desde summary/detalles.
 * - solo texto plano en `pain_points` → el texto es el reporte y se muestra truncado como tag.
 */
export function painView(detail: AnalysisDetail | null, plainText: string | null | undefined): PainView {
  const plain = clean(plainText, 5000);
  let tags = normalizeTags(detail?.tags);
  if (!tags.length && detail) tags = normalizeTags(detail.findings.map((finding) => finding.title));
  if (!tags.length && plain) tags = normalizeTags([plain.split(/\s*;\s*/)[0] || plain]);
  const report = clean(detail?.report, MAX_PAIN_REPORT_LENGTH)
    || clean(detail?.summary, MAX_PAIN_REPORT_LENGTH)
    || (detail ? detail.findings.map((finding) => [finding.title, finding.detail].filter(Boolean).join(": ")).filter(Boolean).join(" ") : "")
    || plain;
  return { tags, report, hasContent: tags.length > 0 || Boolean(report) };
}

/** ¿Ya hay un análisis de dolores completado con resultado para este mismo foco? Evita repetir llamadas y cobros. */
export function isPainAnalysisCurrent(detail: AnalysisDetail | null | undefined, focus: string) {
  return Boolean(detail && detail.status === "completed" && hasPainResult({ tags: detail.tags, report: detail.report, findings: detail.findings ?? [] }) && clean(detail.focus, 300) === clean(focus, 300));
}
