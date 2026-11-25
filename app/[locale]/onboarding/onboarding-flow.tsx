"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Globe, Loader2, PenLine, RotateCcw } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { getSession, type SessionUser } from "@/lib/client/session";
import { ONBOARDING_STEPS, type Business, type OnboardingStep } from "@/lib/workspace/types";
import {
  CapacityStep, ChannelsStep, CompanyStep, ConfirmStep, CustomersStep, ErrorNote, FOCUS, LABEL, PlanStep, PRIMARY, RESUME_KEY, SECONDARY,
  requestJson, type StepNav,
} from "./onboarding-steps";

type Step = (typeof ONBOARDING_STEPS)[number];
type View = "start" | Step;
type Load = "loading" | "ready" | "error";

/** El sidebar (selector de negocio) se recarga con este evento. */
export const ACTIVE_BUSINESS_EVENT = "leadta:active-business-changed";

const ERROR_CODES = new Set(["rate_limited", "research_failed", "invalid_request", "step_locked", "not_found", "unauthorized", "network"]);
const PHASE_MS = 9000;

const viewFor = (step: OnboardingStep | undefined): Step => (!step ? "company" : step === "done" ? "capacity" : step);

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations("BusinessOnboarding");
  return (
    <div className="min-h-dvh bg-(--ash-100) text-(color:--ink)">
      <header className="px-4 pt-5 sm:px-8 sm:pt-6">
        <Link href="/" className="brand" style={{ fontSize: 30 }} aria-label={t("brandHome")}>Leadta<span className="brand-period">.</span></Link>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16 sm:pt-10">{children}</main>
    </div>
  );
}

const CARD = "rounded-2xl border border-(color:--line) bg-(--paper) shadow-[0_1px_2px_rgb(32_35_32/4%),0_12px_32px_-18px_rgb(32_35_32/18%)]";

export function OnboardingFallback() {
  const t = useTranslations("BusinessOnboarding");
  return (
    <Frame>
      <div className={`${CARD} p-8`}>
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-(color:--muted)"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("loading")}</p>
      </div>
    </Frame>
  );
}

function Progress({ index }: { index: number }) {
  const t = useTranslations("BusinessOnboarding");
  const total = ONBOARDING_STEPS.length;
  return (
    <div className="flex items-center gap-3">
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        {ONBOARDING_STEPS.map((step, i) => (
          <li key={step} className={`h-2 rounded-full transition-all ${i + 1 === index ? "w-6 bg-(--lime-dark)" : i + 1 < index ? "w-2 bg-(--ash-800)" : "w-2 bg-(--ash-200)"}`} />
        ))}
      </ol>
      <p className={LABEL}>{t("stepOf", { index, total })}</p>
    </div>
  );
}

