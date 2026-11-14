"use client";

import { ExternalLink, X } from "lucide-react";
import { useId, type RefObject } from "react";
import { Popover } from "@/app/ui/popover";
import { useTranslations } from "next-intl";

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
  const popoverId = useId();
  const detailUrl = /^https?:\/\//i.test(value) ? value : "";

  // Focus stays on the cell (anchor) while open; Escape/outside click close and the cell keeps focus.
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      id={popoverId}
      role="dialog"
      placement="bottom-start"
      initialFocus="none"
      className="cell-details-popover"
      aria-labelledby={`${popoverId}-title`}
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
    </Popover>
  );
}
