"use client";

import { ExternalLink, MessageCircle, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Popover, usePopover } from "@/app/ui/popover";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("WhatsApp");
  const [message, setMessage] = useState(() => t("defaultMessage"));
  const dialog = usePopover();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverId = useId();
  const number = getWhatsAppNumber(phone);

  const close = dialog.close;
  const encodedMessage = message.trim();
  const directUrl = number ? `https://wa.me/${number}` : undefined;
  const messageUrl = number && encodedMessage
    ? `${directUrl}?text=${encodeURIComponent(encodedMessage)}`
    : undefined;

  if (!phone.trim()) return <span aria-label={t("noPhone")}>—</span>;

  return (
    <>
      <button {...dialog.triggerProps} className="whatsapp-contact-trigger" type="button" aria-haspopup="dialog">
        {phone}
      </button>
      <Popover
        {...dialog.popoverProps}
        role="dialog"
        placement="bottom-start"
        initialFocus={textareaRef}
        className="whatsapp-contact-popover"
        aria-labelledby={`${popoverId}-title`}
      >
          <div className="whatsapp-contact-heading">
            <div>
              <h2 id={`${popoverId}-title`}>{t("title")}</h2>
              <p>{phone}</p>
            </div>
            <button className="whatsapp-contact-close" type="button" onClick={close} aria-label={t("close")}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <label className="whatsapp-contact-label" htmlFor={`${popoverId}-message`}>
            {t("message")}
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
                {t("openWithMessage")}
              </a>
            ) : (
              <button className="whatsapp-contact-action whatsapp-contact-action-primary" type="button" disabled>
                <MessageCircle size={16} aria-hidden="true" />
                {t("openWithMessage")}
              </button>
            )}
            {directUrl ? (
              <a className="whatsapp-contact-action whatsapp-contact-action-secondary" href={directUrl} target="_blank" rel="noreferrer" onClick={close}>
                <ExternalLink size={15} aria-hidden="true" />
                {t("direct")}
              </a>
            ) : (
              <button className="whatsapp-contact-action whatsapp-contact-action-secondary" type="button" disabled>
                <ExternalLink size={15} aria-hidden="true" />
                {t("direct")}
              </button>
            )}
          </div>
          {!number && <p className="whatsapp-contact-hint" role="status">{t("invalidNumber")}</p>}
      </Popover>
    </>
  );
}
