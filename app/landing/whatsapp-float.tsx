"use client";

import { useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { X } from "lucide-react";
import { BrandMark } from "@/app/brand-logo";
import "./whatsapp-float.css";

const WHATSAPP_NUMBER = "5491134083140";

type WhatsappFloatProps = {
  hello: string;
  text: string;
  prefill: string;
  openLabel: string;
  closeLabel: string;
};

export function WhatsappFloat({ hello, text, prefill, openLabel, closeLabel }: WhatsappFloatProps) {
  const [visible, setVisible] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(prefill)}`;

  return (
    <div className="wa-float">
      {cardOpen && (
        <div className="wa-card">
          <a className="wa-card-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={openLabel}>
            <BrandMark className="wa-brand" />
            <span className="wa-card-copy">
              <strong>{hello}</strong>
              <span>{text}</span>
            </span>
          </a>
          <button type="button" className="wa-close" onClick={() => setCardOpen(false)} aria-label={closeLabel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <a className="wa-button" href={href} target="_blank" rel="noopener noreferrer" aria-label={openLabel}>
        <FaWhatsapp size={30} aria-hidden="true" />
        <span className="wa-badge" aria-hidden="true">1</span>
      </a>
    </div>
  );
}
