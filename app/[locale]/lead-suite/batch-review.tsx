"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Mail, Phone } from "lucide-react";

export type BatchReviewRow = { leadId: string; leadName: string; to: string; subject: string; text: string };
export type BatchReviewState = { rows: (BatchReviewRow & { included: boolean; open: boolean })[]; acknowledged: boolean };
type Channel = "email" | "whatsapp";

/** Batches bigger than this need an explicit "I reviewed them" check before sending. */
export const ACK_THRESHOLD = 5;
const TEXT_MAX: Record<Channel, number> = { email: 5000, whatsapp: 1500 };

export const initialBatchReview = (rows: BatchReviewRow[]): BatchReviewState => ({ rows: rows.map((row) => ({ ...row, included: true, open: false })), acknowledged: false });

const included = (state: BatchReviewState) => state.rows.filter((row) => row.included);
const rowValid = (row: BatchReviewRow, channel: Channel) => Boolean(row.text.trim()) && (channel === "whatsapp" || Boolean(row.subject.trim()));

/** Ready to send: at least one recipient, every kept message complete, and the check when the batch is large. */
export function batchReviewReady(state: BatchReviewState, channel: Channel) {
  const kept = included(state);
  return kept.length > 0 && kept.every((row) => rowValid(row, channel)) && (kept.length <= ACK_THRESHOLD || state.acknowledged);
}

/** What the confirm route receives: kept recipients with their (possibly edited) messages. */
export function batchReviewPayload(state: BatchReviewState, channel: Channel) {
  return included(state).map((row) => channel === "email" ? { leadId: row.leadId, subject: row.subject.trim(), body: row.text.trim() } : { leadId: row.leadId, text: row.text.trim() });
}

export const batchReviewCount = (state: BatchReviewState) => included(state).length;

/** Review list of a batch send: every recipient with its full message, include/exclude and inline edits. */
export function BatchReview({ channel, original, state, onChange, disabled }: { channel: Channel; original: BatchReviewRow[]; state: BatchReviewState; onChange: (next: BatchReviewState) => void; disabled: boolean }) {
  const t = useTranslations("leadSuiteChat.batchReview");
  const baseId = useId();
  const kept = included(state).length;
  const allOpen = state.rows.every((row) => row.open);
  const DestinationIcon = channel === "email" ? Mail : Phone;

  const patchRow = (index: number, patch: Partial<BatchReviewState["rows"][number]>) =>
    onChange({ ...state, rows: state.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });

  return (
    <div className="ls-batch">
      <div className="ls-batch__bar">
        <p className="ls-batch__count" aria-live="polite">{t("selected", { count: kept, total: state.rows.length })}</p>
        <button type="button" className="ls-batch__toggle-all" onClick={() => onChange({ ...state, rows: state.rows.map((row) => ({ ...row, open: !allOpen })) })}>
          {allOpen ? t("collapseAll") : t("expandAll")}
        </button>
      </div>

      <ul className="ls-batch__list">
        {state.rows.map((row, index) => {
          const source = original.find((item) => item.leadId === row.leadId);
          const edited = Boolean(source) && (source!.text !== row.text || source!.subject !== row.subject);
          const invalid = row.included && !rowValid(row, channel);
          const panelId = `${baseId}-panel-${index}`;
          const checkId = `${baseId}-check-${index}`;
          return (
            <li key={row.leadId} className={`ls-batch__row${row.included ? "" : " is-excluded"}${invalid ? " is-invalid" : ""}`}>
              <div className="ls-batch__head">
                <input id={checkId} type="checkbox" checked={row.included} disabled={disabled} onChange={(event) => patchRow(index, { included: event.target.checked })} aria-label={t("include", { name: row.leadName })} />
                <label htmlFor={checkId} className="ls-batch__who">
                  <strong>{row.leadName}</strong>
                  <span><DestinationIcon aria-hidden="true" size={13} />{row.to}</span>
                </label>
                {!row.included ? <span className="ls-batch__tag">{t("excluded")}</span> : edited ? <span className="ls-batch__tag is-edited">{t("edited")}</span> : null}
                <button type="button" className="ls-batch__expand" aria-expanded={row.open} aria-controls={panelId} onClick={() => patchRow(index, { open: !row.open })}>
                  <span>{row.open ? t("hide") : t("show")}</span><ChevronDown aria-hidden="true" size={15} />
                </button>
              </div>

              {row.open ? (
                <div id={panelId} className="ls-batch__panel">
                  {channel === "email" ? (
                    <label><span>{t("subject")}</span><input type="text" value={row.subject} maxLength={200} disabled={disabled || !row.included} onChange={(event) => patchRow(index, { subject: event.target.value })} /></label>
                  ) : null}
                  <label><span>{t("message")}</span><textarea value={row.text} maxLength={TEXT_MAX[channel]} rows={channel === "email" ? 7 : 5} disabled={disabled || !row.included} onChange={(event) => patchRow(index, { text: event.target.value })} /></label>
                  {invalid ? <p className="ls-batch__error" role="alert">{t(channel === "email" ? "emptyEmail" : "emptyText")}</p> : null}
                </div>
              ) : (
                <p className="ls-batch__preview" id={panelId}>{channel === "email" && row.subject ? <strong>{row.subject} · </strong> : null}{row.text}</p>
              )}
            </li>
          );
        })}
      </ul>

      {kept === 0 ? <p className="ls-batch__error" role="alert">{t("noneSelected")}</p> : null}
      {kept > ACK_THRESHOLD ? (
        <label className="ls-batch__ack">
          <input type="checkbox" checked={state.acknowledged} disabled={disabled} onChange={(event) => onChange({ ...state, acknowledged: event.target.checked })} />
          <span>{t("acknowledge", { count: kept })}</span>
        </label>
      ) : null}
    </div>
  );
}
