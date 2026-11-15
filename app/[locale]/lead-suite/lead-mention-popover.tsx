"use client";

import type { RefObject } from "react";
import { Popover } from "@/app/ui/popover";

export type MentionLeadOption = { id: string; name: string; category: string; city: string };

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
}: {
  anchorRef: RefObject<HTMLTextAreaElement | null>;
  open: boolean;
  query: string;
  leads: MentionLeadOption[];
  loading: boolean;
  activeIndex: number;
  onSelect: (lead: MentionLeadOption) => void;
  onDismiss: () => void;
  labels: { title: string; start: string; loading: string; empty: string; fallback: string };
}) {
  if (!open) return null;
  return (
    <Popover open onClose={onDismiss} anchorRef={anchorRef} id="ls-chat-mentions" role="listbox" placement="top-start" offset={12} initialFocus="none" className="ls-chat__mentions" aria-label={labels.title}>
      {!query.trim() ? <p className="ls-chat__mentions-state">{labels.start}</p>
        : loading ? <p className="ls-chat__mentions-state" role="status">{labels.loading}</p>
          : leads.length ? leads.map((lead, index) => (
            <button key={lead.id} id={`ls-chat-mention-${lead.id}`} type="button" role="option" aria-selected={index === activeIndex} className={`ls-chat__mention${index === activeIndex ? " is-active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(lead)}>
              <span className="ls-chat__mention-name">{lead.name}</span>
              <span className="ls-chat__mention-meta">{[lead.category, lead.city].filter(Boolean).join(" · ") || labels.fallback}</span>
            </button>
          )) : <p className="ls-chat__mentions-state">{labels.empty}</p>}
    </Popover>
  );
}
