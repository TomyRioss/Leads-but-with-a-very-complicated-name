"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarRange, CircleAlert, LoaderCircle, Megaphone, Pencil, Plus, Power, PowerOff, RefreshCw, Save, Trash2 } from "lucide-react";
import { CAMPAIGN_FEATURES, isLive, type Campaign, type CampaignFeature } from "@/lib/campaigns";
import "@/app/campaign-banner.css";
import {
  cardClass, controlClass, countBadge, dangerButton, errorBox, ghostButton, hintText, isUnauthorized, mutedText, ownerFetch,
  primaryButton, sectionHead, sectionTitle, smallButton, stateBox, titleDot, useOwnerFormat, type OnAction,
} from "../ui";

type CampaignState = "live" | "scheduled" | "expired" | "inactive";
type Field = "name" | "label" | "message" | "discountPercent" | "features" | "startsAt" | "endsAt";
type Form = {
  name: string; label: string; message: string; discountPercent: string; allFeatures: boolean;
  features: CampaignFeature[]; startsAt: string; endsAt: string; active: boolean;
};
type RangeFormatter = (startsAt: string, endsAt: string) => string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LIMITS = { name: 120, label: 40, message: 200 } as const;

const fieldError = "inline-flex items-start gap-1 text-[11px] font-semibold text-(color:--ash-950)";
const invalidControl = "aria-invalid:border-(color:--ash-950) aria-invalid:bg-(--ash-50)";
const legendClass = "mb-3.5 p-0 text-[13px] font-[680] tracking-[-0.01em]";
const groupClass = "m-0 grid min-w-0 gap-3.5 border-0 border-b border-(color:--ash-150) p-0 pb-5 last:border-b-0 last:pb-0";
const segmentClass = "inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-md px-3.5 text-xs font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-(color:--ash-950) sm:flex-none";
const chipBase = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold";
const scopeChip = "inline-flex items-center whitespace-nowrap rounded-full border border-(color:--line) bg-(--ash-50) px-2 py-0.5 text-[11px] font-medium text-(color:--ash-800)";
// Semantic tones: live = brand accent, scheduled = neutral strong, inactive = outlined, expired = recessed.
const stateTone: Record<CampaignState, string> = {
  live: "bg-(--lime) text-(color:--ink)",
  scheduled: "bg-(--ash-200) text-(color:--ash-900)",
  inactive: "border border-(color:--ash-300) bg-(--paper) text-(color:--ash-700)",
  expired: "bg-(--ash-150) text-(color:--ash-700)",
};
const stateOrder: Record<CampaignState, number> = { live: 0, scheduled: 1, inactive: 2, expired: 3 };

const parseDate = (value: string) => Date.parse(value.replace(" ", "T"));

function campaignState(campaign: Pick<Campaign, "active" | "startsAt" | "endsAt">, now: number): CampaignState {
  if (!campaign.active) return "inactive";
  if (isLive(campaign, now)) return "live";
  return parseDate(campaign.startsAt) > now ? "scheduled" : "expired";
}

/** Live first (strongest discount on top, like the public banner), then upcoming, inactive and expired. */
function sortCampaigns(items: Campaign[], now: number) {
  return items
    .map((campaign) => ({ campaign, state: campaignState(campaign, now) }))
    .sort((a, b) => {
      if (a.state !== b.state) return stateOrder[a.state] - stateOrder[b.state];
      const x = a.campaign;
      const y = b.campaign;
      if (a.state === "live") return y.discountPercent - x.discountPercent || parseDate(x.endsAt) - parseDate(y.endsAt);
      if (a.state === "scheduled") return parseDate(x.startsAt) - parseDate(y.startsAt);
      if (a.state === "inactive") return parseDate(y.startsAt) - parseDate(x.startsAt);
      return parseDate(y.endsAt) - parseDate(x.endsAt);
    });
}

/** Whole units until `target`: days, else hours, else minutes (at least 1). */
function remaining(target: number, now: number): { unit: "days" | "hours" | "minutes"; count: number } {
  const diff = Math.max(0, target - now);
  if (diff >= DAY) return { unit: "days", count: Math.floor(diff / DAY) };
  if (diff >= HOUR) return { unit: "hours", count: Math.floor(diff / HOUR) };
  return { unit: "minutes", count: Math.max(1, Math.ceil(diff / MINUTE)) };
}

