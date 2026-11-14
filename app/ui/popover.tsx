"use client";

/**
 * Popover / menú anclado a su disparador (sin dependencias).
 *
 *   const plus = usePopover({ menu: true });
 *   <button {...plus.triggerProps} aria-haspopup="menu" aria-label="Adjuntar">+</button>
 *   <Popover {...plus.popoverProps} role="menu" aria-label="Adjuntar" placement="top-start" className="mi-menu">
 *     <button type="button" role="menuitem" onClick={() => { plus.close(); upload(); }}>Subir archivo</button>
 *   </Popover>
 *
 * - Posición: CSS Anchor Positioning (position-area + flip) si el navegador lo soporta; si no, JS
 *   (getBoundingClientRect) con flip + shift dentro del viewport, re-calculado en scroll/resize.
 *   `arrow` fuerza el camino JS (la flecha necesita la coordenada exacta).
 * - Capa: Popover API nativa (`popover="manual"` + showPopover) → top layer, sin clipping por overflow.
 *   Manual y no "auto": el cierre lo maneja este componente para que el clic en el disparador no reabra.
 * - Cierra con Escape, clic afuera y al salir el foco; devuelve el foco al disparador si estaba adentro.
 * - role="menu" | "listbox": foco al ítem seleccionado o al primero, flechas/Home/End, Tab cierra.
 *   role="dialog": foco al primer control (o `initialFocus`).
 */

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { anchorArea, computePosition, type Placement } from "./popover-position";
import "./popover.css";

export type { Placement } from "./popover-position";

const ITEM = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]),[role="option"]:not(:disabled):not([aria-disabled="true"])';
const FOCUSABLE = 'a[href],button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';

let anchorSupport: boolean | undefined;
function supportsAnchorPositioning() {
  anchorSupport ??= typeof CSS !== "undefined" && CSS.supports("anchor-name: --a") && CSS.supports("position-area: bottom");
  return anchorSupport;
}

type PopoverProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  id?: string;
  placement?: Placement;
  /** Distance to the trigger, px. */
  offset?: number;
  arrow?: boolean;
  /** min-width = trigger width (account menu under a full-width trigger). */
  matchAnchorWidth?: boolean;
  role?: "dialog" | "menu" | "listbox";
  /** Default: selected/first item for menus, first control for dialogs. "none" keeps focus where it is. */
  initialFocus?: "none" | RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children: ReactNode;
};

export function Popover(props: PopoverProps) {
  return props.open ? <PopoverSurface {...props} /> : null;
}

function PopoverSurface({
  onClose,
  anchorRef,
  id,
  placement = "bottom-start",
  offset = 8,
  arrow = false,
  matchAnchorWidth = false,
  role = "dialog",
  initialFocus,
  className,
  style,
  children,
  ...aria
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorName = `--popover-${useId().replace(/[^\w-]/g, "")}`;
  const onCloseRef = useRef(onClose);
  const placeRef = useRef<() => void>(() => {});
  const cssAnchorFailed = useRef(false);

  // Runs after every render: re-measures when the anchor or the content changed.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    if (matchAnchorWidth) el.style.minWidth = `${anchor.offsetWidth}px`;

    const { area, margin } = anchorArea(placement);
    const cssProps = ["position-anchor", "position-area", "position-try-fallbacks"];
    const placeWithJs = () => {
      const node = ref.current;
      const target = anchorRef.current;
      if (!node || !target) return;
      cssProps.forEach((prop) => node.style.removeProperty(prop));
      node.style[margin] = "";
      const position = computePosition(
        target.getBoundingClientRect(),
        { width: node.offsetWidth, height: node.offsetHeight },
        placement,
        { width: document.documentElement.clientWidth, height: window.innerHeight },
        offset,
      );
      node.style.top = `${position.top}px`;
      node.style.left = `${position.left}px`;
      node.style.setProperty("--popover-arrow", `${position.arrow}px`);
      node.dataset.side = position.side;
    };

    if (arrow || !supportsAnchorPositioning() || cssAnchorFailed.current) {
      placeRef.current = placeWithJs;
      placeRef.current();
      return;
    }
    anchor.style.setProperty("anchor-name", anchorName);
    el.style.setProperty("position-anchor", anchorName);
    el.style.setProperty("position-area", area);
    el.style.setProperty("position-try-fallbacks", "flip-block, flip-inline, flip-block flip-inline");
    el.style[margin] = `${offset}px`;
    // CSS anchoring can flip but not shift: if no try-option fits (narrow viewports), switch to the JS path.
    placeRef.current = () => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const edge = 4; // touching the viewport edge counts as overflow
      if (rect.left >= edge && rect.top >= edge && rect.right <= document.documentElement.clientWidth - edge && rect.bottom <= window.innerHeight - edge) return;
      cssAnchorFailed.current = true;
      placeRef.current = placeWithJs;
      placeWithJs();
    };
    placeRef.current();
    return () => { anchor.style.removeProperty("anchor-name"); };
  });

  // Mount: initial focus, dismissal, reposition listeners, focus return on unmount.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = initialFocus === "none"
      ? null
      : initialFocus?.current
        ?? (role === "dialog"
          ? el.querySelector<HTMLElement>(FOCUSABLE)
          : el.querySelector<HTMLElement>('[aria-selected="true"],[aria-checked="true"]') ?? el.querySelector<HTMLElement>(ITEM))
        ?? el;
    target?.focus({ preventScroll: true });

    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => placeRef.current()); };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node;
      if (el.contains(node) || anchorRef.current?.contains(node)) return;
      onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (anchorRef.current) observer.observe(anchorRef.current);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const anchor = anchorRef.current;
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      const active = document.activeElement;
      if (!active || active === document.body || el.contains(active)) anchor?.focus({ preventScroll: true });
    };
    // Mount-only: later prop changes are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (role === "dialog" || !ref.current) return;
    if (event.key === "Tab") { onCloseRef.current(); return; }
    const items = [...ref.current.querySelectorAll<HTMLElement>(ITEM)];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length
      : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
        : event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next].focus();
  }

  // Focus left both popover and trigger (Tab away, click in another window region) → close.
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && (ref.current?.contains(next) || anchorRef.current?.contains(next))) return;
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node || !document.hasFocus()) return;
      const active = document.activeElement;
      if (active && (node.contains(active) || anchorRef.current?.contains(active))) return;
      onCloseRef.current();
    });
  }

  return (
    <div
      ref={ref}
      id={id}
      popover="manual"
      role={role}
      tabIndex={-1}
      className={className ? `ui-popover ${className}` : "ui-popover"}
      data-placement={placement}
      style={style}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      {...aria}
    >
      {children}
      {arrow && <span className="ui-popover-arrow" aria-hidden="true" />}
    </div>
  );
}

/** State + trigger wiring. `menu: true` also opens with ArrowDown/ArrowUp on the trigger. */
export function usePopover<T extends HTMLElement = HTMLButtonElement>(options: { menu?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<T>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const { menu = false } = options;

  return {
    open,
    setOpen,
    close,
    anchorRef,
    triggerProps: {
      ref: anchorRef,
      "aria-expanded": open,
      "aria-controls": open ? id : undefined,
      onClick: () => setOpen((value) => !value),
      onKeyDown: menu
        ? (event: ReactKeyboardEvent<T>) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            setOpen(true);
          }
        : undefined,
    },
    popoverProps: { open, onClose: close, anchorRef, id },
  };
}
