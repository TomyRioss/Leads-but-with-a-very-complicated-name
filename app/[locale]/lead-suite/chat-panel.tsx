"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorReportButton } from "@/app/feedback-dialog";
import { BrandMark } from "@/app/brand-logo";
import { ArrowDown, ArrowUp, ArrowUpRight, AtSign, Ban, BriefcaseBusiness, CalendarCheck, CalendarClock, CalendarPlus, Check, ChevronRight, CircleAlert, CircleCheck, CircleHelp, Coins, Copy, Download, FileText, FileUp, Globe, Filter, History, Image as ImageIcon, ListPlus, LoaderCircle, Mail, Mails, MessagesSquare, Maximize2, MessageCircle, MessageSquarePlus, PackagePlus, PencilLine, Plus, RotateCcw, Search, Send, Sheet, Sparkles, SquarePen, StickyNote, Tag, Trash2, Upload, UserPen, UserPlus, UserSearch, X } from "lucide-react";
import type { ContactChannel, ContactStatus } from "@/lib/lead-suite";
import { renderMarkdown } from "@/lib/markdown";
import { parseLeadRules, type LeadRule } from "@/lib/lead-rules";
import { findingsForTag } from "@/lib/analysis-format";
import { cleanWebsiteUrl, displayWebsite } from "@/lib/url-display";
import { getSocialProfileUrl, type Lead, type SocialNetwork } from "@/lib/types";
import WhatsAppContact from "@/app/whatsapp-contact";
import type { IconType } from "react-icons";
import { FaFacebook, FaInstagram, FaLinkedin, FaWhatsapp, FaYoutube } from "react-icons/fa";
import { getSession } from "@/lib/client/session";
import { deactivateConversations, fetchConversationList, loadConversation, loadHistory, MAX_STORED_MESSAGES, mergeHistory, newConversationId, saveConversation, scheduleServerSave, setActiveConversation, syncWithServer, type HistoryItem, type StoredConversation } from "@/lib/client/leadtita-history";
import { GoogleDriveConnect, GoogleFeatureConnectButton, type ConnectedDriveFile } from "@/app/google-drive-connect";
import { WhatsAppConnectCard } from "@/app/whatsapp-connect";
import { Popover } from "@/app/ui/popover";
import { Link } from "@/i18n/navigation";

import { ChatControls, OPEN_CHANNEL_CONNECT_EVENT, type LeadtitaMode, type LeadtitaSalesChannel } from "./chat-controls";
import { AttachIntegrations } from "./attach-integrations";
import { SCHEDULED_EVENT, SchedulePicker, sendAtValid } from "./schedule-picker";
import { ScheduledButton } from "./scheduled-dialog";
import { BatchReview, batchReviewCount, batchReviewPayload, batchReviewReady, initialBatchReview, type BatchReviewRow, type BatchReviewState } from "./batch-review";
import { runsWithoutAsking, useLeadtitaPermission, type LeadtitaPermission } from "./chat-permissions";
import { LEAD_DRAG_TYPE, LeadMentionPopover, MENTION_LEAD_EVENT, readDraggedLead, requestLeadMention, type MentionLeadOption } from "./lead-mention-popover";
import { SiGmail, SiGoogledrive, SiWhatsapp } from "react-icons/si";
import "./chat-panel.css";

// Leadtita page shortcuts: one click sends the prompt with its mode/channel; channel ones open the connect step first if needed.
type PageShortcut = { key: "email" | "whatsapp" | "search" | "today"; Icon: typeof Mail; mode: LeadtitaMode; channel: LeadtitaSalesChannel };
const PAGE_SHORTCUTS: PageShortcut[] = [
  { key: "email", Icon: Mail, mode: "seller", channel: "gmail" },
  { key: "whatsapp", Icon: MessageCircle, mode: "seller", channel: "whatsapp" },
  { key: "search", Icon: Search, mode: "generator", channel: null },
  { key: "today", Icon: CalendarCheck, mode: "planner", channel: null },
];

// Last chosen mode survives reloads; memory fallback keeps the selector working when storage is blocked.
const MODE_KEY = "leadta:leadtita-mode";
const isMode = (value: unknown): value is LeadtitaMode => value === "seller" || value === "generator" || value === "planner";
let modeMemory: LeadtitaMode = "seller";
const modeListeners = new Set<() => void>();
function readMode(): LeadtitaMode {
  try { const saved = localStorage.getItem(MODE_KEY); return isMode(saved) ? saved : modeMemory; } catch { return modeMemory; }
}
export function writeMode(value: LeadtitaMode) {
  modeMemory = value;
  try { localStorage.setItem(MODE_KEY, value); } catch {}
  modeListeners.forEach((listener) => listener());
}
function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

type LeadMentionSpan = { start: number; end: number; leadId: string; name: string };
type ToolProgressItem = { id: string; label: string; status: "running" | "done" | "failed" };

function renderUserMessage(content: string, mentions: LeadMentionSpan[] = []) {
  const valid = mentions
    .filter((mention) => Number.isInteger(mention.start) && Number.isInteger(mention.end) && mention.start >= 0 && mention.end <= content.length && mention.end > mention.start && content.slice(mention.start, mention.end) === `@${mention.name}`)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const mention of valid) {
    if (mention.start < cursor) continue;
    if (mention.start > cursor) parts.push(content.slice(cursor, mention.start));
    parts.push(<span className="ls-chat__lead-mention" key={`${mention.start}:${mention.leadId}`}>{content.slice(mention.start, mention.end)}</span>);
    cursor = mention.end;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return parts;
}

type QuotaChannel = "whatsapp" | "gmail";
type MessageQuotaState = Record<QuotaChannel, { used: number; limit: number }> & { ai?: { used: number; limit: number } | null };
/** 429 codes from the shared AI gate (lib/server/ai-daily-limit.ts). */
type AiLimitCode = "ai_daily_limit" | "ai_rate_limit";

function MessageQuotaMeter({ channel, used, limit, label, today, detail, description, compact = false }: {
  channel: QuotaChannel | "ai"; used: number; limit: number; label: string; today: ReactNode; detail?: string; description: string; compact?: boolean;
}) {
  const Icon = channel === "whatsapp" ? SiWhatsapp : channel === "gmail" ? SiGmail : Sparkles;
  const progress = limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
  const remaining = Math.max(0, limit - used);
  const level = remaining === 0 ? " is-empty" : remaining <= Math.max(1, Math.ceil(limit * 0.1)) ? " is-low" : "";
  return (
    <div className={`ls-chat__quota-meter is-${channel}${compact ? " is-compact" : ""}${level}`}>
      <div className="ls-chat__quota-label">
        <Icon aria-hidden="true" size={compact ? 14 : 16} />
        <span>{label}</span>
        <strong>{today}</strong>
      </div>
      <div className="ls-chat__quota-track" role="progressbar" aria-label={description} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
        <span style={{ width: `${progress}%` }} />
      </div>
      {detail ? <small className="ls-chat__quota-detail">{detail}</small> : null}
    </div>
  );
}

type ChatRole = "user" | "assistant";
type ChangeData = { channel?: ContactChannel; message?: string; contactedAt?: string; status?: ContactStatus; notes?: string };
type MentionLead = MentionLeadOption;
type PendingKind = "record_contact" | "update_contact" | "delete_contact" | "update_status" | "add_note" | "add_lead" | "analyze_pains" | "search_businesses" | "search_people" | "import_leads" | "import_contacts" | "send_email" | "send_email_batch" | "send_whatsapp_batch" | "create_meeting" | "update_commercial_profile" | "topup_batch" | "filter_batch" | "update_lead";
type ChangeExtra = Record<string, string | number>;
type ChatAction =
  | { type: "pending_change"; token: string; change: { kind: PendingKind; leadName: string; data: ChangeData; before?: ChangeData; extra?: ChangeExtra; review?: BatchReviewRow[] } }
  | { type: "lead_candidates"; candidates: { name: string; category: string; city: string }[] }
  | { type: "message_suggestions"; leadId?: string; leadName: string; sendChannels?: { whatsapp: boolean; email: boolean }; hasRecipient?: { whatsapp: boolean; email: boolean }; messages: { channel: "whatsapp" | "email"; subject: string; text: string }[] }
  | { type: "google_connect" }
  | { type: "google_feature_connect"; feature: "gmail" | "calendar" }
  | { type: "whatsapp_connect" }
  | { type: "drive_file"; name: string; kind: "csv" | "text"; rows: number }
  /** Leadtita changed leads of this batch (enrichment): reload its card. */
  | { type: "batch_updated"; batchId: string }
  /** Client-only: shown after a confirmed search/import delivers a batch. */
  | { type: "batch_result"; kind: PendingKind; batchId: string; count: number; charged: number; tags: (Chip | string)[]; preview: LeadPreview[] };
/** Summary chip; `hint` = longer explanation shown on hover, keyboard focus or tap. */
type Chip = { label: string; hint?: string };
type LeadPreview = { id: string; name: string; phone: string; whatsapp: string; email: string; socialProfiles: string };
type ResultState = { download?: "xlsx" | "csv"; downloadError?: boolean; analyze?: "busy" | "done" | "error"; analyzed?: { analyzed: number; findings: number }; enrich?: "busy" | "done" | "error"; enriched?: number; enrichError?: string };
/** A detected pain with its evidence (review quote or website note) when the analysis cites one. */
type PainSource = { label: string; quote: string; url: string };
type Pain = { tag: string; detail: string; sources: PainSource[] };
type Proposal = { variant: string; service: string; message: string };
type LeadPainState = { status: "busy" | "done" | "error"; pains?: Pain[]; proposals?: Proposal[] };
const SOCIAL_PILLS: { id: SocialNetwork; label: string; Icon: IconType }[] = [
  { id: "facebook", label: "Facebook", Icon: FaFacebook },
  { id: "instagram", label: "Instagram", Icon: FaInstagram },
  { id: "youtube", label: "YouTube", Icon: FaYoutube },
  { id: "linkedin", label: "LinkedIn", Icon: FaLinkedin },
];
/** Website for display and linking via the shared helpers (no tracking params, never a data-source name in the label). */
function cleanWebsite(raw: string): { href: string; label: string } | null {
  const href = cleanWebsiteUrl(raw);
  return href ? { href, label: displayWebsite(raw) } : null;
}

/** One lead row in the result card and the batch modal (from the confirm preview or the full /api/leads list). */
/** enriched: the email/social enrichment already ran on this lead (same rule as /buscar). analyzed: the pain analysis ran, even if it found nothing. */
type RowLead = { id: string; name: string; phone: string; whatsapp: string; email: string; socialProfiles: string; category: string; address: string; website: string; pains: Pain[]; proposals: Proposal[]; enriched: boolean; analyzed: boolean };
const rowFromPreview = (lead: LeadPreview): RowLead => ({ ...lead, category: "", address: "", website: "", pains: [], proposals: [], enriched: false, analyzed: false });

/** Old analyses stored the internal website-audit instruction as the WEB source text: never show it as a quote. */
const LEGACY_WEB_TEXT = new Set([
  "Auditar esta pagina por SEO visible, rendimiento percibido, optimizacion, UX/UI y originalidad del contenido y diseno.",
  "Audit this page for visible SEO, perceived performance, optimization, UX/UI, and originality of content and design.",
]);
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** Pains (with their sources: label, real quote, link) and proposals of an analyzed lead; same data /buscar shows. */
function painsOf(lead: Pick<Lead, "pain_points" | "pain_points_detail">): { pains: Pain[]; proposals: Proposal[] } {
  const detail = lead.pain_points_detail;
  const tags = detail?.tags?.length ? detail.tags : (lead.pain_points ?? "").split(";").map((tag) => tag.trim()).filter(Boolean);
  const pains = tags.slice(0, 4).map((tag) => {
    const finding = detail?.findings?.length ? findingsForTag(detail.findings, tags, tag)[0] : undefined;
    const sources = (finding?.sources ?? []).slice(0, 3).map((source) => {
      const quote = source.text?.trim() ?? "";
      return {
        // Review labels carry the raw ISO date ("…, 2026-05-08T15:15:53Z"): keep the day only.
        label: (source.label?.trim() ?? "").replace(/(\d{4}-\d{2}-\d{2})T[\d:.]+Z?/, "$1"),
        quote: quote && !LEGACY_WEB_TEXT.has(quote) ? clip(quote, 280) : "",
        // Lead data is untrusted: only http(s) links.
        url: /^https?:\/\//i.test(source.url ?? "") ? source.url : "",
      };
    }).filter((source) => source.label || source.quote || source.url);
    return { tag, detail: clip(finding?.detail?.trim() ?? "", 280), sources };
  });
  const proposals = (detail?.proposals ?? []).slice(0, 2).map(({ variant, service, message }) => ({ variant, service, message }));
  return { pains, proposals };
}
const rowFromLead = (lead: Lead): RowLead => ({
  id: lead.id,
  name: lead.name,
  phone: lead.phone ?? "",
  whatsapp: lead.whatsapp ?? "",
  email: lead.email ?? "",
  socialProfiles: lead.social_profiles ?? "",
  category: lead.category ?? "",
  address: lead.location || lead.address || "",
  // Only http(s) links are rendered (lead data is untrusted); cleanWebsite drops tracking params.
  website: cleanWebsiteUrl(lead.website),
  ...painsOf(lead),
  enriched: Boolean(lead.enrichment_detail?.status || lead.enrichment?.trim()),
  // A saved analysis without pains (status no_data) still counts: "Analizar dolores" must not come back for it.
  analyzed: Boolean(lead.pain_points_detail || lead.pain_points?.trim()),
});

