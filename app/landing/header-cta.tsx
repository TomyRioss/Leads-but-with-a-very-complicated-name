"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/lib/client/session";

/** Botones del header público: miembro logueado ve "Ir a Leadta"; visitante ve Ingresar/Registrarse. */
export function HeaderCta() {
  const t = useTranslations("Landing.nav");
  const tp = useTranslations("Pricing");
  const [member, setMember] = useState(false);

  useEffect(() => {
    let active = true;
    getSession()
      .then((payload) => { if (active) setMember(Boolean(payload.user)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (member) return <Link className="lp-btn lp-btn-lime lp-btn-sm" href="/leadtita">{tp("goToLeadta")}<ArrowRight size={16} aria-hidden="true" /></Link>;
  return (
    <>
      <Link className="lp-btn lp-btn-ghost lp-btn-sm lp-hide-sm" href="/login">{t("login")}</Link>
      <Link className="lp-btn lp-btn-ink lp-btn-sm lp-show-sm" href="/login">{t("login")}</Link>
      <Link className="lp-btn lp-btn-lime lp-btn-sm lp-hide-sm" href="/register">{t("signup")}</Link>
    </>
  );
}
