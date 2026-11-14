"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import type { BlogPostSummary } from "@/lib/blog";
import {
  errorBox, ghostButton, isUnauthorized, ownerFetch, primaryButton, smallButton, stateBox, statusPill, tableClass, tableWrap,
  tdClass, theadClass, thClass, trClass, useOwnerFormat, useOwnerList, type OnAction,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";
import BlogEditor from "./blog-editor";

export default function BlogSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction: OnAction }) {
  const t = useTranslations("Owner.blog");
  const common = useTranslations("Owner.common");
  const { formatDateTime, errorText } = useOwnerFormat();
  const list = useOwnerList<BlogPostSummary>("/api/owner/blog", t("loadError"), onUnauthorized);
  const { data, loading, error } = list;
  const [editing, setEditing] = useState<string | null>(null); // "" = new post
  const [confirmId, setConfirmId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const statusOptions = [{ value: "draft", label: t("draft") }, { value: "published", label: t("published") }];

  async function run(post: BlogPostSummary, method: "PATCH" | "DELETE") {
    setBusyId(post.id);
    setActionError("");
    const publish = post.status !== "published";
    const body = method === "PATCH" ? { status: publish ? "published" : "draft", ...(publish && !post.publishedAt ? { publishedAt: new Date().toISOString() } : {}) } : undefined;
    const result = await ownerFetch(`/api/owner/blog/${encodeURIComponent(post.id)}`, { method, body });
    setBusyId("");
    setConfirmId("");
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok) return setActionError(errorText(result.data.error, t("actionError")));
    onAction(method === "DELETE" ? t("deleted", { title: post.title }) : publish ? t("publishedOk", { title: post.title }) : t("unpublishedOk", { title: post.title }));
    void list.reload();
  }

  if (editing !== null) {
    return <BlogEditor postId={editing || null} onUnauthorized={onUnauthorized} onAction={onAction} onClose={() => { setEditing(null); void list.reload(); }} />;
  }

  return (
    <section aria-label={t("title")}>
      <ListToolbar
        title={t("title")}
        query={list.query}
        onQuery={list.setQuery}
        queryLabel={t("searchLabel")}
        status={list.status}
        onStatus={list.setStatus}
        statusLabel={t("statusLabel")}
        allLabel={t("all")}
        statusOptions={statusOptions}
        onRefresh={() => void list.reload()}
      />
      <div className="mb-3 flex justify-end">
        <button className={primaryButton} type="button" onClick={() => setEditing("")}><Plus size={15} aria-hidden="true" /> {t("newPost")}</button>
      </div>
      {(error || actionError) && <p className={errorBox} role="alert">{actionError || error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{t("postTitle")}</th>
              <th className={thClass} scope="col">{t("locale")}</th>
              <th className={thClass} scope="col">{common("status")}</th>
              <th className={thClass} scope="col">{t("publishedAt")}</th>
              <th className={thClass} scope="col">{t("updated")}</th>
              <th className={thClass} scope="col">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((post) => (
              <tr className={trClass} key={post.id}>
                <td className={`${tdClass} min-w-[220px]`} data-label={t("postTitle")}>
                  <span className="grid gap-0.5">
                    <span className="font-semibold">{post.title}</span>
                    <span className="text-[11px] text-(color:--muted)">/{post.slug}</span>
                  </span>
                </td>
                <td className={`${tdClass} uppercase`} data-label={t("locale")}>{post.locale}</td>
                <td className={tdClass} data-label={common("status")}>
                  <span className={statusPill(post.status === "published" ? "completed" : "pending")}>{post.status === "published" ? t("published") : t("draft")}</span>
                </td>
                <td className={`${tdClass} whitespace-nowrap`} data-label={t("publishedAt")}>{post.publishedAt ? formatDateTime(post.publishedAt) : "—"}</td>
                <td className={`${tdClass} whitespace-nowrap`} data-label={t("updated")}>{formatDateTime(post.updated)}</td>
                <td className={tdClass} data-label={t("actions")}>
                  {confirmId === post.id ? (
                    <span className="inline-flex flex-wrap gap-1.5">
                      <button className={`${primaryButton} ${smallButton}`} type="button" disabled={busyId === post.id} onClick={() => void run(post, "DELETE")}>
                        {busyId === post.id ? t("deleting") : t("confirmDelete")}
                      </button>
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busyId === post.id} onClick={() => setConfirmId("")}>{common("cancel")}</button>
                    </span>
                  ) : (
                    <span className="inline-flex flex-wrap gap-1.5">
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={Boolean(busyId)} onClick={() => setEditing(post.id)}><Pencil size={14} aria-hidden="true" /> {t("edit")}</button>
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={Boolean(busyId)} onClick={() => void run(post, "PATCH")}>
                        {post.status === "published" ? <><EyeOff size={14} aria-hidden="true" /> {t("unpublish")}</> : <><Eye size={14} aria-hidden="true" /> {t("publish")}</>}
                      </button>
                      <button className={`${ghostButton} ${smallButton}`} type="button" disabled={Boolean(busyId)} onClick={() => setConfirmId(post.id)} aria-label={t("deleteLabel", { title: post.title })}><Trash2 size={14} aria-hidden="true" /></button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">{t("loading")}</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? common("noResultsFilter") : t("empty")}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
