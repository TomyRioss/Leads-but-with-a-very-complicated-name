"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ImageOff, LoaderCircle, Save } from "lucide-react";
import { slugify, type BlogLocale, type BlogPost, type BlogPostInput, type BlogStatus } from "@/lib/blog";
import { confirmBox, controlClass, errorBox, ghostButton, hintText, isUnauthorized, okBox, ownerFetch, primaryButton, sectionHead, sectionTitle, stateBox, titleDot, useOwnerFormat, type OnAction } from "../ui";
import { renderMarkdown } from "@/lib/markdown";
import "../../blog/blog.css";

type Form = {
  title: string; slug: string; slugTouched: boolean; locale: BlogLocale; excerpt: string; content: string; coverAlt: string;
  seoTitle: string; seoDescription: string; tags: string; status: BlogStatus; publishedAt: string; authorName: string;
};

const emptyForm: Form = { title: "", slug: "", slugTouched: false, locale: "es", excerpt: "", content: "", coverAlt: "", seoTitle: "", seoDescription: "", tags: "", status: "draft", publishedAt: "", authorName: "" };
const labelClass = "grid gap-1.5 text-xs font-semibold";
const textareaClass = `${controlClass} py-2 leading-relaxed`;

/** ISO → value for <input type="datetime-local"> in the viewer's local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromPost(post: BlogPost): Form {
  return {
    title: post.title, slug: post.slug, slugTouched: true, locale: post.locale, excerpt: post.excerpt, content: post.content, coverAlt: post.coverAlt,
    seoTitle: post.seoTitle, seoDescription: post.seoDescription, tags: post.tags.join(", "), status: post.status, publishedAt: toLocalInput(post.publishedAt), authorName: post.authorName,
  };
}

function toInput(form: Form): BlogPostInput {
  return {
    title: form.title.trim(), slug: form.slug.trim() || undefined, locale: form.locale, excerpt: form.excerpt.trim(), content: form.content,
    coverAlt: form.coverAlt.trim(), seoTitle: form.seoTitle.trim(), seoDescription: form.seoDescription.trim(),
    tags: [...new Set(form.tags.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
    status: form.status, publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : form.status === "published" ? new Date().toISOString() : null,
    authorName: form.authorName.trim(),
  };
}

// ---- Editor ---------------------------------------------------------------------------------
function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return <span className={`text-[11px] font-normal tabular-nums ${over ? "font-semibold text-(color:--ash-950)" : "text-(color:--muted)"}`}>{value.length}/{max}</span>;
}

export default function BlogEditor({ postId, onClose, onUnauthorized, onAction }: { postId: string | null; onClose: () => void; onUnauthorized: () => void; onAction: OnAction }) {
  const t = useTranslations("Owner.blog");
  const common = useTranslations("Owner.common");
  const { errorText } = useOwnerFormat();
  const [id, setId] = useState(postId);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saved, setSaved] = useState<Form>(emptyForm);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [loading, setLoading] = useState(Boolean(postId));
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; });

  useEffect(() => {
    if (!postId) return;
    let active = true;
    ownerFetch<{ post: BlogPost }>(`/api/owner/blog/${encodeURIComponent(postId)}`).then((result) => {
      if (!active) return;
      setLoading(false);
      if (isUnauthorized(result.status)) return unauthorizedRef.current();
      if (!result.ok || !result.data.post) return setLoadError(errorText(result.data.error, t("loadPostError")));
      const next = fromPost(result.data.post);
      setForm(next);
      setSaved(next);
      setCoverUrl(result.data.post.coverUrl);
    });
    return () => { active = false; };
  }, [postId, errorText, t]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved) || Boolean(coverFile) || removeCover, [form, saved, coverFile, removeCover]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const preview = useMemo(() => renderMarkdown(form.content), [form.content]);
  const localPreviewUrl = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : null), [coverFile]);
  useEffect(() => () => { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); }, [localPreviewUrl]);
  const shownCover = localPreviewUrl ?? (removeCover ? null : coverUrl);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaveState((state) => (state === "saved" ? "idle" : state));
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "title" && !current.slugTouched) next.slug = slugify(String(value));
      return next;
    });
  };

  const invalid = !form.title.trim() || form.title.length > 160 || form.slug.length > 120 || form.excerpt.length > 300
    || form.seoTitle.length > 70 || form.seoDescription.length > 170 || form.coverAlt.length > 200 || (Boolean(shownCover) && !form.coverAlt.trim());

  async function save() {
    if (invalid) return;
    setSaveState("saving");
    setSaveError("");
    const input = { ...toInput(form), ...(removeCover && !coverFile ? { removeCover: true } : {}) };
    let ok = false;
    let status = 0;
    let data: { post?: BlogPost; error?: string } = {};
    try {
      const init: RequestInit = { method: id ? "PATCH" : "POST", cache: "no-store" };
      if (coverFile) {
        const body = new FormData();
        body.set("data", JSON.stringify(input));
        body.set("cover", coverFile);
        init.body = body;
      } else {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(input);
      }
      const response = await fetch(id ? `/api/owner/blog/${encodeURIComponent(id)}` : "/api/owner/blog", init);
      ok = response.ok;
      status = response.status;
      data = await response.json().catch(() => ({}));
    } catch {
      data = { error: "" };
      setSaveError(common("networkError"));
      setSaveState("error");
      return;
    }
    if (isUnauthorized(status)) return onUnauthorized();
    if (!ok || !data.post) {
      setSaveError(errorText(data.error, t("saveError")));
      setSaveState("error");
      return;
    }
    const next = fromPost(data.post);
    setId(data.post.id);
    setForm(next);
    setSaved(next);
    setCoverUrl(data.post.coverUrl);
    setCoverFile(null);
    setRemoveCover(false);
    if (fileRef.current) fileRef.current.value = "";
    setSaveState("saved");
    onAction(t("savedOk", { title: data.post.title }));
  }

  function back() {
    if (dirty) setConfirmLeave(true);
    else onClose();
  }

  if (loading) return <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {common("loading")}</p>;
  if (loadError) {
    return (
      <div>
        <p className={errorBox} role="alert">{loadError}</p>
        <button className={ghostButton} type="button" onClick={onClose}><ArrowLeft size={15} aria-hidden="true" /> {t("backToList")}</button>
      </div>
    );
  }

  const snippetTitle = form.seoTitle.trim() || form.title.trim() || t("snippetPlaceholderTitle");
  const snippetDescription = form.seoDescription.trim() || form.excerpt.trim() || t("snippetPlaceholderDescription");

  return (
    <section aria-label={id ? t("editTitle") : t("newPost")}>
      <div className={sectionHead}>
        <div className="flex items-center gap-2">
          <button className={ghostButton} type="button" onClick={back}><ArrowLeft size={15} aria-hidden="true" /> {t("backToList")}</button>
          <h1 className={sectionTitle}>{id ? t("editTitle") : t("newPost")}<span className={titleDot} aria-hidden="true">.</span></h1>
          {dirty && <span className={hintText}>{t("unsaved")}</span>}
        </div>
        <button className={primaryButton} type="button" disabled={invalid || saveState === "saving"} onClick={() => void save()}>
          {saveState === "saving" ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
          {saveState === "saving" ? t("saving") : t("save")}
        </button>
      </div>

      {confirmLeave && (
        <div className={`${confirmBox} mb-3`} role="alertdialog" aria-label={t("leaveTitle")}>
          <p className="m-0 text-xs">{t("leaveBody")}</p>
          <span className="inline-flex flex-wrap gap-1.5">
            <button className={primaryButton} type="button" onClick={onClose}>{t("leaveConfirm")}</button>
            <button className={ghostButton} type="button" onClick={() => setConfirmLeave(false)}>{common("cancel")}</button>
          </span>
        </div>
      )}
      <div aria-live="polite">
        {saveState === "saved" && <p className={okBox}>{t("savedBox")}</p>}
        {saveState === "error" && <p className={errorBox} role="alert">{saveError}</p>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-3 rounded-[10px] border border-(color:--line) bg-(--paper) p-4">
            <label className={labelClass}>
              <span className="flex justify-between">{t("fieldTitle")} <Counter value={form.title} max={160} /></span>
              <input className={controlClass} value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
            </label>
            <label className={labelClass}>
              <span className="flex justify-between">{t("fieldSlug")} <Counter value={form.slug} max={120} /></span>
              <input className={controlClass} value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))} />
              <span className={hintText}>/blog/{form.slug || "…"}</span>
            </label>
            <label className={labelClass}>
              <span className="flex justify-between">{t("fieldExcerpt")} <Counter value={form.excerpt} max={300} /></span>
              <textarea className={textareaClass} rows={2} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
            </label>
          </div>

          <div className="rounded-[10px] border border-(color:--line) bg-(--paper) p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold" id="blog-content-label">{t("fieldContent")}</span>
              <div className="flex gap-1 lg:hidden" role="tablist" aria-label={t("fieldContent")}>
                {(["write", "preview"] as const).map((key) => (
                  <button key={key} className={`${ghostButton} min-h-8! px-2.5! ${tab === key ? "bg-(--ash-950)! text-(color:--paper)!" : ""}`} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{t(key === "write" ? "tabWrite" : "tabPreview")}</button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <textarea
                className={`${textareaClass} min-h-[420px] font-mono text-[13px] ${tab === "preview" ? "max-lg:hidden" : ""}`}
                aria-labelledby="blog-content-label"
                value={form.content}
                onChange={(e) => set("content", e.target.value)}
                placeholder={t("contentPlaceholder")}
                maxLength={100_000}
              />
              <div className={`blog-prose min-h-[420px] overflow-auto rounded-lg border border-(color:--ash-150) bg-(--ash-50) p-4 ${tab === "write" ? "max-lg:hidden" : ""}`} aria-label={t("tabPreview")}>
                {form.content.trim() ? preview : <p className={hintText}>{t("previewEmpty")}</p>}
              </div>
            </div>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <div className="grid gap-3 rounded-[10px] border border-(color:--line) bg-(--paper) p-4">
            <label className={labelClass}>{t("fieldStatus")}
              <select className={controlClass} value={form.status} onChange={(e) => set("status", e.target.value as BlogStatus)}>
                <option value="draft">{t("draft")}</option>
                <option value="published">{t("published")}</option>
              </select>
            </label>
            <label className={labelClass}>{t("fieldPublishedAt")}
              <input className={controlClass} type="datetime-local" value={form.publishedAt} onChange={(e) => set("publishedAt", e.target.value)} />
              <span className={hintText}>{t("publishedAtHint")}</span>
            </label>
            <label className={labelClass}>{t("fieldLocale")}
              <select className={controlClass} value={form.locale} onChange={(e) => set("locale", e.target.value as BlogLocale)}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className={labelClass}>{t("fieldAuthor")}
              <input className={controlClass} value={form.authorName} maxLength={80} onChange={(e) => set("authorName", e.target.value)} />
            </label>
            <label className={labelClass}>{t("fieldTags")}
              <input className={controlClass} value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder={t("tagsPlaceholder")} />
            </label>
          </div>

          <div className="grid gap-3 rounded-[10px] border border-(color:--line) bg-(--paper) p-4">
            <span className="text-xs font-semibold">{t("fieldCover")}</span>
            {shownCover ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URLs and uploaded files
              <img className="aspect-video w-full rounded-lg border border-(color:--line) object-cover" src={shownCover} alt={form.coverAlt} />
            ) : (
              <p className={`${hintText} flex items-center gap-1.5`}><ImageOff size={14} aria-hidden="true" /> {t("noCover")}</p>
            )}
            <input
              ref={fileRef}
              className="text-xs"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={t("fieldCover")}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file && file.size > 5 * 1024 * 1024) { setSaveError(t("coverTooLarge")); setSaveState("error"); e.target.value = ""; return; }
                setCoverFile(file);
                if (file) setRemoveCover(false);
              }}
            />
            {(coverUrl || coverFile) && !removeCover && (
              <button className={ghostButton} type="button" onClick={() => { setCoverFile(null); setRemoveCover(Boolean(coverUrl)); if (fileRef.current) fileRef.current.value = ""; }}>{t("removeCover")}</button>
            )}
            <label className={labelClass}>
              <span className="flex justify-between">{t("fieldCoverAlt")} <Counter value={form.coverAlt} max={200} /></span>
              <input className={controlClass} value={form.coverAlt} onChange={(e) => set("coverAlt", e.target.value)} />
              {shownCover && !form.coverAlt.trim() && <span className={hintText}>{t("coverAltRequired")}</span>}
            </label>
          </div>

          <div className="grid gap-3 rounded-[10px] border border-(color:--line) bg-(--paper) p-4">
            <label className={labelClass}>
              <span className="flex justify-between">{t("fieldSeoTitle")} <Counter value={form.seoTitle} max={70} /></span>
              <input className={controlClass} value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
            </label>
            <label className={labelClass}>
              <span className="flex justify-between">{t("fieldSeoDescription")} <Counter value={form.seoDescription} max={170} /></span>
              <textarea className={textareaClass} rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
            </label>
            <div className="grid gap-0.5 rounded-lg border border-(color:--ash-150) bg-(--ash-50) p-3" aria-label={t("snippetLabel")}>
              <span className="text-[11px] text-(color:--muted)">{t("snippetLabel")}</span>
              <span className="truncate text-[11px] text-(color:--ash-700)">leadta › blog › {form.slug || "…"}</span>
              <span className="line-clamp-1 text-[15px] font-semibold text-(color:--ash-950)">{snippetTitle.length > 60 ? `${snippetTitle.slice(0, 60)}…` : snippetTitle}</span>
              <span className="line-clamp-2 text-xs leading-snug text-(color:--ash-700)">{snippetDescription.length > 160 ? `${snippetDescription.slice(0, 160)}…` : snippetDescription}</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