export function OnboardingFlow() {
  const t = useTranslations("BusinessOnboarding");
  const router = useRouter();
  const params = useSearchParams();
  const businessParam = params.get("business") ?? "";
  const isNew = params.get("new") === "1";

  const [user, setUser] = useState<SessionUser | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [view, setView] = useState<View>("start");
  const [load, setLoad] = useState<Load>("loading");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadedId = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const message = useCallback((code: string, status: number) => {
    if (ERROR_CODES.has(code)) return t(`errors.${code}`);
    if (status === 401) return t("errors.unauthorized");
    if (status === 404) return t("errors.not_found");
    if (status === 409) return t("errors.step_locked");
    if (status === 429) return t("errors.rate_limited");
    if (status === 400) return t("errors.invalid_request");
    return t("errors.generic");
  }, [t]);

  // Sesión + negocio a retomar (?business=, o el guardado antes de salir a Google). ?new=1 o nada → paso 0.
  useEffect(() => {
    let ignore = false;
    void (async () => {
      const session = await getSession().catch(() => null);
      if (ignore) return;
      if (!session?.user) { router.replace("/login"); return; }
      setUser(session.user);
      let id = businessParam;
      if (!id && !isNew) {
        try { id = sessionStorage.getItem(RESUME_KEY) ?? ""; sessionStorage.removeItem(RESUME_KEY); } catch { /* storage bloqueado */ }
      }
      if (!id || isNew) { loadedId.current = ""; setBusiness(null); setView("start"); setLoad("ready"); return; }
      if (loadedId.current === id) { setLoad("ready"); return; }
      const result = await requestJson<{ business: Business }>(`/api/onboarding/${encodeURIComponent(id)}`);
      if (ignore) return;
      if (!result.ok) {
        if (result.status === 401) { router.replace("/login"); return; }
        setLoadError(message(result.error, result.status));
        setLoad("error");
        return;
      }
      loadedId.current = result.data.business.id;
      setBusiness(result.data.business);
      setView(viewFor(result.data.business.onboardingStep));
      setLoad("ready");
    })();
    return () => { ignore = true; };
  }, [businessParam, isNew, attempt, router, message]);

  // Cada paso nuevo: arriba y foco en su título (lectores de pantalla anuncian el cambio).
  const firstView = useRef(true);
  useEffect(() => {
    if (load !== "ready") return;
    if (firstView.current) { firstView.current = false; return; }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [view, load]);

  function go(next: View) {
    setError("");
    setView(next);
  }

  function onResearched(created: Business) {
    loadedId.current = created.id;
    setBusiness(created);
    go(viewFor(created.onboardingStep));
    window.dispatchEvent(new Event(ACTIVE_BUSINESS_EVENT));
    router.replace(`/onboarding?business=${encodeURIComponent(created.id)}`, { scroll: false });
  }

  async function submit(step: Step, data: Record<string, unknown>) {
    if (!business || busy) return;
    setBusy(true);
    setError("");
    const result = await requestJson<{ business: Business }>(`/api/onboarding/${encodeURIComponent(business.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ step, data }),
    });
    if (!result.ok) {
      setBusy(false);
      if (result.status === 401) { router.replace("/login"); return; }
      setError(message(result.error, result.status));
      return;
    }
    const saved = result.data.business;
    setBusiness(saved);
    if (step === "capacity") {
      window.dispatchEvent(new Event(ACTIVE_BUSINESS_EVENT));
      // Con propuestas (negocio traído de /explorar) sigue a enviarlas; si no, a Leadtita.
      const proposals = await requestJson<{ proposals: unknown[] }>(`/api/proposals?business=${encodeURIComponent(saved.id)}`);
      router.push(proposals.ok && proposals.data.proposals?.length ? `/propuestas?business=${encodeURIComponent(saved.id)}` : "/leadtita");
      return;
    }
    setBusy(false);
    // Al siguiente del guardado (o al que diga el servidor si es anterior, p. ej. step_locked corregido).
    const after = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? "capacity";
    const server = viewFor(saved.onboardingStep);
    go(ONBOARDING_STEPS.indexOf(server) < ONBOARDING_STEPS.indexOf(after) ? server : after);
  }

  if (load === "loading") return <OnboardingFallback />;

  if (load === "error") {
    return (
      <Frame>
        <div className={`${CARD} space-y-4 p-6 sm:p-8`}>
          <ErrorNote message={loadError} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={SECONDARY} onClick={() => { setLoad("loading"); setAttempt((n) => n + 1); }}><RotateCcw size={15} aria-hidden="true" />{t("retry")}</button>
            <Link href="/onboarding?new=1" className={PRIMARY}>{t("startOver")}</Link>
          </div>
        </div>
      </Frame>
    );
  }

  if (view === "start" || !business) {
    return (
      <Frame>
        <StartStep headingRef={headingRef} onDone={onResearched} message={message} />
      </Frame>
    );
  }

  const index = ONBOARDING_STEPS.indexOf(view) + 1;
  const previous = ONBOARDING_STEPS[index - 2];
  const nav: StepNav = { busy, error, onBack: previous ? () => go(previous) : undefined };
  // key: cada vez que se entra a un paso, su borrador arranca desde el negocio guardado.
  const key = `${business.id}-${view}`;

  return (
    <Frame>
      <section className={CARD} aria-labelledby="onboarding-title">
        <div className="px-5 pt-6 sm:px-10 sm:pt-9">
          <Progress index={index} />
          <h1 id="onboarding-title" ref={headingRef} tabIndex={-1} className="mt-5 text-2xl font-bold tracking-tight outline-none sm:text-[28px]">
            {t(`${view}.title`)}
          </h1>
          <p className="mt-1.5 text-[15px] text-(color:--muted)">{t(`${view}.intro`)}</p>
        </div>
        {view === "company" ? <CompanyStep key={key} business={business} nav={nav} onSubmit={(data) => void submit("company", data)} />
          : view === "customers" ? <CustomersStep key={key} business={business} nav={nav} onSubmit={(data) => void submit("customers", data)} />
          : view === "confirm" ? <ConfirmStep key={key} business={business} nav={nav} onSubmit={(data) => void submit("confirm", data)} onEdit={go} />
          : view === "plan" ? <PlanStep key={key} user={user} nav={nav} onSubmit={() => void submit("plan", {})} />
          : view === "channels" ? <ChannelsStep key={key} business={business} nav={nav} onSubmit={(data) => void submit("channels", data)} />
          : <CapacityStep key={key} business={business} nav={nav} onSubmit={() => void submit("capacity", {})} />}
      </section>
    </Frame>
  );
}

// ─── Paso 0 ────────────────────────────────────────────────────────────────

function StartStep({ headingRef, onDone, message }: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onDone: (business: Business) => void;
  message: (code: string, status: number) => string;
}) {
  const t = useTranslations("BusinessOnboarding.start");
  const inputId = useId();
  const [mode, setMode] = useState<"web" | "text">("web");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [researching, setResearching] = useState(false);
  const [phase, setPhase] = useState(0);
  const phases = t.raw("phases") as string[];

  useEffect(() => {
    if (!researching) return;
    const timer = window.setInterval(() => setPhase((p) => Math.min(p + 1, phases.length - 1)), PHASE_MS);
    return () => window.clearInterval(timer);
  }, [researching, phases.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    let body: { mode: "web"; url: string } | { mode: "text"; description: string };
    if (mode === "web") {
      const host = url.trim().replace(/^https?:\/\//i, "");
      if (!/^[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/.test(host)) { setFieldError(t("urlInvalid")); return; }
      body = { mode: "web", url: `https://${host}` };
    } else {
      if (description.trim().length < 20) { setFieldError(t("textShort")); return; }
      body = { mode: "text", description: description.trim() };
    }
    setFieldError("");
    setPhase(0);
    setResearching(true);
    const result = await requestJson<{ business: Business }>("/api/onboarding", { method: "POST", body: JSON.stringify(body) });
    if (result.ok && result.data.business) { onDone(result.data.business); return; }
    setResearching(false);
    setError(result.ok ? message("", 500) : message(result.error, result.status));
  }

  const modes = [
    { key: "web", label: t("modeWeb"), Icon: Globe },
    { key: "text", label: t("modeText"), Icon: PenLine },
  ] as const;

  return (
    <section className={CARD} aria-labelledby="onboarding-title">
      <div className="px-5 pt-6 sm:px-10 sm:pt-9">
        <p className={LABEL}>{t("eyebrow")}</p>
        <h1 id="onboarding-title" ref={headingRef} tabIndex={-1} className="mt-3 text-2xl font-bold tracking-tight outline-none sm:text-[28px]">{t("title")}</h1>
        <p className="mt-1.5 text-[15px] text-(color:--muted)">{t("intro")}</p>
      </div>
      {researching ? (
        <div className="px-5 py-10 sm:px-10" role="status" aria-live="polite">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-full bg-(--lime)" aria-hidden="true">
              <Loader2 size={26} className="animate-spin text-(color:--ink) motion-reduce:animate-none" />
            </span>
            <p className="mt-5 text-lg font-semibold tracking-tight">{t("researching")}</p>
            <p className="mt-1 text-sm font-medium text-(color:--ash-800)">{phases[phase]}</p>
            <p className="mt-4 text-xs text-(color:--muted)">{t("researchingHint")}</p>
            <ol className="mt-6 flex gap-1.5" aria-hidden="true">
              {phases.map((item, i) => <li key={item} className={`h-1.5 w-8 rounded-full transition-colors ${i <= phase ? "bg-(--lime-dark)" : "bg-(--ash-200)"}`} />)}
            </ol>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
            <div role="radiogroup" aria-label={t("modeAria")} className="grid grid-cols-2 gap-1 rounded-xl bg-(--ash-150) p-1">
              {modes.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={mode === key}
                  onClick={() => { setMode(key); setFieldError(""); }}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${FOCUS} ${mode === key ? "bg-(--paper) text-(color:--ink) shadow-sm" : "text-(color:--ash-700) hover:text-(color:--ink)"}`}
                >
                  <Icon size={16} aria-hidden="true" /><span className="truncate">{label}</span>
                </button>
              ))}
            </div>
            <div>
              <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold">{mode === "web" ? t("urlLabel") : t("textLabel")}</label>
              {mode === "web" ? (
                <input
                  id={inputId}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  autoFocus
                  value={url}
                  placeholder={t("urlPlaceholder")}
                  maxLength={300}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${inputId}-error` : undefined}
                  onChange={(event) => { setUrl(event.target.value); setFieldError(""); }}
                  className={`min-h-12 w-full rounded-lg border border-(color:--line) bg-(--paper) px-3 text-base placeholder:text-(color:--ash-500) ${FOCUS} focus-visible:outline-offset-0`}
                />
              ) : (
                <textarea
                  id={inputId}
                  autoFocus
                  value={description}
                  placeholder={t("textPlaceholder")}
                  maxLength={2000}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${inputId}-error` : undefined}
                  onChange={(event) => { setDescription(event.target.value); setFieldError(""); }}
                  className={`min-h-32 w-full resize-y rounded-lg border border-(color:--line) bg-(--paper) px-3 py-2.5 text-base leading-relaxed placeholder:text-(color:--ash-500) ${FOCUS} focus-visible:outline-offset-0`}
                />
              )}
              {fieldError ? <p id={`${inputId}-error`} className="mt-1.5 text-sm text-[#8a1c12]">{fieldError}</p> : null}
            </div>
          </div>
          <div className="border-t border-(color:--line) px-5 py-4 sm:px-10">
            {error ? <div className="mb-3"><ErrorNote message={error} /></div> : null}
            <div className="flex justify-end">
              <button type="submit" className={PRIMARY}>{t("submit")}<ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
