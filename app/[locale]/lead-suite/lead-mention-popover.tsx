"use client";

import type { ReactNode, RefObject } from "react";
import { Popover } from "@/app/ui/popover";

export type MentionLeadOption = { id: string; name: string; category: string; city: string; contactStatus?: string; batchDate?: string | null; saved?: boolean };

/** Other UI (Leadtita sidebar) asks the chat composer to insert "@lead" at the caret. */
export const MENTION_LEAD_EVENT = "leadta:mention-lead";
export function requestLeadMention(lead: Pick<MentionLeadOption, "id" | "name">) {
  window.dispatchEvent(new CustomEvent(MENTION_LEAD_EVENT, { detail: { id: lead.id, name: lead.name } }));
}

/** Drag & drop of a lead (Leadtita sidebar → chat): custom type so the chat tells it apart from files. */
export const LEAD_DRAG_TYPE = "application/x-leadta-lead";
export function readDraggedLead(data: DataTransfer): Pick<MentionLeadOption, "id" | "name"> | null {
  try {
    const lead = JSON.parse(data.getData(LEAD_DRAG_TYPE)) as { id?: unknown; name?: unknown };
    return typeof lead.id === "string" && typeof lead.name === "string" && lead.name ? { id: lead.id, name: lead.name } : null;
  } catch {
    return null;
  }
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Bolds every query word inside the name (accent/case-insensitive). NFD folding keeps the index map only for 1:1 chars. */
function highlight(name: string, query: string): ReactNode {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const folded = fold(name);
  if (!words.length || folded.length !== name.length) return name;
  const marks = new Array<boolean>(name.length).fill(false);
  for (const word of words) {
    let at = folded.indexOf(word);
    while (at >= 0) { marks.fill(true, at, at + word.length); at = folded.indexOf(word, at + word.length); }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let index = 1; index <= name.length; index += 1) {
    if (index === name.length || marks[index] !== marks[start]) {
      const text = name.slice(start, index);
      parts.push(marks[start] ? <mark key={start}>{text}</mark> : text);
      start = index;
    }
  }
  return parts;
}

export function LeadMentionPopover({
  anchorRef,
  open,
  query,
  leads,
  loading,
  activeIndex,
  onSelect,
  onDismiss,
  labels,
  statusLabel,
  batchLabel,
}: {
  anchorRef: RefObject<HTMLTextAreaElement | null>;
  open: boolean;
  query: string;
  leads: MentionLeadOption[];
  loading: boolean;
  activeIndex: number;
  onSelect: (lead: MentionLeadOption) => void;
  onDismiss: () => void;
  labels: { title: string; recent: string; start: string; loading: string; empty: string; fallback: string; hint: string };
  statusLabel: (status: string) => string;
  batchLabel: (iso: string) => string;
}) {
  if (!open) return null;
  const empty = !query.trim();
  return (
    <Popover open onClose={onDismiss} anchorRef={anchorRef} id="ls-chat-mentions" role="listbox" placement="top-start" offset={12} initialFocus="none" className="ls-chat__mentions" aria-label={labels.title}>
      <p className="ls-chat__mentions-head" aria-hidden="true">{empty ? labels.recent : labels.title}</p>
      {loading && !leads.length ? <p className="ls-chat__mentions-state" role="status">{labels.loading}</p>
        : leads.length ? leads.map((lead, index) => (
          <button key={lead.id} id={`ls-chat-mention-${lead.id}`} type="button" role="option" aria-selected={index === activeIndex} className={`ls-chat__mention${index === activeIndex ? " is-active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(lead)}>
            <span className="ls-chat__mention-row">
              <span className="ls-chat__mention-name">{highlight(lead.name, query)}</span>
              {lead.contactStatus ? <span className={`ls-chat__mention-status is-${lead.contactStatus}`}>{statusLabel(lead.contactStatus)}</span> : null}
            </span>
            <span className="ls-chat__mention-meta">{[lead.category, lead.city, lead.batchDate ? batchLabel(lead.batchDate) : ""].filter(Boolean).join(" · ") || labels.fallback}</span>
          </button>
        )) : <p className="ls-chat__mentions-state">{empty ? labels.start : labels.empty}</p>}
      {leads.length ? <p className="ls-chat__mentions-hint" aria-hidden="true">{labels.hint}</p> : null}
    </Popover>
  );
}
