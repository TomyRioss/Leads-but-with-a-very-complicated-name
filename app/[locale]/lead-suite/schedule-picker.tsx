"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Send } from "lucide-react";
import "./scheduled.css";

/** Fired after something is scheduled, edited or cancelled: the "Programados" button reloads its count. */
export const SCHEDULED_EVENT = "leadta:scheduled-changed";

const pad = (value: number) => String(value).padStart(2, "0");
/** ISO → value of <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** datetime-local value (browser time zone) → ISO, or "" when empty/invalid. */
export function fromLocalInput(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}
/** Default "Programar" time: one hour from now, rounded up to 5 minutes. */
export function defaultSendAt(now = Date.now()) {
  const step = 5 * 60_000;
  return new Date(Math.ceil((now + 60 * 60_000) / step) * step).toISOString();
}
/** Same window the server accepts (30 s to 90 days ahead). */
export const sendAtValid = (iso: string, now = Date.now()) => {
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && time >= now + 30_000 && time <= now + 90 * 24 * 60 * 60_000;
};

/** "Enviar ahora / Programar" on send cards. `value` null = send on confirm; an ISO date = schedule at that time. */
export function SchedulePicker({ value, onChange, disabled }: { value: string | null; onChange: (next: string | null) => void; disabled: boolean }) {
  const t = useTranslations("leadSuiteChat.schedule");
  const inputId = useId();
  const invalid = value !== null && !sendAtValid(value);
  return (
    <div className="ls-schedule" role="group" aria-label={t("label")}>
      <div className="ls-schedule__modes">
        <button type="button" aria-pressed={value === null} disabled={disabled} onClick={() => onChange(null)}>
          <Send aria-hidden="true" size={14} />{t("now")}
        </button>
        <button type="button" aria-pressed={value !== null} disabled={disabled} onClick={() => onChange(value ?? defaultSendAt())}>
          <CalendarClock aria-hidden="true" size={14} />{t("later")}
        </button>
      </div>
      {value !== null ? (
        <div className="ls-schedule__when">
          <label htmlFor={inputId}>{t("when")}</label>
          <input id={inputId} type="datetime-local" value={toLocalInput(value)} min={toLocalInput(new Date().toISOString())} disabled={disabled} aria-invalid={invalid || undefined} onChange={(event) => { const next = fromLocalInput(event.target.value); if (next) onChange(next); }} />
          {invalid ? <p className="ls-schedule__error" role="alert">{t("invalid")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
