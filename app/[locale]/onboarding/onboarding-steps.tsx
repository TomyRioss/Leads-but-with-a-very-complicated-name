"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock, CreditCard, Loader2, MapPin, Pencil, Plus, Sparkles, X } from "lucide-react";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import { Link } from "@/i18n/navigation";
import { Favicon } from "@/app/[locale]/explorar/explore-steps";
import { WhatsAppConnectCard } from "@/app/whatsapp-connect";
import { GoogleFeatureConnectButton } from "@/app/google-drive-connect";
import { FREE_LIMITS, UNKNOWN_PLAN_LIMITS, getSubscriptionPlan, type PlanLimits } from "@/lib/plans";
import { TRIAL_DAYS } from "@/lib/trial";
import type { Business, BusinessMarket, ProposalChannel } from "@/lib/workspace/types";
import type { SessionUser } from "@/lib/client/session";

// Piezas del onboarding de un negocio (contrato: lib/workspace/types.ts). Cada paso arma su borrador local y llama onSubmit(data).
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)";
export const PRIMARY = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-(--lime) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--lime-dark) disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-(--lime) ${FOCUS}`;
export const SECONDARY = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-(color:--line) bg-(--paper) px-4 text-sm font-semibold text-(color:--ink) hover:bg-(--ash-50) disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const LABEL = "text-[11px] font-semibold tracking-[0.08em] text-(color:--muted) uppercase";
const INPUT = `min-h-11 w-full rounded-lg border border-(color:--line) bg-(--paper) px-3 text-[15px] text-(color:--ink) placeholder:text-(color:--ash-500) ${FOCUS} focus-visible:outline-offset-0`;
const FIELD_LABEL = "mb-1.5 block text-sm font-semibold text-(color:--ink)";

const WHATSAPP_GREEN = "#25D366";
const GMAIL_RED = "#EA4335";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

/** fetch JSON sin cache. error: el código del contrato ({error}) o "network". */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, error: typeof payload?.error === "string" ? payload.error : "" };
    return { ok: true, status: response.status, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export function cleanDomain(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
}

/** Negocio guardado antes de salir a Google: la vuelta llega a /onboarding sin query y retoma este negocio. */
export const RESUME_KEY = "leadta.onboarding.business";

export type StepNav = { busy: boolean; error: string; onBack?: () => void };

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-[#f1c7c2] bg-[#fff6f5] px-3 py-2.5 text-sm text-[#8a1c12]">
      <CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{message}
    </p>
  );
}

/** Pie de cada paso: "Atrás" y el primario. blocked = se ve deshabilitado pero el clic avisa qué falta (onBlocked). */
export function StepFooter({ nav, label, onContinue, blocked = false, onBlocked, hint }: {
  nav: StepNav;
  label: string;
  onContinue: () => void;
  blocked?: boolean;
  onBlocked?: () => void;
  hint?: ReactNode;
}) {
  const t = useTranslations("BusinessOnboarding");
  return (
    <div className="border-t border-(color:--line) px-5 py-4 sm:px-10">
      {nav.error ? <div className="mb-3"><ErrorNote message={nav.error} /></div> : null}
      {hint ? <div className="mb-3 text-sm text-(color:--muted)">{hint}</div> : null}
      <div className="flex items-center justify-between gap-3">
        {nav.onBack ? (
          <button type="button" className={SECONDARY} onClick={nav.onBack} disabled={nav.busy}>
            <ArrowLeft size={16} aria-hidden="true" />{t("back")}
          </button>
        ) : <span />}
        <button
          type="button"
          className={PRIMARY}
          disabled={nav.busy}
          aria-disabled={blocked || undefined}
          onClick={() => (blocked ? onBlocked?.() : onContinue())}
        >
          {nav.busy ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("saving")}</> : <>{label}<ArrowRight size={16} aria-hidden="true" /></>}
        </button>
      </div>
    </div>
  );
}

function StepBody({ children }: { children: ReactNode }) {
  return <div className="space-y-7 px-5 py-6 sm:px-10 sm:py-8">{children}</div>;
}

function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(color:--line) bg-(--ash-50) py-1 pr-1 pl-3 text-sm text-(color:--ash-800)">
      <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className={`grid size-7 shrink-0 place-items-center rounded-full text-(color:--ash-600) hover:bg-(--ash-150) hover:text-(color:--ink) ${FOCUS}`}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : <span className="w-2" />}
    </li>
  );
}

/** Input + "Agregar"; Enter también agrega. */
function AddInput({ label, placeholder, addLabel, onAdd }: { label: string; placeholder: string; addLabel: string; onAdd: (value: string) => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  function submit(event?: FormEvent) {
    event?.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    onAdd(clean);
    setValue("");
  }
  return (
    <div className="mt-3">
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          className={INPUT}
          value={value}
          placeholder={placeholder}
          maxLength={120}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submit(event); }}
        />
        <button type="button" className={`${SECONDARY} shrink-0`} onClick={() => submit()} aria-label={label}>
          <Plus size={16} aria-hidden="true" /><span className="hidden sm:inline">{addLabel}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Paso 1 ────────────────────────────────────────────────────────────────

export function CompanyStep({ business, nav, onSubmit }: { business: Business; nav: StepNav; onSubmit: (data: { name: string; summary: string; competitors: Business["competitors"] }) => void }) {
  const t = useTranslations("BusinessOnboarding.company");
  const tRoot = useTranslations("BusinessOnboarding");
  const nameId = useId();
  const summaryId = useId();
  const [name, setName] = useState(business.name);
  const [summary, setSummary] = useState(business.summary);
  const [competitors, setCompetitors] = useState(business.competitors ?? []);
  const [nameError, setNameError] = useState(false);

  function addCompetitor(value: string) {
    const looksLikeDomain = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(value.replace(/^https?:\/\//i, ""));
    const domain = looksLikeDomain ? cleanDomain(value) : "";
    const label = domain ? domain.split(".")[0] : value;
    const item = { name: label.charAt(0).toUpperCase() + label.slice(1), domain };
    setCompetitors((list) => (list.some((c) => (domain && c.domain === domain) || c.name.toLowerCase() === item.name.toLowerCase()) ? list : [...list, item].slice(0, 20)));
  }

  function submit() {
    if (!name.trim()) { setNameError(true); return; }
    onSubmit({ name: name.trim(), summary: summary.trim(), competitors });
  }

  return (
    <>
      <StepBody>
        <div className="flex items-center gap-4 rounded-xl border border-(color:--line) bg-(--ash-50) p-4">
          <Favicon domain={business.domain} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-tight">{name || business.name}</p>
            {business.domain ? <p className="truncate text-sm text-(color:--muted)">{cleanDomain(business.domain)}</p> : null}
          </div>
        </div>
        <div>
          <label htmlFor={nameId} className={FIELD_LABEL}>{t("name")}</label>
          <input
            id={nameId}
            className={INPUT}
            value={name}
            maxLength={120}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            onChange={(event) => { setName(event.target.value); setNameError(false); }}
          />
          {nameError ? <p id={`${nameId}-error`} className="mt-1.5 text-sm text-[#8a1c12]">{t("nameRequired")}</p> : null}
        </div>
        <div>
          <label htmlFor={summaryId} className={FIELD_LABEL}>{t("summary")}</label>
          <textarea
            id={summaryId}
            className={`${INPUT} min-h-28 resize-y py-2.5 leading-relaxed`}
            value={summary}
            maxLength={1200}
            aria-describedby={`${summaryId}-hint`}
            onChange={(event) => setSummary(event.target.value)}
          />
          <p id={`${summaryId}-hint`} className="mt-1.5 text-xs text-(color:--muted)">{t("summaryHint")}</p>
        </div>
        <div>
          <h2 className={LABEL}>{t("competitors")}</h2>
          {competitors.length ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("competitors")}>
              {competitors.map((item) => (
                <Chip key={item.domain || item.name} onRemove={() => setCompetitors((list) => list.filter((c) => c !== item))} removeLabel={t("remove", { name: item.name })}>
                  <Favicon domain={item.domain} size={18} plain />
                  <span className="truncate">{item.name}</span>
                </Chip>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-(color:--muted)">{t("competitorsEmpty")}</p>}
          <AddInput label={t("addCompetitor")} placeholder={t("competitorPlaceholder")} addLabel={t("add")} onAdd={addCompetitor} />
        </div>
      </StepBody>
      <StepFooter nav={nav} label={tRoot("continue")} onContinue={submit} />
    </>
  );
}

// ─── Paso 2 ────────────────────────────────────────────────────────────────

export function marketLabel(market: BusinessMarket, whole: string) {
  return market.region ? `${market.region}, ${market.country}` : `${market.country} · ${whole}`;
}

export function CustomersStep({ business, nav, onSubmit }: { business: Business; nav: StepNav; onSubmit: (data: { markets: BusinessMarket[]; businessTypes: string[] }) => void }) {
  const t = useTranslations("BusinessOnboarding.customers");
  const tRoot = useTranslations("BusinessOnboarding");
  const countryId = useId();
  const regionId = useId();
  const [markets, setMarkets] = useState<BusinessMarket[]>(() => business.markets?.length ? business.markets : business.country ? [{ country: business.country, region: "" }] : []);
  const [types, setTypes] = useState<string[]>(business.businessTypes ?? []);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [missing, setMissing] = useState(false);

  function addMarket(event?: FormEvent) {
    event?.preventDefault();
    const next = { country: country.trim(), region: region.trim() };
    if (!next.country) return;
    const key = (m: BusinessMarket) => `${m.country}|${m.region}`.toLowerCase();
    setMarkets((list) => (list.some((m) => key(m) === key(next)) ? list : [...list, next].slice(0, 30)));
    setCountry("");
    setRegion("");
    setMissing(false);
  }

  function submit() {
    if (!markets.length) { setMissing(true); return; }
    onSubmit({ markets, businessTypes: types });
  }

  return (
    <>
      <StepBody>
        <div>
          <h2 className={LABEL}>{t("markets")}</h2>
          <p className="mt-1 text-sm text-(color:--muted)">{t("marketsHint")}</p>
          {markets.length ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("markets")}>
              {markets.map((market) => {
                const text = marketLabel(market, t("wholeCountry"));
                return (
                  <Chip key={`${market.country}|${market.region}`} onRemove={() => setMarkets((list) => list.filter((m) => m !== market))} removeLabel={t("remove", { name: text })}>
                    <MapPin size={14} className="shrink-0 text-(color:--muted)" aria-hidden="true" /><span className="truncate">{text}</span>
                  </Chip>
                );
              })}
            </ul>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor={countryId} className="mb-1 block text-xs font-semibold text-(color:--ash-700)">{t("country")}</label>
              <input id={countryId} className={INPUT} value={country} placeholder={t("countryPlaceholder")} maxLength={80} autoComplete="country-name"
                aria-invalid={missing || undefined} aria-describedby={missing ? `${countryId}-error` : undefined}
                onChange={(event) => setCountry(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addMarket(event); }} />
            </div>
            <div>
              <label htmlFor={regionId} className="mb-1 block text-xs font-semibold text-(color:--ash-700)">{t("region")}</label>
              <input id={regionId} className={INPUT} value={region} placeholder={t("regionPlaceholder")} maxLength={80}
                onChange={(event) => setRegion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addMarket(event); }} />
            </div>
            <button type="button" className={SECONDARY} onClick={() => addMarket()} disabled={!country.trim()}>
              <Plus size={16} aria-hidden="true" />{t("addMarket")}
            </button>
          </div>
          {missing ? <p id={`${countryId}-error`} role="alert" className="mt-2 text-sm text-[#8a1c12]">{t("marketsRequired")}</p> : null}
        </div>
        <div>
          <h2 className={LABEL}>{t("types")}</h2>
          <p className="mt-1 text-sm text-(color:--muted)">{t("typesHint")}</p>
          {types.length ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("types")}>
              {types.map((item) => (
                <Chip key={item} onRemove={() => setTypes((list) => list.filter((value) => value !== item))} removeLabel={t("remove", { name: item })}>
                  <span className="truncate">{item}</span>
                </Chip>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-(color:--muted)">{t("typesEmpty")}</p>}
          <AddInput label={t("addType")} placeholder={t("typePlaceholder")} addLabel={t("add")} onAdd={(value) => setTypes((list) => (list.some((v) => v.toLowerCase() === value.toLowerCase()) ? list : [...list, value].slice(0, 30)))} />
        </div>
      </StepBody>
      <StepFooter nav={nav} label={tRoot("continue")} onContinue={submit} blocked={!markets.length} onBlocked={() => setMissing(true)} />
    </>
  );
}

// ─── Paso 3 ────────────────────────────────────────────────────────────────

function ConfirmCard({ title, children, checked, onToggle, checkLabel, onEdit, attention }: {
  title: string; children: ReactNode; checked: boolean; onToggle: () => void; checkLabel: string; onEdit: () => void; attention: boolean;
}) {
  const t = useTranslations("BusinessOnboarding.confirm");
  const titleId = useId();
  const tone = checked
    ? "border-(color:--lime-dark) bg-(--ash-50)"
    : attention ? "border-(color:--ash-950) ring-4 ring-(color:--lime)" : "border-(color:--line) bg-(--paper)";
  return (
    <section aria-labelledby={titleId} data-attention={attention && !checked ? "true" : undefined} className={`rounded-xl border p-4 transition-shadow sm:p-5 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold tracking-tight">{title}</h2>
        <button type="button" onClick={onEdit} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-(color:--ash-700) hover:bg-(--ash-150) hover:text-(color:--ink) ${FOCUS}`}>
          <Pencil size={14} aria-hidden="true" />{t("edit")}
        </button>
      </div>
      <div className="mt-2">{children}</div>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className={`mt-4 inline-flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm font-semibold sm:w-auto sm:pr-5 ${FOCUS} ${checked ? "border-(color:--lime-dark) bg-(--lime) text-(color:--ink)" : "border-(color:--line) bg-(--paper) text-(color:--ink) hover:bg-(--ash-50)"}`}
      >
        <span className={`grid size-5 shrink-0 place-items-center rounded border ${checked ? "border-(color:--ash-950) bg-(--ash-950) text-(color:--lime)" : "border-(color:--ash-400) bg-(--paper)"}`} aria-hidden="true">
          {checked ? <Check size={13} strokeWidth={3} /> : null}
        </span>
        {checkLabel}
      </button>
    </section>
  );
}

export function ConfirmStep({ business, nav, onSubmit, onEdit }: { business: Business; nav: StepNav; onSubmit: (data: { offerConfirmed: true; marketsConfirmed: true }) => void; onEdit: (step: "company" | "customers") => void }) {
  const t = useTranslations("BusinessOnboarding.confirm");
  const tRoot = useTranslations("BusinessOnboarding");
  const tc = useTranslations("BusinessOnboarding.customers");
  const [offer, setOffer] = useState(Boolean(business.offerConfirmed));
  const [markets, setMarkets] = useState(Boolean(business.marketsConfirmed));
  const [attention, setAttention] = useState(false);
  const both = offer && markets;
  return (
    <>
      <StepBody>
        <div className="space-y-4">
          <ConfirmCard title={t("offerTitle", { name: business.name })} checked={offer} onToggle={() => setOffer((v) => !v)} checkLabel={t("offerCheck")} onEdit={() => onEdit("company")} attention={attention}>
            <p className="text-[15px] leading-relaxed text-(color:--ash-800)">{business.summary || t("noSummary")}</p>
          </ConfirmCard>
          <ConfirmCard title={t("marketsTitle")} checked={markets} onToggle={() => setMarkets((v) => !v)} checkLabel={t("marketsCheck")} onEdit={() => onEdit("customers")} attention={attention}>
            <ul className="flex flex-wrap gap-2">
              {(business.markets ?? []).map((market) => (
                <Chip key={`${market.country}|${market.region}`}>
                  <MapPin size={14} className="shrink-0 text-(color:--muted)" aria-hidden="true" /><span className="truncate">{marketLabel(market, tc("wholeCountry"))}</span>
                </Chip>
              ))}
            </ul>
          </ConfirmCard>
        </div>
      </StepBody>
      <StepFooter
        nav={nav}
        label={tRoot("continue")}
        blocked={!both}
        onBlocked={() => setAttention(true)}
        hint={attention && !both ? <p role="alert" className="font-semibold text-(color:--ink)">{t("missing")}</p> : null}
        onContinue={() => onSubmit({ offerConfirmed: true, marketsConfirmed: true })}
      />
    </>
  );
}

// ─── Paso 4 ────────────────────────────────────────────────────────────────

type Subscription = { planId: string; planName: string; status: string; monthlyCredits: number } | null;

/** null mientras carga; "error" si falló. Lo usan el plan y la capacidad. */
function useSubscription() {
  const [state, setState] = useState<{ subscription: Subscription } | "error" | null>(null);
  useEffect(() => {
    let ignore = false;
    void requestJson<{ subscription: Subscription }>("/api/subscriptions").then((result) => {
      if (!ignore) setState(result.ok ? { subscription: result.data.subscription ?? null } : "error");
    });
    return () => { ignore = true; };
  }, []);
  return state;
}

const activeOf = (subscription: Subscription) => (subscription?.status === "authorized" ? subscription : null);

export function PlanStep({ user, nav, onSubmit }: { user: SessionUser | null; nav: StepNav; onSubmit: () => void }) {
  const t = useTranslations("BusinessOnboarding.plan");
  const tRoot = useTranslations("BusinessOnboarding");
  const format = useFormatter();
  const state = useSubscription();
  const active = state && state !== "error" ? activeOf(state.subscription) : null;
  const expired = user?.access === "expired";
  const endsAt = typeof user?.trialEndsAt === "string" ? user.trialEndsAt : "";
  return (
    <>
      <StepBody>
        {state === null ? (
          <p role="status" className="flex items-center gap-2 text-sm text-(color:--muted)"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("loading")}</p>
        ) : active ? (
          <div className="flex items-start gap-4 rounded-xl border border-(color:--lime-dark) bg-(--ash-50) p-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--ash-950) text-(color:--lime)" aria-hidden="true"><CreditCard size={20} /></span>
            <div>
              <p className="text-lg font-semibold tracking-tight">{t("active", { name: active.planName })}</p>
              <p className="mt-1 text-sm text-(color:--ash-700)">{t("activeText", { credits: format.number(active.monthlyCredits) })}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-(color:--line) bg-(--ash-50) p-5">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--lime) text-(color:--ink)" aria-hidden="true">{expired ? <Clock size={20} /> : <Sparkles size={20} />}</span>
              <div className="min-w-0">
                <p className="text-lg font-semibold tracking-tight">{expired ? t("expiredTitle") : t("trialTitle", { days: TRIAL_DAYS })}</p>
                <p className="mt-1 text-sm leading-relaxed text-(color:--ash-700)">{expired ? t("expiredText") : t("trialText", { days: TRIAL_DAYS })}</p>
                {!expired && endsAt ? <p className="mt-2 text-sm font-semibold">{t("trialEnds", { date: format.dateTime(new Date(endsAt), { day: "numeric", month: "long" }) })}</p> : null}
                <Link href="/pricing" className={`${expired ? PRIMARY : SECONDARY} mt-4`}>{t("seePlans")}<ArrowRight size={16} aria-hidden="true" /></Link>
              </div>
            </div>
            {state === "error" ? <p className="mt-4 text-sm text-(color:--muted)">{t("error")}</p> : null}
          </div>
        )}
      </StepBody>
      <StepFooter nav={nav} label={tRoot("continue")} onContinue={onSubmit} />
    </>
  );
}

// ─── Paso 5 ────────────────────────────────────────────────────────────────

type GoogleStatus = { configured: boolean; connected: boolean; email: string; features?: { gmail?: boolean } };

function useGoogleStatus() {
  const [state, setState] = useState<GoogleStatus | "error" | null>(null);
  useEffect(() => {
    let ignore = false;
    void requestJson<GoogleStatus>("/api/integrations/google/status").then((result) => { if (!ignore) setState(result.ok ? result.data : "error"); });
    return () => { ignore = true; };
  }, []);
  return state;
}

const CHANNELS = [
  { key: "whatsapp", Icon: SiWhatsapp, color: WHATSAPP_GREEN },
  { key: "gmail", Icon: SiGmail, color: GMAIL_RED },
] as const;

export function ChannelsStep({ business, nav, onSubmit }: { business: Business; nav: StepNav; onSubmit: (data: { channels: ProposalChannel[] }) => void }) {
  const t = useTranslations("BusinessOnboarding.channels");
  const tRoot = useTranslations("BusinessOnboarding");
  const [selected, setSelected] = useState<ProposalChannel[]>(business.channels ?? []);
  const [missing, setMissing] = useState(false);
  const google = useGoogleStatus();
  const toggle = (channel: ProposalChannel) => {
    setMissing(false);
    setSelected((list) => (list.includes(channel) ? list.filter((c) => c !== channel) : [...list, channel]));
  };
  // Al salir a Google, la vuelta (returnTo=/onboarding, sin query) retoma este negocio.
  const rememberBusiness = () => { try { sessionStorage.setItem(RESUME_KEY, business.id); } catch { /* storage bloqueado */ } };

  return (
    <>
      <StepBody>
        <ul className="space-y-3">
          {CHANNELS.map(({ key, Icon, color }) => {
            const on = selected.includes(key);
            return (
              <li key={key} className={`overflow-hidden rounded-xl border transition-colors ${on ? "border-(color:--ash-950) bg-(--paper)" : "border-(color:--line) bg-(--paper)"}`}>
                <button type="button" aria-pressed={on} onClick={() => toggle(key)} className={`flex w-full items-center gap-4 p-4 text-left hover:bg-(--ash-50) sm:p-5 ${FOCUS} focus-visible:outline-offset-[-2px]`}>
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-(color:--line) bg-(--paper)" aria-hidden="true"><Icon size={24} color={color} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold tracking-tight">{t(key)}</span>
                    <span className="block text-sm text-(color:--muted)">{t(`${key}Text`)}</span>
                  </span>
                  <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${on ? "border-(color:--ash-950) bg-(--ash-950) text-(color:--lime)" : "border-(color:--ash-400)"}`} aria-hidden="true">
                    {on ? <Check size={14} strokeWidth={3} /> : null}
                  </span>
                  {on ? <span className="sr-only">{t("selected")}</span> : null}
                </button>
                {on ? (
                  <div className="border-t border-(color:--line) bg-(--ash-50) p-4 sm:p-5">
                    {key === "whatsapp" ? <WhatsAppConnectCard compact /> : (
                      google === null ? <p role="status" className="flex items-center gap-2 text-sm text-(color:--muted)"><Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("gmailLoading")}</p>
                      : google === "error" ? <p className="text-sm text-(color:--muted)">{t("gmailError")}</p>
                      : !google.configured ? <p className="text-sm text-(color:--muted)">{t("gmailNotConfigured")}</p>
                      : google.features?.gmail ? <p className="flex items-center gap-2 text-sm font-semibold"><Check size={16} className="text-(color:--lime-dark)" aria-hidden="true" />{t("gmailConnected", { email: google.email })}</p>
                      : <span onClickCapture={rememberBusiness}><GoogleFeatureConnectButton feature="gmail" returnTo="/onboarding" className={PRIMARY} /></span>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </StepBody>
      <StepFooter
        nav={nav}
        label={tRoot("continue")}
        blocked={!selected.length}
        onBlocked={() => setMissing(true)}
        hint={missing ? <p role="alert" className="font-semibold text-(color:--ink)">{t("required")}</p> : t("later")}
        onContinue={() => onSubmit({ channels: selected })}
      />
    </>
  );
}

// ─── Paso 6 ────────────────────────────────────────────────────────────────

type Usage = { gmail: { used: number; limit: number }; whatsapp: { used: number; limit: number }; ai: { used: number; limit: number } | null };
type WaStatus = { status: string };

export function CapacityStep({ business, nav, onSubmit }: { business: Business; nav: StepNav; onSubmit: () => void }) {
  const t = useTranslations("BusinessOnboarding.capacity");
  const tc = useTranslations("BusinessOnboarding.channels");
  const format = useFormatter();
  const subscription = useSubscription();
  const google = useGoogleStatus();
  const [usage, setUsage] = useState<Usage | "error" | null>(null);
  const [whatsapp, setWhatsapp] = useState<WaStatus | "error" | null>(null);
  useEffect(() => {
    let ignore = false;
    void Promise.all([requestJson<Usage>("/api/lead-suite/chat/usage"), requestJson<WaStatus>("/api/integrations/whatsapp/status")]).then(([u, w]) => {
      if (ignore) return;
      setUsage(u.ok ? u.data : "error");
      setWhatsapp(w.ok ? w.data : "error");
    });
    return () => { ignore = true; };
  }, []);

  const loading = subscription === null || usage === null;
  const active = subscription && subscription !== "error" ? activeOf(subscription.subscription) : null;
  const limits: PlanLimits = active ? getSubscriptionPlan(active.planId)?.limits ?? UNKNOWN_PLAN_LIMITS : FREE_LIMITS;
  const u = usage && usage !== "error" ? usage : null;
  const n = (value: number) => format.number(value);
  const capOrUnlimited = (value: number) => (Number.isFinite(value) ? t("limitOnly", { limit: n(value) }) : t("unlimited"));
  const rows: { key: string; label: string; value: string; used?: number; limit?: number }[] = [
    { key: "plan", label: t("plan"), value: active?.planName ?? t("planFree") },
    u ? { key: "wa", label: t("whatsappMonthly"), value: t("usage", { used: n(u.whatsapp.used), limit: n(u.whatsapp.limit) }), used: u.whatsapp.used, limit: u.whatsapp.limit }
      : { key: "wa", label: t("whatsappMonthly"), value: capOrUnlimited(limits.whatsappMonthly) },
    ...(u ? [{ key: "gmail", label: t("gmailDaily"), value: t("usage", { used: n(u.gmail.used), limit: n(u.gmail.limit) }), used: u.gmail.used, limit: u.gmail.limit }] : []),
    { key: "email", label: t("emailMonthly"), value: capOrUnlimited(limits.emailMonthly) },
    { key: "scheduled", label: t("scheduledMonthly"), value: capOrUnlimited(limits.scheduledMonthly) },
    ...(u ? [u.ai ? { key: "ai", label: t("aiDaily"), value: t("usage", { used: n(u.ai.used), limit: n(u.ai.limit) }), used: u.ai.used, limit: u.ai.limit } : { key: "ai", label: t("aiDaily"), value: t("unlimited") }] : []),
  ];
  const connected: Record<ProposalChannel, boolean | null> = {
    whatsapp: whatsapp === null ? null : whatsapp !== "error" && whatsapp.status === "connected",
    gmail: google === null ? null : google !== "error" && Boolean(google.features?.gmail),
  };
  const channels = business.channels ?? [];

  return (
    <>
      <StepBody>
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-(color:--muted)"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("loading")}</p>
        ) : (
          <>
            {subscription === "error" || usage === "error" ? <p className="text-sm text-(color:--muted)">{t("error")}</p> : null}
            <dl className="grid gap-3 sm:grid-cols-2">
              {rows.map((row) => (
                <div key={row.key} className="rounded-xl border border-(color:--line) bg-(--ash-50) p-4">
                  <dt className={LABEL}>{row.label}</dt>
                  <dd className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums">{row.value}</dd>
                  {row.limit ? (
                    <dd className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--ash-200)" aria-hidden="true">
                      <span className="block h-full rounded-full bg-(--lime-dark)" style={{ width: `${Math.min(100, Math.round(((row.used ?? 0) / row.limit) * 100))}%` }} />
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
          </>
        )}
        <div>
          <h2 className={LABEL}>{t("channelsTitle", { name: business.name })}</h2>
          {channels.length ? (
            <ul className="mt-3 space-y-2">
              {CHANNELS.filter(({ key }) => channels.includes(key)).map(({ key, Icon, color }) => (
                <li key={key} className="flex items-center gap-3 rounded-lg border border-(color:--line) bg-(--paper) px-3 py-2.5">
                  <Icon size={20} color={color} aria-hidden="true" />
                  <span className="flex-1 text-sm font-semibold">{tc(key)}</span>
                  {connected[key] === null ? <Loader2 size={15} className="animate-spin text-(color:--muted) motion-reduce:animate-none" aria-hidden="true" />
                    : connected[key] ? <span className="rounded-full bg-(--lime) px-2.5 py-0.5 text-xs font-semibold text-(color:--ink)">{t("connected")}</span>
                    : <span className="rounded-full bg-(--ash-150) px-2.5 py-0.5 text-xs font-semibold text-(color:--ash-700)">{t("notConnected")}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-(color:--muted)">{t("noChannels")}</p>}
        </div>
      </StepBody>
      <StepFooter nav={nav} label={t("finish")} onContinue={onSubmit} />
    </>
  );
}