/** Short local date range ("15 nov, 10:00 – 22 nov, 23:59"); the year only shows when it is not the current one. */
function useRangeFormat(): RangeFormatter {
  const locale = useLocale();
  return useMemo(() => {
    const tag = locale === "en" ? "en-US" : "es-AR";
    const base: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
    const short = new Intl.DateTimeFormat(tag, base);
    const withYear = new Intl.DateTimeFormat(tag, { ...base, year: "numeric" });
    const year = new Date().getFullYear();
    return (startsAt, endsAt) => {
      const start = parseDate(startsAt);
      const end = parseDate(endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
      const from = new Date(start);
      const to = new Date(end);
      const format = from.getFullYear() === year && to.getFullYear() === year ? short : withYear;
      return end > start ? format.formatRange(from, to) : `${format.format(from)} – ${format.format(to)}`;
    };
  }, [locale]);
}

/** ISO → value for <input type="datetime-local"> in the viewer's local time. */
function toLocalInput(iso: string) {
  const time = parseDate(iso);
  if (!Number.isFinite(time)) return "";
  return new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** datetime-local value (viewer's local time) → ISO, or "" when empty/invalid. */
function fromLocalInput(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function toForm(campaign: Campaign): Form {
  return {
    name: campaign.name, label: campaign.label, message: campaign.message, discountPercent: String(campaign.discountPercent),
    allFeatures: campaign.allFeatures, features: campaign.features, startsAt: toLocalInput(campaign.startsAt), endsAt: toLocalInput(campaign.endsAt), active: campaign.active,
  };
}

/** Mirrors the server validation so most mistakes are caught before the request. */
function validate(form: Form): Field | null {
  const percent = Number(form.discountPercent);
  if (!form.name.trim() || form.name.trim().length > LIMITS.name) return "name";
  if (form.label.trim().length > LIMITS.label) return "label";
  if (!form.message.trim() || form.message.trim().length > LIMITS.message) return "message";
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return "discountPercent";
  if (!form.allFeatures && form.features.length === 0) return "features";
  if (!fromLocalInput(form.startsAt)) return "startsAt";
  if (!fromLocalInput(form.endsAt) || Date.parse(fromLocalInput(form.startsAt)) >= Date.parse(fromLocalInput(form.endsAt))) return "endsAt";
  return null;
}

/** Maps the API's 400 `field` onto the form field that shows the message. */
function toField(field: string | undefined): Field | null {
  if (field === "allFeatures") return "features";
  return field && (["name", "label", "message", "discountPercent", "features", "startsAt", "endsAt"] as string[]).includes(field) ? field as Field : null;
}

const toBody = (form: Form) => ({
  name: form.name.trim(), label: form.label.trim(), message: form.message.trim(), discountPercent: Number(form.discountPercent),
  allFeatures: form.allFeatures, features: form.allFeatures ? [] : form.features,
  startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), active: form.active,
});

/** Same markup and styles as the public strip (app/campaign-banner), made static for the preview. */
function BannerStrip({ label, message, placeholder }: { label: string; message: string; placeholder?: boolean }) {
  return (
    <div className="campaign-banner static! z-auto! rounded-lg">
      {label ? (
        <span className="campaign-banner__pill">
          <Megaphone size={14} strokeWidth={2.2} aria-hidden="true" />
          <span className="campaign-banner__label">{label}</span>
        </span>
      ) : null}
      {message ? <p className={`campaign-banner__message${placeholder ? " opacity-60" : ""}`}>{message}</p> : null}
    </div>
  );
}

function StateChip({ state }: { state: CampaignState }) {
  const t = useTranslations("Owner.campaigns");
  return (
    <span className={`${chipBase} ${stateTone[state]}`}>
      {state === "live" && <span className="size-1.5 rounded-full bg-(--ash-950)" aria-hidden="true" />}
      {t(`state.${state}`)}
    </span>
  );
}

function ScopeChips({ allFeatures, features }: Pick<Campaign, "allFeatures" | "features">) {
  const t = useTranslations("Owner.campaigns");
  if (allFeatures) return <span className={scopeChip}>{t("scopeAll")}</span>;
  return <>{features.map((feature) => <span key={feature} className={scopeChip}>{t(`features.${feature}`)}</span>)}</>;
}

function LiveHighlight({ campaign, others, now, formatRange }: { campaign: Campaign; others: number; now: number; formatRange: RangeFormatter }) {
  const t = useTranslations("Owner.campaigns");
  const left = remaining(parseDate(campaign.endsAt), now);
  return (
    <section aria-labelledby="campaign-live-title" className="mb-5 grid gap-4 rounded-[10px] border border-(color:--line) bg-(--paper) p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6 md:p-5">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StateChip state="live" />
          <h2 id="campaign-live-title" className="m-0 min-w-0 break-words text-base font-[680] tracking-[-0.01em]">{campaign.name}</h2>
        </div>
        <BannerStrip label={campaign.label} message={campaign.message} />
        <div className="flex flex-wrap items-center gap-1.5">
          <ScopeChips allFeatures={campaign.allFeatures} features={campaign.features} />
          <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-(color:--ash-800)">
            <CalendarRange size={14} aria-hidden="true" /> {formatRange(campaign.startsAt, campaign.endsAt)}
          </span>
        </div>
        {others > 0 && <p className={`${mutedText} m-0`}>{t("liveMore", { count: others })}</p>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 md:grid md:justify-items-end md:text-right">
        <span className="whitespace-nowrap text-4xl font-[680] leading-none tracking-[-0.03em] tabular-nums">{t("percentOff", { value: campaign.discountPercent })}</span>
        <span className="text-xs font-semibold text-(color:--ash-800)">{t(`endsIn.${left.unit}`, { count: left.count })}</span>
      </div>
    </section>
  );
}

export default function CampaignsSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const t = useTranslations("Owner.campaigns");
  const common = useTranslations("Owner.common");
  const { formatNumber, errorText } = useOwnerFormat();
  const formatRange = useRangeFormat();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [confirmId, setConfirmId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef(0);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; });

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const result = await ownerFetch<{ items: Campaign[] }>("/api/owner/campaigns");
    if (id !== requestId.current) return;
    setLoading(false);
    setNow(Date.now());
    if (isUnauthorized(result.status)) return unauthorizedRef.current();
    if (result.ok) { setItems(result.data.items); setError(""); }
    else setError(errorText(result.data.error, t("loadError")));
  }, [errorText, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
  useEffect(() => { void load(); }, [load]);
  // Keeps states, "ends in" and the form's state preview current.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => (items ? sortCampaigns(items, now) : []), [items, now]);
  const liveCount = rows.filter((row) => row.state === "live").length;

  async function toggle(campaign: Campaign) {
    setBusyId(campaign.id);
    setActionError("");
    const result = await ownerFetch(`/api/owner/campaigns/${encodeURIComponent(campaign.id)}`, { method: "PATCH", body: { active: !campaign.active } });
    setBusyId("");
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok) return setActionError(errorText(result.data.error, common("actionError")));
    onAction?.(t(campaign.active ? "deactivated" : "activated", { name: campaign.name }));
    void load();
  }

  async function remove(campaign: Campaign) {
    setBusyId(campaign.id);
    setActionError("");
    const result = await ownerFetch(`/api/owner/campaigns/${encodeURIComponent(campaign.id)}`, { method: "DELETE" });
    setBusyId("");
    setConfirmId("");
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok) return setActionError(errorText(result.data.error, common("actionError")));
    onAction?.(t("deleted", { name: campaign.name }));
    void load();
  }

  function cancelDelete(id: string) {
    setConfirmId("");
    window.requestAnimationFrame(() => document.getElementById(`campaign-delete-${id}`)?.focus());
  }

  if (editing !== null) {
    return (
      <CampaignForm
        campaign={editing === "new" ? null : editing}
        formatRange={formatRange}
        now={now}
        onUnauthorized={onUnauthorized}
        onClose={(saved) => {
          setEditing(null);
          if (saved) { onAction?.(saved); void load(); }
        }}
      />
    );
  }

  const newButton = <button className={primaryButton} type="button" onClick={() => setEditing("new")}><Plus size={15} aria-hidden="true" /> {t("newCampaign")}</button>;

  return (
    <section aria-label={t("title")} className="max-w-6xl">
      <div className={`${sectionHead} mb-1.5!`}>
        <h1 className={sectionTitle}>{t("title")}<span className={titleDot} aria-hidden="true">.</span>{items ? <span className={countBadge}>{formatNumber(items.length)}</span> : null}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className={ghostButton} type="button" onClick={() => void load()} disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} {common("refresh")}
          </button>
          {newButton}
        </div>
      </div>
      <p className={`${mutedText} mb-5 mt-0 max-w-[75ch] leading-normal`}>{t("intro")}</p>
      {(error || actionError) && <p className={errorBox} role="alert">{actionError || error}</p>}

      {!items && loading && <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}

      {items && items.length === 0 && (
        <div className={`${cardClass} grid justify-items-start gap-3 px-5 py-8 md:px-8`}>
          <span className="grid size-10 place-items-center rounded-full bg-(--lime) text-(color:--ink)" aria-hidden="true"><Megaphone size={18} /></span>
          <h2 className="m-0 text-base font-[680] tracking-[-0.01em]">{t("emptyTitle")}</h2>
          <p className="m-0 max-w-[60ch] text-[13px] leading-normal text-(color:--muted)">{t("empty")}</p>
          {newButton}
        </div>
      )}

      {rows.length > 0 && (
        <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
          {rows[0].state === "live" && <LiveHighlight campaign={rows[0].campaign} others={liveCount - 1} now={now} formatRange={formatRange} />}
          <ul className="m-0 list-none overflow-hidden rounded-[10px] border border-(color:--line) bg-(--paper) p-0" aria-label={t("listLabel")}>
            {rows.map(({ campaign, state }) => {
              const busy = busyId === campaign.id;
              const recessed = state === "expired" || state === "inactive";
              const timing = state === "live" ? remaining(parseDate(campaign.endsAt), now) : state === "scheduled" ? remaining(parseDate(campaign.startsAt), now) : null;
              return (
                <li key={campaign.id} className="grid grid-cols-[minmax(5.25rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-3 border-b border-(color:--ash-150) px-4 py-3.5 last:border-b-0 hover:bg-(--ash-50) md:grid-cols-[6rem_minmax(0,1fr)_auto] md:items-center md:gap-x-4">
                  <span className={`whitespace-nowrap text-lg font-[680] leading-tight tracking-[-0.02em] tabular-nums ${recessed ? "text-(color:--muted)" : ""}`}>
                    {t("percentOff", { value: campaign.discountPercent })}
                  </span>
                  <div className="grid min-w-0 gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-sm font-semibold">{campaign.name}</span>
                      <StateChip state={state} />
                    </div>
                    <p className="m-0 truncate text-xs text-(color:--muted)" title={campaign.message}>
                      {campaign.label && <span className="font-semibold text-(color:--ash-800)">{campaign.label} · </span>}
                      {campaign.message}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ScopeChips allFeatures={campaign.allFeatures} features={campaign.features} />
                      <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-(color:--ash-800)">
                        <CalendarRange size={13} aria-hidden="true" /> {formatRange(campaign.startsAt, campaign.endsAt)}
                      </span>
                      {timing && <span className="text-[11px] font-semibold text-(color:--ash-900)">· {t(`${state === "live" ? "endsIn" : "startsIn"}.${timing.unit}`, { count: timing.count })}</span>}
                    </div>
                  </div>
                  {confirmId === campaign.id ? (
                    <div
                      className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 md:col-span-1"
                      role="group"
                      aria-label={t("deleteLabel", { name: campaign.name })}
                      onKeyDown={(event) => { if (event.key === "Escape" && !busy) cancelDelete(campaign.id); }}
                    >
                      <span className="text-xs font-semibold">{t("confirmDeleteQuestion")}</span>
                      <button className={`${dangerButton} ${smallButton}`} type="button" disabled={busy} onClick={() => void remove(campaign)} autoFocus>
                        {busy ? <><LoaderCircle className="animate-spin" size={14} aria-hidden="true" /> {common("deleting")}</> : <><Trash2 size={14} aria-hidden="true" /> {t("confirmDelete")}</>}
                      </button>
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={() => cancelDelete(campaign.id)}>{common("cancel")}</button>
                    </div>
                  ) : (
                    <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 md:col-span-1">
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={Boolean(busyId)} onClick={() => setEditing(campaign)}><Pencil size={14} aria-hidden="true" /> {t("edit")}</button>
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={Boolean(busyId)} onClick={() => void toggle(campaign)}>
                        {busy ? <LoaderCircle className="animate-spin" size={14} aria-hidden="true" /> : campaign.active ? <PowerOff size={14} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
                        {" "}{campaign.active ? t("deactivate") : t("activate")}
                      </button>
                      <button id={`campaign-delete-${campaign.id}`} className={`${ghostButton} ${smallButton}`} type="button" disabled={Boolean(busyId)} onClick={() => setConfirmId(campaign.id)} aria-label={t("deleteLabel", { name: campaign.name })} title={t("deleteLabel", { name: campaign.name })}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return <span id={id} className={fieldError}><CircleAlert className="mt-px shrink-0" size={13} aria-hidden="true" /> {message}</span>;
}

function CampaignForm({ campaign, formatRange, now, onClose, onUnauthorized }: { campaign: Campaign | null; formatRange: RangeFormatter; now: number; onClose: (saved?: string) => void; onUnauthorized: () => void }) {
  const t = useTranslations("Owner.campaigns");
  const common = useTranslations("Owner.common");
  const { errorText } = useOwnerFormat();
  const [form, setForm] = useState<Form>(() => campaign ? toForm(campaign) : {
    name: "", label: t("defaultLabel"), message: "", discountPercent: "", allFeatures: true, features: [], startsAt: "", endsAt: "", active: true,
  });
  const [invalid, setInvalid] = useState<Field | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setInvalid(null);
  };
  const toggleFeature = (feature: CampaignFeature, checked: boolean) =>
    set("features", CAMPAIGN_FEATURES.filter((item) => (item === feature ? checked : form.features.includes(item))));

  const fieldMessages: Record<Field, string> = {
    name: t("errors.name"), label: t("errors.label"), message: t("errors.message"), discountPercent: t("errors.discountPercent"),
    features: t("errors.features"), startsAt: t("errors.startsAt"), endsAt: t("errors.endsAt"),
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const field = validate(form);
    setInvalid(field);
    setSaveError("");
    if (field) {
      formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
      return;
    }
    setSaving(true);
    const result = await ownerFetch<{ campaign: Campaign; field?: string }>(
      campaign ? `/api/owner/campaigns/${encodeURIComponent(campaign.id)}` : "/api/owner/campaigns",
      { method: campaign ? "PATCH" : "POST", body: toBody(form) },
    );
    setSaving(false);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok) {
      const serverField = toField(result.data.field);
      if (serverField) {
        setInvalid(serverField);
        formRef.current?.querySelector<HTMLElement>(`[data-field="${serverField}"]`)?.focus();
      }
      return setSaveError(result.status === 404 ? t("notFound") : errorText(result.data.error, t("saveError")));
    }
    onClose(t(campaign ? "updated" : "created", { name: result.data.campaign.name }));
  }

  const errorId = (field: Field) => `campaign-${field}-error`;
  const describedBy = (field: Field, ...ids: string[]) => [...ids, invalid === field ? errorId(field) : ""].filter(Boolean).join(" ") || undefined;
  const errorFor = (field: Field) => invalid === field && <FieldError id={errorId(field)} message={fieldMessages[field]} />;

  const textField = (field: "name" | "label" | "message", options: { hint?: string; placeholder?: string; required?: boolean }) => {
    const id = `campaign-${field}`;
    const max = LIMITS[field];
    return (
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-xs font-semibold">{t(field)}</label>
          <span id={`${id}-count`} className="text-[11px] tabular-nums text-(color:--ash-700)">{t("chars", { count: form[field].length, max })}</span>
        </div>
        <input
          id={id}
          data-field={field}
          className={`${controlClass} ${invalidControl}`}
          value={form[field]}
          maxLength={max}
          required={options.required}
          placeholder={options.placeholder}
          aria-invalid={invalid === field || undefined}
          aria-describedby={describedBy(field, ...(options.hint ? [`${id}-hint`] : []), `${id}-count`)}
          onChange={(event) => set(field, event.target.value)}
        />
        {options.hint && <span id={`${id}-hint`} className={hintText}>{options.hint}</span>}
        {errorFor(field)}
      </div>
    );
  };

  const dateField = (field: "startsAt" | "endsAt") => (
    <div className="grid gap-1.5">
      <label htmlFor={`campaign-${field}`} className="text-xs font-semibold">{t(field)}</label>
      <input
        id={`campaign-${field}`}
        data-field={field}
        className={`${controlClass} ${invalidControl} tabular-nums`}
        type="datetime-local"
        required
        value={form[field]}
        min={field === "endsAt" ? form.startsAt || undefined : undefined}
        aria-invalid={invalid === field || undefined}
        aria-describedby={describedBy(field, "campaign-timezone-hint")}
        onChange={(event) => set(field, event.target.value)}
      />
      {errorFor(field)}
    </div>
  );

  const startsIso = fromLocalInput(form.startsAt);
  const endsIso = fromLocalInput(form.endsAt);
  const percent = Number(form.discountPercent);
  const previewState = startsIso && endsIso && Date.parse(startsIso) < Date.parse(endsIso)
    ? campaignState({ active: form.active, startsAt: startsIso, endsAt: endsIso }, now)
    : null;
  const message = form.message.trim();
  const title = campaign ? t("editTitle") : t("newTitle");

  return (
    <section aria-label={title} className="max-w-6xl">
      <div className={sectionHead}>
        <h1 className={sectionTitle}>{title}<span className={titleDot} aria-hidden="true">.</span></h1>
      </div>
      <form ref={formRef} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-6" onSubmit={(event) => void submit(event)} noValidate>
        <div className={`${cardClass} grid gap-5 md:p-5 lg:col-start-1`}>
          <fieldset className={groupClass}>
            <legend className={legendClass}>{t("groupBanner")}</legend>
            <div className="grid gap-3.5 sm:grid-cols-2">
              {textField("name", { hint: t("nameHint"), required: true })}
              {textField("label", { hint: t("labelHint") })}
            </div>
            {textField("message", { placeholder: t("messagePlaceholder"), required: true })}
          </fieldset>

          <fieldset className={groupClass}>
            <legend className={legendClass}>{t("discount")}</legend>
            <div className="grid gap-1.5">
              <label htmlFor="campaign-discountPercent" className="text-xs font-semibold">{t("discountPercent")}</label>
              <div className="relative sm:max-w-40">
                <input
                  id="campaign-discountPercent"
                  data-field="discountPercent"
                  className={`${controlClass} ${invalidControl} pr-9 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  required
                  value={form.discountPercent}
                  aria-invalid={invalid === "discountPercent" || undefined}
                  aria-describedby={describedBy("discountPercent", "campaign-discountPercent-hint")}
                  onChange={(event) => set("discountPercent", event.target.value)}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[13px] font-semibold text-(color:--ash-700)" aria-hidden="true">%</span>
              </div>
              <span id="campaign-discountPercent-hint" className={hintText}>{t("discountHint")}</span>
              {errorFor("discountPercent")}
            </div>
          </fieldset>

          <fieldset className={groupClass} aria-describedby={invalid === "features" ? errorId("features") : undefined}>
            <legend className={legendClass}>{t("scope")}</legend>
            <div className="flex w-full gap-1 rounded-lg border border-(color:--ash-300) bg-(--paper) p-0.5 sm:w-fit">
              {[true, false].map((all) => {
                const checked = form.allFeatures === all;
                return (
                  <label key={String(all)} className={`${segmentClass} ${checked ? "bg-(--lime) text-(color:--ink)" : "text-(color:--ash-800) hover:bg-(--ash-100)"}`}>
                    <input
                      type="radio"
                      name="campaign-scope"
                      className="sr-only"
                      checked={checked}
                      data-field={!all && form.allFeatures ? "features" : undefined}
                      onChange={() => set("allFeatures", all)}
                    />
                    {all ? t("scopeAll") : t("scopeFeatures")}
                  </label>
                );
              })}
            </div>
            {!form.allFeatures && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("scopeFeatures")}>
                {CAMPAIGN_FEATURES.map((feature, index) => (
                  <label
                    key={feature}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-(color:--ash-300) bg-(--paper) px-3 text-[13px] hover:bg-(--ash-50) has-checked:border-(color:--ash-950) has-checked:bg-(--ash-50) has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-(color:--ash-950)"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-(--ash-950) focus-visible:outline-none"
                      data-field={index === 0 ? "features" : undefined}
                      checked={form.features.includes(feature)}
                      onChange={(event) => toggleFeature(feature, event.target.checked)}
                    />
                    {t(`features.${feature}`)}
                  </label>
                ))}
              </div>
            )}
            {errorFor("features")}
          </fieldset>

          <fieldset className={groupClass}>
            <legend className={legendClass}>{t("window")}</legend>
            <div className="grid gap-3.5 sm:grid-cols-2">
              {dateField("startsAt")}
              {dateField("endsAt")}
            </div>
            <p id="campaign-timezone-hint" className={`${hintText} m-0`}>{t("timezoneHint")}</p>
            <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-(color:--line) bg-(--ash-50) px-3.5 py-3">
              <span className="grid gap-0.5">
                <span className="text-[13px] font-semibold">{t("active")}</span>
                <span className={hintText}>{t("activeHint")}</span>
              </span>
              <input type="checkbox" role="switch" className="sr-only" checked={form.active} onChange={(event) => set("active", event.target.checked)} />
              <span className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-(--ash-300) transition-colors group-has-checked:bg-(--ash-950) group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-(color:--ash-950) motion-reduce:transition-none" aria-hidden="true">
                <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-(--paper) shadow-[0_1px_2px_rgb(23_25_24/0.25)] transition-transform group-has-checked:translate-x-4 group-has-checked:bg-(--lime) motion-reduce:transition-none" />
              </span>
            </label>
          </fieldset>
        </div>

        <aside aria-label={t("preview")} className="grid gap-3 self-start rounded-[10px] border border-(color:--line) bg-(--paper) p-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <span className="text-xs font-semibold">{t("preview")}</span>
          <BannerStrip label={form.label.trim()} message={message || t("messagePlaceholder")} placeholder={!message} />
          <dl className="m-0 grid gap-2.5 border-t border-(color:--ash-150) pt-3 text-xs">
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2">
              <dt className="text-(color:--muted)">{t("discount")}</dt>
              <dd className="m-0 text-lg font-[680] leading-none tracking-[-0.02em] tabular-nums">
                {Number.isInteger(percent) && percent >= 1 && percent <= 100 ? t("percentOff", { value: percent }) : "—"}
              </dd>
            </div>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2">
              <dt className="text-(color:--muted)">{t("scope")}</dt>
              <dd className="m-0 flex flex-wrap gap-1.5">
                {form.allFeatures || form.features.length > 0 ? <ScopeChips allFeatures={form.allFeatures} features={form.features} /> : "—"}
              </dd>
            </div>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2">
              <dt className="text-(color:--muted)">{t("window")}</dt>
              <dd className="m-0 font-semibold">{previewState ? formatRange(startsIso, endsIso) : "—"}</dd>
            </div>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2">
              <dt className="text-(color:--muted)">{common("status")}</dt>
              <dd className="m-0">{previewState ? <StateChip state={previewState} /> : "—"}</dd>
            </div>
          </dl>
        </aside>

        <div className="grid gap-3 lg:col-start-1">
          {saveError && <p className={`${errorBox} m-0!`} role="alert">{saveError}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={primaryButton} type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />} {saving ? common("saving") : t("save")}
            </button>
            <button className={ghostButton} type="button" disabled={saving} onClick={() => onClose()}>{common("cancel")}</button>
          </div>
        </div>
      </form>
    </section>
  );
}
