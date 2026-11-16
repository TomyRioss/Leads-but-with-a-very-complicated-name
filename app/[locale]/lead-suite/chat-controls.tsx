"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BriefcaseBusiness, CalendarCheck, Check, ChartNoAxesCombined, ChevronDown, CircleAlert, Search } from "lucide-react";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import { GoogleFeatureConnectButton } from "@/app/google-drive-connect";
import { WhatsAppConnectCard } from "@/app/whatsapp-connect";
import { Popover } from "@/app/ui/popover";
import { PermissionControl } from "./chat-permissions";

export type LeadtitaMode = "seller" | "generator" | "planner";
export type LeadtitaSalesChannel = "whatsapp" | "gmail" | null;

type WhatsAppStatus = { configured: boolean; status: "disconnected" | "connecting" | "qr" | "connected" };
type GoogleStatus = { configured: boolean; email?: string; features?: { gmail?: boolean } };
type Props = {
  mode: LeadtitaMode;
  onModeChange: (mode: LeadtitaMode) => void;
  salesChannel: LeadtitaSalesChannel;
  onSalesChannelChange: (channel: LeadtitaSalesChannel) => void;
  onResumeTyping: () => void;
  /** Connection per channel: true/false when known, null while loading or when the channel isn't offered here. */
  onChannelsChange?: (channels: Record<"whatsapp" | "gmail", boolean | null>) => void;
};

/** Leadtita shortcuts ask the sales popover to open on a channel's connect step (detail: "whatsapp" | "gmail"). */
export const OPEN_CHANNEL_CONNECT_EVENT = "leadta:open-channel-connect";

const modes: LeadtitaMode[] = ["seller", "generator", "planner"];
const modeIcons = { seller: BriefcaseBusiness, generator: Search, planner: CalendarCheck } as const;

