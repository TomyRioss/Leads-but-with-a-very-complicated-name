"use client";

import { useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ArrowUp, Globe, Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import type { ExploreInput as ExploreInputValue } from "@/lib/explore/types";
import WebThreads from "./web-threads";
import { TurnstileField, type TurnstileFieldHandle } from "@/app/turnstile-field";
import { ServicesDialog } from "./services-dialog";

const TEXT_MAX = 1000;
const URL_MAX = 300;
const TEXT_MAX_HEIGHT = 112; // ~4 líneas
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** "https://www.Loruppa.com/x" → "loruppa.com"; "" si no parece un dominio. */
function toDomain(value: string) {
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0] ?? "";
  return host.length <= 253 && DOMAIN_RE.test(host) ? host : "";
}

type ErrorKind = "" | "quota" | "failed";

/** Favicon del dominio; globo neutro hasta que carga (montar con key={domain} para no mostrar el de otro dominio). */
function DomainIcon({ domain }: { domain: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="relative grid size-5 flex-none place-items-center">
      {!loaded && <Globe size={16} className="text-(color:--ash-500)" aria-hidden="true" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- favicon externo de 32px */}
      <img
        // ponytail: gstatic directo evita el 301 de google.com/s2/favicons.
        src={`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=32`}
        alt=""
        width={20}
        height={20}
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 size-5 rounded ${loaded ? "" : "invisible"}`}
      />
    </span>
  );
}

/** Caja del hero que arranca el flujo público /explorar (texto, web o servicios). */
export function ExploreInput() {
  const t = useTranslations("Landing.hero.explore");
  const locale = useLocale();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [mode, setMode] = useState<"text" | "web">("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKind>("");
  const [servicesOpen, setServicesOpen] = useState(false);

  const domain = mode === "web" ? toDomain(url) : "";
  const valid = mode === "text" ? text.trim().length >= 3 : Boolean(domain);
  const active = valid && focused;

  async function start(input: ExploreInputValue) {
    if (busy) return;
    setBusy(true);
    setError("");
    const turnstileToken = String(rootRef.current?.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value ?? "");
    try {
      const response = await fetch("/api/explore/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, turnstileToken }),
      });
      if (response.ok) {
        router.push("/explorar");
        return;
      }
      setError(response.status === 429 ? "quota" : "failed");
    } catch {
      setError("failed");
    }
    captchaRef.current?.reset();
    setBusy(false);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!valid) return;
    void start(mode === "text" ? { mode: "text", description: text.trim() } : { mode: "web", url: url.trim() });
  }

  function onTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function fitText(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXT_MAX_HEIGHT)}px`;
  }

  function onBlur(event: FocusEvent<HTMLFormElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }

  const errorNode = error === "quota"
    ? t.rich("quota", { link: (chunks) => <Link href="/register" className="font-semibold text-(color:--ink) underline decoration-(--lime-dark) decoration-2 underline-offset-2">{chunks}</Link> })
    : error === "failed" ? t("failed") : null;

  const toggleClass = (on: boolean) =>
    `min-h-7 rounded-[7px] px-2.5 text-[13px] font-semibold transition-colors outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--lime)_55%,transparent)] ${on ? "bg-(--paper) text-(color:--ink) shadow-[0_1px_2px_color-mix(in_srgb,var(--ash-950)_14%,transparent)]" : "text-(color:--muted) hover:text-(color:--ink)"}`;

  return (
    <div ref={rootRef} className="mx-auto mt-12 grid w-full max-w-[560px] justify-items-center gap-3">
      <form
        className="relative isolate w-full"
        onSubmit={submit}
        onFocus={() => setFocused(true)}
        onBlur={onBlur}
        aria-busy={busy || undefined}
      >
        <div
          className={`flex w-full flex-col gap-1.5 rounded-[18px] border bg-(--paper) p-2 text-left transition-[border-color,box-shadow] ${active ? "border-(--ink) shadow-[0_0_0_1px_var(--ink)]" : "border-(--line) shadow-[0_1px_2px_color-mix(in_srgb,var(--ash-950)_6%,transparent)]"}`}
        >
          <div role="group" aria-label={t("modeLabel")} className="inline-flex w-fit gap-0.5 rounded-[9px] bg-(--ash-100) p-0.5">
            <button type="button" className={toggleClass(mode === "text")} aria-pressed={mode === "text"} onClick={() => { setMode("text"); setError(""); }}>{t("modeText")}</button>
            <button type="button" className={toggleClass(mode === "web")} aria-pressed={mode === "web"} onClick={() => { setMode("web"); setError(""); }}>{t("modeWeb")}</button>
          </div>
          <div className="flex items-end gap-2">
            {mode === "text" ? (
              <textarea
                ref={fitText}
                rows={1}
                value={text}
                maxLength={TEXT_MAX}
                disabled={busy}
                onChange={(event) => { setText(event.target.value); fitText(event.target); }}
                onKeyDown={onTextKeyDown}
                placeholder={t("textPlaceholder")}
                aria-label={t("textLabel")}
                className="min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[16px] leading-6 text-(color:--ink) outline-none! placeholder:text-(color:--ash-500) disabled:opacity-60"
                style={{ maxHeight: TEXT_MAX_HEIGHT }}
              />
            ) : (
              <input
                type="text"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="off"
                spellCheck={false}
                value={url}
                maxLength={URL_MAX}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("webPlaceholder")}
                aria-label={t("webLabel")}
                className="min-h-10 flex-1 border-0 bg-transparent px-2 text-[16px] text-(color:--ink) outline-none! placeholder:text-(color:--ash-500) disabled:opacity-60"
              />
            )}
            <button
              type="submit"
              disabled={!valid || busy}
              aria-label={t("submit")}
              className={`grid size-10 flex-none place-items-center rounded-[10px] transition-colors outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--lime)_55%,transparent)] disabled:cursor-not-allowed ${active || busy ? "bg-(--ink) text-(color:--paper)" : "bg-(--ash-150) text-(color:--ash-600)"}`}
            >
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" size={18} aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {/* Fondo: el pinch (cruce) queda en el centro del recuadro. */}
        <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[440px] w-screen -translate-x-1/2 -translate-y-1/2">
          <WebThreads colors={["#1b6b00", "#2eff00"]} thickness={1.6} brightness={2.4} spread={0.23} pulses={0.3} falloff={0.5} pinch={0.5} position={0.5} lightMode />
        </div>
        {domain && focused && !busy && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => submit()}
            className="absolute inset-x-0 top-[calc(100%+6px)] z-10 flex min-h-12 items-center gap-3 rounded-[14px] border border-(--line) bg-(--paper) px-3 text-left shadow-[0_18px_36px_-20px_color-mix(in_srgb,var(--ash-950)_40%,transparent)] outline-none hover:bg-(--ash-50) focus-visible:border-(--ink)"
          >
            <DomainIcon key={domain} domain={domain} />
            <span className="min-w-0 flex-1 truncate text-[14px]">
              <strong className="font-semibold text-(color:--ink)">{domain}</strong>
              <span className="ml-2 text-(color:--muted)">{t("research")}</span>
            </span>
            <ArrowRight size={16} className="flex-none text-(color:--ink)" aria-hidden="true" />
          </button>
        )}
      </form>
      {errorNode && !servicesOpen ? <p className="m-0 text-center text-[13px] leading-normal text-(color:--ash-800)" role="alert">{errorNode}</p> : null}
      <button
        type="button"
        onClick={() => { setError(""); setServicesOpen(true); }}
        aria-haspopup="dialog"
        className="rounded-md px-1 text-[13px] font-medium text-(color:--muted) underline decoration-(--ash-300) underline-offset-4 transition-colors outline-none hover:text-(color:--ink) focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--lime)_55%,transparent)]"
      >
        {t("services")}
      </button>
      <div className="w-full max-w-[300px] empty:hidden">
        <TurnstileField ref={captchaRef} locale={locale} appearance="interaction-only" />
      </div>
      <ServicesDialog
        open={servicesOpen}
        onClose={() => { if (!busy) { setServicesOpen(false); setError(""); } }}
        onSubmit={(input) => void start(input)}
        busy={busy}
        error={errorNode}
      />
    </div>
  );
}
