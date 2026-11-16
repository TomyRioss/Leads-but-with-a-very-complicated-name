"use client";

import { Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LiveCampaigns } from "@/lib/campaigns";
import "./campaign-banner.css";

type Banner = NonNullable<LiveCampaigns["banner"]>;

const HEIGHT_VAR = "--campaign-banner-h";
const MAX_TIMEOUT_MS = 2_147_483_647;
// /owner and /en/owner (localePrefix "as-needed").
const OWNER_PATH = /^\/(?:[a-z]{2}\/)?owner(?:\/|$)/;

// One request per page load, shared by every mount.
let bannerRequest: Promise<Banner | null> | null = null;
function loadBanner() {
  bannerRequest ??= fetch("/api/campaigns/live")
    .then((response) => (response.ok ? (response.json() as Promise<LiveCampaigns>) : null))
    .then((data) => data?.banner ?? null)
    .catch(() => null);
  return bannerRequest;
}

const isOver = (banner: Banner) => !(Date.parse(banner.endsAt) > Date.now());

/** Static strip with the live campaign. Renders nothing until loaded, when there is none, after it ends, and on /owner. */
export function CampaignBanner() {
  const t = useTranslations("CampaignBanner");
  const pathname = usePathname();
  const [banner, setBanner] = useState<Banner | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let current = true;
    void loadBanner().then((next) => { if (current && next && !isOver(next)) setBanner(next); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), Math.min(MAX_TIMEOUT_MS, Math.max(0, Date.parse(banner.endsAt) - Date.now())));
    return () => window.clearTimeout(timer);
  }, [banner]);

  const visible = banner !== null && (banner.label || banner.message) && !OWNER_PATH.test(pathname ?? "");

  // Fixed/sticky shells offset themselves by this variable (see globals.css); it tracks wrapping on small screens.
  useEffect(() => {
    const node = ref.current;
    if (!visible || !node) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty(HEIGHT_VAR, `${node.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => { observer.disconnect(); root.style.removeProperty(HEIGHT_VAR); };
  }, [visible]);

  if (!visible) return null;
  return (
    <aside ref={ref} className="campaign-banner" aria-label={t("label")}>
      {banner.label ? (
        <span className="campaign-banner__pill">
          <Megaphone size={14} strokeWidth={2.2} aria-hidden="true" />
          <span className="campaign-banner__label">{banner.label}</span>
        </span>
      ) : null}
      {banner.message ? <p className="campaign-banner__message">{banner.message}</p> : null}
    </aside>
  );
}
