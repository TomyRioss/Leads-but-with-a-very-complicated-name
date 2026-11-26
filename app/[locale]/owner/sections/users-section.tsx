"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Activity, Check, Minus, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import {
  blockClass, confirmBox, controlClass, exclusivePill, countBadge, dangerButton, errorBox, ghostButton,
  hintText, iconButton, isUnauthorized, mutedText, okBox, ownerFetch, primaryButton, rightCell, sectionHead, smallButton,
  sectionTitle, sortTheadClass, stateBox, titleDot, statusPill, tableClass, tableWrap, tdClass, theadClass, thClass, trClass, useFocusTrap,
  useOwnerFormat, useOwnerList, type OnAction, type OwnerResult,
} from "../ui";
import { Pager } from "./list-controls";
import { SortableTh } from "./sortable-th";
import UserActivity from "./user-activity";

type SubscriptionSummary = { id: string; planId: string; status: string; priceArs: number; monthlyCredits: number };
type UserRow = { id: string; email: string; name: string; credits: number; created: string; phone?: string; lastActivity?: string; role?: string; ownerContacted: boolean; subscription: SubscriptionSummary | null };
type UserDetail = {
  user: { id: string; email: string; name: string; credits: number; created: string; phone?: string; role?: string };
  subscriptions: (SubscriptionSummary & { externalReference?: string; created: string })[];
  subscriptionsHasMore?: boolean;
  paymentsHasMore?: boolean;
  payments: { id: string; paymentId: string; status: string; amountArs: number; credits: number; created: string }[];
};
type Pending = { message: string; run: () => Promise<OwnerResult<unknown>>; success: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const quickAmounts = [10, 50, 100, -10];
const live = ["authorized", "paused", "pending"];

/** wa.me link from the stored phone (digits only, country code included); "—" when missing. */
function whatsappLink(phone: string | undefined, label: string) {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 8) return "—";
  return <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" aria-label={label} className="whitespace-nowrap rounded text-xs font-semibold text-(color:--ink) underline decoration-(--ash-300) underline-offset-[3px] hover:decoration-(--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)">{phone}</a>;
}