/** Batch table for a batch id: people batches open in /personas, the rest in /historial. */
const batchHref = (kind: PendingKind, batchId: string) => `${kind === "search_people" ? "/personas" : "/historial"}?batch=${encodeURIComponent(batchId)}`;
/** WhatsAppContact expects an international number; a wa.me link carries the digits. */
const whatsappPhone = (lead: Pick<LeadPreview, "phone" | "whatsapp">) => lead.phone || (lead.whatsapp.match(/(\d{8,15})/)?.[1] ? `+${lead.whatsapp.match(/(\d{8,15})/)![1]}` : "");
const RESULT_KINDS: PendingKind[] = ["search_businesses", "search_people", "import_leads", "topup_batch"];
type ConfirmedSummary = { batchId?: string; delivered?: number; charged?: number; tags?: string[]; created?: boolean | number; skipped?: number; failed?: number; queued?: number; preview?: LeadPreview[]; eventLink?: string; meetLink?: string; serviceOffering?: string; commercialSectors?: string; limitReached?: boolean; scheduled?: number; sendAt?: string; missing?: number; round?: number; kept?: number; discarded?: number; refunded?: number };
const SPEND_KINDS: PendingKind[] = ["search_businesses", "search_people", "analyze_pains", "topup_batch"];
/** Lead fields update_lead can change (the card shows one chip per changed field). */
const LEAD_EDIT_FIELDS = ["name", "phone", "email", "website", "category", "address"] as const;
type AttachmentKind = "image" | "pdf" | "text" | "csv";
/** Extracted by /api/lead-suite/chat/attachments; sent back with the conversation (the server re-validates it). */
type AttachmentContext = { name: string; kind: AttachmentKind; size: number; text: string; truncated: boolean; csv?: { totalRows: number; rows: unknown[] } & Record<string, unknown>; preview?: { headers: string[]; rows: string[][] }; restored?: boolean };
type AttachmentChip = { id: number; name: string; size: number; status: "uploading" | "ready" | "error"; error?: string; context?: AttachmentContext };
type ChatMessage = { id: number; role: ChatRole; content: string; actions?: ChatAction[]; attachments?: AttachmentContext[]; leadMentions?: LeadMentionSpan[]; progress?: ToolProgressItem[]; at?: number };
type SendFailure = "error" | "session" | "rate" | "service" | "offline" | "busy";
type FailedRequest = { history: ChatMessage[]; turnId: string; reason: SendFailure };
const CONFIRM_ERRORS = ["session", "rate", "service", "creditBusy", "gmailQuota", "whatsappUnavailable", "invalid", "invalidSendAt", "scheduleLimit", "whatsappMonthlyLimit"] as const;
/** Send cards that can go to "Programados" instead of out now. */
const SCHEDULABLE_KINDS: PendingKind[] = ["send_email", "send_email_batch", "send_whatsapp_batch"];
const DRAFT_SEND_ERRORS = ["needs_gmail", "needs_whatsapp", "recipient_missing", "lead_not_found", "unauthorized"] as const;
/** fetch() rejects with a TypeError when the network is down (wording differs per browser). */
const isOffline = (error: unknown) => (typeof navigator !== "undefined" && !navigator.onLine) || (error instanceof TypeError && /fetch|network|load failed/i.test(error.message));

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.md,.markdown,.txt,.csv,image/png,image/jpeg,image/webp,application/pdf,text/csv,text/markdown,text/plain";
const acceptedFile = (file: File) => /\.(png|jpe?g|webp|pdf|md|markdown|txt|csv)$/i.test(file.name) || /^image\/(png|jpeg|webp)$/.test(file.type);
const KIND_ICON = { image: ImageIcon, pdf: FileText, text: FileText, csv: Sheet } as const;
const ACTION_ICON = {
  record_contact: MessageSquarePlus,
  update_contact: PencilLine,
  delete_contact: Trash2,
  update_status: Tag,
  add_note: StickyNote,
  add_lead: UserPlus,
  analyze_pains: Sparkles,
  search_businesses: Search,
  search_people: UserSearch,
  import_leads: FileUp,
  import_contacts: ListPlus,
  send_email: Send,
  send_email_batch: Mails,
  send_whatsapp_batch: MessagesSquare,
  create_meeting: CalendarPlus,
  update_commercial_profile: BriefcaseBusiness,
  topup_batch: PackagePlus,
  filter_batch: Filter,
  update_lead: UserPen,
} as const;
/** Pixels from the bottom that still count as "reading the latest message". */
const STICK_TO_BOTTOM_PX = 96;
/** Message time, taken in event handlers (never during render). */
const timestamp = () => Date.now();
/** Narrow screens get the short placeholder so it fits on one line. */
const NARROW_QUERY = "(max-width: 640px)";
const subscribeNarrow = (onChange: () => void) => {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
type CardState = "busy" | "done" | "cancelled" | "error" | "no_credits" | "expired" | "needs_gmail" | "needs_calendar" | "needs_whatsapp";
/** Cards whose content the user can edit before confirming (their own email draft / meeting). */
const EDITABLE_KINDS: PendingKind[] = ["send_email", "create_meeting"];
/** The "?" button in the page corner asks LeadtitaOnboarding to replay the tour. */
export const LEADTITA_TOUR_EVENT = "leadta:leadtita-tour";
/** Batch sends show every recipient and message for review before confirming. */
const BATCH_SEND_KINDS: PendingKind[] = ["send_email_batch", "send_whatsapp_batch"];
/** ISO → value for <input type="datetime-local"> in the viewer's zone. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const MAX_HISTORY = 20;
/** 8 lines of 22px; keep in sync with .ls-chat__composer textarea max-height. */
const COMPOSER_MAX_HEIGHT = 176;

/** Payload for /api/lead-suite/chat: only the 5 most recent attachments travel (the server enforces the same cap). */
function withRecentAttachments(history: ChatMessage[]) {
  let budget = MAX_FILES;
  return history.slice().reverse().map(({ role, content, attachments }) => {
    // The table preview is UI-only: undefined drops it from the JSON payload.
    // Sessions saved before attachments kept their text restore them empty (`restored`): nothing to send.
    const kept = (attachments ?? []).filter((attachment) => !attachment.restored && attachment.text).slice(0, Math.max(0, budget)).map((attachment) => ({ ...attachment, preview: undefined }));
    budget -= kept.length;
    return { role, content, ...(kept.length ? { attachments: kept } : {}) };
  }).reverse();
}
const MAX_CHARS = 2000;


type ConversationExtra = { cards: Record<string, string>; results: Record<string, ResultState>; leadPains: Record<string, LeadPainState> };
type Conversation = StoredConversation<ChatMessage, ConversationExtra>;
const SETTLED = new Set(["done", "cancelled", "stale", "expired"]);

/** Expiry of a signed card token ("<base64url payload>.<sig>"); 0 when unreadable (treated as expired). */
function tokenExpiry(token: string) {
  try {
    const body = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(body + "=".repeat((4 - (body.length % 4)) % 4))) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * What gets stored: attachments keep what the model reads (text + CSV columns, not the CSV rows, which only the import
 * tools use and can be large), and settled cards drop their (possibly large) signed token.
 * Pending cards keep the token so they can still be confirmed after a reload while it is valid.
 */
function toStored(messages: ChatMessage[], cards: Record<string, string>) {
  const storedCards: Record<string, string> = {};
  const stored = messages.map((message) => ({
    ...message,
    ...(message.attachments ? { attachments: message.attachments.map((attachment) => ({ ...attachment, ...(attachment.csv ? { csv: { ...attachment.csv, rows: [] } } : {}) })) } : {}),
    ...(message.actions ? {
      actions: message.actions.map((action, index) => {
        if (action.type !== "pending_change") return action;
        const state = cards[action.token];
        const token = state && SETTLED.has(state) ? `settled-${message.id}-${index}` : action.token;
        if (state) storedCards[token] = state;
        return { ...action, token };
      }),
    } : {}),
  }));
  return { messages: stored, cards: storedCards };
}

/** Restored pending cards whose token already expired can't run anymore: show them as expired. */
function restoredCards(messages: ChatMessage[], cards: Record<string, string>, now: number) {
  const next: Record<string, string> = { ...cards };
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (action.type !== "pending_change" || SETTLED.has(next[action.token] ?? "")) continue;
      if (action.token.startsWith("settled-") || tokenExpiry(action.token) <= now) next[action.token] = "expired";
      else if (next[action.token] === "busy") delete next[action.token];
    }
  }
  return next;
}

