"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CircleCheck, Compass, Loader2, Lock, Mail, Save, Send } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import { Link, useRouter } from "@/i18n/navigation";
import type { Proposal, ProposalStatus, SalesCampaign } from "@/lib/workspace/types";
import {
  EmptyState, ErrorBanner, FilterChip, FOCUS, LoadingState, PageHeader, PRIMARY_BUTTON, SECONDARY_BUTTON, requestJson, useErrorMessage,
} from "@/app/workspace/workspace-ui";

type Draft = { subject: string; body: string };
type Notice = { id: string; kind: "ok" | "error"; message: string; integrations?: boolean };

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: "bg-(--ash-150) text-(color:--ash-800)",
  sent: "bg-(--lime) text-(color:--ink)",
  failed: "bg-[#fde3e0] text-[#8a1c12]",
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function StatusChip({ status }: { status: ProposalStatus }) {
  const t = useTranslations("Workspace.proposals");
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>{t(`status.${status}`)}</span>;
}

export function ProposalsView() {
  const t = useTranslations("Workspace.proposals");
  const w = useTranslations("Workspace");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const params = useSearchParams();
  const campaignId = params.get("campaign") ?? "";
  const businessId = params.get("business") ?? "";
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<"" | "save" | "send">("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setError("");
    setProposals(null);
    const query = new URLSearchParams();
    if (campaignId) query.set("campaign", campaignId);
    if (businessId) query.set("business", businessId);
    const search = query.size ? `?${query}` : "";
    // El nombre de la campaña solo hace falta con filtro; va en paralelo.
    const [result, campaigns] = await Promise.all([
      requestJson<{ proposals: Proposal[] }>(`/api/proposals${search}`),
      campaignId ? requestJson<{ campaigns: SalesCampaign[] }>("/api/sales-campaigns") : Promise.resolve(null),
    ]);
    if (campaigns?.ok) setCampaignName(campaigns.data.campaigns?.find((item) => item.id === campaignId)?.name ?? "");
    if (!result.ok) {
      if (result.status === 401) return router.replace("/");
      return setError(errorMessage(result.error, result.status, t("errLoad")));
    }
    const list = result.data.proposals ?? [];
    setProposals(list);
    setActiveId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
  }, [businessId, campaignId, errorMessage, router, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const active = proposals?.find((item) => item.id === activeId) ?? null;
  const draft = active ? drafts[active.id] : undefined;
  const subject = draft?.subject ?? active?.subject ?? "";
  const body = draft?.body ?? active?.body ?? "";
  const dirty = Boolean(active && draft && (draft.subject !== active.subject || draft.body !== active.body));
  const readOnly = active?.status === "sent";

  function replaceProposal(next: Proposal) {
    setProposals((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? current);
    setDrafts((current) => {
      const { [next.id]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
  }

  function edit(field: keyof Draft, value: string) {
    if (!active || readOnly) return;
    setNotice(null);
    setDrafts((current) => ({ ...current, [active.id]: { subject, body, [field]: value } }));
  }

  function failure(id: string, code: string, status: number) {
    if (status === 401) return router.replace("/");
    setNotice({ id, kind: "error", message: errorMessage(code, status), integrations: code === "needs_whatsapp" || code === "needs_gmail" });
  }

  async function patch(proposal: Proposal) {
    const result = await requestJson<{ proposal: Proposal }>(`/api/proposals/${encodeURIComponent(proposal.id)}`, {
      method: "PATCH",
      body: JSON.stringify(proposal.channel === "gmail" ? { subject, body } : { body }),
    });
    if (!result.ok) {
      failure(proposal.id, result.error, result.status);
      return null;
    }
    replaceProposal(result.data.proposal);
    return result.data.proposal;
  }

  async function save() {
    if (!active || !dirty) return;
    setBusy("save");
    setNotice(null);
    const saved = await patch(active);
    setBusy("");
    if (saved) setNotice({ id: saved.id, kind: "ok", message: t("saved") });
  }

  async function send() {
    if (!active || readOnly) return;
    setBusy("send");
    setNotice(null);
    // Lo que se ve es lo que se envía: primero se guardan los cambios pendientes.
    if (dirty && !(await patch(active))) return setBusy("");
    const result = await requestJson<{ proposal: Proposal }>(`/api/proposals/${encodeURIComponent(active.id)}/send`, { method: "POST" });
    setBusy("");
    if (!result.ok) {
      failure(active.id, result.error, result.status);
      if (result.error === "already_sent") void load();
      return;
    }
    replaceProposal(result.data.proposal);
    setNotice({ id: active.id, kind: "ok", message: t("sentOk") });
  }

  function displayDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  }

  const filtered = Boolean(campaignId || businessId);
  const activeNotice = notice && active && notice.id === active.id ? notice : null;

  return (
    <section aria-labelledby="proposals-title" className="@container">
      <PageHeader id="proposals-title" title={t("title")} intro={t("intro")} count={proposals ? t("count", { count: proposals.length }) : undefined}>
        {filtered ? <FilterChip label={campaignName ? t("filteredBy", { name: campaignName }) : t("filteredGeneric")} clearHref="/propuestas" /> : null}
      </PageHeader>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!proposals && !error ? <LoadingState label={t("loading")} /> : null}
      {proposals && proposals.length === 0 ? (
        filtered
          ? <EmptyState Icon={Send} title={t("emptyFilteredTitle")} text={t("emptyFilteredText")} cta={{ href: "/propuestas", label: t("title") }} />
          : <EmptyState Icon={Send} title={t("emptyTitle")} text={t("emptyText")} cta={{ href: "/", label: t("emptyCta"), Icon: Compass }} />
      ) : null}

      {proposals?.length && active ? (
        <div className="grid overflow-hidden rounded-xl border border-(color:--line) bg-(--paper) @2xl:grid-cols-[300px_minmax(0,1fr)]">
          <ul aria-label={t("listAria")} className="max-h-72 overflow-y-auto border-b border-(color:--line) @2xl:max-h-[640px] @2xl:border-r @2xl:border-b-0">
            {proposals.map((item) => {
              const current = item.id === active.id;
              return (
                <li key={item.id} className="border-b border-(color:--ash-150) last:border-b-0">
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    onClick={() => { setActiveId(item.id); setNotice(null); }}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left -outline-offset-2 focus-visible:outline-2 focus-visible:outline-(color:--ink) ${current ? "bg-(--ash-100)" : "hover:bg-(--ash-50)"}`}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--ash-150) text-xs font-semibold text-(color:--ash-800)" aria-hidden="true">{initials(item.leadName || item.to)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.leadName || item.to}</span>
                      <span className="mt-0.5 block truncate text-xs text-(color:--muted)">
                        <span className="sr-only">{t(`channel.${item.channel}`)}:</span>{item.to}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <StatusChip status={item.status} />
                        {drafts[item.id] ? <span className="text-[11px] text-(color:--muted)">{t("unsaved")}</span> : null}
                      </span>
                    </span>
                    {item.channel === "whatsapp"
                      ? <SiWhatsapp size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[#25D366]" />
                      : <SiGmail size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[#EA4335]" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex min-w-0 flex-col p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{active.leadName || active.to}</h2>
              <StatusChip status={active.status} />
            </div>
            {active.status === "sent" && active.sentAt ? <p className="mt-1 text-xs text-(color:--muted)">{t("sentAt", { date: displayDate(active.sentAt) })}</p> : null}
            {active.status === "failed" && active.error ? <p className="mt-1 text-xs text-[#8a1c12]">{t("lastError", { message: errorMessage(active.error, 0) })}</p> : null}

            <dl className="mt-4 space-y-2 border-b border-(color:--line) pb-4 text-sm">
              <div className="flex items-center gap-3">
                <dt className="w-16 shrink-0 text-(color:--muted)">{t("to")}</dt>
                <dd className="flex min-w-0 items-center gap-1.5 truncate">
                  {active.channel === "whatsapp" ? <FaWhatsapp aria-hidden="true" className="shrink-0 text-(color:--ash-700)" /> : <Mail size={14} aria-hidden="true" className="shrink-0 text-(color:--ash-700)" />}
                  <span className="sr-only">{t(`channel.${active.channel}`)}:</span>{active.to}
                </dd>
              </div>
              {active.channel === "gmail" ? (
                <div className="flex items-center gap-3">
                  <dt className="w-16 shrink-0 text-(color:--muted)"><label htmlFor="proposal-subject">{t("subject")}</label></dt>
                  <dd className="min-w-0 flex-1">
                    <input
                      id="proposal-subject"
                      value={subject}
                      readOnly={readOnly}
                      onChange={(event) => edit("subject", event.target.value)}
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-medium hover:border-(color:--line) focus-visible:border-(color:--line) focus-visible:outline-2 focus-visible:outline-(color:--ink) read-only:hover:border-transparent"
                    />
                  </dd>
                </div>
              ) : null}
            </dl>

            <label htmlFor="proposal-body" className="sr-only">{t("body")}</label>
            <textarea
              id="proposal-body"
              value={body}
              readOnly={readOnly}
              aria-describedby={readOnly ? "proposal-readonly" : undefined}
              onChange={(event) => edit("body", event.target.value)}
              rows={12}
              className="mt-4 min-h-64 w-full flex-1 resize-y rounded-lg border border-(color:--line) bg-(--ash-50) p-4 text-sm leading-relaxed whitespace-pre-wrap text-(color:--ash-900) focus-visible:outline-2 focus-visible:outline-(color:--ink) read-only:cursor-default read-only:text-(color:--ash-700)"
            />

            {activeNotice?.kind === "error" ? (
              <div className="mt-4">
                <ErrorBanner message={activeNotice.message}>
                  {activeNotice.integrations ? <Link href="/integraciones" className={`rounded-md px-2 py-1 font-semibold underline underline-offset-2 ${FOCUS}`}>{w("goIntegrations")}</Link> : null}
                </ErrorBanner>
              </div>
            ) : null}
            {activeNotice?.kind === "ok" ? (
              <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium"><CircleCheck size={16} aria-hidden="true" className="text-(color:--lime-dark)" />{activeNotice.message}</p>
            ) : null}

            {readOnly ? (
              <p id="proposal-readonly" className="mt-4 flex items-center gap-2 text-sm text-(color:--muted)"><Lock size={15} aria-hidden="true" />{t("readOnly")}</p>
            ) : (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" className={SECONDARY_BUTTON} disabled={!dirty || Boolean(busy)} aria-busy={busy === "save"} onClick={() => void save()}>
                  {busy === "save" ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                  {busy === "save" ? t("saving") : t("save")}
                </button>
                <button type="button" className={PRIMARY_BUTTON} disabled={Boolean(busy) || !body.trim()} aria-busy={busy === "send"} onClick={() => void send()}>
                  {busy === "send" ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  {busy === "send" ? t("sending") : t("send")}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
