"use client";

import { useTranslations } from "next-intl";
import { Plug } from "lucide-react";
import { openIntegrations } from "@/app/integrations-dialog";

/** "Conectores" item of the chat's "+" menu: closes the menu and opens the integrations modal. */
export function AttachIntegrations({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations("leadSuiteChat.attachMenu");
  return (
    <>
      <div role="separator" className="ls-chat__attach-divider" />
      <button type="button" role="menuitem" onClick={() => { onOpen(); openIntegrations(); }}>
        <Plug aria-hidden="true" size={17} /><span>{t("connectors")}<small>{t("connectorsHint")}</small></span>
      </button>
    </>
  );
}