export default function UsersSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const t = useTranslations("Owner.users");
  const common = useTranslations("Owner.common");
  const { formatDate, formatDateTime, formatNumber, planName, isExclusive, statusLabel } = useOwnerFormat();
  const list = useOwnerList<UserRow>("/api/owner/users", t("loadError"), onUnauthorized, "status", "-created");
  const { data, loading, error, reload } = list;
  const sorting = { sort: list.sort, onSort: list.setSort };
  const [selected, setSelected] = useState<{ id: string; mode?: "add" } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeDrawer = useCallback(() => {
    setSelected(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  const open = (opener: HTMLElement, id: string, mode?: "add") => {
    openerRef.current = opener;
    setSelected({ id, mode });
  };

  // Bulk delete: id -> email of picked users (kept across pages). Each one goes through the per-user DELETE,
  // which re-checks owner protection and logs its own audit entry.
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map());
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [contactBusyIds, setContactBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [contactError, setContactError] = useState("");
  const confirmWord = t("bulkConfirmWord");
  const deletable = data?.items.filter((user) => user.role !== "owner") ?? [];
  const pageAllPicked = deletable.length > 0 && deletable.every((user) => picked.has(user.id));
  const togglePick = (user: UserRow) => setPicked((current) => {
    const next = new Map(current);
    if (!next.delete(user.id)) next.set(user.id, user.email);
    return next;
  });
  const togglePage = () => setPicked((current) => {
    const next = new Map(current);
    for (const user of deletable) {
      if (pageAllPicked) next.delete(user.id);
      else next.set(user.id, user.email);
    }
    return next;
  });

  async function toggleContacted(user: UserRow) {
    if (contactBusyIds.has(user.id)) return;
    setContactError("");
    setContactBusyIds((current) => new Set(current).add(user.id));
    const result = await ownerFetch<{ ownerContacted: boolean }>(`/api/owner/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: { ownerContacted: !user.ownerContacted },
    });
    setContactBusyIds((current) => { const next = new Set(current); next.delete(user.id); return next; });
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) {
      onAction?.(t("contactStatusUpdated"));
      void reload();
    } else {
      setContactError(t("contactStatusError"));
    }
  }

  async function deletePicked() {
    if (bulkBusy || bulkConfirm?.trim().toUpperCase() !== confirmWord) return;
    setBulkBusy(true);
    setBulkError("");
    const failed = new Map<string, string>();
    let deleted = 0;
    // ponytail: sequential on purpose; each delete cascades batches/leads in PocketBase.
    for (const [id, email] of picked) {
      const result = await ownerFetch(`/api/owner/users/${encodeURIComponent(id)}`, { method: "DELETE", body: { confirmEmail: email } });
      if (result.status === 401) { setBulkBusy(false); return onUnauthorized(); }
      if (result.ok) deleted += 1;
      else failed.set(id, email);
    }
    setBulkBusy(false);
    setPicked(failed);
    setBulkConfirm(null);
    if (deleted > 0) onAction?.(t("bulkDeleted", { count: deleted }));
    if (failed.size > 0) setBulkError(t("bulkFailed", { count: failed.size }));
    void reload();
  }

  return (
    <section aria-label={t("title")}>
      <div className={sectionHead}>
        <h1 className={sectionTitle}>{t("title")}<span className={titleDot} aria-hidden="true">.</span>{data ? <span className={countBadge}>{formatNumber(data.totalItems)}</span> : null}</h1>
        <label className="relative flex w-full items-center sm:w-auto">
          <Search className="pointer-events-none absolute left-3 text-(color:--ash-600)" size={15} aria-hidden="true" />
          <span className="sr-only">{t("search")}</span>
          <input className={`${controlClass} pl-[33px] sm:w-65`} type="search" placeholder={t("searchPlaceholder")} value={list.query} onChange={(event) => list.setQuery(event.target.value)} />
        </label>
      </div>
      {error && <p className={errorBox} role="alert">{error}</p>}
      {bulkError && <p className={errorBox} role="alert">{bulkError}</p>}
      {contactError && <p className={errorBox} role="alert">{contactError}</p>}
      {picked.size > 0 && (
        <div className={`${confirmBox} mb-3`} role="region" aria-label={t("bulkRegion")}>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <p className="m-0 text-[13px] font-semibold">{t("bulkSelected", { count: picked.size })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${ghostButton} ${smallButton}`} disabled={bulkBusy} onClick={() => { setPicked(new Map()); setBulkConfirm(null); }}><X size={14} aria-hidden="true" /> {t("bulkClear")}</button>
              {bulkConfirm === null && <button type="button" className={`${dangerButton} ${smallButton}`} onClick={() => { setBulkError(""); setBulkConfirm(""); }}><Trash2 size={14} aria-hidden="true" /> {t("bulkDelete", { count: picked.size })}</button>}
            </div>
          </div>
          {bulkConfirm !== null && (
            <form className="grid gap-2.5" onSubmit={(event) => { event.preventDefault(); void deletePicked(); }}>
              <p className="m-0 text-xs leading-normal">{t("bulkWarning", { count: picked.size })}</p>
              <label className="grid gap-1.5 text-xs">
                {t.rich("bulkTypeToConfirm", { word: confirmWord, strong: (chunks) => <strong>{chunks}</strong> })}
                <input className={controlClass} type="text" autoComplete="off" autoFocus value={bulkConfirm} disabled={bulkBusy} onChange={(event) => setBulkConfirm(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={dangerButton} disabled={bulkBusy || bulkConfirm.trim().toUpperCase() !== confirmWord}><Trash2 size={14} aria-hidden="true" /> {bulkBusy ? t("bulkDeleting") : t("bulkDelete", { count: picked.size })}</button>
                <button type="button" className={ghostButton} disabled={bulkBusy} onClick={() => setBulkConfirm(null)}>{t("bulkCancel")}</button>
              </div>
            </form>
          )}
        </div>
      )}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={`${tableClass} md:[&_td]:px-2! md:[&_th]:px-2!`}>
          <thead className={sortTheadClass}>
            <tr>
              <th className={`${thClass} w-8`} scope="col">
                <input type="checkbox" className="size-4 cursor-pointer accent-(--ash-950)" aria-label={t("bulkSelectPage")} checked={pageAllPicked} disabled={deletable.length === 0 || bulkBusy} onChange={togglePage} />
              </th>
              <SortableTh {...sorting} column="email" label={common("email")} />
              <SortableTh {...sorting} column="name" label={common("name")} />
              <SortableTh {...sorting} column="credits" kind="number" label={common("credits")} />
              <th className={thClass} scope="col">{common("plan")}</th>
              <SortableTh {...sorting} column="created" kind="date" label={common("created")} />
              <SortableTh {...sorting} column="lastActivity" kind="date" label={t("lastActivity")} />
              <SortableTh {...sorting} column="phone" label={t("whatsapp")} />
              <th className={thClass} scope="col">{t("contacted")}</th>
              <th className={thClass} scope="col">{common("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((user) => (
              <tr className={trClass} key={user.id}>
                <td className={`${tdClass} w-8`} data-label={t("bulkSelectColumn")}>
                  {user.role !== "owner" && <input type="checkbox" className="size-4 cursor-pointer accent-(--ash-950)" aria-label={t("bulkSelectAria", { email: user.email })} checked={picked.has(user.id)} disabled={bulkBusy} onChange={() => togglePick(user)} />}
                </td>
                <td className={tdClass} data-label={common("email")}>
                  <button type="button" className="cursor-pointer break-all rounded border-0 bg-transparent py-1.5 text-left text-xs font-semibold text-(color:--ink) underline decoration-(--ash-300) underline-offset-[3px] hover:decoration-(--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" onClick={(event) => open(event.currentTarget, user.id)}>{user.email}</button>
                </td>
                <td className={tdClass} data-label={common("name")}>{user.name || "—"}</td>
                <td className={`${tdClass} ${rightCell}`} data-label={common("credits")}>
                  <span className="inline-flex items-center gap-1.5">
                    {user.role !== "owner" && (<button type="button" className={`${ghostButton} ${smallButton} min-w-9 px-0`} aria-label={t("subtractAria", { email: user.email })} onClick={(event) => open(event.currentTarget, user.id, "add")}><Minus size={14} aria-hidden="true" /></button>)}
                    <strong className="min-w-10 text-center text-[15px] tabular-nums">{formatNumber(user.credits)}</strong>
                    {user.role !== "owner" && (<button type="button" className={`${ghostButton} ${smallButton} min-w-9 px-0`} aria-label={t("addAria", { email: user.email })} onClick={(event) => open(event.currentTarget, user.id, "add")}><Plus size={14} aria-hidden="true" /></button>)}
                  </span>
                </td>
                <td className={tdClass} data-label={common("plan")}>{user.subscription ? <span>{planName(user.subscription.planId)} {isExclusive(user.subscription.planId) && <span className={exclusivePill}>{common("exclusive")}</span>} <span className={`${statusPill(user.subscription.status)} ml-1`}>{statusLabel(user.subscription.status)}</span></span> : <span className={mutedText}>{t("noPlan")}</span>}</td>
                <td className={tdClass} data-label={common("created")}>{formatDate(user.created)}</td>
                <td className={`${tdClass} whitespace-nowrap`} data-label={t("lastActivity")}>{user.lastActivity ? formatDateTime(user.lastActivity) : "—"}</td>
                <td className={tdClass} data-label={t("whatsapp")}>{whatsappLink(user.phone, t("whatsappAria", { email: user.email }))}</td>
                <td className={tdClass} data-label={t("contacted")}>
                  <button
                    type="button"
                    className={`${user.ownerContacted ? primaryButton : ghostButton} ${smallButton} whitespace-nowrap`}
                    disabled={contactBusyIds.has(user.id)}
                    aria-pressed={user.ownerContacted}
                    aria-label={t(user.ownerContacted ? "markNotContacted" : "markContacted", { email: user.email })}
                    onClick={() => void toggleContacted(user)}
                  >
                    {user.ownerContacted && <Check size={14} aria-hidden="true" />}
                    {contactBusyIds.has(user.id) ? t("contactSaving") : t(user.ownerContacted ? "contacted" : "notContacted")}
                  </button>
                </td>
                <td className={`${tdClass} max-md:justify-end`} data-label={common("actions")}>
                  <button type="button" className={`${primaryButton} ${smallButton}`} onClick={(event) => open(event.currentTarget, user.id)} aria-label={t("manageAria", { email: user.email })}><Settings2 size={14} aria-hidden="true" /> {t("manage")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query ? t("noResults") : t("empty")}</p>}
        {!data && loading && <p className={stateBox} role="status">{t("loading")}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />

      {selected !== null && <UserDrawer userId={selected.id} initialMode={selected.mode} onClose={closeDrawer} onChanged={() => void reload()} onUnauthorized={onUnauthorized} onAction={onAction} />}
    </section>
  );
}

function UserDrawer({ userId, initialMode, onClose, onChanged, onUnauthorized, onAction }: {
  userId: string;
  initialMode?: "add";
  onClose: () => void;
  onChanged: () => void;
  onUnauthorized: () => void;
  onAction?: OnAction;
}) {
  const t = useTranslations("Owner.users");
  const common = useTranslations("Owner.common");
  const sub = useTranslations("Owner.subscriptions");
  const activityT = useTranslations("Owner.activity");
  const { formatArs, formatDate, formatNumber, planName, isExclusive, statusLabel, errorText } = useOwnerFormat();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"set" | "add">(initialMode ?? "set");
  const [amount, setAmount] = useState("");
  const [form, setForm] = useState<{ name: string; email: string; phone: string } | null>(null);
  const [fieldError, setFieldError] = useState<{ field: "name" | "email" | "phone"; text: string } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const focusedAmount = useRef(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<"account" | "activity">("account");
  // While the activity content dialog is open it owns Esc/Tab, so the drawer's trap pauses.
  const [childDialog, setChildDialog] = useState(false);
  // The activity panel is mounted only while selected: the drawer's focus trap must not end on hidden controls.
  const selectTab = (key: "account" | "activity") => setTab(key);
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = tab === "account" ? "activity" : "account";
    selectTab(next);
    document.getElementById(`user-tab-${next}`)?.focus();
  };

  const load = useCallback(async () => {
    const result = await ownerFetch<UserDetail>(`/api/owner/users/${encodeURIComponent(userId)}`);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) { setDetail(result.data); setLoadError(""); }
    else setLoadError(errorText(result.data.error, t("loadUserError")));
  }, [userId, onUnauthorized, errorText, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    if (detail && initialMode === "add" && !focusedAmount.current) {
      focusedAmount.current = true;
      amountRef.current?.focus();
    }
  }, [detail, initialMode]);
  useFocusTrap(drawerRef, !childDialog, onClose);

  const current = detail?.subscriptions.find((subscription) => live.includes(subscription.status));
  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && Number.isInteger(parsed * 2) && (mode === "add" ? parsed !== 0 : parsed >= 0);
  const resulting = detail ? (mode === "set" ? parsed : detail.user.credits + parsed) : 0;
  const isOwner = detail?.user.role === "owner";
  const values = form ?? { name: detail?.user.name ?? "", email: detail?.user.email ?? "", phone: detail?.user.phone ?? "" };
  const changes = detail === null ? {} : {
    ...(values.name.trim() !== detail.user.name ? { name: values.name.trim() } : {}),
    ...(values.email.trim().toLowerCase() !== detail.user.email.toLowerCase() ? { email: values.email.trim() } : {}),
    ...(values.phone.trim() !== (detail.user.phone ?? "") ? { phone: values.phone.trim() } : {}),
  };
  const hasChanges = Object.keys(changes).length > 0;
  const edit = (field: "name" | "email" | "phone", value: string) => { setFieldError(null); setForm({ ...values, [field]: value }); };
  const canDelete = detail !== null && deleteEmail.trim().toLowerCase() === detail.user.email.toLowerCase();

  const succeed = async (text: string) => {
    setNotice({ kind: "ok", text });
    onAction?.(text);
    await load();
    onChanged();
  };

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    const result = await pending.run();
    setBusy(false);
    setPending(null);
    if (result.status === 401) return onUnauthorized();
    if (result.ok) {
      setAmount("");
      await succeed(pending.success);
    } else {
      setNotice({ kind: "error", text: errorText(result.data.error, common("actionError")) });
    }
  }

  async function saveData() {
    if (!hasChanges || busy) return;
    if ("name" in changes && values.name.trim().length > 100) return setFieldError({ field: "name", text: t("nameTooLong") });
    if ("email" in changes && (!emailPattern.test(values.email.trim()) || values.email.trim().length > 254)) return setFieldError({ field: "email", text: t("emailInvalid") });
    if ("phone" in changes && values.phone.trim().length > 30) return setFieldError({ field: "phone", text: t("phoneTooLong") });
    setBusy(true);
    setNotice(null);
    setFieldError(null);
    const result = await ownerFetch<Record<string, string>>(`/api/owner/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: changes });
    setBusy(false);
    if (result.status === 401) return onUnauthorized();
    if (result.ok) { setForm(null); await succeed(t("dataUpdated")); return; }
    const text = errorText(result.data.error, t("dataUpdateError"));
    if (result.status === 409 || /email/i.test(text)) setFieldError({ field: "email", text });
    else setNotice({ kind: "error", text });
  }

  async function deleteUser() {
    if (!detail || !canDelete || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await ownerFetch<{ ok: boolean; deleted: { batches?: number; leads?: number; subscriptions?: number } }>(
      `/api/owner/users/${encodeURIComponent(userId)}`,
      { method: "DELETE", body: { confirmEmail: deleteEmail.trim() } },
    );
    setBusy(false);
    if (result.status === 401) return onUnauthorized();
    if (result.ok) {
      onAction?.(t("userDeleted", { email: detail.user.email }));
      onChanged();
      onClose();
    } else {
      setNotice({ kind: "error", text: errorText(result.data.error, t("deleteError")) });
    }
  }

  const ask = (next: Pending) => { setNotice(null); setPending(next); };

  const changeStatus = (status: "authorized" | "paused" | "cancelled") => {
    if (!current) return;
    const values = { plan: planName(current.planId), email: detail?.user.email ?? "" };
    ask({
      message: status === "paused" ? sub("confirmPause", values) : status === "authorized" ? sub("confirmResume", values) : sub("confirmCancel", values),
      success: status === "paused" ? sub("paused") : status === "authorized" ? sub("resumed") : sub("cancelled"),
      run: () => ownerFetch(`/api/owner/subscriptions/${encodeURIComponent(current.id)}`, { method: "PATCH", body: { status } }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-(--ash-950)/45" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerRef} className="grid h-full w-full content-start gap-3.5 overflow-y-auto border-l border-(color:--line) bg-(--ash-100) p-5 md:w-130" role="dialog" aria-modal="true" aria-label={t("drawerLabel")}>
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 mb-1 break-all text-[17px] font-semibold tracking-tight">{detail?.user.email ?? t("drawerFallback")}</h2>
            {detail && <p className={mutedText}>{t("joined", { name: detail.user.name || t("noName"), date: formatDate(detail.user.created) })}</p>}
          </div>
          <button ref={closeRef} className={iconButton} type="button" onClick={onClose} aria-label={common("close")}><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="flex gap-1" role="tablist" aria-label={activityT("tabsLabel")} onKeyDown={onTabKey}>
          {(["account", "activity"] as const).map((key) => (
            <button key={key} id={`user-tab-${key}`} className={`${ghostButton} ${smallButton} ${tab === key ? "border-(color:--ash-950)! bg-(--ash-950)! text-(color:--paper)!" : ""}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`user-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)}>
              {key === "account" ? <Settings2 size={14} aria-hidden="true" /> : <Activity size={14} aria-hidden="true" />} {activityT(key === "account" ? "tabAccount" : "tabActivity")}
            </button>
          ))}
        </div>

        <div id="user-panel-account" role="tabpanel" aria-labelledby="user-tab-account" className={tab === "account" ? "grid content-start gap-3.5" : "hidden"}>
          {loadError && <p className={errorBox} role="alert">{loadError}</p>}
          {!detail && !loadError && <p className={stateBox} role="status">{common("loading")}</p>}
          {notice && <p className={notice.kind === "ok" ? okBox : errorBox} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}

          {detail && (
            <>
              <section className={blockClass} aria-label={t("dataTitle")}>
                <h3 className="m-0 text-[13px] font-semibold">{t("dataTitle")}</h3>
                {isOwner && <p className={mutedText}>{t("ownerReadonly")}</p>}
                {([["name", common("name"), "text", t("noName")], ["email", common("email"), "email", t("emailPlaceholder")], ["phone", t("phone"), "tel", t("noPhone")]] as const).map(([field, label, type, placeholder]) => (
                  <label className="grid gap-1 text-xs font-semibold" key={field}>
                    {label}
                    <input className={`${controlClass} font-normal`} type={type} readOnly={isOwner} maxLength={field === "email" ? 254 : field === "phone" ? 30 : 100} placeholder={placeholder} value={values[field]} onChange={(event) => edit(field, event.target.value)} aria-invalid={fieldError?.field === field} aria-describedby={fieldError?.field === field ? `error-${field}` : undefined} autoComplete="off" />
                    {fieldError?.field === field && <span id={`error-${field}`} className="text-[11px] font-normal text-(color:--ash-900)" role="alert">{fieldError.text}</span>}
                  </label>
                ))}
                {!isOwner && <div><button className={primaryButton} type="button" disabled={!hasChanges || busy} onClick={() => void saveData()}>{t("saveChanges")}</button></div>}
              </section>

              <section className={blockClass} aria-label={t("creditsLabel")}>
                <h3 className="m-0 text-[13px] font-semibold">{t("creditsHeading")} <strong className="text-lg tabular-nums">{formatNumber(detail.user.credits)}</strong></h3>
                {isOwner ? <p className={mutedText}>{t("ownerCredits")}</p> : <>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("shortcuts")}>
                  {quickAmounts.map((value) => (
                    <button key={value} className={`${ghostButton} ${smallButton}`} type="button" onClick={() => { setMode("add"); setAmount(String(value)); setPending(null); }}>{value > 0 ? `+${value}` : `−${Math.abs(value)}`}</button>
                  ))}
                </div>
                <fieldset className="m-0 flex gap-4 border-0 p-0 text-xs">
                  <legend className="sr-only">{t("adjustType")}</legend>
                  <label className="inline-flex items-center gap-1.5"><input className="size-4 accent-(--ash-900)" type="radio" name="mode" checked={mode === "set"} onChange={() => { setMode("set"); setPending(null); }} /> {t("modeSet")}</label>
                  <label className="inline-flex items-center gap-1.5"><input className="size-4 accent-(--ash-900)" type="radio" name="mode" checked={mode === "add"} onChange={() => { setMode("add"); setPending(null); }} /> {t("modeAdd")}</label>
                </fieldset>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                  <label className="flex min-w-0 flex-1"><span className="sr-only">{t("amountLabel")}</span>
                    <input ref={amountRef} className={controlClass} type="number" step="0.5" min={mode === "set" ? 0 : undefined} inputMode="decimal" placeholder={mode === "set" ? t("placeholderSet") : t("placeholderAdd")} value={amount} onChange={(event) => { setAmount(event.target.value); setPending(null); }} />
                  </label>
                  <button className={primaryButton} type="button" disabled={!validAmount || busy || (mode === "add" && resulting < 0)}
                    onClick={() => ask({
                      message: mode === "set"
                        ? t("confirmSet", { before: formatNumber(detail.user.credits), after: formatNumber(resulting) })
                        : t("confirmAdd", { sign: parsed > 0 ? "plus" : "minus", amount: formatNumber(Math.abs(parsed)), before: formatNumber(detail.user.credits), after: formatNumber(resulting) }),
                      success: t("creditsUpdated"),
                      run: () => ownerFetch(`/api/owner/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: mode === "set" ? { credits: parsed } : { addCredits: parsed } }),
                    })}>{t("save")}</button>
                </div>
                {amount !== "" && !validAmount && <p className={hintText}>{mode === "set" ? t("hintHalvesNonNegative") : t("hintHalves")}</p>}
                {mode === "add" && validAmount && resulting < 0 && <p className={hintText}>{t("hintNegativeBalance")}</p>}
                </>}
              </section>

              <section className={blockClass} aria-label={t("membership")}>
                <h3 className="m-0 text-[13px] font-semibold">{t("membership")}</h3>
                {detail.subscriptionsHasMore && <p className={mutedText}>{t("showingLatest")}</p>}
                {current ? (
                  <>
                    <p>{planName(current.planId)} {isExclusive(current.planId) && <span className={exclusivePill}>{common("exclusive")}</span>} · <span className={statusPill(current.status)}>{statusLabel(current.status)}</span> · {t("planLine", { price: formatArs(current.priceArs), credits: common("creditsCount", { count: current.monthlyCredits }) })}</p>
                    <div className="flex flex-wrap gap-2">
                      {current.status === "authorized" && <button className={ghostButton} type="button" disabled={busy} onClick={() => changeStatus("paused")}>{sub("pause")}</button>}
                      {current.status === "paused" && <button className={ghostButton} type="button" disabled={busy} onClick={() => changeStatus("authorized")}>{sub("resume")}</button>}
                      <button className={dangerButton} type="button" disabled={busy} onClick={() => changeStatus("cancelled")}>{sub("cancel")}</button>
                    </div>
                  </>
                ) : (
                  <p className={mutedText}>{t("noSubscription")}</p>
                )}
              </section>

              {pending && (
                <div className={confirmBox} role="alertdialog" aria-label={common("confirmAction")}>
                  <p className="m-0 text-[13px] font-semibold">{pending.message}</p>
                  <div className="flex flex-wrap gap-2">
                    <button className={primaryButton} type="button" disabled={busy} onClick={() => void confirm()} autoFocus>{busy ? common("saving") : common("confirm")}</button>
                    <button className={ghostButton} type="button" disabled={busy} onClick={() => setPending(null)}>{common("back")}</button>
                  </div>
                </div>
              )}

              <section className={blockClass} aria-label={t("payments")}>
                <h3 className="m-0 text-[13px] font-semibold">{t("payments")}</h3>
                {detail.paymentsHasMore && <p className={mutedText}>{t("showingLatest")}</p>}
                {detail.payments.length === 0 ? <p className={mutedText}>{t("noPayments")}</p> : (
                  <div className={tableWrap}>
                    <table className={`${tableClass} min-w-0!`}>
                      <thead className={theadClass}>
                        <tr>
                          <th className={thClass} scope="col">{common("date")}</th>
                          <th className={thClass} scope="col">{common("status")}</th>
                          <th className={`${thClass} ${rightCell}`} scope="col">{common("amount")}</th>
                          <th className={`${thClass} ${rightCell}`} scope="col">{common("credits")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.payments.map((payment) => (
                          <tr className={trClass} key={payment.id}>
                            <td className={tdClass} data-label={common("date")}>{formatDate(payment.created)}</td>
                            <td className={tdClass} data-label={common("status")}>{statusLabel(payment.status)}</td>
                            <td className={`${tdClass} ${rightCell}`} data-label={common("amount")}>{formatArs(payment.amountArs)}</td>
                            <td className={`${tdClass} ${rightCell}`} data-label={common("credits")}>{formatNumber(payment.credits)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {!isOwner && <section className="grid gap-2.5 rounded-[10px] border border-(color:--ash-700) bg-(--paper) p-4 [&_p]:text-xs [&_p]:leading-normal" aria-label={t("danger")}>
                <h3 className="m-0 text-[13px] font-semibold">{t("danger")}</h3>
                <p>{t("dangerWarning")}</p>
                <label className="grid gap-1.5 text-xs">
                  {t.rich("typeToConfirm", { email: detail.user.email, strong: (chunks) => <strong className="break-all">{chunks}</strong> })} <input className={controlClass} type="text" autoComplete="off" value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} />
                </label>
                <div>
                  <button className={dangerButton} type="button" disabled={!canDelete || busy} onClick={() => void deleteUser()}><Trash2 size={14} aria-hidden="true" /> {t("deleteUser")}</button>
                </div>
              </section>}
            </>
          )}
        </div>

        {tab === "activity" && (
          <div id="user-panel-activity" role="tabpanel" aria-labelledby="user-tab-activity" className="grid content-start">
            <UserActivity userId={userId} onUnauthorized={onUnauthorized} onDialogChange={setChildDialog} />
          </div>
        )}
      </aside>
    </div>
  );
}
