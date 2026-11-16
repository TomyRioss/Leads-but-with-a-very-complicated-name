"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { LEADTITA_TOUR_EVENT, writeMode } from "@/app/[locale]/lead-suite/chat-panel";
import { useSpotlight } from "./onboarding";
import "./onboarding.css";

// Tour de Leadtita. `anchor` apunta a un `data-onboarding="..."` del chat.
// WhatsApp y Gmail se ofrecen antes, en la pantalla opcional de ChannelSetup.
const STEPS = [
  { key: "intro", anchor: "leadtita-intro", focus: false },
  { key: "ask", anchor: "leadtita-composer", focus: true },
  { key: "confirm", anchor: "leadtita-search", focus: false },
  { key: "results", anchor: "leadtita-search", focus: false },
] as const;
const ASK = 1;
const CONFIRM = 2;
const RESULTS = 3;
const FAILED = ["cancelled", "expired", "stale"];

// ?tour=1 queda pendiente en la sesión: sobrevive a ChannelSetup y al ida y vuelta de OAuth de Gmail.
const PENDING_KEY = "leadta:leadtita-onboarding-pending";
const DONE_KEY = (userId: string) => `leadta:leadtita-onboarding:${userId}`;

/** /buscar llama esto para un usuario sin búsquedas: true una sola vez por usuario y navegador. */
export function claimLeadtitaTour(userId: string) {
  try {
    if (localStorage.getItem(DONE_KEY(userId)) !== null) return false;
    localStorage.setItem(DONE_KEY(userId), "redirected");
    return true;
  } catch { return false; }
}
function setPending(value: boolean) {
  try { if (value) sessionStorage.setItem(PENDING_KEY, "1"); else sessionStorage.removeItem(PENDING_KEY); } catch { /* sin storage: el tour solo abre sin desvíos */ }
}
function isPending() {
  try { return sessionStorage.getItem(PENDING_KEY) === "1"; } catch { return false; }
}
/** Estado de la tarjeta de búsqueda más nueva: null si todavía no hay; "pending" | "busy" | "done" | ... */
function searchState() {
  const cards = document.querySelectorAll<HTMLElement>('[data-onboarding="leadtita-search"]');
  return cards.length ? cards[cards.length - 1].dataset.state ?? "pending" : null;
}

/** `ready`: el chat ya está en pantalla (ChannelSetup resuelto). */
export function LeadtitaOnboarding({ ready }: { ready: boolean }) {
  const t = useTranslations("Onboarding.leadtita");
  const common = useTranslations("Onboarding");
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  let current = step;
  if (current === ASK && search && !FAILED.includes(search)) current = CONFIRM;
  if (current === CONFIRM && search === "done") current = RESULTS;
  const config = STEPS[current];

  const close = useCallback(() => { setPending(false); setOpen(false); }, []);

  // ?tour=1 (redirección desde /buscar) se guarda y se limpia de la URL al montar, aunque ChannelSetup esté primero.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tour") !== "1") return;
    setPending(true);
    url.searchParams.delete("tour");
    window.history.replaceState(null, "", url);
  }, []);

  // Abre cuando el chat está visible y hay un tour pendiente.
  useEffect(() => {
    if (!ready || !isPending()) return;
    writeMode("generator");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apertura única al quedar listo el chat; depende de sessionStorage
    setOpen(true);
  }, [ready]);

  // Botón "Ver tutorial" del chat: reabre el tour desde el primer paso, aunque ya se haya visto.
  useEffect(() => {
    const replay = () => { writeMode("generator"); setStep(0); setOpen(true); };
    window.addEventListener(LEADTITA_TOUR_EVENT, replay);
    return () => window.removeEventListener(LEADTITA_TOUR_EVENT, replay);
  }, []);

  // La tarjeta de búsqueda la dibuja el chat: se observa el DOM en vez de acoplar el tour al estado interno del chat.
  useEffect(() => {
    if (!open) return;
    const root = document.querySelector(".ls-chat") ?? document.body;
    const sync = () => setSearch(searchState());
    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    sync();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && (cardRef.current?.contains(document.activeElement) || !event.defaultPrevented)) close(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { observer.disconnect(); document.removeEventListener("keydown", onKeyDown); };
  }, [open, close]);

  const { rect, card } = useSpotlight(open, config.anchor, config.focus, bodyId, cardRef);
  if (!open) return null;

  const hint = current === ASK ? (search && FAILED.includes(search) ? t("ask.retry") : t("ask.hint"))
    : current === CONFIRM ? (search === "busy" ? t("confirm.searching") : t("confirm.hint"))
    : "";
  const canAdvance = current !== ASK && current !== CONFIRM;

  return (
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
          <span className="onboarding-counter">{common("stepCounter", { current: current + 1, total: STEPS.length })}</span>
          <button type="button" className="onboarding-skip" onClick={close}>
            <X size={14} strokeWidth={2} aria-hidden="true" />
            <span>{common("skip")}</span>
          </button>
        </div>
        <h3 id={titleId}>{t(`${config.key}.title`)}</h3>
        <p id={bodyId}>{t(`${config.key}.body`)}</p>
        {hint && <p className="onboarding-hint" role="status">{hint}</p>}
        <div className="onboarding-actions">
          <button type="button" className="onboarding-button" disabled={current === 0 || current >= CONFIRM} onClick={() => setStep(current - 1)}>
            {common("back")}
          </button>
          {current === RESULTS ? (
            <button type="button" className="onboarding-button is-primary" onClick={close}>{common("finish")}</button>
          ) : (
            <button type="button" className="onboarding-button is-primary" disabled={!canAdvance} onClick={() => setStep(current + 1)}>
              {common("next")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
