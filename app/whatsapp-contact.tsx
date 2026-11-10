"use client";

import { ExternalLink, MessageCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_MESSAGE = "Hola, vi tu negocio y quería hacerte una consulta.";

function getWhatsAppNumber(phone: string) {
  const normalized = phone.trim();
  if (!/^(?:\+|00)[\d\s().-]+$/.test(normalized)) return null;

  const digits = normalized.replace(/\D/g, "");
  const internationalDigits = normalized.startsWith("00") ? digits.slice(2) : digits;
  return internationalDigits.length >= 8 && internationalDigits.length <= 15
    ? internationalDigits
    : null;
}

type WhatsAppContactProps = { phone: string };

export default function WhatsAppContact({ phone }: WhatsAppContactProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverId = useId();
  const number = getWhatsAppNumber(phone);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(336, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const popoverHeight = popoverRef.current?.offsetHeight ?? 320;
      const top = rect.bottom + popoverHeight + 10 <= window.innerHeight
        ? rect.bottom + 8
        : Math.max(12, rect.top - popoverHeight - 8);
      setPosition((current) => current?.left === left && current.top === top ? current : { left, top });
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    updatePosition();
    const focusFrame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const close = () => setOpen(false);
  const encodedMessage = message.trim();
  const directUrl = number ? `https://wa.me/${number}` : undefined;
  const messageUrl = number && encodedMessage
    ? `${directUrl}?text=${encodeURIComponent(encodedMessage)}`
    : undefined;

  if (!phone.trim()) return <span aria-label="Sin teléfono">—</span>;

  return (
    <>
      <button
        ref={triggerRef}
        className="whatsapp-contact-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          setPosition(null);
          setOpen((current) => !current);
        }}
      >
        {phone}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          className="whatsapp-contact-popover"
          id={popoverId}
          role="dialog"
          aria-labelledby={`${popoverId}-title`}
          style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: position ? "visible" : "hidden" }}
        >
          <div className="whatsapp-contact-heading">
            <div>
              <h2 id={`${popoverId}-title`}>Contactar por WhatsApp</h2>
              <p>{phone}</p>
            </div>
            <button className="whatsapp-contact-close" type="button" onClick={close} aria-label="Cerrar">
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <label className="whatsapp-contact-label" htmlFor={`${popoverId}-message`}>
            Mensaje
          </label>
          <textarea
            ref={textareaRef}
            className="whatsapp-contact-message"
            id={`${popoverId}-message`}
            value={message}
            maxLength={500}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
          />
          <div className="whatsapp-contact-actions">
            {messageUrl ? (
              <a className="whatsapp-contact-action whatsapp-contact-action-primary" href={messageUrl} target="_blank" rel="noreferrer" onClick={close}>
                <MessageCircle size={16} aria-hidden="true" />
                Abrir con mensaje
              </a>
            ) : (
              <button className="whatsapp-contact-action whatsapp-contact-action-primary" type="button" disabled>
                <MessageCircle size={16} aria-hidden="true" />
                Abrir con mensaje
              </button>
            )}
            {directUrl ? (
              <a className="whatsapp-contact-action whatsapp-contact-action-secondary" href={directUrl} target="_blank" rel="noreferrer" onClick={close}>
                <ExternalLink size={15} aria-hidden="true" />
                WhatsApp directo
              </a>
            ) : (
              <button className="whatsapp-contact-action whatsapp-contact-action-secondary" type="button" disabled>
                <ExternalLink size={15} aria-hidden="true" />
                WhatsApp directo
              </button>
            )}
          </div>
          {!number && <p className="whatsapp-contact-hint" role="status">El número no tiene un formato internacional válido.</p>}
        </div>,
        document.body,
      )}
    </>
  );
}
