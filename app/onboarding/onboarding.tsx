"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { CircleHelp, X } from "lucide-react";
import "./onboarding.css";

// Pasos del tour. `anchor` apunta a un `data-onboarding="..."` de /buscar; `focus` mueve el foco al control real.
const STEPS = [
  { key: "lead", anchor: "intro", focus: false },
  { key: "keywords", anchor: "keywords", focus: true },
  { key: "location", anchor: "location", focus: true },
  { key: "count", anchor: "count", focus: false },
  { key: "launch", anchor: "submit", focus: true },
  { key: "results", anchor: "results", focus: false },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
const LAUNCH = 4;
const RESULTS = 5;
const MIN_BATCH = 5;

type OnboardingProps = {
  userId: string;
  hasHistory: boolean;
  hasCountry: boolean;
  busy: boolean;
  resultCount: number;
  /** Tamaño de lote del tour mientras está abierto (1 primera búsqueda, 5 si ya hay historial); null al cerrar. */
  onGuidedCountChange: (count: number | null) => void;
};
type Layout = { rect: { top: number; left: number; width: number; height: number } | null; card: { top: number; left: number } | null };

const storageKey = (userId: string) => `leadta:onboarding:${userId}`;
function markDone(userId: string, value: "completed" | "skipped") {
  try { localStorage.setItem(storageKey(userId), value); } catch { /* sin storage: el tour puede reaparecer */ }
}
/** Último elemento con ese ancla: en el chat puede haber varias tarjetas y la vigente es la más nueva. */
function anchorOf(name: string) {
  const all = document.querySelectorAll<HTMLElement>(`[data-onboarding="${name}"]`);
  return all.length ? all[all.length - 1] : null;
}
function keywordsTyped() {
  return Boolean(anchorOf("keywords")?.querySelector("textarea")?.value.trim());
}

/** Resaltado, posición de la tarjeta y foco del paso actual. Sin ancla en pantalla, la tarjeta queda centrada (CSS). */
export function useSpotlight(open: boolean, anchorName: string, focus: boolean, bodyId: string, cardRef: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState<Layout>({ rect: null, card: null });
  useEffect(() => {
    if (!open) return;
    const anchor = anchorOf(anchorName);
    const card = cardRef.current;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!anchor || !card) { setLayout({ rect: null, card: null }); return; }
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = { top: r.top, left: r.left, width: r.width, height: r.height };
      if (vw <= 640) { setLayout({ rect, card: null }); return; }
      const gap = 14, margin = 16, cw = card.offsetWidth, ch = card.offsetHeight;
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
      let top: number, left = clamp(r.left, margin, vw - cw - margin);
      if (r.bottom + gap + ch <= vh - margin) top = r.bottom + gap;
      else if (r.top - gap - ch >= margin) top = r.top - gap - ch;
      else if (r.right + gap + cw <= vw - margin) { left = r.right + gap; top = clamp(r.top, margin, vh - ch - margin); }
      else top = vh - ch - margin;
      setLayout({ rect, card: { top, left } });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });

    let described: HTMLElement | null = null;
    let previousDescription: string | null = null;
    const focusable = "textarea:not(:disabled), select:not(:disabled), button:not(:disabled)";
    const control = focus && anchor ? (anchor.matches(focusable) ? anchor : anchor.querySelector<HTMLElement>(focusable)) : null;
    if (control) {
      control.focus({ preventScroll: true });
      described = control;
      previousDescription = control.getAttribute("aria-describedby");
      control.setAttribute("aria-describedby", [previousDescription, bodyId].filter(Boolean).join(" "));
    } else {
      card?.focus({ preventScroll: true });
    }

    schedule();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    if (anchor) observer.observe(anchor);
    if (card) observer.observe(card);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (described) {
        if (previousDescription === null) described.removeAttribute("aria-describedby");
        else described.setAttribute("aria-describedby", previousDescription);
      }
    };
  }, [open, anchorName, focus, bodyId, cardRef]);
  return layout;
}

