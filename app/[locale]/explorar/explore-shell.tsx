"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Circle, CircleAlert, Loader2, RotateCcw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EXPLORE_STEPS, type ExploreCampaign, type ExploreRun, type ExploreStep } from "@/lib/explore/types";
import { CampaignsStep, CompetitorsStep, LeadsStep, ProposalsStep, ResearchStep } from "./explore-steps";
import { SignupDialog } from "./signup-dialog";

const FIELD = {
  research: "product",
  competitors: "competitors",
  campaigns: "campaigns",
  leads: "leads",
  proposals: "proposals",
} as const satisfies Record<ExploreStep, keyof ExploreRun>;

type LoadState = "loading" | "missing" | "error" | "ready";
type StepStatus = "done" | "running" | "error" | "pending";

function nextStep(run: ExploreRun) {
  return EXPLORE_STEPS.find((step) => run[FIELD[step]] === null) ?? null;
}

function topCampaign(campaigns: ExploreCampaign[] | null) {
  return campaigns?.reduce<ExploreCampaign | null>((best, item) => (!best || item.fit > best.fit ? item : best), null) ?? null;
}

export function ExploreShell() {
  const t = useTranslations("Explore");
  const locale = useLocale();
  const [run, setRun] = useState<ExploreRun | null>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [running, setRunning] = useState<ExploreStep | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ExploreStep, string>>>({});
  const [view, setView] = useState<ExploreStep>("research");
  const [pickedCampaign, setPickedCampaign] = useState("");
  const [signupOpen, setSignupOpen] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let ignore = false;
    fetch("/api/explore", { cache: "no-store" })
      .then(async (response) => {
        if (ignore) return;
        if (response.status === 404) return setLoad("missing");
        if (!response.ok) return setLoad("error");
        const data = (await response.json()) as ExploreRun;
        if (ignore) return;
        setRun(data);
        setView(nextStep(data) ?? "proposals");
        setLoad("ready");
      })
      .catch(() => { if (!ignore) setLoad("error"); });
    return () => { ignore = true; };
  }, [loadAttempt]);

  const selectedCampaignId = pickedCampaign || run?.campaignId || topCampaign(run?.campaigns ?? null)?.id || "";

  const runStep = useCallback(async (step: ExploreStep, campaignId: string) => {
    inFlight.current = true;
    setRunning(step);
    setView(step);
    try {
      const response = await fetch(`/api/explore/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaignId || undefined, locale }),
      });
      const payload = (await response.json().catch(() => null)) as { data?: unknown; error?: string } | null;
      if (!response.ok || !payload || payload.data == null) throw new Error(payload?.error || "");
      setRun((prev) => (prev ? { ...prev, [FIELD[step]]: payload.data, ...(step === "leads" ? { campaignId } : {}) } : prev));
    } catch (error) {
      setErrors((prev) => ({ ...prev, [step]: error instanceof Error && error.message ? error.message : t("stepError") }));
    } finally {
      inFlight.current = false;
      setRunning(null);
    }
  }, [locale, t]);

  // Avanza solo: corre el primer paso sin datos, salvo que esté corriendo o haya fallado.
  const pending = run ? nextStep(run) : null;
  const pendingFailed = pending ? Boolean(errors[pending]) : false;
  useEffect(() => {
    if (load !== "ready" || !run || !pending || pendingFailed || running || inFlight.current) return;
    const campaignId = pending === "leads" ? selectedCampaignId : run.campaignId;
    void runStep(pending, campaignId);
  }, [load, run, pending, pendingFailed, running, runStep, selectedCampaignId]);

  function retry(step: ExploreStep) {
    setErrors((prev) => ({ ...prev, [step]: undefined }));
  }

  function statusOf(step: ExploreStep): StepStatus {
    if (running === step) return "running";
    if (errors[step]) return "error";
    if (run && run[FIELD[step]] !== null) return "done";
    return "pending";
  }

  if (load !== "ready" || !run) {
    return (
      <main className="grid min-h-dvh place-items-center bg-(--ash-100) px-4 text-(color:--ink)">
        <div className="w-full max-w-md rounded-xl border border-(color:--line) bg-(--paper) p-8 text-center">
          {load === "loading" ? (
            <p role="status" className="flex items-center justify-center gap-2 text-sm text-(color:--muted)"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("loading")}</p>
          ) : load === "missing" ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">{t("empty.title")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-(color:--muted)">{t("empty.text")}</p>
              <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-(--lime) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--lime-dark) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)">{t("empty.cta")}</Link>
            </>
          ) : (
            <>
              <p role="alert" className="text-sm text-(color:--ink)">{t("loadError")}</p>
              <button type="button" onClick={() => { setLoad("loading"); setLoadAttempt((n) => n + 1); }} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-(color:--line) bg-(--ash-50) px-4 text-sm font-semibold hover:bg-(--ash-150) focus-visible:outline-2 focus-visible:outline-(color:--ink)"><RotateCcw size={15} aria-hidden="true" />{t("retry")}</button>
            </>
          )}
        </div>
      </main>
    );
  }

  const stepIndex = (step: ExploreStep) => EXPLORE_STEPS.indexOf(step) + 1;
  const lastDone = [...EXPLORE_STEPS].reverse().find((step) => run[FIELD[step]] !== null);
  const failed = EXPLORE_STEPS.find((step) => errors[step]);
  const liveMessage = running
    ? t("live.running", { index: stepIndex(running), step: t(`steps.${running}`) })
    : failed
      ? t("live.error", { index: stepIndex(failed), step: t(`steps.${failed}`) })
      : lastDone ? t("live.done", { index: stepIndex(lastDone), step: t(`steps.${lastDone}`) }) : "";

  const leadsCampaign = run.campaigns?.find((item) => item.id === (run.campaignId || selectedCampaignId)) ?? null;
  const viewStatus = statusOf(view);

  return (
    <div className="min-h-dvh bg-(--ash-100) text-(color:--ink) lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <p className="sr-only" aria-live="polite">{liveMessage}</p>
      <aside className="border-b border-(color:--line) bg-(--ash-50) lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="px-4 pt-4 lg:px-5 lg:pt-6">
          <Link href="/" className="brand" aria-label="Leadta">Leadta<span className="brand-period">.</span></Link>
          {run.product ? <p className="mt-3 truncate text-sm font-semibold">{run.product.name}</p> : null}
        </div>
        <nav aria-label={t("stepsAria")} className="mt-3 pb-3 lg:mt-5 lg:pb-6">
          <ol className="flex gap-1 overflow-x-auto px-3 lg:flex-col lg:gap-0.5 lg:overflow-visible">
            {EXPLORE_STEPS.map((step, index) => {
              const status = statusOf(step);
              const reachable = status !== "pending";
              return (
                <li key={step} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    disabled={!reachable}
                    aria-current={view === step ? "step" : undefined}
                    onClick={() => setView(step)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-(color:--ink) disabled:cursor-default lg:whitespace-normal ${view === step ? "bg-(--ash-150) text-(color:--ink)" : "text-(color:--ash-700) enabled:hover:bg-(--ash-100)"}`}
                  >
                    <StatusIcon status={status} label={t(`status.${status}`)} />
                    <span>{index + 1}. {t(`steps.${step}`)}</span>
                  </button>
                  {step === "research" && run.product ? (
                    <div className="mt-1 mb-2 hidden pr-2 pl-10 lg:block">
                      <p className="line-clamp-3 text-xs leading-relaxed text-(color:--muted)">{run.product.summary}</p>
                      <p className="mt-1.5 text-xs text-(color:--ash-700)">{t("location")} | {run.product.location || t("noLocation")}</p>
                    </div>
                  ) : null}
                  {step === "campaigns" && run.campaigns ? (
                    <ul className="mt-1 mb-2 hidden space-y-0.5 pr-2 pl-8 lg:block">
                      {run.campaigns.map((campaign) => (
                        <li key={campaign.id}>
                          <button type="button" onClick={() => { setPickedCampaign(campaign.id); setView("campaigns"); }} aria-pressed={selectedCampaignId === campaign.id} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-(color:--ink) ${selectedCampaignId === campaign.id ? "font-semibold text-(color:--ink)" : "text-(color:--muted) hover:text-(color:--ink)"}`}>
                            <span className="truncate">{campaign.name}</span>
                            <span className="tabular-nums">{campaign.fit}%</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="sr-only">{t(`titles.${view}`)}</h1>
          <div>
            {viewStatus === "error" ? (
              <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-(color:--line) bg-(--paper) p-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm"><CircleAlert size={18} className="text-(color:--ash-700)" aria-hidden="true" />{errors[view]}</p>
                <button type="button" onClick={() => retry(view)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-(--lime) px-4 text-sm font-semibold hover:bg-(--lime-dark) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)"><RotateCcw size={15} aria-hidden="true" />{t("retry")}</button>
              </div>
            ) : viewStatus === "running" && view !== "leads" ? (
              <div role="status" className="flex items-center gap-3 rounded-xl border border-(color:--line) bg-(--paper) p-8 text-sm text-(color:--muted)">
                <Loader2 size={18} className="animate-spin text-(color:--ink)" aria-hidden="true" />{t(`working.${view}`)}
              </div>
            ) : view === "research" && run.product ? (
              <ResearchStep product={run.product} />
            ) : view === "competitors" && run.competitors ? (
              <CompetitorsStep data={run.competitors} />
            ) : view === "campaigns" && run.campaigns ? (
              <CampaignsStep campaigns={run.campaigns} selectedId={selectedCampaignId} onSelect={setPickedCampaign} />
            ) : view === "leads" ? (
              <LeadsStep leads={run.leads} campaign={leadsCampaign} loading={viewStatus === "running"} />
            ) : view === "proposals" && run.proposals ? (
              <ProposalsStep proposals={run.proposals} leads={run.leads ?? []} onSend={() => setSignupOpen(true)} />
            ) : null}
          </div>
        </div>
      </main>
      <SignupDialog open={signupOpen} onClose={() => setSignupOpen(false)} />
    </div>
  );
}

function StatusIcon({ status, label }: { status: StepStatus; label: string }) {
  if (status === "done") return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-(--lime-dark) text-(color:--ink)" role="img" aria-label={label}><Check size={12} strokeWidth={3} aria-hidden="true" /></span>;
  if (status === "running") return <Loader2 size={20} className="shrink-0 animate-spin text-(color:--ink) motion-reduce:animate-none" role="img" aria-label={label} />;
  if (status === "error") return <CircleAlert size={20} className="shrink-0 text-(color:--ash-700)" role="img" aria-label={label} />;
  return <Circle size={20} className="shrink-0 text-(color:--ash-400)" role="img" aria-label={label} />;
}