const titleOf = (messages: ChatMessage[]) => (messages.find((message) => message.role === "user")?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Leadtita chat. "panel" = side panel in Lead Suite; "page" = full-screen /leadtita with every capability suggested. */
export function LeadSuiteChat({ onActivity, variant = "panel" }: { onActivity?: () => void; variant?: "panel" | "page" }) {
  const t = useTranslations("leadSuiteChat");
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<LeadMentionSpan[]>([]);
  const [progress, setProgress] = useState<ToolProgressItem[]>([]);
  const progressRef = useRef<ToolProgressItem[]>([]);
  const progressCopy = (item: ToolProgressItem) => {
    if (item.status === "running") return item.label;
    if (item.status === "failed") return t("toolProgress.failed", { label: item.label.replace(/…$/, "") });
    if (/dolores|pain points/i.test(item.label)) return t("toolProgress.analysisDone");
    if (/contexto|context/i.test(item.label)) return t("toolProgress.memoryDone");
    return t("toolProgress.done");
  };
  const assistantMode = useSyncExternalStore(subscribeMode, readMode, () => "seller" as const);
  const permission = useLeadtitaPermission();
  const [salesChannel, setSalesChannel] = useState<LeadtitaSalesChannel>(null);
  const [messageQuota, setMessageQuota] = useState<MessageQuotaState | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null);
  const [mentionLeads, setMentionLeads] = useState<MentionLead[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<FailedRequest | null>(null);
  // The model could not answer this conversation (too long / empty reply): offer a fresh chat instead of a retry loop.
  const [contextFull, setContextFull] = useState(false);
  const [aiLimit, setAiLimit] = useState<AiLimitCode | null>(null);
  const [cards, setCards] = useState<Record<string, CardState | "stale">>({});
  /** Translated reason of a failed confirmation, per card token. */
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  /** Review state of batch-send cards (kept recipients, edited messages, "I reviewed them" check), per token. */
  const [batchReviews, setBatchReviews] = useState<Record<string, BatchReviewState>>({});
  /** "Programar" time chosen on a send card (null = send now); cards without an entry use the time Leadtita proposed, if any. */
  const [scheduleAt, setScheduleAt] = useState<Record<string, string | null>>({});
  const scheduleOf = (token: string, extra: ChangeExtra) => (token in scheduleAt ? scheduleAt[token] : extra.sendAt ? String(extra.sendAt) : null);
  /** Account credits (session cache), to warn on search cards before confirming. null until known. */
  const [balance, setBalance] = useState<number | null>(null);
  /** Edits the user made on an email/meeting card before confirming (sent with the confirmation, re-validated server-side). */
  const [cardEdits, setCardEdits] = useState<Record<string, Record<string, string | boolean>>>({});
  const editOf = (token: string, extra: ChangeExtra) => ({
    to: String(extra.to ?? ""), subject: String(extra.subject ?? ""), body: String(extra.body ?? ""),
    start: toLocalInput(String(extra.start ?? "")), durationMinutes: String(extra.durationMinutes ?? 30), title: String(extra.title ?? ""),
    meet: Boolean(Number(extra.meet ?? 0)), invite: Boolean(extra.attendee),
    ...cardEdits[token],
  });
  const setEdit = (token: string, key: string, value: string | boolean) => setCardEdits((current) => ({ ...current, [token]: { ...current[token], [key]: value } }));
  const [copied, setCopied] = useState<string | null>(null);
  // "busy" while preparing; otherwise the error key shown under the send button.
  const [draftSendState, setDraftSendState] = useState<Record<string, string>>({});
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches, () => false);
  const [dragging, setDragging] = useState(false);
  const [leadDragging, setLeadDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionMirrorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mentionRequest = useRef(0);
  /** Start index of an "@" closed with Esc, so further typing doesn't reopen it. */
  const mentionDismissed = useRef<number | null>(null);
  /** Multi-word query that returned nothing: longer text after it is a sentence, not a name. */
  const mentionDeadEnd = useRef<string | null>(null);
  const refreshMessageQuota = useCallback(async () => {
    try {
      const response = await fetch("/api/lead-suite/chat/usage", { cache: "no-store" });
      if (!response.ok) return;
      setMessageQuota(await response.json() as MessageQuotaState);
    } catch {
      // Quota meters are informative; sending remains protected by the server-side quota.
    }
  }, []);
  useEffect(() => {
    void refreshMessageQuota();
    const interval = window.setInterval(() => void refreshMessageQuota(), 60_000);
    return () => window.clearInterval(interval);
  }, [refreshMessageQuota]);

  useEffect(() => {
    const requestId = ++mentionRequest.current;
    if (!mention) return;
    const query = mention.query.trim();
    // Empty "@" lists recent leads right away; typing is debounced.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/lead-suite/leads?mention=1&q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const data = response.ok ? await response.json() as { items?: MentionLead[] } : null;
        if (mentionRequest.current !== requestId) return;
        const items = data?.items ?? [];
        setMentionLeads(items);
        if (!items.length && query.includes(" ")) mentionDeadEnd.current = query;
      } catch {
        if (mentionRequest.current === requestId) setMentionLeads([]);
      } finally {
        if (mentionRequest.current === requestId) setMentionLoading(false);
      }
    }, query ? 140 : 0);
    return () => window.clearTimeout(timer);
  }, [mention]);

  /** `spans`: mentions already shifted for `value` (state may not have caught up yet). */
  const updateMention = (value: string, caret: number, spans = draftMentions) => {
    // Names may contain spaces ("@café central"); the query ends at a newline, another "@" or 40 chars.
    const match = value.slice(0, caret).match(/(?:^|\s)@((?:[^\s@][^@\n]{0,39})?)$/);
    const query = match?.[1] ?? "";
    const start = caret - query.length - 1;
    const deadEnd = mentionDeadEnd.current;
    // Skip finished mentions, an "@" the user dismissed with Esc, and sentences that already stopped matching.
    if (!match || spans.some((span) => span.start === start) || mentionDismissed.current === start || (deadEnd && query.includes(" ") && query.trim().startsWith(deadEnd))) {
      setMention(null); setMentionLeads([]); setMentionLoading(false); return;
    }
    mentionDeadEnd.current = null;
    setMentionLoading(true);
    setMention({ query, start, end: caret });
    setMentionIndex(0);
  };

  const updateDraft = (value: string, caret: number) => {
    let prefix = 0;
    while (prefix < draft.length && prefix < value.length && draft[prefix] === value[prefix]) prefix += 1;
    let oldEnd = draft.length;
    let newEnd = value.length;
    while (oldEnd > prefix && newEnd > prefix && draft[oldEnd - 1] === value[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
    const delta = newEnd - oldEnd;
    const spans = draftMentions.flatMap((span) => {
      if (oldEnd <= span.start) return [{ ...span, start: span.start + delta, end: span.end + delta }];
      if (prefix >= span.end) return [span];
      return [];
    });
    if (mentionDismissed.current !== null && !value.startsWith("@", mentionDismissed.current)) mentionDismissed.current = null;
    setDraftMentions(spans);
    setDraft(value);
    updateMention(value, caret, spans);
  };

  /** "@" button: opens the lead picker at the caret, adding a space when glued to a word. */
  const insertMentionTrigger = () => {
    const input = inputRef.current;
    if (!input) return;
    const at = input.selectionStart ?? draft.length;
    const insert = at > 0 && !/\s/.test(draft[at - 1]) ? " @" : "@";
    const caret = at + insert.length;
    mentionDismissed.current = null;
    updateDraft(`${draft.slice(0, at)}${insert}${draft.slice(input.selectionEnd ?? at)}`, caret);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(caret, caret); });
  };

  // Leadtita sidebar: clicking a lead appends "@Lead " to the draft as a real mention span.
  // ponytail: always at the end; clicking the sidebar blurs the composer, so the caret position isn't meaningful.
  useEffect(() => {
    const onMention = (event: Event) => {
      const lead = (event as CustomEvent<{ id?: unknown; name?: unknown }>).detail;
      if (typeof lead?.id !== "string" || typeof lead.name !== "string" || !lead.name) return;
      const start = draft.length + (draft && !/\s$/.test(draft) ? 1 : 0);
      const tag = `@${lead.name}`;
      const next = `${draft}${start > draft.length ? " " : ""}${tag} `;
      if (next.length > MAX_CHARS) return;
      setDraftMentions([...draftMentions, { start, end: start + tag.length, leadId: lead.id, name: lead.name }]);
      setDraft(next);
      setMention(null);
      const input = inputRef.current;
      requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(next.length, next.length); });
    };
    window.addEventListener(MENTION_LEAD_EVENT, onMention);
    return () => window.removeEventListener(MENTION_LEAD_EVENT, onMention);
  }, [draft, draftMentions]);

  /** Backspace right after a mention removes it whole instead of leaving a broken "@Nam". */
  const removeMentionBefore = (input: HTMLTextAreaElement) => {
    const caret = input.selectionStart;
    const span = input.selectionEnd === caret ? draftMentions.find((item) => item.end === caret) : undefined;
    if (!span) return false;
    const length = span.end - span.start;
    setDraftMentions(draftMentions.filter((item) => item !== span).map((item) => item.start >= span.end ? { ...item, start: item.start - length, end: item.end - length } : item));
    setDraft(`${draft.slice(0, span.start)}${draft.slice(span.end)}`);
    setMention(null);
    requestAnimationFrame(() => input.setSelectionRange(span.start, span.start));
    return true;
  };

  const chooseMention = (lead: MentionLead) => {
    if (!mention) return;
    const input = inputRef.current;
    // Trailing space so the user keeps typing; the next Backspace deletes it, the one after the whole mention.
    const after = draft.slice(mention.end);
    const spacer = /^\s/.test(after) ? "" : " ";
    const next = `${draft.slice(0, mention.start)}@${lead.name}${spacer}${after}`;
    const end = mention.start + lead.name.length + 1;
    const caret = end + spacer.length;
    const delta = caret - mention.end;
    setDraftMentions((current) => [
      ...current.flatMap((span) => {
        if (mention.end <= span.start) return [{ ...span, start: span.start + delta, end: span.end + delta }];
        if (mention.start >= span.end) return [span];
        return [];
      }),
      { start: mention.start, end, leadId: lead.id, name: lead.name },
    ].sort((a, b) => a.start - b.start));
    setDraft(next);
    setMention(null);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(caret, caret); });
  };

  /**
   * Keep the composer ready to type without stealing focus: skipped while the user types in another field or selects
   * text, and on touch screens (it would open the keyboard) unless `afterSend`.
   */
  const focusComposer = (afterSend = false) => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    if (!afterSend && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
    if (window.getSelection()?.toString()) return;
    input.focus({ preventScroll: true });
  };

  // Empty composer cycles the default placeholder and usage tips; paused while typing (placeholder hidden anyway).
  const placeholderTips = t.raw("placeholderTips") as string[];
  const [tipIndex, setTipIndex] = useState(0);
  const draftEmpty = draft === "";
  useEffect(() => {
    if (!draftEmpty) return;
    const interval = window.setInterval(() => setTipIndex((index) => (index + 1) % (placeholderTips.length + 1)), 6000);
    return () => window.clearInterval(interval);
  }, [draftEmpty, placeholderTips.length]);

  // Composer grows with its content up to 8 lines, then scrolls inside with a fade at the bottom edge.
  const [fade, setFade] = useState(false);
  const updateFade = () => {
    const input = inputRef.current;
    if (input && mentionMirrorRef.current) mentionMirrorRef.current.scrollTop = input.scrollTop;
    setFade(Boolean(input && input.scrollHeight - input.scrollTop - input.clientHeight > 2));
  };
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
    setFade(input.scrollHeight - input.scrollTop - input.clientHeight > 2);
  }, [draft]);

  // Follow new messages only while the reader is at the bottom (or just sent one); otherwise offer "jump to latest".
  const [unseen, setUnseen] = useState(false);
  const atBottom = useRef(true);
  const scrollToEnd = (behavior: ScrollBehavior) => {
    const log = listRef.current;
    if (!log) return;
    const smooth = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : behavior;
    // When the log doesn't scroll on its own (auto-height layouts), bring its last item into view instead.
    if (log.scrollHeight <= log.clientHeight + 1) log.lastElementChild?.scrollIntoView({ block: "end", behavior: smooth });
    else log.scrollTo({ top: log.scrollHeight, behavior: smooth });
    setUnseen(false);
  };
  useEffect(() => {
    const log = listRef.current;
    if (!log) return;
    const onScroll = () => {
      atBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_TO_BOTTOM_PX;
      if (atBottom.current) setUnseen(false);
    };
    log.addEventListener("scroll", onScroll, { passive: true });
    return () => log.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!messages.length && !sending) return;
    const ownMessage = messages[messages.length - 1]?.role === "user";
    if (atBottom.current || ownMessage) scrollToEnd("smooth");
    else setUnseen(true);
  }, [messages, sending, failed]);

  // A reply that asks for a decision (Yes/No card or lead options) focuses that decision; otherwise the composer.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant") return;
    if (last.actions?.some((action) => action.type === "pending_change")) {
      listRef.current?.querySelector<HTMLButtonElement>(".ls-chat__action-primary:not(:disabled)")?.focus({ preventScroll: true });
    } else if (last.actions?.some((action) => action.type === "lead_candidates")) {
      listRef.current?.querySelector<HTMLButtonElement>(".ls-chat__options button:not(:disabled)")?.focus({ preventScroll: true });
    } else focusComposer();
  }, [messages]);

  // Mounting /leadtita, or the Lead Suite panel becoming visible (opened/expanded), focuses the composer.
  useEffect(() => {
    const form = formRef.current;
    if (!form || typeof IntersectionObserver === "undefined") return;
    let visible = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !visible) focusComposer();
      visible = Boolean(entry?.isIntersecting);
    });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  const appendAssistant = (content: string, actions?: ChatAction[]) =>
    setMessages((current) => [...current, { id: nextId.current++, role: "assistant" as const, content, at: timestamp(), ...(actions?.length ? { actions } : {}) }].slice(-MAX_STORED_MESSAGES));

  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [leadPains, setLeadPains] = useState<Record<string, LeadPainState>>({});
  const [leadEnrich, setLeadEnrich] = useState<Record<string, "busy" | "error">>({});
  // Full lead lists of delivered batches (result cards and the "see more" modal), fetched once per batch.
  const [batchLeads, setBatchLeads] = useState<Record<string, RowLead[]>>({});
  const requestedBatches = useRef(new Set<string>());
  const refreshedBatches = useRef(new Set<string>());
  const [modal, setModal] = useState<{ batchId: string; kind: PendingKind; count: number } | null>(null);
  const [modalQuery, setModalQuery] = useState("");
  const modalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    for (const message of messages) {
      for (const action of message.actions ?? []) {
        if (action.type === "batch_updated") {
          const key = `${message.id}:${action.batchId}`;
          if (refreshedBatches.current.has(key)) continue;
          refreshedBatches.current.add(key);
          // Fresh copy of a batch Leadtita just changed (only when its card is on screen).
          if (requestedBatches.current.has(action.batchId)) {
            fetch(`/api/leads?batchId=${encodeURIComponent(action.batchId)}`, { cache: "no-store" })
              .then((response) => (response.ok ? response.json() : null))
              .then((payload: { leads?: Lead[] } | null) => { if (Array.isArray(payload?.leads)) setBatchLeads((current) => ({ ...current, [action.batchId]: payload.leads!.map(rowFromLead) })); })
              .catch(() => undefined);
          }
          continue;
        }
        if (action.type !== "batch_result" || requestedBatches.current.has(action.batchId)) continue;
        requestedBatches.current.add(action.batchId);
        fetch(`/api/leads?batchId=${encodeURIComponent(action.batchId)}`, { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload: { leads?: Lead[] } | null) => {
            if (Array.isArray(payload?.leads)) setBatchLeads((current) => ({ ...current, [action.batchId]: payload.leads!.map(rowFromLead) }));
            else requestedBatches.current.delete(action.batchId);
          })
          .catch(() => requestedBatches.current.delete(action.batchId));
      }
    }
  }, [messages]);
  useEffect(() => {
    const dialog = modalRef.current;
    if (modal && dialog && !dialog.open) dialog.showModal();
  }, [modal]);
  // "Ver propuesta": the lead's pains + proposals in a modal (can open on top of the batch modal).
  const [proposalLead, setProposalLead] = useState<{ id: string; name: string; pains: Pain[]; proposals: Proposal[] } | null>(null);
  const proposalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = proposalRef.current;
    if (proposalLead && dialog && !dialog.open) dialog.showModal();
  }, [proposalLead]);
  // "Analizar dolores" (lead or batch) asks the focus first, prefilled with the saved service; a changed focus is saved as the service.
  const [focusAsk, setFocusAsk] = useState<{ batchId: string; leadId?: string; value: string } | null>(null);
  const focusRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = focusRef.current;
    if (focusAsk && dialog && !dialog.open) dialog.showModal();
  }, [focusAsk]);
  // CSV / Sheet attachment: table preview of the first rows.
  const [filePreview, setFilePreview] = useState<AttachmentContext | null>(null);
  const filePreviewRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = filePreviewRef.current;
    if (filePreview && dialog && !dialog.open) dialog.showModal();
  }, [filePreview]);
  // Pain sources: click/keyboard popover anchored to the chip (it holds a link, so not a hover tooltip).
  const [painPop, setPainPop] = useState<{ id: string; pain: Pain } | null>(null);
  const painAnchor = useRef<HTMLElement | null>(null);
  // Service the user sells (commercial profile): the server uses it as the pain-analysis focus; shown on the result card.
  const [serviceOffering, setServiceOffering] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account/profile", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { profile?: { serviceOffering?: string } } | null) => setServiceOffering(data?.profile?.serviceOffering ?? ""))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  // ───────── Persistent history (server = source of truth, this browser = per-account cache) ─────────
  const [userId, setUserId] = useState<string | null>(null);
  // Assigned on hydration (never during render: ids use the clock, which Next forbids while prerendering).
  const [conversationId, setConversationId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<{ items: HistoryItem[]; now: number }>({ items: [], now: 0 });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedConversations, setSelectedConversations] = useState<string[]>([]);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [deletingConversations, setDeletingConversations] = useState(false);
  const [historyDeleteError, setHistoryDeleteError] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  // Current conversation id + length, so a late server answer never overwrites what the user did meanwhile.
  const live = useRef({ id: "", length: 0 });
  useEffect(() => { live.current = { id: conversationId, length: messages.length }; }, [conversationId, messages.length]);

  function hydrate(conversation: Conversation | null, now: number) {
    // Older sessions may hold empty assistant bubbles from failed turns: hide them.
    const restored = (conversation?.messages ?? []).filter((message) => message.role !== "assistant" || message.content || message.actions?.length);
    setConversationId(conversation?.id ?? newConversationId());
    setMessages(restored);
    setCards(conversation ? restoredCards(restored, conversation.extra?.cards ?? {}, now) as Record<string, CardState | "stale"> : {});
    setResults(conversation?.extra?.results ?? {});
    setLeadPains(Object.fromEntries(Object.entries(conversation?.extra?.leadPains ?? {}).filter(([, pain]) => pain.status !== "busy")));
    setFailed(null);
    setContextFull(false);
    setChips([]);
    setUnseen(false);
    atBottom.current = true;
    nextId.current = restored.reduce((max, message) => Math.max(max, message.id), 0) + 1;
    return restored.length;
  }

  // Restore the active conversation once the account is known (accounts sharing a browser never mix): the local cache
  // first for an instant paint, then the server copy if it is newer (another browser/device kept chatting).
  useEffect(() => {
    let current = true;
    getSession().then(async (session) => {
      if (!current || !session.user) return;
      const id = String(session.user.id);
      setBalance(Number(session.user.credits ?? 0));
      const history = loadHistory<ChatMessage, ConversationExtra>(id);
      const active = history.conversations.find((conversation) => conversation.id === history.activeId) ?? null;
      setUserId(id);
      const length = hydrate(active, timestamp());
      const synced = await syncWithServer<ChatMessage, ConversationExtra>(id, active?.id ?? null, active?.updatedAt ?? 0);
      if (current && synced.activeMissing && live.current.id === active?.id) hydrate(null, timestamp());
      else if (current && synced.conversation && live.current.id === synced.conversation.id && live.current.length === length) hydrate(synced.conversation, timestamp());
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  // Save after each change (debounced): local cache at once, server ~1.5 s later; an empty conversation is never stored.
  useEffect(() => {
    if (!userId || !conversationId || !messages.length) return;
    const timer = window.setTimeout(() => {
      const stored = toStored(messages, cards);
      const conversation: Conversation = {
        id: conversationId,
        title: titleOf(messages) || t("untitled"),
        updatedAt: timestamp(),
        messages: stored.messages,
        extra: { cards: stored.cards, results, leadPains },
      };
      saveConversation(userId, conversation);
      scheduleServerSave(userId, conversation);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [userId, conversationId, messages, cards, results, leadPains, t]);

  function startNewChat() {
    if (!messages.length || sending) return;
    if (userId) setActiveConversation(userId, null);
    hydrate(null, timestamp());
    setHistoryOpen(false);
    focusComposer();
  }

  function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      focusComposer();
      return;
    }
    // Local cache paints at once; the server list (other browsers/devices) merges in when it answers.
    setHistoryList({ items: userId ? mergeHistory(userId, null) : [], now: timestamp() });
    setConfirmDelete(null);
    setSelectedConversations([]);
    setConfirmDeleteSelected(false);
    setHistoryDeleteError(false);
    setHistoryOpen(true);
    if (!userId) return;
    void fetchConversationList().then((server) => {
      if (server) setHistoryList((list) => ({ ...list, items: mergeHistory(userId, server) }));
    });
  }

  async function openConversation(item: HistoryItem) {
    if (sending || !userId) return;
    if (item.serverUpdatedAt === undefined) {
      const server = await fetchConversationList();
      if (server) {
        const activeItems = mergeHistory(userId, server);
        setHistoryList({ items: activeItems, now: timestamp() });
        if (!activeItems.some((entry) => entry.id === item.id)) return;
      }
    }
    const conversation = await loadConversation<ChatMessage, ConversationExtra>(userId, item);
    if (!conversation) return;
    setActiveConversation(userId, conversation.id);
    hydrate(conversation, timestamp());
    setHistoryOpen(false);
    focusComposer();
  }

  async function removeConversations(ids: string[]) {
    if (!userId || deletingConversations || !ids.length) return;
    setDeletingConversations(true);
    setHistoryDeleteError(false);
    const removed = await deactivateConversations(userId, ids);
    if (!removed) {
      const server = await fetchConversationList();
      if (server) {
        setHistoryList({ items: mergeHistory(userId, server), now: timestamp() });
        const activeIds = new Set(server.map((item) => item.id));
        setSelectedConversations((current) => current.filter((id) => activeIds.has(id)));
      }
      setHistoryDeleteError(true);
      setDeletingConversations(false);
      return;
    }
    const idsToRemove = new Set(ids);
    setHistoryList((current) => ({ ...current, items: current.items.filter((item) => !idsToRemove.has(item.id)) }));
    setSelectedConversations((current) => current.filter((id) => !idsToRemove.has(id)));
    setConfirmDelete(null);
    setConfirmDeleteSelected(false);
    if (idsToRemove.has(conversationId)) hydrate(null, timestamp());
    setDeletingConversations(false);
  }

  function toggleConversationSelection(id: string) {
    setSelectedConversations((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setConfirmDeleteSelected(false);
    setConfirmDelete(null);
  }

  // History groups by calendar day in the user's time zone: today, yesterday, last 7 days, older.
  const historyGroup = (at: number, now: number) => {
    const day = (ms: number) => { const date = new Date(ms); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000; };
    const days = day(now) - day(at);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? "week" : "older";
  };

  const relativeTime = (at: number, now: number) => {
    const minutes = Math.round((at - now) / 60_000);
    const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return format.format(hours, "hour");
    return format.format(Math.round(hours / 24), "day");
  };


  /** One lead through the same pain analysis as the table (/api/analysis with leadId); free, counts toward the free cap. */
  async function analyzeLead(batchId: string, leadId: string, focus: string) {
    setLeadPains((current) => ({ ...current, [leadId]: { status: "busy" } }));
    try {
      const response = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, action: "pain_points", leadId, focus }) });
      const payload = (await response.json().catch(() => ({}))) as { leads?: Lead[] };
      if (!response.ok) throw new Error(String(response.status));
      const lead = payload.leads?.find((item) => item.id === leadId);
      setLeadPains((current) => ({ ...current, [leadId]: { status: "done", ...(lead ? painsOf(lead) : { pains: [], proposals: [] }) } }));
      onActivity?.();
    } catch {
      setLeadPains((current) => ({ ...current, [leadId]: { status: "error" } }));
    }
  }
  function submitFocus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!focusAsk) return;
    const focus = focusAsk.value.trim();
    const { batchId, leadId } = focusAsk;
    focusRef.current?.close();
    if (focus !== serviceOffering) {
      setServiceOffering(focus);
      // The analysis gets the focus in its own body, so it never waits on (or depends on) this save.
      void fetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceOffering: focus }) }).catch(() => undefined);
    }
    void (leadId ? analyzeLead(batchId, leadId, focus) : analyzeBatch(batchId, focus));
  }
  const patchResult = (batchId: string, patch: ResultState) => setResults((current) => ({ ...current, [batchId]: { ...current[batchId], ...patch } }));

  async function download(batchId: string, format: "xlsx" | "csv") {
    patchResult(batchId, { download: format, downloadError: false });
    try {
      const response = await fetch(`/api/export/${format}?batchId=${encodeURIComponent(batchId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? `leadta-${batchId}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      patchResult(batchId, { download: undefined });
    } catch {
      patchResult(batchId, { download: undefined, downloadError: true });
    }
  }

  /** Same pain analysis as the batch table (/api/analysis); free, it only counts toward the free analysis cap. */
  async function analyzeBatch(batchId: string, focus: string) {
    patchResult(batchId, { analyze: "busy" });
    try {
      const response = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, action: "pain_points", focus }) });
      const payload = (await response.json().catch(() => ({}))) as { analyzedCount?: number; findingCount?: number; leads?: Lead[] };
      if (!response.ok) throw new Error(String(response.status));
      patchResult(batchId, { analyze: "done", analyzed: { analyzed: payload.analyzedCount ?? 0, findings: payload.findingCount ?? 0 } });
      // The response carries the whole batch: rows pick up pains and the "analyzed" mark (also leads with no pains found).
      if (Array.isArray(payload.leads)) setBatchLeads((current) => ({ ...current, [batchId]: payload.leads!.map(rowFromLead) }));
      onActivity?.();
    } catch {
      patchResult(batchId, { analyze: "error" });
    }
  }
  /**
   * Same email/social enrichment as the batch table (/api/analysis, action "enrichment"): free, capped per account.
   * The response carries every lead of the batch, so the card shows the new emails and profiles right away.
   */
  async function enrich(batchId: string, leadId?: string) {
    if (leadId) setLeadEnrich((current) => ({ ...current, [leadId]: "busy" }));
    else patchResult(batchId, { enrich: "busy", enrichError: "" });
    try {
      const response = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, action: "enrichment", ...(leadId ? { leadId } : {}) }) });
      const payload = (await response.json().catch(() => ({}))) as { leads?: Lead[]; analyzedCount?: number; error?: string };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "");
      if (Array.isArray(payload.leads)) setBatchLeads((current) => ({ ...current, [batchId]: payload.leads!.map(rowFromLead) }));
      if (leadId) setLeadEnrich((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== leadId)));
      else patchResult(batchId, { enrich: "done", enriched: payload.analyzedCount ?? 0 });
      onActivity?.();
    } catch (error) {
      if (leadId) setLeadEnrich((current) => ({ ...current, [leadId]: "error" }));
      else patchResult(batchId, { enrich: "error", enrichError: error instanceof Error ? error.message : "" });
    }
  }


  /** Display extra of a pending card (to rebuild its keyword list on confirm). */
  const pendingExtra = (token: string): ChangeExtra => {
    for (const message of messages) for (const action of message.actions ?? []) if (action.type === "pending_change" && action.token === token) return action.change.extra ?? {};
    return {};
  };

  /** Review rows of a batch-send card; cards saved before the review existed have none. */
  const pendingReview = (token: string): BatchReviewRow[] | undefined => {
    for (const message of messages) for (const action of message.actions ?? []) if (action.type === "pending_change" && action.token === token) return action.change.review;
    return undefined;
  };
  const reviewOf = (token: string, rows: BatchReviewRow[]) => batchReviews[token] ?? initialBatchReview(rows);

  /** `opts.extra`: auto-run cards confirm before `messages` holds them, so pendingExtra can't find their extra yet. */
  async function confirm(token: string, kind: PendingKind, leadName: string, tags: Chip[] = [], opts: { auto?: LeadtitaPermission; extra?: ChangeExtra } = {}) {
    setCards((current) => ({ ...current, [token]: "busy" }));
    try {
      const removed = removedKeywords[token] ?? [];
      const cardExtra = opts.extra ?? pendingExtra(token);
      const reviewRows = BATCH_SEND_KINDS.includes(kind) ? pendingReview(token) : undefined;
      const sendAt = SCHEDULABLE_KINDS.includes(kind) ? scheduleOf(token, cardExtra) : null;
      const response = await fetch("/api/lead-suite/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          conversationId,
          ...(opts.auto ? { auto: opts.auto } : {}),
          ...(removed.length ? { keywords: keywordsOf(cardExtra).filter((keyword) => !removed.includes(keyword)) } : {}),
          ...(EDITABLE_KINDS.includes(kind) ? { edits: (() => {
            const edit = editOf(token, cardExtra);
            return kind === "send_email"
              ? { to: edit.to, subject: edit.subject, body: edit.body }
              : { start: edit.start ? new Date(String(edit.start)).toISOString() : "", durationMinutes: Number(edit.durationMinutes), title: edit.title, meet: edit.meet, invite: edit.invite };
          })() } : {}),
          ...(reviewRows ? { review: batchReviewPayload(reviewOf(token, reviewRows), kind === "send_email_batch" ? "email" : "whatsapp") } : {}),
          ...(sendAt ? { sendAt } : {}),
        }),
      });
      if (response.status === 402) {
        const { available = 0, required = 0 } = (await response.json().catch(() => ({}))) as { available?: number; required?: number };
        setBalance(available);
        setCardErrors((current) => ({ ...current, [token]: t("confirmErrors.noCredits", { available, required }) }));
        setCards((current) => ({ ...current, [token]: "no_credits" }));
        return;
      }
      if (response.status === 409) {
        const { code } = (await response.json().catch(() => ({}))) as { code?: string };
        if (code === "credit_busy") throw new Error("creditBusy");
        // Over the "Omitir" limits (sends, >30% of credits): back to a normal Yes/No card.
        if (code === "needs_confirmation") {
          setCards((current) => { const next = { ...current }; delete next[token]; return next; });
          return;
        }
        setCards((current) => ({ ...current, [token]: code === "needs_gmail" ? "needs_gmail" : code === "needs_calendar" ? "needs_calendar" : code === "needs_whatsapp" ? "needs_whatsapp" : "stale" }));
        return;
      }
      if (response.status === 410) {
        const { code } = (await response.json().catch(() => ({}))) as { code?: string };
        if (code === "conversation_inactive") {
          if (userId) await deactivateConversations(userId, [conversationId]);
          setHistoryList((current) => ({ ...current, items: current.items.filter((item) => item.id !== conversationId) }));
          hydrate(null, timestamp());
          return;
        }
      }
      if (!response.ok) {
        const { code } = (await response.json().catch(() => ({}))) as { code?: string };
        throw new Error(response.status === 401 ? "session" : code === "gmail_quota" ? "gmailQuota" : code === "whatsapp_unavailable" ? "whatsappUnavailable" : code === "invalid" ? "invalid" : code === "invalid_send_at" ? "invalidSendAt" : code === "schedule_limit" ? "scheduleLimit" : code === "whatsapp_monthly_limit" ? "whatsappMonthlyLimit" : response.status === 429 ? "rate" : response.status === 503 ? "service" : "generic");
      }
      const { result } = (await response.json()) as { result?: { leadName?: string; summary?: ConfirmedSummary; next?: ChatAction } };
      const summary = result?.summary ?? {};
      if (summary.charged) setBalance((current) => (current === null ? current : Math.max(0, current - Number(summary.charged))));
      if (summary.refunded) setBalance((current) => (current === null ? current : current + Number(summary.refunded)));
      void refreshMessageQuota();
      setCards((current) => ({ ...current, [token]: "done" }));
      if (summary.sendAt) {
        // Scheduled instead of sent: it now lives in "Programados".
        appendAssistant(t("schedule.done", { count: summary.scheduled ?? 0, date: formatTime(summary.sendAt) }));
        window.dispatchEvent(new Event(SCHEDULED_EVENT));
        focusComposer();
        return;
      }
      if (kind === "update_commercial_profile") setServiceOffering(summary.serviceOffering ?? "");
      const count = kind === "import_leads" ? Number(summary.created ?? 0) : summary.delivered ?? 0;
      const resultCard: ChatAction[] = RESULT_KINDS.includes(kind) && summary.batchId && count > 0
        ? [{ type: "batch_result", kind, batchId: summary.batchId, count, charged: summary.charged ?? 0, tags, preview: summary.preview ?? [] }]
        : [];
      appendAssistant(kind === "send_email" && summary.limitReached ? t("gmailDailyLimitReached") : t(`done.${kind}`, {
        lead: result?.leadName || leadName,
        delivered: summary.delivered ?? 0,
        charged: summary.charged ?? 0,
        tags: summary.tags?.join(", ") || "—",
        event: summary.eventLink ?? "",
        meet: summary.meetLink ?? "",
        created: Number(summary.created ?? 0),
        skipped: summary.skipped ?? 0,
        failed: summary.failed ?? 0,
        queued: summary.queued ?? 0,
        missing: summary.missing ?? 0,
        kept: summary.kept ?? 0,
        discarded: summary.discarded ?? 0,
        refunded: summary.refunded ?? 0,
        href: summary.batchId ? batchHref(kind, summary.batchId) : "/historial",
      }), resultCard);
      if (kind === "send_email_batch" && summary.limitReached) appendAssistant(t("gmailDailyLimitReached"));
      onActivity?.();
      focusComposer();
      // Next top-up round for a batch still short of leads. Free rounds run on their own (the server caps them and
      // re-checks the price); a paid one stays as a Yes/No card.
      const next = result?.next;
      if (next?.type === "pending_change" && next.change.kind === "topup_batch") {
        const nextExtra = next.change.extra ?? {};
        const missing = Number(nextExtra.missing ?? 0);
        if (Number(nextExtra.free) === 1) {
          appendAssistant(t("topup.autoRunning", { missing }), [next]);
          await confirm(next.token, "topup_batch", "", actionTags("topup_batch", nextExtra), { extra: nextExtra });
        } else appendAssistant(t("topup.offer", { missing, credits: Number(nextExtra.credits ?? 0) }), [next]);
      }
    } catch (error) {
      const key = isOffline(error) ? "offline" : error instanceof Error && (CONFIRM_ERRORS as readonly string[]).includes(error.message) ? error.message : "generic";
      setCardErrors((current) => ({ ...current, [token]: t(`confirmErrors.${key}`) }));
      setCards((current) => ({ ...current, [token]: "error" }));
    }
  }

  function cancel(token: string) {
    setCards((current) => ({ ...current, [token]: "cancelled" }));
    appendAssistant(t("cancelled"));
    focusComposer();
  }

  async function prepareDraftSend(action: Extract<ChatAction, { type: "message_suggestions" }>, draftMessage: { channel: "whatsapp" | "email"; subject: string; text: string }, key: string) {
    setDraftSendState((current) => ({ ...current, [key]: "busy" }));
    try {
      const response = await fetch("/api/lead-suite/chat/draft-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, leadId: action.leadId, channel: draftMessage.channel, subject: draftMessage.subject, text: draftMessage.text }),
      });
      const payload = await response.json().catch(() => ({})) as { action?: ChatAction; error?: string };
      if (!response.ok || payload.action?.type !== "pending_change") throw new Error(payload.error ?? "proposal_unavailable");
      appendAssistant(t("draftSend.confirmPrompt", { lead: action.leadName, channel: t(`channels.${draftMessage.channel}`) }), [payload.action]);
      setDraftSendState((current) => { const next = { ...current }; delete next[key]; return next; });
    } catch (error) {
      const code = isOffline(error) ? "offline" : error instanceof Error && (DRAFT_SEND_ERRORS as readonly string[]).includes(error.message) ? error.message : "generic";
      setDraftSendState((current) => ({ ...current, [key]: code }));
    }
  }

  async function request(history: ChatMessage[], turnId = newConversationId(), overrides: { mode?: LeadtitaMode; salesChannel?: LeadtitaSalesChannel } = {}) {
    setSending(true);
    setFailed(null);
    setContextFull(false);
    setAiLimit(null);
    progressRef.current = [];
    setProgress([]);
    try {
      const response = await fetch("/api/lead-suite/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          turnId,
          messages: withRecentAttachments(history.slice(-MAX_HISTORY)),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          mode: overrides.mode ?? assistantMode,
          salesChannel: overrides.salesChannel !== undefined ? overrides.salesChannel : salesChannel,
          permission,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        if (payload.code === "context_full") setContextFull(true);
        if (payload.code === "ai_daily_limit" || payload.code === "ai_rate_limit") setAiLimit(payload.code);
        if (payload.code === "conversation_inactive") {
          if (userId) await deactivateConversations(userId, [conversationId]);
          setHistoryList((current) => ({ ...current, items: current.items.filter((item) => item.id !== conversationId) }));
          hydrate(null, timestamp());
          return;
        }
        throw new Error(response.status === 401 ? "session" : response.status === 429 ? "rate" : response.status >= 500 ? "service" : String(response.status));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("chat_failed");
      const decoder = new TextDecoder();
      let buffer = "";
      // ponytail: assertion stops TS narrowing to null; consumeFrame assigns it inside a closure.
      let completed = null as { reply?: string; actions?: ChatAction[] } | null;
      let streamFailure: string | null = null;
      const consumeFrame = (rawFrame: string) => {
        const lines = rawFrame.replace(/\r\n/g, "\n").split("\n");
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const payload = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!event || !payload) return;
        let data: unknown;
        try { data = JSON.parse(payload); } catch { return; }
        if (event === "progress" && data && typeof data === "object") {
          const update = data as { type?: unknown; id?: unknown; label?: unknown };
          if (typeof update.id !== "string" || typeof update.label !== "string") return;
          const status = update.type === "tool_started" ? "running" : update.type === "tool_succeeded" ? "done" : update.type === "tool_failed" ? "failed" : null;
          if (!status) return;
          const current = progressRef.current;
          const index = current.findIndex((item) => item.id === update.id);
          const next = [...current];
          if (index < 0) next.push({ id: update.id, label: update.label, status });
          else next[index] = { ...next[index], label: update.label, status };
          progressRef.current = next;
          setProgress(next);
        } else if (event === "complete" && data && typeof data === "object") {
          completed = data as { reply?: string; actions?: ChatAction[] };
        } else if (event === "failure" && data && typeof data === "object" && "code" in data && typeof data.code === "string") {
          streamFailure = data.code;
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
        let separator = buffer.indexOf("\n\n");
        while (separator >= 0) {
          consumeFrame(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) consumeFrame(buffer);
      if (streamFailure) {
        if (streamFailure === "context_full") setContextFull(true);
        throw new Error(streamFailure);
      }
      if (!completed) throw new Error("chat_failed");
      const actions = Array.isArray(completed.actions) ? completed.actions : [];
      const cardActions = actions.filter((action) => action.type === "pending_change");
      const autoActions = cardActions.filter((action) => runsWithoutAsking(permission, action.change.kind));
      // An empty reply with a card still needs a line in the history so the model sees its own question next turn.
      const content = completed.reply?.trim() || (cardActions.length ? t(autoActions.length === cardActions.length ? "permissions.running" : "confirmPrompt") : "");
      // Nothing to show: surface the retry state instead of an empty bubble.
      if (!content && !actions.length) {
        setContextFull(true);
        throw new Error("empty_reply");
      }
      setMessages([...history, { id: nextId.current++, role: "assistant" as const, content, actions, ...(progressRef.current.length ? { progress: progressRef.current } : {}), at: timestamp() }].slice(-MAX_STORED_MESSAGES));
      progressRef.current = [];
      setProgress([]);
      // Permissions "Omitir"/"Peligro": the card runs through the normal confirm flow, so it shows Procesando… then the result.
      // Sequential: confirm appends its own "Listo" message per card, and searches share the credit lock.
      if (autoActions.length) void (async () => {
        for (const action of autoActions) {
          const { kind, leadName, extra = {} } = action.change;
          await confirm(action.token, kind, leadName, actionTags(kind, extra), { auto: permission, extra });
        }
      })();
    } catch (error) {
      const code = error instanceof Error ? error.message : "chat_failed";
      if (code === "context_full") setContextFull(true);
      progressRef.current = progressRef.current.map((item) => item.status === "running" ? { ...item, status: "failed" } : item);
      setProgress(progressRef.current);
      const reason: SendFailure = isOffline(error) ? "offline" : code === "turn_in_progress" ? "busy" : code === "session" || code === "rate" || code === "service" ? code : "error";
      setFailed({ history, turnId, reason });
      focusComposer();
    } finally {
      setSending(false);
      // Each sent message moves the AI counter (and replies may have sent Gmail/WhatsApp).
      void refreshMessageQuota();
    }
  }

  function send(text: string, overrides?: { mode?: LeadtitaMode; salesChannel?: LeadtitaSalesChannel }) {
    const attachments = chips.flatMap((chip) => (chip.status === "ready" && chip.context ? [chip.context] : []));
    const content = (text.trim() || (attachments.length ? t("attachmentDefaultPrompt") : "")).slice(0, MAX_CHARS);
    if (!content || sending || chips.some((chip) => chip.status === "uploading")) return;
    const leadingWhitespace = text === draft ? text.length - text.trimStart().length : 0;
    const selectedMentions = text === draft ? draftMentions
      .filter((span) => span.start >= leadingWhitespace && span.end <= leadingWhitespace + content.length)
      .map((span) => ({ ...span, start: span.start - leadingWhitespace, end: span.end - leadingWhitespace })) : [];
    const history = [...messages, { id: nextId.current++, role: "user" as const, content, at: timestamp(), ...(selectedMentions.length ? { leadMentions: selectedMentions } : {}), ...(attachments.length ? { attachments } : {}) }].slice(-MAX_STORED_MESSAGES);
    setMessages(history);
    setDraft("");
    setDraftMentions([]);
    setChips([]);
    focusComposer(true);
    void request(history, undefined, overrides);
  }

  // Connection state reported by ChatControls: true/false when known, null while loading or when the channel isn't offered.
  const [channelsReady, setChannelsReady] = useState<Record<"whatsapp" | "gmail", boolean | null>>({ whatsapp: null, gmail: null });
  function runShortcut(shortcut: PageShortcut, text: string) {
    writeMode(shortcut.mode);
    if (shortcut.channel) setSalesChannel(shortcut.channel);
    if (shortcut.channel && channelsReady[shortcut.channel] === false) {
      window.dispatchEvent(new CustomEvent(OPEN_CHANNEL_CONNECT_EVENT, { detail: shortcut.channel }));
      return;
    }
    send(text, { mode: shortcut.mode, salesChannel: shortcut.channel ?? salesChannel });
  }

  // "+" menu: upload from the device or attach a connected Google Drive file (same attachment pipeline).
  const [attachMenu, setAttachMenu] = useState<"" | "menu" | "drive">("");
  const attachButtonRef = useRef<HTMLButtonElement>(null);

  async function addDriveFile(file: ConnectedDriveFile) {
    if (chips.filter((chip) => chip.status !== "error").length >= MAX_FILES) return;
    const id = nextId.current++;
    setChips((current) => [...current, { id, name: file.name, size: 0, status: "uploading" }]);
    setAttachMenu("");
    focusComposer();
    try {
      const response = await fetch("/api/lead-suite/chat/attachments/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: file.id }) });
      const payload = (await response.json().catch(() => ({}))) as { attachment?: AttachmentContext; code?: string };
      if (!response.ok || !payload.attachment) throw new Error(payload.code ?? "failed");
      setChips((current) => current.map((chip) => (chip.id === id ? { ...chip, status: "ready", context: payload.attachment } : chip)));
    } catch (error) {
      const code = error instanceof Error ? error.message : "failed";
      setChips((current) => current.map((chip) => (chip.id === id ? { ...chip, status: "error", error: t(`drive.errors.${["not_connected", "not_found", "forbidden", "too_large", "unsupported"].includes(code) ? code : "failed"}`) } : chip)));
    }
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const room = MAX_FILES - chips.filter((chip) => chip.status !== "error").length;
    const next: AttachmentChip[] = files.map((file, index) => ({
      id: nextId.current++,
      name: file.name || t("pastedImage"),
      size: file.size,
      status: index >= room ? "error" : !acceptedFile(file) ? "error" : file.size > MAX_FILE_BYTES ? "error" : "uploading",
      error: index >= room ? t("attachErrors.count", { max: MAX_FILES }) : !acceptedFile(file) ? t("attachErrors.type") : file.size > MAX_FILE_BYTES ? t("attachErrors.size") : undefined,
    }));
    setChips((current) => [...current, ...next]);
    const uploads = next.map((chip, index) => ({ chip, file: files[index] })).filter(({ chip }) => chip.status === "uploading");
    if (!uploads.length) return;
    const form = new FormData();
    for (const { chip, file } of uploads) form.append("files", file, chip.name);
    try {
      const response = await fetch("/api/lead-suite/chat/attachments", { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as { code?: string; results?: { attachment?: AttachmentContext; error?: string }[] };
      if (payload.code === "ai_daily_limit") void refreshMessageQuota();
      if (!response.ok || !payload.results) throw new Error(payload.code === "rate" || payload.code === "ai_rate_limit" ? "rate" : payload.code === "ai_daily_limit" ? "aiDaily" : payload.code === "size" ? "size" : "extract");
      setChips((current) => current.map((chip) => {
        const position = uploads.findIndex((upload) => upload.chip.id === chip.id);
        if (position === -1) return chip;
        const result = payload.results![position];
        return result?.attachment
          ? { ...chip, status: "ready", context: result.attachment }
          : { ...chip, status: "error", error: t(`attachErrors.${["type", "size", "empty"].includes(result?.error ?? "") ? result!.error : "extract"}`) };
      }));
    } catch (error) {
      const code = error instanceof Error && (error.message === "rate" || error.message === "size" || error.message === "aiDaily") ? error.message : "extract";
      setChips((current) => current.map((chip) => (uploads.some((upload) => upload.chip.id === chip.id) ? { ...chip, status: "error", error: t(`attachErrors.${code}`) } : chip)));
    }
  }

  // Drag & drop over the whole chat: a depth counter keeps nested dragenter/dragleave from flickering the overlay.
  const dragDepth = useRef(0);
  // Files show the attach overlay; a lead dragged from the Leadtita sidebar only highlights the composer.
  const dragKind = (event: DragEvent) => event.dataTransfer.types.includes("Files") ? "files" : event.dataTransfer.types.includes(LEAD_DRAG_TYPE) ? "lead" : null;
  function endDrag() {
    dragDepth.current = 0;
    setDragging(false);
    setLeadDragging(false);
  }
  function onDragEnter(event: DragEvent) {
    const kind = dragKind(event);
    if (!kind) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (kind === "files") setDragging(true);
    else setLeadDragging(true);
  }
  function onDragOver(event: DragEvent) {
    if (!dragKind(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(event: DragEvent) {
    if (!dragKind(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) endDrag();
  }
  function onDrop(event: DragEvent) {
    const kind = dragKind(event);
    if (!kind) return;
    // Also stops the textarea from inserting the plain-text fallback ("@Lead") on its own.
    event.preventDefault();
    endDrag();
    if (kind === "files") { void addFiles([...event.dataTransfer.files]); return; }
    const lead = readDraggedLead(event.dataTransfer);
    if (lead) requestLeadMention(lead);
  }
  // Cancel paths the section never hears about: Esc, leaving the window, or dropping elsewhere on the page.
  useEffect(() => {
    if (!dragging && !leadDragging) return;
    const reset = () => { dragDepth.current = 0; setDragging(false); setLeadDragging(false); };
    const onWindowLeave = (event: globalThis.DragEvent) => { if (!event.relatedTarget) reset(); };
    const onWindowDrop = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); reset(); };
    const onWindowOver = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") reset(); };
    window.addEventListener("dragleave", onWindowLeave);
    window.addEventListener("drop", onWindowDrop);
    window.addEventListener("dragover", onWindowOver);
    window.addEventListener("dragend", reset);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("dragleave", onWindowLeave);
      window.removeEventListener("drop", onWindowDrop);
      window.removeEventListener("dragover", onWindowOver);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, leadDragging]);

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  }

  const formatSize = (bytes: number) => bytes >= 1024 * 1024
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMention(null);
    send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Backspace" && !event.nativeEvent.isComposing && removeMentionBefore(event.currentTarget)) { event.preventDefault(); return; }
    if (mention) {
      if (event.key === "ArrowDown" && mentionLeads.length) { event.preventDefault(); setMentionIndex((index) => (index + 1) % mentionLeads.length); return; }
      if (event.key === "ArrowUp" && mentionLeads.length) { event.preventDefault(); setMentionIndex((index) => (index - 1 + mentionLeads.length) % mentionLeads.length); return; }
      if (event.key === "Escape") { event.preventDefault(); mentionDismissed.current = mention.start; setMention(null); return; }
      if (event.key === "Tab" && !event.shiftKey && mentionLeads.length) { event.preventDefault(); chooseMention(mentionLeads[mentionIndex]); return; }
      if (event.key === "Enter" && !event.shiftKey && mentionLeads.length) { event.preventDefault(); chooseMention(mentionLeads[mentionIndex]); return; }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  }

  const formatClock = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  /** Short, scannable action title: what will happen and to what. */
  const actionTitle = (kind: PendingKind, leadName: string, extra: ChangeExtra) => {
    const seen = new Set<string>();
    const place = [extra.district, extra.province, extra.country].map((part) => String(part ?? "").trim()).filter((part) => {
      const key = part.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(", ");
    return t(`titles.${kind}`, {
      lead: leadName,
      file: leadName,
      count: Number(extra.count ?? extra.toCreate ?? extra.toRecord ?? 0),
      query: String(extra.label ?? keywordsOf(extra)[0] ?? extra.query ?? ""),
      place: place || String(extra.location ?? ""),
      hasPlace: place || extra.location ? "yes" : "no",
      hasQuery: extra.label || keywordsOf(extra)[0] ? "yes" : "no",
      missing: Number(extra.missing ?? 0),
    });
  };

  /** "Teléfono empieza con +56", "Sin web": one custom search/batch filter as a chip label. */
  const ruleLabel = (rule: LeadRule) => rule.op === "empty" || rule.op === "not_empty"
    ? t(`rules.${rule.op}.${rule.field}`)
    : t(`rules.${rule.op}`, { field: t(`rules.fields.${rule.field}`), value: rule.value });

  /** Search filters and import counts as chips instead of a label/value table. */
  const actionTags = (kind: PendingKind, extra: ChangeExtra): Chip[] => {
    const rules = (parseLeadRules(extra.rules) ?? []).map((rule) => ({ label: ruleLabel(rule) }));
    if (kind === "search_businesses" || kind === "topup_batch") {
      const presence = (["website", "phone", "email"] as const).flatMap((key) => (extra[key] === "with" || extra[key] === "without"
        ? [{ label: t(`filters.${key}.${extra[key]}`), hint: t(`filters.hints.${key}.${extra[key]}`) }]
        : []));
      return [
        ...presence,
        ...rules,
      ];
    }
    if (kind === "filter_batch") {
      return [
        { label: t("batchFilter.kept", { n: Number(extra.kept ?? 0) }) },
        { label: t("batchFilter.discarded", { n: Number(extra.discarded ?? 0) }) },
        ...(Number(extra.refund) > 0 ? [{ label: t("batchFilter.refund", { n: Number(extra.refund) }) }] : []),
        ...rules,
      ];
    }
    if (kind === "update_lead") {
      return LEAD_EDIT_FIELDS.filter((key) => key in extra).map((key) => {
        const value = String(extra[key] ?? "").trim();
        const field = t(`rules.fields.${key}`);
        return { label: value ? t("leadEdit.set", { field, value: key === "website" ? cleanWebsite(value)?.label ?? value : value }) : t("leadEdit.clear", { field }) };
      });
    }
    if (kind === "update_commercial_profile") {
      return [
        extra.serviceOffering ? t("filters.service", { service: String(extra.serviceOffering) }) : "",
        extra.commercialSectors ? t("filters.sectors", { sectors: String(extra.commercialSectors) }) : "",
      ].filter(Boolean).map((label) => ({ label }));
    }
    if (kind === "analyze_pains" && extra.focus) return [{ label: t("filters.focus", { focus: String(extra.focus) }) }];
    if (kind === "add_lead") return (["category", "city", "phone", "email", "website"] as const).map((key) => ({ label: key === "website" ? cleanWebsite(String(extra[key] ?? ""))?.label ?? "" : String(extra[key] ?? "") })).filter((chip) => chip.label);
    if (kind === "import_leads") {
      return [
        t("importTags.toCreate", { n: Number(extra.toCreate ?? 0) }),
        Number(extra.duplicates) ? t("importTags.duplicates", { n: Number(extra.duplicates) }) : "",
        Number(extra.invalid) ? t("importTags.invalid", { n: Number(extra.invalid) }) : "",
        extra.target ? t(`targets.${extra.target}`) : "",
      ].filter(Boolean).map((label) => ({ label }));
    }
    if (kind === "import_contacts") {
      return [
        t("importTags.toRecord", { n: Number(extra.toRecord ?? 0) }),
        Number(extra.doubtfulCount) ? t("importTags.doubtful", { n: Number(extra.doubtfulCount) }) : "",
        Number(extra.unmatched) ? t("importTags.unmatched", { n: Number(extra.unmatched) }) : "",
      ].filter(Boolean).map((label) => ({ label }));
    }
    return [];
  };

  // One shared tooltip, rendered by the anchored Popover primitive (top layer: never clipped by scroll areas).
  const [tip, setTip] = useState<{ id: string; text: string } | null>(null);
  const tipAnchor = useRef<HTMLElement | null>(null);
  const tipProps = (id: string, text: string) => {
    const show = (event: { currentTarget: HTMLElement }) => {
      tipAnchor.current = event.currentTarget;
      setTip({ id, text });
    };
    const hide = () => setTip((current) => (current?.id === id ? null : current));
    return {
      "aria-describedby": tip?.id === id ? id : undefined,
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      // Touch: tap toggles.
      onClick: (event: { currentTarget: HTMLElement }) => (tip?.id === id ? setTip(null) : show(event)),
    };
  };
  /** Keywords the user removed from a pending search card (by card token); sent with the confirmation. */
  const [removedKeywords, setRemovedKeywords] = useState<Record<string, string[]>>({});
  const keywordsOf = (extra: ChangeExtra) => String(extra.keywords ?? "").split(/\n|, /).map((keyword) => keyword.trim()).filter(Boolean);
  const renderChips = (chips: (Chip | string)[], scope: string) => (
    <ul className="ls-chat__tags" aria-label={t("summary")}>
      {chips.map((raw, index) => {
        const chip = typeof raw === "string" ? { label: raw } : raw;
        const id = `${scope}-tip-${index}`;
        if (!chip.hint) return <li key={`${chip.label}-${index}`}>{chip.label}</li>;
        return (
          <li key={`${chip.label}-${index}`} className="ls-chat__tag-tip-item">
            <button type="button" className={`ls-chat__tag-tip${tip?.id === id ? " is-open" : ""}`} {...tipProps(id, chip.hint)}>
              {chip.label}
            </button>
          </li>
        );
      })}
    </ul>
  );

  /** Finding + its sources: label ("Reseña, 4/5", "Sitio web del negocio"), real quote if any, link when there is a URL. */
  const renderPainSources = (pain: Pain) => (
    <div className="ls-chat__sources">
      {pain.detail ? <p className="ls-chat__source-detail">{pain.detail}</p> : null}
      {pain.sources.length ? (
        <ul aria-label={t("result.sources")}>
          {pain.sources.map((source, index) => (
            <li key={`${source.label}-${index}`}>
              {source.label ? <span className="ls-chat__source-label">{source.label}</span> : null}
              {source.quote ? <q>{source.quote}</q> : null}
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{t("result.viewSource")}<ArrowUpRight aria-hidden="true" size={13} /></a> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const renderLeadRow = (lead: RowLead, batchId: string, extended: boolean) => {
    const phone = whatsappPhone(lead);
    const socials = SOCIAL_PILLS.flatMap(({ id, label, Icon }) => {
      const url = getSocialProfileUrl(lead.socialProfiles, id);
      return url ? [{ id, label, Icon, url }] : [];
    });
    const pains = lead.id ? leadPains[lead.id] : undefined;
    const enrichState = lead.id ? leadEnrich[lead.id] : undefined;
    const website = lead.website ? cleanWebsite(lead.website) : null;
    const found = pains?.status === "done" ? pains.pains ?? [] : lead.pains;
    const proposals = pains?.status === "done" ? pains.proposals ?? [] : lead.proposals;
    const analyzed = pains?.status === "done" || lead.analyzed || lead.pains.length > 0;
    return (
      <li key={lead.id || lead.name}>
        <div className="ls-chat__result-row-head">
          <span className="ls-chat__result-name">
            <strong>{lead.name}</strong>
            {extended && (lead.category || lead.address) ? <small>{[lead.category, lead.address].filter(Boolean).join(" · ")}</small> : null}
          </span>
          {lead.id && !lead.enriched ? (
            <button type="button" className="ls-chat__result-analyze" onClick={() => void enrich(batchId, lead.id)} disabled={enrichState === "busy"} aria-label={t("result.enrichLead", { lead: lead.name })}>
              {enrichState === "busy" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={14} /> : <AtSign aria-hidden="true" size={14} />}
              <span>{enrichState === "busy" ? t("result.enriching") : enrichState === "error" ? t("result.enrichRetry") : t("result.enrich")}</span>
            </button>
          ) : null}
          {lead.id ? (
            <button type="button" className="ls-chat__result-analyze" onClick={() => setFocusAsk({ batchId, leadId: lead.id, value: serviceOffering })} disabled={pains?.status === "busy" || analyzed} aria-label={t("result.analyzeLead", { lead: lead.name })}>
              {pains?.status === "busy" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={14} /> : analyzed ? <Check aria-hidden="true" size={14} /> : <Sparkles aria-hidden="true" size={14} />}
              <span>{pains?.status === "busy" ? t("result.analyzing") : analyzed ? t("result.analyzedOne") : t("result.analyze")}</span>
            </button>
          ) : null}
        </div>
        <div className="ls-chat__result-contact">
          {phone ? <span className="compact-phone"><FaWhatsapp aria-hidden="true" /><WhatsAppContact phone={phone} /></span> : null}
          {lead.email ? <a className="ls-chat__result-email" href={`mailto:${lead.email}`}><Mail aria-hidden="true" size={13} />{lead.email}</a> : null}
          {extended && website ? <a className="ls-chat__result-email" href={website.href} target="_blank" rel="noreferrer"><Globe aria-hidden="true" size={13} />{website.label}</a> : null}
          {socials.map(({ id, label, Icon, url }) => (
            <a className={`social-pill is-${id}`} key={id} href={url} target="_blank" rel="noreferrer" title={url}><Icon aria-hidden="true" /><span>{label}</span></a>
          ))}
          {!phone && !lead.email && !socials.length && !(extended && website) ? <span>{t("result.noContact")}</span> : null}
        </div>
        {found.length ? (
          <div className="ls-chat__pains">
            <p className="ls-chat__pains-title"><Sparkles aria-hidden="true" size={13} />{t("result.pains")}</p>
            <ul className="ls-chat__pain-list">
              {found.map((pain, painIndex) => {
                const popId = `ls-chat-pain-${lead.id}-${painIndex}`;
                const open = painPop?.id === popId;
                return pain.sources.length || pain.detail ? (
                  <li key={pain.tag} className="ls-chat__tag-tip-item">
                    <button
                      type="button"
                      className={`ls-chat__pain${open ? " is-open" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={open}
                      aria-controls={open ? popId : undefined}
                      onClick={(event) => {
                        if (open) return setPainPop(null);
                        painAnchor.current = event.currentTarget;
                        setPainPop({ id: popId, pain });
                      }}
                    >{pain.tag}</button>
                  </li>
                ) : <li key={pain.tag}><span className="ls-chat__pain">{pain.tag}</span></li>;
              })}
            </ul>
            {proposals.length ? (
              <button type="button" className="ls-chat__proposals-open" aria-haspopup="dialog" onClick={() => setProposalLead({ id: lead.id, name: lead.name, pains: found, proposals })}>
                {t("result.viewProposal")}
              </button>
            ) : null}
          </div>
        )
          : pains?.status === "done" ? <p className="ls-chat__result-note">{t("result.noPains")}</p>
          : pains?.status === "error" ? <p className="ls-chat__result-note" role="alert">{t("result.analyzeError")}</p> : null}
      </li>
    );
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  };

  const examples: { text: string; channel: string; Icon: typeof Mail; shortcut?: PageShortcut }[] = variant === "page"
    ? PAGE_SHORTCUTS.map((shortcut) => ({ text: t(`shortcuts.${shortcut.key}.prompt`), channel: t(`shortcuts.${shortcut.key}.label`), Icon: shortcut.Icon, shortcut }))
    : [
      { text: t("example1"), channel: t("exampleChannel1"), Icon: MessageCircle },
      { text: t("example2"), channel: t("exampleChannel2"), Icon: Mail },
      { text: t("example3"), channel: t("exampleChannel3"), Icon: CalendarCheck },
    ];

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className={`ls-chat ls-chat--${variant}${messageQuota ? " has-quotas" : ""}${dragging ? " is-dragging" : ""}${leadDragging ? " is-lead-dragging" : ""}`} aria-labelledby="ls-chat-title" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {messageQuota ? (
        <div className="ls-chat__quotas" aria-label={`${t("quota.whatsapp")}, ${t("quota.gmail")}`}>
          {(["whatsapp", "gmail"] as const).map((channel) => {
            const usage = messageQuota[channel];
            const label = t(`quota.${channel}`);
            const monthly = channel === "whatsapp";
            return <MessageQuotaMeter key={channel} channel={channel} {...usage} label={label} today={t(monthly ? "quota.month" : "quota.today", usage)} description={t(monthly ? "quota.monthProgress" : "quota.progress", { channel: label, ...usage })} compact />;
          })}
          {messageQuota.ai ? <MessageQuotaMeter channel="ai" {...messageQuota.ai} label={t("quota.ai")} today={t("quota.aiTotal", messageQuota.ai)} description={t("quota.aiProgress", messageQuota.ai)} compact /> : null}
          <ScheduledButton />
        </div>
      ) : null}
      <div className="ls-chat__dropzone" aria-hidden="true">
        <div className="ls-chat__dropzone-inner">
          <FileUp size={28} />
          <p className="ls-chat__dropzone-title">{t("dropzone.title")}</p>
          <p className="ls-chat__dropzone-types">{t("dropzone.types")}</p>
        </div>
      </div>
      <div className="ls-chat__corner">
        {variant === "page" ? (
          <button type="button" className="ls-chat__corner-icon" onClick={() => window.dispatchEvent(new Event(LEADTITA_TOUR_EVENT))} aria-label={t("tour")} title={t("tour")}>
            <CircleHelp aria-hidden="true" size={18} />
          </button>
        ) : null}
        {variant === "page" ? (
          <button type="button" ref={historyButtonRef} className="ls-chat__corner-icon" onClick={toggleHistory} aria-expanded={historyOpen} aria-controls="ls-chat-history" aria-label={t("history.open")} title={t("history.open")}>
            <History aria-hidden="true" size={18} />
          </button>
        ) : null}
        <button type="button" className="ls-chat__new" onClick={startNewChat} disabled={!messages.length || sending} aria-label={t("newChat")}>
          <SquarePen aria-hidden="true" size={17} /><span>{t("newChat")}</span>
        </button>
        {historyOpen ? (
          <Popover open onClose={() => setHistoryOpen(false)} anchorRef={historyButtonRef} id="ls-chat-history" role="dialog" placement="bottom-end" className="ls-chat__history" aria-label={t("history.title")}>
            <div className="ls-chat__history-head">
              <p className="ls-chat__history-title">{t("history.title")}</p>
              {historyList.items.length > 0 ? (
                <button type="button" className="ls-chat__history-select-all" disabled={deletingConversations || sending} onClick={() => {
                  const allSelected = historyList.items.every((item) => selectedConversations.includes(item.id));
                  setSelectedConversations(allSelected ? [] : historyList.items.map((item) => item.id));
                  setConfirmDeleteSelected(false);
                  setConfirmDelete(null);
                }}>{historyList.items.every((item) => selectedConversations.includes(item.id)) ? t("history.deselectAll") : t("history.selectAll")}</button>
              ) : null}
            </div>
            {historyDeleteError ? <p className="ls-chat__history-error" role="alert">{t("history.deleteError")}</p> : null}
            {selectedConversations.length > 0 ? (
              <div className="ls-chat__history-bulk" role="group" aria-label={t("history.deleteSelected")}>
                {confirmDeleteSelected ? (
                  <>
                    <span>{t("history.confirmDeleteSelected", { count: selectedConversations.length })}</span>
                    <button type="button" disabled={deletingConversations || sending} onClick={() => setConfirmDeleteSelected(false)}>{t("cancelAction")}</button>
                    <button type="button" className="is-danger" disabled={deletingConversations || sending} onClick={() => void removeConversations(selectedConversations)}>{deletingConversations ? t("history.deleting") : t("deleteAction")}</button>
                  </>
                ) : (
                  <>
                    <span>{t("history.selected", { count: selectedConversations.length })}</span>
                    <button type="button" className="is-danger" disabled={deletingConversations || sending} onClick={() => setConfirmDeleteSelected(true)}><Trash2 aria-hidden="true" size={14} />{t("history.deleteSelected")}</button>
                  </>
                )}
              </div>
            ) : null}
            {historyList.items.length ? (
              <ul>
                {historyList.items.map((conversation, index) => (
                  <Fragment key={conversation.id}>
                  {index === 0 || historyGroup(historyList.items[index - 1].updatedAt, historyList.now) !== historyGroup(conversation.updatedAt, historyList.now) ? (
                    <li role="presentation" className="ls-chat__history-group">{t(`history.groups.${historyGroup(conversation.updatedAt, historyList.now)}`)}</li>
                  ) : null}
                  <li className={conversation.id === conversationId ? "is-current" : undefined}>
                    {confirmDelete === conversation.id ? (
                      <div className="ls-chat__history-confirm" role="group" aria-label={t("history.confirmDelete")}>
                        <span>{t("history.confirmDelete")}</span>
                        <button type="button" onClick={() => setConfirmDelete(null)}>{t("cancelAction")}</button>
                        <button type="button" className="is-danger" disabled={deletingConversations || sending} onClick={() => void removeConversations([conversation.id])}>{deletingConversations ? t("history.deleting") : t("deleteAction")}</button>
                      </div>
                    ) : (
                      <>
                        <input type="checkbox" className="ls-chat__history-check" checked={selectedConversations.includes(conversation.id)} disabled={deletingConversations || sending} aria-label={t("history.selectConversation", { title: conversation.title || t("untitled") })} onChange={() => toggleConversationSelection(conversation.id)} />
                        <button type="button" className="ls-chat__history-open" disabled={deletingConversations} onClick={() => openConversation(conversation)} aria-current={conversation.id === conversationId ? "true" : undefined}>
                          <MessageCircle aria-hidden="true" size={15} />
                          <span><strong>{conversation.title || t("untitled")}</strong>
                          <small>{relativeTime(conversation.updatedAt, historyList.now)}</small></span>
                        </button>
                        <button type="button" className="ls-chat__history-delete" disabled={deletingConversations || sending} onClick={() => { setSelectedConversations([]); setConfirmDeleteSelected(false); setConfirmDelete(conversation.id); }} aria-label={t("history.delete", { title: conversation.title || t("untitled") })}>
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      </>
                    )}
                  </li>
                  </Fragment>
                ))}
              </ul>
            ) : (
              <div className="ls-chat__history-empty">
                <span aria-hidden="true"><MessagesSquare size={18} /></span>
                <strong>{t("history.empty")}</strong>
                <small>{t("history.emptyHint")}</small>
              </div>
            )}
          </Popover>
        ) : null}
      </div>

      {variant === "page" ? (
        // Full page: no top bar. The brand mark + name live in the empty state; once chatting, the log takes the whole height.
        messages.length > 0 || sending ? <h1 id="ls-chat-title" className="ls-chat__sr">{t("pageTitle")}</h1> : null
      ) : (
        // Panel: no header bar (the collapse toggle floats top-right); the greeting lives in the empty state.
        <h2 id="ls-chat-title" className="ls-chat__sr">{t("title")}</h2>
      )}

      <ol className={`ls-chat__log${messages.length === 0 && !sending ? " ls-chat__log--empty" : ""}`} ref={listRef} aria-live="polite" aria-relevant="additions" aria-busy={sending}>
        {variant === "page" && (messages.length > 0 || sending) ? null : <li className="ls-chat__intro" data-onboarding="leadtita-intro">
          {variant === "page" ? (
            <div className="ls-chat__hero">
              {/* Same markup as BrandLogo without its home link: here it's a centered mark, not navigation. */}
              <span className="brand ls-chat__hero-logo" aria-hidden="true">Leadta<span className="brand-period">.</span></span>
              <h1 id="ls-chat-title" className="ls-chat__sr">{t("pageTitle")}</h1>
            </div>
          ) : null}
          {variant === "page" ? null : (
            <>
              <p className="ls-chat__intro-title">{t("introTitle")}</p>
              <p className="ls-chat__intro-text">{t("intro")}</p>
            </>
          )}
          <p className="ls-chat__examples-label" id="ls-chat-examples-label">{t("examplesLabel")}</p>
          <ul className="ls-chat__examples" aria-labelledby="ls-chat-examples-label">
            {examples.map(({ text, channel, Icon, shortcut }) => (
              <li key={text}>
                <button type="button" disabled={Boolean(shortcut) && sending} onClick={() => { if (shortcut) { runShortcut(shortcut, text); return; } setDraft(text); setDraftMentions([]); inputRef.current?.focus(); }} aria-label={`${t("useExample")}: ${text}`}>
                  <span className="ls-chat__example-icon" aria-hidden="true"><Icon size={16} /></span>
                  <span className="ls-chat__example-body">
                    <span className="ls-chat__example-channel">{channel}</span>
                    <span className="ls-chat__example-text">{text}</span>
                  </span>
                  <ArrowUpRight className="ls-chat__example-go" aria-hidden="true" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </li>}

        {messages.map((message, messageIndex) => {
          const grouped = messageIndex > 0 && messages[messageIndex - 1].role === message.role;
          return (
          <li key={message.id} className={`ls-chat__msg ls-chat__msg--${message.role}${grouped ? " is-grouped" : ""}`}>
            {message.role === "assistant" ? (
              <span className="ls-chat__avatar" aria-hidden="true">{grouped ? null : <BrandMark />}</span>
            ) : null}
            <div className="ls-chat__msg-body">
              <span className="ls-chat__sr">{message.role === "user" ? t("you") : t("assistant")}: </span>
              {message.content
                ? message.role === "assistant"
                  ? <div className="ls-chat__md">{renderMarkdown(message.content.replace(/!\[/g, "["))}</div>
                  : <p className="ls-chat__bubble">{renderUserMessage(message.content, message.leadMentions)}</p>
                : null}
              {message.progress?.length ? (
                <ul className="ls-chat__tool-progress" aria-label={t("toolProgress.label")}>
                  {message.progress.map((item) => <li key={item.id} role="status" aria-live="polite"><span className={`ls-chat__tool-progress-icon is-${item.status}`} aria-hidden="true">{item.status === "running" ? <LoaderCircle className="ls-chat__spin" size={14} /> : item.status === "done" ? <CircleCheck size={14} /> : <CircleAlert size={14} />}</span><span>{progressCopy(item)}</span></li>)}
                </ul>
              ) : null}
              {message.attachments?.length ? (
                <ul className="ls-chat__msg-files" aria-label={t("attachedFiles")}>
                  {message.attachments.map((attachment) => {
                    const Icon = KIND_ICON[attachment.kind];
                    const label = <><Icon aria-hidden="true" size={14} /><span>{attachment.name}</span></>;
                    return (
                      <li key={attachment.name}>
                        {attachment.preview ? <button type="button" onClick={() => setFilePreview(attachment)} aria-label={t("previewFile", { name: attachment.name })} aria-haspopup="dialog">{label}</button> : label}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {message.actions?.map((action, index) => {
                if (action.type === "pending_change") {
                  const { kind, leadName, data, before, extra = {}, review } = action.change;
                  const state = cards[action.token];
                  const spend = SPEND_KINDS.includes(kind);
                  const destructive = kind === "delete_contact" || kind === "filter_batch";
                  const credits = Number(extra.credits ?? 0);
                  const Icon = ACTION_ICON[kind];
                  const titleId = `ls-chat-action-${message.id}-${index}`;
                  const show = (key: keyof ChangeData, value: string | undefined) =>
                    !value ? "—" : key === "channel" ? t(`channels.${value}`) : key === "status" ? t(`statuses.${value}`) : key === "contactedAt" ? formatTime(value) : value;
                  const fields = (Object.keys(data) as (keyof ChangeData)[]).filter((key) => data[key] !== undefined && data[key] !== "");
                  const shortFields = fields.filter((key) => key !== "message" && key !== "notes");
                  const longFields = fields.filter((key) => key === "message" || key === "notes");
                  const lines = (key: string) => (typeof extra[key] === "string" ? String(extra[key]).split("\n").filter(Boolean) : []);
                  const tags = actionTags(kind, extra);
                  const quotaChannel: QuotaChannel | null = kind === "send_whatsapp_batch" ? "whatsapp" : kind === "send_email" || kind === "send_email_batch" ? "gmail" : null;
                  const settled = state === "done" || state === "cancelled" || state === "stale" || state === "expired";
                  const editable = EDITABLE_KINDS.includes(kind) && !settled && state !== "busy";
                  const edit = editOf(action.token, extra);
                  return (
                    <article key={action.token} className={`ls-chat__action${destructive ? " is-destructive" : ""}${state ? ` is-${state}` : ""}`} aria-labelledby={titleId} {...(kind === "search_businesses" ? { "data-onboarding": "leadtita-search", "data-state": state ?? "pending" } : {})}>
                      <header className="ls-chat__action-head">
                        <span className="ls-chat__action-icon" aria-hidden="true"><Icon size={18} /></span>
                        <h3 id={titleId}>{actionTitle(kind, leadName, extra)}</h3>
                      </header>

                      {quotaChannel && messageQuota ? (() => {
                        const usage = messageQuota[quotaChannel];
                        const label = t(`quota.${quotaChannel}`);
                        const remaining = Math.max(0, usage.limit - usage.used);
                        const monthly = quotaChannel === "whatsapp";
                        return <MessageQuotaMeter channel={quotaChannel} {...usage} label={label} today={t.rich(monthly ? "quota.monthRemaining" : "quota.remaining", { count: remaining, n: (chunks) => <b>{chunks}</b> })} detail={t(monthly ? "quota.monthSent" : "quota.sent", usage)} description={t(monthly ? "quota.monthProgress" : "quota.progress", { channel: label, ...usage })} />;
                      })() : null}

                      {spend ? (
                        <p className="ls-chat__cost">
                          <Coins aria-hidden="true" size={18} />
                          <span><strong>{credits > 0 ? t("creditsMax", { count: credits }) : t("free")}</strong>{credits > 0 ? <small>{t("chargedOnlyDelivered")}</small> : null}</span>
                        </p>
                      ) : null}
                      {spend && credits > 0 && balance !== null && balance < credits && !settled && state !== "busy" && state !== "no_credits" ? (
                        <p className="ls-chat__credit-warning" role="status">
                          <CircleAlert aria-hidden="true" size={16} />
                          <span>{balance === 0 ? t("creditWarning.none") : t("creditWarning.low", { available: balance, required: credits })} <Link className="ls-chat__error-link" href="/pricing">{t("buyCredits")}</Link></span>
                        </p>
                      ) : null}

                      {kind === "search_businesses" && keywordsOf(extra).length ? (() => {
                        const all = keywordsOf(extra);
                        const removed = removedKeywords[action.token] ?? [];
                        const kept = all.filter((keyword) => !removed.includes(keyword));
                        const editable = !settled && state !== "busy" && kept.length > 1;
                        return (
                          <ul className="ls-chat__keywords" aria-label={t("keywords.label")}>
                            {kept.map((keyword, keywordIndex) => {
                              const tipId = `ls-chat-kw-${message.id}-${index}-${keywordIndex}`;
                              return (
                                <li key={keyword}>
                                  <span className="ls-chat__keyword" tabIndex={0} {...tipProps(tipId, t("keywords.hint", { keyword }))}><Search aria-hidden="true" size={13} />{keyword}</span>
                                  {editable ? (
                                    <button type="button" className="ls-chat__keyword-remove" onClick={() => setRemovedKeywords((current) => ({ ...current, [action.token]: [...(current[action.token] ?? []), keyword] }))} aria-label={t("keywords.remove", { keyword })}>
                                      <X aria-hidden="true" size={13} />
                                    </button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })() : null}
                      {tags.length ? renderChips(tags, `ls-chat-action-${message.id}-${index}`) : null}

                      {shortFields.length ? (
                        <dl className="ls-chat__facts">
                          {shortFields.map((key) => (
                            <div key={key}>
                              <dt>{t(`fields.${key}`)}</dt>
                              <dd>
                                {before && before[key] !== undefined && before[key] !== data[key] ? <s>{show(key, before[key])}</s> : null}
                                <span>{show(key, data[key])}</span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {longFields.map((key) => (
                        <blockquote key={key} className="ls-chat__quote" aria-label={t(`fields.${key}`)}>{data[key]}</blockquote>
                      ))}

                      {(["doubtful", "preview"] as const).map((key) => lines(key).length && !(key === "preview" && review) ? (
                        <details key={key} className={`ls-chat__more${key === "doubtful" ? " is-doubtful" : ""}`} open={key === "doubtful"}>
                          <summary>{t(`fields.${key}`)}</summary>
                          <ul>{lines(key).map((line) => <li key={line}>{line}</li>)}</ul>
                        </details>
                      ) : null)}

                      {kind === "send_email" ? (
                        <div className="ls-chat__draft-edit">
                          <label><span>{t("emailCard.to")}</span><input type="email" value={String(edit.to)} onChange={(event) => setEdit(action.token, "to", event.target.value)} disabled={!editable} maxLength={254} /></label>
                          <label><span>{t("emailCard.subject")}</span><input type="text" value={String(edit.subject)} onChange={(event) => setEdit(action.token, "subject", event.target.value)} disabled={!editable} maxLength={200} /></label>
                          <label><span>{t("emailCard.body")}</span><textarea value={String(edit.body)} onChange={(event) => setEdit(action.token, "body", event.target.value)} disabled={!editable} maxLength={5000} rows={7} /></label>
                        </div>
                      ) : kind === "create_meeting" ? (
                        <div className="ls-chat__draft-edit">
                          <label><span>{t("meetingCard.title")}</span><input type="text" value={String(edit.title)} onChange={(event) => setEdit(action.token, "title", event.target.value)} disabled={!editable} maxLength={200} /></label>
                          <div className="ls-chat__draft-row">
                            <label><span>{t("meetingCard.start")}</span><input type="datetime-local" value={String(edit.start)} onChange={(event) => setEdit(action.token, "start", event.target.value)} disabled={!editable} /></label>
                            <label><span>{t("meetingCard.duration")}</span>
                              <select value={String(edit.durationMinutes)} onChange={(event) => setEdit(action.token, "durationMinutes", event.target.value)} disabled={!editable}>
                                {[15, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{t("meetingCard.minutes", { minutes })}</option>)}
                              </select>
                            </label>
                          </div>
                          <label className="ls-chat__check"><input type="checkbox" checked={Boolean(edit.meet)} onChange={(event) => setEdit(action.token, "meet", event.target.checked)} disabled={!editable} /><span>{t("meetingCard.meet")}</span></label>
                          {extra.attendee ? <label className="ls-chat__check"><input type="checkbox" checked={Boolean(edit.invite)} onChange={(event) => setEdit(action.token, "invite", event.target.checked)} disabled={!editable} /><span>{t("meetingCard.invite", { email: String(extra.attendee) })}</span></label> : null}
                        </div>
                      ) : null}
                      {review ? <BatchReview channel={kind === "send_email_batch" ? "email" : "whatsapp"} original={review} state={reviewOf(action.token, review)} disabled={settled || state === "busy"} onChange={(next) => setBatchReviews((current) => ({ ...current, [action.token]: next }))} /> : null}
                      {kind === "send_email_batch" ? <p className="ls-chat__action-note">{t("emailCard.batchNote", { seconds: 20 })}</p>
                        : kind === "send_whatsapp_batch" ? <p className="ls-chat__action-note">{t("whatsappCard.batchNote", { min: 45, max: 120 })}</p> : null}
                      {SCHEDULABLE_KINDS.includes(kind) && !settled ? <SchedulePicker value={scheduleOf(action.token, extra)} disabled={state === "busy"} onChange={(next) => setScheduleAt((current) => ({ ...current, [action.token]: next }))} /> : null}

                      {destructive && !settled ? <p className="ls-chat__action-note">{t("irreversible")}</p> : null}

                      <footer className="ls-chat__action-foot" aria-live="polite">
                        {state === "done" ? (
                          <p className="ls-chat__action-status is-done"><CircleCheck aria-hidden="true" size={16} />{t("statusConfirmed")}</p>
                        ) : state === "cancelled" ? (
                          <p className="ls-chat__action-status"><Ban aria-hidden="true" size={16} />{t("statusCancelled")}</p>
                        ) : state === "expired" ? (
                          <p className="ls-chat__action-status"><Ban aria-hidden="true" size={16} />{t("statusExpired")}</p>
                        ) : state === "needs_gmail" || state === "needs_calendar" ? (
                          <div className="ls-chat__action-connect" role="status">
                            <p>{t(state === "needs_gmail" ? "googleNeeds.gmail" : "googleNeeds.calendar")}</p>
                            <GoogleFeatureConnectButton feature={state === "needs_gmail" ? "gmail" : "calendar"} returnTo="/leadtita" />
                          </div>
                        ) : state === "needs_whatsapp" ? (
                          <div className="ls-chat__drive-connect">
                            <p className="ls-chat__action-note">{t("whatsappNeeds")}</p>
                            <WhatsAppConnectCard compact />
                          </div>
                        ) : state === "stale" ? (
                          <p className="ls-chat__action-status" role="status">{t("staleChange")}</p>
                        ) : state === "busy" ? (
                          <div className="ls-chat__action-progress" role="status">
                            <span className="ls-chat__progress-bar" aria-hidden="true" />
                            <span>{spend ? t("running") : t("confirming")}</span>
                          </div>
                        ) : (
                          <>
                            {state === "error" || state === "no_credits" ? (
                              <p className="ls-chat__action-error" role="alert">
                                <CircleAlert aria-hidden="true" size={16} />
                                <span>{cardErrors[action.token] ?? t("confirmErrors.generic")}{state === "no_credits" ? <> <Link className="ls-chat__error-link" href="/pricing">{t("buyCredits")}</Link></> : null}</span>
                              </p>
                            ) : null}
                            <div className="ls-chat__action-buttons">
                              <button type="button" className="ls-chat__action-secondary" onClick={() => cancel(action.token)}>{t("cancelAction")}</button>
                              {(() => {
                                const when = SCHEDULABLE_KINDS.includes(kind) ? scheduleOf(action.token, extra) : null;
                                const count = review ? batchReviewCount(reviewOf(action.token, review)) : 1;
                                const blocked = (Boolean(review) && !batchReviewReady(reviewOf(action.token, review!), kind === "send_email_batch" ? "email" : "whatsapp")) || (when !== null && !sendAtValid(when));
                                return (
                                  <button type="button" className="ls-chat__action-primary" disabled={blocked} onClick={() => void confirm(action.token, kind, leadName, tags)}>
                                    {state === "error" || state === "no_credits" ? <RotateCcw aria-hidden="true" size={16} /> : destructive ? <Trash2 aria-hidden="true" size={16} /> : when ? <CalendarClock aria-hidden="true" size={16} /> : review ? <Send aria-hidden="true" size={16} /> : <Check aria-hidden="true" size={16} />}
                                    {state === "error" || state === "no_credits" ? t("retry") : destructive ? t("deleteAction") : when ? t("schedule.confirm", { count }) : review ? t("batchReview.send", { count }) : t("confirmAction")}
                                  </button>
                                );
                              })()}
                            </div>
                          </>
                        )}
                      </footer>
                    </article>
                  );
                }
                if (action.type === "batch_result") {
                  const state = results[action.batchId] ?? {};
                  const titleId = `ls-chat-result-${message.id}-${index}`;
                  return (
                    <article key={index} className="ls-chat__result" aria-labelledby={titleId}>
                      <header className="ls-chat__action-head">
                        <span className="ls-chat__action-icon is-done" aria-hidden="true"><CircleCheck size={18} /></span>
                        <div>
                          <h3 id={titleId}>{t(`result.title.${action.kind}`, { count: action.count })}</h3>
                          {action.charged > 0 ? <p className="ls-chat__result-meta"><Coins aria-hidden="true" size={14} />{t("result.charged", { count: action.charged })}</p> : null}
                        </div>
                      </header>
                      {action.tags.length ? renderChips(action.tags, `ls-chat-result-${message.id}-${index}`) : null}
                      {action.kind !== "search_people" && serviceOffering ? <p className="ls-chat__result-focus">{t("filters.focus", { focus: serviceOffering })}</p> : null}
                      {(() => {
                        const rows = batchLeads[action.batchId] ?? action.preview.map(rowFromPreview);
                        return rows.length ? (
                          <ul className="ls-chat__result-rows is-scroll" aria-label={t("result.preview")} tabIndex={0}>
                            {rows.map((lead) => renderLeadRow(lead, action.batchId, false))}
                          </ul>
                        ) : null;
                      })()}
                      <div className="ls-chat__result-actions">
                        <button type="button" className="ls-chat__result-primary" onClick={() => { setModalQuery(""); setModal({ batchId: action.batchId, kind: action.kind, count: action.count }); }}>{t("result.viewMore")}<Maximize2 aria-hidden="true" size={15} /></button>
                        <button type="button" onClick={() => void download(action.batchId, "xlsx")} disabled={Boolean(state.download)}>
                          {state.download === "xlsx" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}{t("result.xlsx")}
                        </button>
                        <button type="button" onClick={() => void download(action.batchId, "csv")} disabled={Boolean(state.download)}>
                          {state.download === "csv" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}{t("result.csv")}
                        </button>
                        {action.kind !== "search_people" ? (
                          <button type="button" onClick={() => setFocusAsk({ batchId: action.batchId, value: serviceOffering })} disabled={state.analyze === "busy" || state.analyze === "done"}>
                            {state.analyze === "busy" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : <Sparkles aria-hidden="true" size={15} />}
                            {state.analyze === "busy" ? t("result.analyzing") : t("result.analyzeBatch")}
                          </button>
                        ) : null}
                        {action.kind !== "search_people" ? (
                          <button type="button" onClick={() => void enrich(action.batchId)} disabled={state.enrich === "busy" || state.enrich === "done"}>
                            {state.enrich === "busy" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : <AtSign aria-hidden="true" size={15} />}
                            {state.enrich === "busy" ? t("result.enriching") : t("result.enrichBatch")}
                          </button>
                        ) : null}
                      </div>
                      <p className="ls-chat__result-status" role="status">
                        {state.downloadError ? t("result.downloadError")
                          : state.analyze === "done" && state.analyzed ? t("result.analyzed", { analyzed: state.analyzed.analyzed, findings: state.analyzed.findings })
                          : state.analyze === "error" ? t("result.analyzeError")
                          : state.enrich === "done" ? t("result.enrichDone", { count: state.enriched ?? 0 })
                          : state.enrich === "error" ? state.enrichError || t("result.enrichError")
                          : ""}
                      </p>
                    </article>
                  );
                }
                if (action.type === "message_suggestions") {
                  return (
                    <div key={index} className="ls-chat__drafts" role="group" aria-label={t("draftsFor", { lead: action.leadName })}>
                      {action.messages.map((draftMessage, draftIndex) => {
                        const key = `${message.id}-${index}-${draftIndex}`;
                        const full = draftMessage.subject ? `${draftMessage.subject}\n\n${draftMessage.text}` : draftMessage.text;
                        const ChannelIcon = draftMessage.channel === "email" ? SiGmail : SiWhatsapp;
                        const canSend = action.sendChannels?.[draftMessage.channel] === true;
                        const hasRecipient = action.hasRecipient?.[draftMessage.channel] === true;
                        const sendState = draftSendState[key];
                        return (
                          <article key={key} className="ls-chat__draft">
                            <header>
                              <span className="ls-chat__draft-channel"><ChannelIcon className={`is-${draftMessage.channel}`} aria-hidden="true" size={15} />{t(`channels.${draftMessage.channel}`)}{action.messages.length > 1 ? <em>{t("option", { n: draftIndex + 1 })}</em> : null}</span>
                              <button type="button" className={copied === key ? "is-copied" : undefined} onClick={() => void copy(key, full)} aria-label={t("copyDraft", { n: draftIndex + 1 })}>
                                {copied === key ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
                                {copied === key ? t("copied") : t("copy")}
                              </button>
                            </header>
                            {draftMessage.subject ? <p className="ls-chat__draft-subject">{draftMessage.subject}</p> : null}
                            <p className="ls-chat__draft-text">{draftMessage.text}</p>
                            {canSend ? (
                              <div className="ls-chat__draft-send-row">
                                <button type="button" className={`ls-chat__draft-send is-${draftMessage.channel}`} disabled={!hasRecipient || sendState === "busy"} onClick={() => void prepareDraftSend(action, draftMessage, key)}>
                                  {sendState === "busy" ? <LoaderCircle aria-hidden="true" size={15} className="ls-chat__spin" /> : <Send aria-hidden="true" size={15} />}
                                  {t(`draftSend.${draftMessage.channel}`)}
                                </button>
                                {!hasRecipient ? <span className="ls-chat__draft-send-hint">{t(`draftSend.missing${draftMessage.channel === "email" ? "Email" : "Whatsapp"}`)}</span> : null}
                                {sendState && sendState !== "busy" ? (
                                  <span className="ls-chat__draft-send-error" role="alert">
                                    {t(`draftSend.errors.${sendState}`)}
                                    {sendState === "needs_gmail" || sendState === "needs_whatsapp" ? <> <Link className="ls-chat__error-link" href="/integraciones">{t("draftSend.connect")}</Link></> : null}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                      <span className="ls-chat__sr" role="status" aria-live="polite">{copied ? t("copied") : ""}</span>
                    </div>
                  );
                }
                if (action.type === "google_feature_connect") {
                  // The email/meeting card already offers the connect button when confirming; don't repeat it.
                  if (message.actions?.some((item) => item.type === "pending_change" && ["send_email", "send_email_batch", "create_meeting"].includes(item.change.kind))) return null;
                  return (
                    <div key={index} className="ls-chat__action-connect">
                      <p>{t(`googleNeeds.${action.feature}`)}</p>
                      <GoogleFeatureConnectButton feature={action.feature} returnTo="/leadtita" />
                    </div>
                  );
                }
                if (action.type === "whatsapp_connect") {
                  // One per message, and none when a WhatsApp batch card in the same message already offers it on confirm.
                  if (message.actions?.some((item) => item.type === "pending_change" && item.change.kind === "send_whatsapp_batch")) return null;
                  if (message.actions?.findIndex((item) => item.type === "whatsapp_connect") !== index) return null;
                  return <div key={index} className="ls-chat__drive-connect"><WhatsAppConnectCard compact /></div>;
                }
                if (action.type === "google_connect") {
                  return <div key={index} className="ls-chat__drive-connect"><GoogleDriveConnect compact returnTo="/leadtita" /></div>;
                }
                if (action.type === "drive_file") {
                  return (
                    <p key={index} className="ls-chat__drive-read">
                      <SiGoogledrive aria-hidden="true" className="ls-chat__drive-icon" />
                      <span>{t("drive.read", { name: action.name })}</span>
                      {action.kind === "csv" ? <small>{t("csvRows", { count: action.rows })}</small> : null}
                    </p>
                  );
                }
                if (action.type === "lead_candidates" && action.candidates.length) {
                  return (
                    <div key={index} className="ls-chat__options" role="group" aria-label={t("chooseLead")}>
                      {action.candidates.slice(0, 3).map((lead) => (
                        <button key={lead.name} type="button" disabled={sending} onClick={() => send(t("pickReply", { name: lead.name }))}>
                          <span><strong>{lead.name}</strong>{[lead.category, lead.city].filter(Boolean).length ? <small>{[lead.category, lead.city].filter(Boolean).join(" · ")}</small> : null}</span>
                          <ChevronRight aria-hidden="true" size={16} />
                        </button>
                      ))}
                    </div>
                  );
                }
                return null;
              })}
              {message.at ? <time className="ls-chat__time" dateTime={new Date(message.at).toISOString()}>{formatClock(message.at)}</time> : null}
            </div>
          </li>
          );
        })}

        {sending ? (
          <li className={`ls-chat__msg ls-chat__msg--assistant ls-chat__typing${messages[messages.length - 1]?.role === "assistant" ? " is-grouped" : ""}`} role="status">
            <span className="ls-chat__avatar" aria-hidden="true"><BrandMark /></span>
            <div className="ls-chat__msg-body">
              <span className="ls-chat__dots" aria-hidden="true"><span /><span /><span /></span>
              <span className="ls-chat__sr">{t("typing")}</span>
            </div>
          </li>
        ) : null}
        {sending && progress.length ? (
          <li className="ls-chat__tool-progress-active">
            <ul className="ls-chat__tool-progress" aria-label={t("toolProgress.label")}>
              {progress.map((item) => <li key={item.id} role="status" aria-live="polite"><span className={`ls-chat__tool-progress-icon is-${item.status}`} aria-hidden="true">{item.status === "running" ? <LoaderCircle className="ls-chat__spin" size={14} /> : item.status === "done" ? <CircleCheck size={14} /> : <CircleAlert size={14} />}</span><span>{progressCopy(item)}</span></li>)}
            </ul>
          </li>
        ) : null}
      </ol>


      {modal ? (() => {
        const rows = batchLeads[modal.batchId] ?? [];
        const query = modalQuery.trim().toLowerCase();
        const visible = query ? rows.filter((lead) => [lead.name, lead.category, lead.address, lead.email, lead.phone].some((value) => value.toLowerCase().includes(query))) : rows;
        const state = results[modal.batchId] ?? {};
        return (
          <dialog ref={modalRef} className="ls-chat__batch-dialog" aria-labelledby="ls-chat-batch-title" onClose={() => setModal(null)} onClick={(event) => { if (event.target === event.currentTarget) modalRef.current?.close(); }}>
            <div className="ls-chat__batch-body">
              <header className="ls-chat__batch-head">
                <h2 id="ls-chat-batch-title">{t(`result.title.${modal.kind}`, { count: modal.count })}</h2>
                <button type="button" className="ls-chat__batch-close" onClick={() => modalRef.current?.close()} aria-label={t("result.close")}><X aria-hidden="true" size={18} /></button>
              </header>
              <div className="ls-chat__batch-tools">
                <label className="ls-chat__batch-search">
                  <Search aria-hidden="true" size={16} />
                  <span className="ls-chat__sr">{t("result.filter")}</span>
                  <input type="search" value={modalQuery} onChange={(event) => setModalQuery(event.target.value)} placeholder={t("result.filter")} />
                </label>
                <div className="ls-chat__result-actions">
                  <button type="button" onClick={() => void download(modal.batchId, "xlsx")} disabled={Boolean(state.download)}>
                    {state.download === "xlsx" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}{t("result.xlsx")}
                  </button>
                  <button type="button" onClick={() => void download(modal.batchId, "csv")} disabled={Boolean(state.download)}>
                    {state.download === "csv" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}{t("result.csv")}
                  </button>
                  <a className="ls-chat__result-primary" href={batchHref(modal.kind, modal.batchId)}>{t("result.openInHistory")}<ArrowUpRight aria-hidden="true" size={15} /></a>
                </div>
              </div>
              {rows.length ? (
                <ul className="ls-chat__result-rows ls-chat__batch-rows" aria-label={t("result.preview")}>
                  {visible.map((lead) => renderLeadRow(lead, modal.batchId, true))}
                  {!visible.length ? <li className="ls-chat__result-note">{t("result.noMatch")}</li> : null}
                </ul>
              ) : <p className="ls-chat__result-note" role="status"><LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> {t("result.loading")}</p>}
            </div>
          </dialog>
        );
      })() : null}
      {proposalLead ? (
        <dialog ref={proposalRef} className="ls-chat__batch-dialog ls-chat__proposal-dialog" aria-labelledby="ls-chat-proposal-title" onClose={() => setProposalLead(null)} onClick={(event) => { if (event.target === event.currentTarget) proposalRef.current?.close(); }}>
          <div className="ls-chat__batch-body">
            <header className="ls-chat__batch-head">
              <h2 id="ls-chat-proposal-title">{t("result.proposalTitle", { lead: proposalLead.name })}</h2>
              <button type="button" className="ls-chat__batch-close" onClick={() => proposalRef.current?.close()} aria-label={t("result.close")}><X aria-hidden="true" size={18} /></button>
            </header>
            <div className="ls-chat__proposal-scroll">
              {proposalLead.pains.length ? (
                <section aria-labelledby="ls-chat-proposal-pains">
                  <h3 id="ls-chat-proposal-pains" className="ls-chat__pains-title"><Sparkles aria-hidden="true" size={13} />{t("result.pains")}</h3>
                  <ul className="ls-chat__proposal-pains">
                    {proposalLead.pains.map((pain) => (
                      <li key={pain.tag}>
                        <strong>{pain.tag}</strong>
                        {renderPainSources(pain)}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section aria-labelledby="ls-chat-proposal-list">
                <h3 id="ls-chat-proposal-list" className="ls-chat__pains-title">{t("result.proposals")}</h3>
                {proposalLead.proposals.map((proposal) => {
                  const key = `${proposalLead.id}-${proposal.variant}`;
                  return (
                    <div key={proposal.variant} className="ls-chat__proposal">
                      <p><strong>{proposal.service}</strong></p>
                      <p className="ls-chat__proposal-message">{proposal.message}</p>
                      <button type="button" onClick={() => void copy(key, proposal.message)} className={copied === key ? "is-copied" : undefined}>
                        {copied === key ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
                        {copied === key ? t("copied") : t("copy")}
                      </button>
                    </div>
                  );
                })}
              </section>
            </div>
          </div>
        </dialog>
      ) : null}
      {focusAsk ? (
        <dialog ref={focusRef} className="ls-chat__batch-dialog ls-chat__focus-dialog" aria-labelledby="ls-chat-focus-title" onClose={() => setFocusAsk(null)} onClick={(event) => { if (event.target === event.currentTarget) focusRef.current?.close(); }}>
          <form className="ls-chat__batch-body ls-chat__focus-form" onSubmit={submitFocus}>
            <header className="ls-chat__batch-head">
              <h2 id="ls-chat-focus-title">{t("result.focusTitle")}</h2>
              <button type="button" className="ls-chat__batch-close" onClick={() => focusRef.current?.close()} aria-label={t("result.close")}><X aria-hidden="true" size={18} /></button>
            </header>
            <label htmlFor="ls-chat-focus-input">{t("result.focusHint")}</label>
            <input id="ls-chat-focus-input" value={focusAsk.value} onChange={(event) => setFocusAsk({ ...focusAsk, value: event.target.value })} placeholder={t("result.focusPlaceholder")} required minLength={3} maxLength={300} autoFocus />
            <div className="ls-chat__action-buttons">
              <button type="button" className="ls-chat__action-secondary" onClick={() => focusRef.current?.close()}>{t("result.focusCancel")}</button>
              <button type="submit" className="ls-chat__action-primary"><Sparkles aria-hidden="true" size={14} />{t("result.focusSubmit")}</button>
            </div>
          </form>
        </dialog>
      ) : null}
      {filePreview?.preview ? (
        <dialog ref={filePreviewRef} className="ls-chat__batch-dialog" aria-labelledby="ls-chat-file-preview-title" onClose={() => setFilePreview(null)} onClick={(event) => { if (event.target === event.currentTarget) filePreviewRef.current?.close(); }}>
          <div className="ls-chat__batch-body">
            <header className="ls-chat__batch-head">
              <div className="ls-chat__file-preview-title">
                <h2 id="ls-chat-file-preview-title">{filePreview.name}</h2>
                <p>
                  {t("previewSummary", { rows: filePreview.csv?.totalRows ?? filePreview.preview.rows.length, cols: filePreview.preview.headers.length })}
                  {(filePreview.csv?.totalRows ?? 0) > filePreview.preview.rows.length ? ` · ${t("previewShowing", { count: filePreview.preview.rows.length })}` : ""}
                </p>
              </div>
              <button type="button" className="ls-chat__batch-close" onClick={() => filePreviewRef.current?.close()} aria-label={t("previewClose")}><X aria-hidden="true" size={18} /></button>
            </header>
            <div className="ls-chat__file-preview-scroll" tabIndex={0} role="region" aria-labelledby="ls-chat-file-preview-title">
              <table className="ls-chat__file-preview-table">
                <thead><tr>{filePreview.preview.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead>
                <tbody>
                  {filePreview.preview.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </dialog>
      ) : null}
      {painPop ? (
        <Popover open onClose={() => setPainPop(null)} anchorRef={painAnchor} id={painPop.id} role="dialog" placement="top-start" className="ls-chat__tooltip-pop ls-chat__source-pop" aria-label={painPop.pain.tag}>
          {renderPainSources(painPop.pain)}
        </Popover>
      ) : null}
      {tip ? (
        <Popover open onClose={() => setTip(null)} anchorRef={tipAnchor} id={tip.id} role="dialog" initialFocus="none" placement="top-start" className="ls-chat__tooltip-pop" aria-label={tip.text}>
          <span role="tooltip">{tip.text}</span>
        </Popover>
      ) : null}
      {unseen ? (
        <button type="button" className="ls-chat__jump" onClick={() => scrollToEnd("smooth")}>
          <ArrowDown aria-hidden="true" size={16} />{t("jumpToLatest")}
        </button>
      ) : null}

      {failed && contextFull ? (
        <div className="ls-chat__error ls-chat__error--context" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span><strong>{t("contextFull.title")}</strong> {t("contextFull.body")}</span>
          <button type="button" className="ls-chat__error-primary" onClick={startNewChat}>
            <SquarePen aria-hidden="true" size={14} />{t("newChat")}
          </button>
          <button type="button" onClick={() => void request(failed.history, failed.turnId)}>
            <RotateCcw aria-hidden="true" size={14} />{t("retry")}
          </button>
        </div>
      ) : failed && aiLimit === "ai_daily_limit" ? (
        <div className="ls-chat__error ls-chat__error--context" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span><strong>{t("aiLimit.title", { limit: messageQuota?.ai?.limit ?? 100 })}</strong> {t("aiLimit.body")}</span>
          <Link className="ls-chat__error-primary" href="/pricing">
            <Sparkles aria-hidden="true" size={14} />{t("aiLimit.cta")}
          </Link>
        </div>
      ) : failed ? (
        <div className="ls-chat__error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span>{aiLimit === "ai_rate_limit" ? t("aiLimit.rate") : t(`sendErrors.${failed.reason}`)}</span>
          <button type="button" onClick={() => void request(failed.history, failed.turnId)}>
            <RotateCcw aria-hidden="true" size={14} />{t("retry")}
          </button>
          {!aiLimit && (failed.reason === "error" || failed.reason === "service") ? <ErrorReportButton message={t(`sendErrors.${failed.reason}`)} action="lead_suite_chat" /> : null}
        </div>
      ) : null}

      <form className="ls-chat__form" onSubmit={onSubmit} ref={formRef} data-onboarding="leadtita-composer">
        <div
          className="ls-chat__composer"
          onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); inputRef.current?.focus(); } }}
        >
          {chips.length ? (
            <ul className="ls-chat__chips" aria-label={t("attachedFiles")} aria-live="polite">
              {chips.map((chip) => {
                const Icon = chip.context ? KIND_ICON[chip.context.kind] : FileText;
                const rows = chip.context?.csv ? chip.context.csv.totalRows : null;
                return (
                  <li key={chip.id} className={`ls-chat__chip-file is-${chip.status}`}>
                    {chip.status === "uploading" ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} /> : chip.status === "error" ? <CircleAlert aria-hidden="true" size={15} /> : <Icon aria-hidden="true" size={15} />}
                    {chip.context?.preview
                      ? <button type="button" className="ls-chat__chip-name ls-chat__chip-preview" onClick={() => setFilePreview(chip.context!)} aria-label={t("previewFile", { name: chip.name })} aria-haspopup="dialog">{chip.name}</button>
                      : <span className="ls-chat__chip-name">{chip.name}</span>}
                    <span className="ls-chat__chip-meta">
                      {chip.status === "uploading" ? t("attachReading")
                        : chip.status === "error" ? chip.error
                        : [t(`kinds.${chip.context!.kind}`), formatSize(chip.size), rows !== null ? t("csvRows", { count: rows }) : "", chip.context!.truncated ? t("truncated") : ""].filter(Boolean).join(" · ")}
                    </span>
                    <button type="button" onClick={() => setChips((current) => current.filter((item) => item.id !== chip.id))} aria-label={t("removeFile", { name: chip.name })}>
                      <X aria-hidden="true" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <label htmlFor="ls-chat-input" className="ls-chat__sr">{t("inputLabel")}</label>
          <div className="ls-chat__input-wrap">
            <div ref={mentionMirrorRef} className="ls-chat__input-highlight" aria-hidden="true">
              {renderUserMessage(draft, draftMentions)}{draft.endsWith("\n") ? "\n" : ""}
            </div>
            <textarea
              id="ls-chat-input"
              ref={inputRef}
              className={fade ? "has-fade" : undefined}
              value={draft}
              rows={1}
              maxLength={MAX_CHARS}
              placeholder={narrow || variant === "panel" ? t("placeholderShort") : tipIndex === 0 ? t("placeholder") : placeholderTips[tipIndex - 1]}
              onChange={(event) => { updateDraft(event.target.value, event.target.selectionStart); }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={updateFade}
              aria-describedby="ls-chat-keyboard-hint"
              aria-autocomplete={mention ? "list" : undefined}
              aria-controls={mention ? "ls-chat-mentions" : undefined}
              aria-activedescendant={mention && mentionLeads[mentionIndex] ? `ls-chat-mention-${mentionLeads[mentionIndex].id}` : undefined}
            />
          </div>
          <div className="ls-chat__toolbar">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="ls-chat__sr"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => { void addFiles([...(event.target.files ?? [])]); event.target.value = ""; focusComposer(); }}
            />
            <div className="ls-chat__attach-wrap">
              <button type="button" ref={attachButtonRef} className="ls-chat__attach" onClick={() => setAttachMenu((current) => (current ? "" : "menu"))} disabled={sending} aria-label={t("attach")} title={t("attachHint")} aria-haspopup="menu" aria-expanded={attachMenu !== ""}>
                <Plus aria-hidden="true" size={20} />
              </button>
              {attachMenu === "menu" ? (
                <Popover open onClose={() => setAttachMenu("")} anchorRef={attachButtonRef} role="menu" placement="top-start" className="ls-chat__attach-menu" aria-label={t("attach")}>
                  <p className="ls-chat__attach-section">{t("attachMenu.attachTitle")}</p>
                  <button type="button" role="menuitem" onClick={() => { setAttachMenu(""); fileInputRef.current?.click(); }}>
                    <Upload aria-hidden="true" size={17} /><span>{t("attachMenu.upload")}<small>{t("attachMenu.uploadHint")}</small></span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => setAttachMenu("drive")}>
                    <SiGoogledrive aria-hidden="true" className="ls-chat__drive-icon" /><span>{t("attachMenu.drive")}<small>{t("attachMenu.driveHint")}</small></span>
                  </button>
                  <AttachIntegrations onOpen={() => setAttachMenu("")} />
                </Popover>
              ) : attachMenu === "drive" ? (
                <Popover open onClose={() => setAttachMenu("")} anchorRef={attachButtonRef} role="dialog" placement="top-start" className="ls-chat__drive-panel" aria-label={t("attachMenu.drive")}>
                  <GoogleDriveConnect compact returnTo="/leadtita" onPicked={(files) => { setAttachMenu(""); files.filter((file) => !chips.some((chip) => chip.name === file.name && chip.status !== "error")).forEach((file) => void addDriveFile(file)); }} />
                </Popover>
              ) : null}
            </div>
            <button type="button" className="ls-chat__attach ls-chat__mention-trigger" onClick={insertMentionTrigger} disabled={sending} aria-label={t("mentionButton")} title={t("mentionButton")}>
              <AtSign aria-hidden="true" size={18} />
            </button>
            <ChatControls mode={assistantMode} onModeChange={writeMode} salesChannel={salesChannel} onSalesChannelChange={setSalesChannel} onResumeTyping={() => inputRef.current?.focus({ preventScroll: true })} onChannelsChange={setChannelsReady} />
            <button type="submit" className="ls-chat__send" disabled={sending || chips.some((chip) => chip.status === "uploading") || (!draft.trim() && !chips.some((chip) => chip.status === "ready"))} aria-label={sending ? t("sending") : t("send")}>
              {sending ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={18} /> : <ArrowUp aria-hidden="true" size={18} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
        <LeadMentionPopover
          anchorRef={inputRef}
          // A multi-word query with no results is just text: hide instead of showing "no matches" under a sentence.
          open={Boolean(mention) && !(mention?.query.includes(" ") && !mentionLoading && !mentionLeads.length)}
          query={mention?.query ?? ""}
          leads={mentionLeads}
          loading={mentionLoading}
          activeIndex={mentionIndex}
          onSelect={chooseMention}
          onDismiss={() => { if (mention) mentionDismissed.current = mention.start; setMention(null); }}
          labels={{ title: t("mentionResults"), recent: t("mentionRecent"), start: t("mentionStart"), loading: t("mentionLoading"), empty: t("mentionEmpty"), fallback: t("mentionLead"), hint: t("mentionKeys") }}
          statusLabel={(status) => t(`statuses.${status}`)}
          batchLabel={(iso) => t("mentionBatch", { date: new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" }) })}
        />
        <p className="ls-chat__sr" id="ls-chat-keyboard-hint">{t("hint")}</p>
      </form>
    </section>
  );
}