export function ChatControls({ mode, onModeChange, salesChannel, onSalesChannelChange, onResumeTyping, onChannelsChange }: Props) {
  const t = useTranslations("leadSuiteChat");
  const [open, setOpen] = useState<"mode" | "sales" | null>(null);
  const [connectView, setConnectView] = useState<"whatsapp" | "gmail" | null>(null);
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [statusErrors, setStatusErrors] = useState({ whatsapp: false, gmail: false });
  // Bumped when the sales popover opens: status loads on mount (button warning) and refreshes on each open.
  const [statusReload, setStatusReload] = useState(0);
  // Inline "Disconnect?" confirmation per channel; Gmail drops the whole Google link (Drive and Calendar too).
  const [disconnecting, setDisconnecting] = useState<"whatsapp" | "gmail" | null>(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState(false);
  const modeAnchor = useRef<HTMLButtonElement>(null);
  const salesAnchor = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [wa, google] = await Promise.allSettled([
        fetch("/api/integrations/whatsapp/status", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("WhatsApp status unavailable");
          return await response.json() as WhatsAppStatus;
        }),
        fetch("/api/integrations/google/status", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("Gmail status unavailable");
          return await response.json() as GoogleStatus;
        }),
      ]);
      if (!active) return;
      if (wa.status === "fulfilled") setWaStatus(wa.value);
      if (google.status === "fulfilled") setGoogleStatus(google.value);
      setStatusErrors({ whatsapp: wa.status === "rejected", gmail: google.status === "rejected" });
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("leadta:whatsapp-status", refresh);
    window.addEventListener("leadta:google-status", refresh);
    return () => {
      active = false;
      window.removeEventListener("leadta:whatsapp-status", refresh);
      window.removeEventListener("leadta:google-status", refresh);
    };
  }, [statusReload]);

  const waConnected = waStatus?.configured && waStatus.status === "connected";
  const gmailConnected = googleStatus?.configured && Boolean(googleStatus.features?.gmail);
  const channelsMissing = (waStatus?.configured && !waConnected) || (googleStatus?.configured && !gmailConnected);
  const waReady = waStatus?.configured ? Boolean(waConnected) : null;
  const gmailReady = googleStatus?.configured ? Boolean(gmailConnected) : null;
  useEffect(() => { onChannelsChange?.({ whatsapp: waReady, gmail: gmailReady }); }, [waReady, gmailReady, onChannelsChange]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const channel = (event as CustomEvent<unknown>).detail;
      if (channel !== "whatsapp" && channel !== "gmail") return;
      setDisconnecting(null);
      setConnectView(channel);
      setOpen("sales");
    };
    window.addEventListener(OPEN_CHANNEL_CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHANNEL_CONNECT_EVENT, onOpen);
  }, []);

  const chooseMode = (value: LeadtitaMode) => {
    onModeChange(value);
    setOpen(null);
    window.setTimeout(onResumeTyping, 0);
  };

  const chooseChannel = (value: Exclude<LeadtitaSalesChannel, null>) => {
    const selecting = salesChannel !== value;
    onSalesChannelChange(selecting ? value : null);
    // Picking a channel that isn't connected keeps the popover open on its connect step.
    const missing = value === "whatsapp" ? waStatus?.configured && !waConnected : googleStatus?.configured && !gmailConnected;
    if (selecting && missing) { setConnectView(value); return; }
    setOpen(null);
    window.setTimeout(onResumeTyping, 0);
  };

  const disconnect = async (channel: "whatsapp" | "gmail") => {
    setDisconnectBusy(true);
    setDisconnectError(false);
    try {
      const response = await fetch(`/api/integrations/${channel === "whatsapp" ? "whatsapp" : "google"}/disconnect`, { method: "POST" });
      if (!response.ok) throw new Error("disconnect failed");
      setDisconnecting(null);
      // Same events the integration cards use: every status view (this one included) reloads.
      window.dispatchEvent(new Event(channel === "whatsapp" ? "leadta:whatsapp-status" : "leadta:google-status"));
    } catch {
      setDisconnectError(true);
    } finally {
      setDisconnectBusy(false);
    }
  };

  const disconnectRow = (channel: "whatsapp" | "gmail") => disconnecting === channel ? (
    <div className="ls-chat__sales-disconnect" role="group" aria-label={t(`salesDisconnectAsk.${channel}`)}>
      <span>{disconnectError ? t("salesDisconnectError") : t(`salesDisconnectAsk.${channel}`)}</span>
      <button type="button" className="ls-chat__sales-connect is-danger" disabled={disconnectBusy} onClick={() => void disconnect(channel)}>{t("salesDisconnectYes")}</button>
      <button type="button" className="ls-chat__sales-connect" disabled={disconnectBusy} onClick={() => { setDisconnecting(null); setDisconnectError(false); }}>{t("salesDisconnectNo")}</button>
    </div>
  ) : null;

  const ModeIcon = modeIcons[mode];

  return (
    <div className="ls-chat__controls">
      <div className="ls-chat__control-wrap">
        <button ref={modeAnchor} type="button" className={`ls-chat__control ls-chat__control--mode${open === "mode" ? " is-open" : ""}`} onClick={() => { setConnectView(null); setOpen((value) => value === "mode" ? null : "mode"); }} aria-haspopup="menu" aria-expanded={open === "mode"}>
          <ModeIcon className="ls-chat__control-icon" size={15} aria-hidden="true" /><span>{t("modeLabel")}</span><span className="ls-chat__control-current">{t(`modes.${mode}`)}</span><ChevronDown size={13} aria-hidden="true" />
        </button>
        {open === "mode" && (
          <Popover open onClose={() => setOpen(null)} anchorRef={modeAnchor} role="menu" placement="top-start" offset={8} className="ls-chat__mode-menu" aria-label={t("modeLabel")}>
            <div className="ls-chat__mode-head"><strong>{t("modeTitle")}</strong><span>{t("modeHelp")}</span></div>
            <div className="ls-chat__mode-options" role="group" aria-label={t("modeLabel")}>
              {modes.map((value) => {
                const ModeOptionIcon = modeIcons[value];
                return (
                  <button key={value} type="button" role="menuitem" aria-current={mode === value ? "true" : undefined} className="ls-chat__mode-option" onClick={() => chooseMode(value)}>
                    <span className="ls-chat__mode-option-icon"><ModeOptionIcon size={16} aria-hidden="true" /></span>
                    <span className="ls-chat__mode-option-copy"><strong>{t(`modes.${value}`)}</strong><small>{t(`modeHints.${value}`)}</small></span>
                    {mode === value ? <Check className="ls-chat__mode-check" size={16} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </Popover>
        )}
      </div>

      <div className="ls-chat__control-wrap">
        <button ref={salesAnchor} type="button" className={`ls-chat__control ls-chat__control--sales${open === "sales" ? " is-open" : ""}${salesChannel ? " has-selection" : ""}`} onClick={() => { setConnectView(null); setStatusErrors({ whatsapp: false, gmail: false }); if (open !== "sales") setStatusReload((value) => value + 1); setOpen((value) => value === "sales" ? null : "sales"); }} aria-haspopup="dialog" aria-expanded={open === "sales"}>
          <ChartNoAxesCombined className="ls-chat__control-icon" size={16} aria-hidden="true" /><span>{t("salesLabel")}</span>{salesChannel ? <span className="ls-chat__control-current">{t(`channels.${salesChannel}`)}</span> : null}{channelsMissing ? <><CircleAlert className="ls-chat__control-alert" size={14} aria-hidden="true" /><span className="ls-chat__sr">{t("salesMissing")}</span></> : null}<ChevronDown size={13} aria-hidden="true" />
        </button>
        {open === "sales" && (
          <Popover open onClose={() => { setOpen(null); setConnectView(null); setDisconnecting(null); }} anchorRef={salesAnchor} role="dialog" placement="top-start" offset={10} initialFocus="none" className="ls-chat__sales-menu" aria-label={t("salesLabel")}>
            <div className="ls-chat__sales-head">
              <strong>{t("salesTitle")}</strong>
              <span>{t("salesHint")}</span>
            </div>
            <div className="ls-chat__sales-options">
                <div className="ls-chat__sales-row">
                  <button type="button" className="ls-chat__sales-choice" aria-pressed={salesChannel === "whatsapp"} onClick={() => chooseChannel("whatsapp")}>
                    <SiWhatsapp size={18} aria-hidden="true" style={{ color: waConnected ? "var(--whatsapp)" : "var(--ash-500)" }} />
                    <span><strong>WhatsApp</strong><small>{statusErrors.whatsapp ? t("salesStatusError") : waConnected ? t("salesConnected") : waStatus ? t(!waStatus.configured ? "salesUnavailable" : waStatus.status === "connecting" || waStatus.status === "qr" ? "salesConnecting" : "salesDisconnected") : t("salesChecking")}</small></span>
                    {salesChannel === "whatsapp" ? <Check className="is-selected" size={15} aria-hidden="true" /> : null}
                  </button>
                  {!waConnected && waStatus?.configured ? <button type="button" className="ls-chat__sales-connect" onClick={() => setConnectView("whatsapp")}>{t("salesConnect")}</button> : null}
                  {waConnected && disconnecting !== "whatsapp" ? <button type="button" className="ls-chat__sales-connect" onClick={() => { setDisconnecting("whatsapp"); setDisconnectError(false); }}>{t("salesDisconnect")}</button> : null}
                </div>
                {disconnectRow("whatsapp")}
                <div className="ls-chat__sales-row">
                  <button type="button" className="ls-chat__sales-choice" aria-pressed={salesChannel === "gmail"} onClick={() => chooseChannel("gmail")}>
                    <SiGmail size={17} aria-hidden="true" />
                    <span><strong>Gmail</strong><small>{statusErrors.gmail ? t("salesStatusError") : gmailConnected ? `${t("salesConnected")}${googleStatus?.email ? ` · ${googleStatus.email}` : ""}` : googleStatus ? t(googleStatus.configured ? "salesDisconnected" : "salesUnavailable") : t("salesChecking")}</small></span>
                    {salesChannel === "gmail" ? <Check className="is-selected" size={15} aria-hidden="true" /> : null}
                  </button>
                  {!gmailConnected && googleStatus?.configured ? <button type="button" className="ls-chat__sales-connect" onClick={() => setConnectView("gmail")}>{t("salesConnect")}</button> : null}
                  {gmailConnected && disconnecting !== "gmail" ? <button type="button" className="ls-chat__sales-connect" onClick={() => { setDisconnecting("gmail"); setDisconnectError(false); }}>{t("salesDisconnect")}</button> : null}
                </div>
                {disconnectRow("gmail")}
            </div>
            {connectView && salesChannel === connectView ? <p className="ls-chat__sales-needs">{t("salesNeedsConnect", { channel: t(`channels.${connectView}`) })}</p> : null}
            {connectView === "whatsapp" ? <div className="ls-chat__sales-connect-view"><WhatsAppConnectCard compact /></div> : null}
            {connectView === "gmail" ? <div className="ls-chat__sales-connect-view"><p>{t("salesGmailConnectHint")}</p><GoogleFeatureConnectButton feature="gmail" returnTo="/leadtita" className="gdrive-primary" /></div> : null}
            <button type="button" className="ls-chat__sales-clear" onClick={() => { onSalesChannelChange(null); setOpen(null); }}>{t("salesClear")}</button>
          </Popover>
        )}
      </div>

      <PermissionControl onResumeTyping={onResumeTyping} />
    </div>
  );
}
