"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

const subscribeToHydration = () => () => {};

type CellDetailsPopoverProps = {
  open: boolean;
  anchorRef: RefObject<HTMLTableCellElement | null>;
  title: string;
  leadName: string;
  value: string;
  onClose: () => void;
};

export default function CellDetailsPopover({
  open,
  anchorRef,
  title,
  leadName,
  value,
  onClose,
}: CellDetailsPopoverProps) {
  const t = useTranslations("CellDetails");
  const portalReady = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const popoverId = useId();
  const detailUrl = /^https?:\/\//i.test(value) ? value : "";

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) anchorRef.current?.focus({ preventScroll: true });
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const width = Math.min(420, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const height = popoverRef.current?.offsetHeight ?? 300;
      const top = rect.bottom + height + 10 <= window.innerHeight
        ? rect.bottom + 8
        : Math.max(12, rect.top - height - 8);

      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onClose();
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portalReady, anchorRef, onClose, title, leadName, value]);

  if (!open || !portalReady) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="cell-details-popover"
      id={popoverId}
      role="dialog"
      aria-labelledby={`${popoverId}-title`}
      style={{ left: position.left, top: position.top }}
    >
      <div className="cell-details-popover-heading">
        <div className="cell-details-popover-labels">
          <h2 id={`${popoverId}-title`}>{title}</h2>
          <p>{leadName}</p>
        </div>
        <button className="cell-details-popover-close" type="button" onClick={onClose} aria-label={t("close")}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="cell-details-popover-value">{value || t("empty")}</div>
      {detailUrl && <a className="cell-details-popover-link" href={detailUrl} target="_blank" rel="noreferrer">{t("openLink")} <ExternalLink size={14} aria-hidden="true" /></a>}
    </div>,
    document.body,
  );
}
