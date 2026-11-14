export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-start` | `${Side}-end`;

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };
type Size = { width: number; height: number };

const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function parsePlacement(placement: Placement): [Side, Align] {
  const [side, align = "center"] = placement.split("-") as [Side, Align?];
  return [side, align];
}

/**
 * Fallback positioning (no CSS Anchor Positioning): flip to the opposite side when the preferred one
 * doesn't fit and the other does, then shift along both axes so the popover stays `padding` px inside
 * the viewport. Returns fixed-position coordinates, the side actually used and the arrow offset.
 */
export function computePosition(anchor: Rect, popover: Size, placement: Placement, viewport: Size, offset = 8, padding = 8) {
  const [preferred, align] = parsePlacement(placement);
  const space: Record<Side, number> = {
    top: anchor.top - padding,
    bottom: viewport.height - anchor.bottom - padding,
    left: anchor.left - padding,
    right: viewport.width - anchor.right - padding,
  };
  const need = (s: Side) => (s === "top" || s === "bottom" ? popover.height : popover.width) + offset;
  const side = space[preferred] < need(preferred) && space[opposite[preferred]] >= need(opposite[preferred]) ? opposite[preferred] : preferred;
  const vertical = side === "top" || side === "bottom";

  let top: number;
  let left: number;
  if (vertical) {
    top = side === "bottom" ? anchor.bottom + offset : anchor.top - offset - popover.height;
    left = align === "start" ? anchor.left : align === "end" ? anchor.right - popover.width : anchor.left + (anchor.width - popover.width) / 2;
  } else {
    left = side === "right" ? anchor.right + offset : anchor.left - offset - popover.width;
    top = align === "start" ? anchor.top : align === "end" ? anchor.bottom - popover.height : anchor.top + (anchor.height - popover.height) / 2;
  }
  // Shift: never past the viewport edges (cross axis, and main axis when neither side fits).
  left = clamp(left, padding, viewport.width - padding - popover.width);
  top = clamp(top, padding, viewport.height - padding - popover.height);

  const arrow = vertical
    ? clamp(anchor.left + anchor.width / 2 - left, 12, popover.width - 12)
    : clamp(anchor.top + anchor.height / 2 - top, 12, popover.height - 12);
  return { top: Math.round(top), left: Math.round(left), side, arrow: Math.round(arrow) };
}

/** CSS Anchor Positioning equivalent: `position-area` for the placement and the margin that carries the offset. */
export function anchorArea(placement: Placement) {
  const [side, align] = parsePlacement(placement);
  const vertical = side === "top" || side === "bottom";
  const span = align === "center" ? "" : vertical ? (align === "start" ? " span-right" : " span-left") : (align === "start" ? " span-bottom" : " span-top");
  const margin = { top: "marginBottom", bottom: "marginTop", left: "marginRight", right: "marginLeft" }[side] as "marginTop";
  return { area: side + span, margin };
}