export function Onboarding({ userId, hasHistory, hasCountry, busy, resultCount, onGuidedCountChange }: OnboardingProps) {
  const t = useTranslations("Onboarding");
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [sawBusy, setSawBusy] = useState(false);
  // Se fija al abrir: el lote de 1 solo vale para quien nunca buscó; con historial el tour usa el mínimo normal.
  const [guidedCount, setGuidedCount] = useState(1);
  const [hasKeywords, setHasKeywords] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // La búsqueda guiada terminó cuando se vio `busy` y ya hay resultados.
  if (open && busy && !sawBusy) setSawBusy(true);
  const resultsReady = sawBusy && !busy && resultCount > 0;
  const current = step === LAUNCH && resultsReady ? RESULTS : step;
  const config = STEPS[current];

  const start = useCallback(() => {
    setStep(0);
    setSawBusy(false);
    setGuidedCount(hasHistory ? MIN_BATCH : 1);
    setOpen(true);
  }, [hasHistory]);

  const close = useCallback((value: "completed" | "skipped") => {
    markDone(userId, value);
    if (cardRef.current?.contains(document.activeElement)) launcherRef.current?.focus();
    setOpen(false);
  }, [userId]);

  useEffect(() => { onGuidedCountChange(open ? guidedCount : null); }, [open, guidedCount, onGuidedCountChange]);
  useEffect(() => {
    if (!open) return;
    const sync = () => setHasKeywords(keywordsTyped());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && (cardRef.current?.contains(document.activeElement) || !event.defaultPrevented)) close("skipped"); };
    const frame = requestAnimationFrame(sync);
    document.addEventListener("input", sync);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("input", sync);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const { rect, card } = useSpotlight(open, config.anchor, config.focus, bodyId, cardRef);

  const key: StepKey = config.key;
  const repeat = guidedCount === MIN_BATCH;
  const text = (field: "title" | "body") => {
    const variant = `steps.${key}.${field}Repeat`;
    return repeat && t.has(variant) ? t(variant, { credits: guidedCount * 2 }) : t(`steps.${key}.${field}`);
  };
  const canAdvance = key === "keywords" ? hasKeywords : key === "location" ? hasCountry : key !== "launch";
  const hint = key === "keywords" && !hasKeywords ? t("steps.keywords.hint")
    : key === "location" && !hasCountry ? t("steps.location.hint")
    : key === "launch" ? (busy ? t("steps.launch.searching") : sawBusy ? t("steps.launch.failed") : "")
    : "";

  return (
    <>
      <button ref={launcherRef} type="button" className="onboarding-launch" onClick={start} aria-label={t("launchLabel")}>
        <CircleHelp size={15} strokeWidth={1.9} aria-hidden="true" />
        <span>{t("launch")}</span>
      </button>
      {open && (
        <>
          {rect && (
            <div
              className="onboarding-spotlight"
              aria-hidden="true"
              style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
            />
          )}
          <div
            ref={cardRef}
            className="onboarding-card"
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            tabIndex={-1}
            style={card ? { top: card.top, left: card.left } : undefined}
          >
            <div className="onboarding-card-head">
              <span className="onboarding-counter">{t("stepCounter", { current: current + 1, total: STEPS.length })}</span>
              <button type="button" className="onboarding-skip" onClick={() => close("skipped")}>
                <X size={14} strokeWidth={2} aria-hidden="true" />
                <span>{t("skip")}</span>
              </button>
            </div>
            <h3 id={titleId}>{text("title")}</h3>
            <p id={bodyId}>{text("body")}</p>
            {hint && <p className="onboarding-hint" role="status">{hint}</p>}
            <div className="onboarding-actions">
              <button type="button" className="onboarding-button" disabled={current === 0 || current === RESULTS} onClick={() => setStep(current - 1)}>
                {t("back")}
              </button>
              {current === RESULTS ? (
                <button type="button" className="onboarding-button is-primary" onClick={() => close("completed")}>{t("finish")}</button>
              ) : (
                <button type="button" className="onboarding-button is-primary" disabled={!canAdvance} onClick={() => setStep(current + 1)}>
                  {t("next")}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
