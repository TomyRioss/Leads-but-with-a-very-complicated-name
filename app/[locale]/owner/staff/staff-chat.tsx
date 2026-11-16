"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, ArrowUp, ArrowUpRight, Ban, ChartLine, CircleAlert, CircleCheck, Coins, CreditCard, LoaderCircle, MessageSquare, Newspaper, PencilLine, RotateCcw, Check, SquarePen, Trash2, Users, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/app/brand-logo";
import { renderMarkdown } from "@/lib/markdown";
import { runsWithoutAsking, StaffPermissionControl, useStaffPermission, type StaffPermission } from "./staff-permissions";
import "@/app/[locale]/lead-suite/chat-panel.css";
import "./staff-chat.css";

type ChangeKind = "adjust_credits" | "update_user" | "delete_user" | "subscription_status" | "close_feedback" | "delete_batch" | "create_blog_post" | "update_blog_post" | "delete_blog_post";
type CardField = { key: string; before?: string | number; after?: string | number };
type PendingAction = { type: "pending_change"; token: string; change: { kind: ChangeKind; target: string; fields: CardField[]; needsCard: boolean; destructive: boolean } };
type ProgressItem = { id: string; label: string; status: "running" | "done" | "failed" };
type Message = { id: number; role: "user" | "assistant"; content: string; actions?: PendingAction[]; progress?: ProgressItem[] };
type CardState = "busy" | "done" | "cancelled" | "stale" | "expired" | "error";
type SendFailure = "error" | "session" | "rate" | "service" | "offline" | "context";

const MAX_CHARS = 4000;
const MAX_HISTORY = 20;
const KIND_ICON: Record<ChangeKind, LucideIcon> = {
  adjust_credits: Coins,
  update_user: PencilLine,
  delete_user: Trash2,
  subscription_status: CreditCard,
  close_feedback: MessageSquare,
  delete_batch: Trash2,
  create_blog_post: Newspaper,
  update_blog_post: PencilLine,
  delete_blog_post: Trash2,
};
const QUOTE_FIELDS = new Set(["message", "excerpt"]);
const EXAMPLES: [string, LucideIcon][] = [["example1", ChartLine], ["example2", Users], ["example3", MessageSquare]];

const isOffline = (error: unknown) => error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);

/** Leadtita Staff: owner-only assistant page. The conversation lives only in this component's state, so the panel
 *  keeps it mounted and passes `hidden` while another section is open. */
export default function StaffChat({ hidden = false }: { hidden?: boolean }) {
  const t = useTranslations("ownerAssistant");
  const permission = useStaffPermission();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [failed, setFailed] = useState<{ history: Message[]; reason: SendFailure } | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const nextId = useRef(1);
  const progressRef = useRef<ProgressItem[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view inside the log (never scrolls the page itself).
  useEffect(() => {
    const list = listRef.current;
    if (list && !hidden) list.scrollTop = list.scrollHeight;
  }, [messages, sending, progress, hidden]);

  const focusComposer = useCallback(() => window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0), []);

  const resize = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 176)}px`;
  };

  const appendAssistant = (content: string) =>
    setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content }]);

  async function confirm(action: PendingAction, auto?: StaffPermission) {
    const { token, change } = action;
    setCards((current) => ({ ...current, [token]: "busy" }));
    try {
      const response = await fetch("/api/owner/assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...(auto ? { auto } : {}) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (response.status === 409 && payload.code === "needs_confirmation") {
        // Not allowed to run on its own: back to a normal Yes/No card.
        setCards((current) => { const next = { ...current }; delete next[token]; return next; });
        return;
      }
      if (response.status === 409 && payload.code === "stale") { setCards((current) => ({ ...current, [token]: "stale" })); return; }
      if (response.status === 400 && payload.code === "invalid") { setCards((current) => ({ ...current, [token]: "expired" })); return; }
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403 ? t("errors.session") : response.status === 429 ? t("errors.rate") : payload.error || t("errors.generic");
        setCardErrors((current) => ({ ...current, [token]: message }));
        setCards((current) => ({ ...current, [token]: "error" }));
        return;
      }
      setCards((current) => ({ ...current, [token]: "done" }));
      appendAssistant(t(`done.${change.kind}`, { target: change.target }));
      focusComposer();
    } catch (error) {
      setCardErrors((current) => ({ ...current, [token]: isOffline(error) ? t("errors.offline") : t("errors.generic") }));
      setCards((current) => ({ ...current, [token]: "error" }));
    }
  }

  function cancel(token: string) {
    setCards((current) => ({ ...current, [token]: "cancelled" }));
    appendAssistant(t("cancelled"));
    focusComposer();
  }

  async function request(history: Message[]) {
    setSending(true);
    setFailed(null);
    progressRef.current = [];
    setProgress([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/owner/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content })),
          permission,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        throw new Error(payload.code === "context_full" ? "context" : response.status === 401 || response.status === 403 ? "session" : response.status === 429 ? "rate" : response.status >= 500 ? "service" : "error");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("error");
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = null as { reply?: string; actions?: PendingAction[] } | null;
      let streamFailure: string | null = null;
      const consume = (frame: string) => {
        const lines = frame.split("\n");
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!event || !data) return;
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { return; }
        if (!parsed || typeof parsed !== "object") return;
        if (event === "progress") {
          const update = parsed as { type?: unknown; id?: unknown; label?: unknown };
          const status = update.type === "tool_started" ? "running" : update.type === "tool_succeeded" ? "done" : update.type === "tool_failed" ? "failed" : null;
          if (!status || typeof update.id !== "string" || typeof update.label !== "string") return;
          const index = progressRef.current.findIndex((item) => item.id === update.id);
          const next = [...progressRef.current];
          if (index < 0) next.push({ id: update.id, label: update.label, status });
          else next[index] = { ...next[index], status };
          progressRef.current = next;
          setProgress(next);
        } else if (event === "complete") {
          completed = parsed as { reply?: string; actions?: PendingAction[] };
        } else if (event === "failure") {
          const code = (parsed as { code?: unknown }).code;
          streamFailure = code === "context_full" ? "context" : "error";
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
        let separator = buffer.indexOf("\n\n");
        while (separator >= 0) {
          consume(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (streamFailure) throw new Error(streamFailure);
      if (!completed) throw new Error("error");
      const actions = (Array.isArray(completed.actions) ? completed.actions : []).filter((action) => action?.type === "pending_change" && typeof action.token === "string");
      const autoActions = actions.filter((action) => runsWithoutAsking(permission, action.change.needsCard));
      const content = completed.reply?.trim() || (actions.length ? t(autoActions.length === actions.length ? "running" : "confirmPrompt") : "");
      if (!content && !actions.length) throw new Error("context");
      setMessages([...history, { id: nextId.current++, role: "assistant", content, actions, ...(progressRef.current.length ? { progress: progressRef.current } : {}) }]);
      progressRef.current = [];
      setProgress([]);
      // Sequential: each auto-run appends its own result line; the server re-checks every one.
      if (autoActions.length) void (async () => { for (const action of autoActions) await confirm(action, permission); })();
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof Error ? error.message : "error";
      const reason: SendFailure = isOffline(error) ? "offline" : (["session", "rate", "service", "context"] as const).find((item) => item === code) ?? "error";
      progressRef.current = progressRef.current.map((item) => (item.status === "running" ? { ...item, status: "failed" } : item));
      setProgress(progressRef.current);
      setFailed({ history, reason });
      focusComposer();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  }

  function send(text: string) {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || sending) return;
    const history = [...messages, { id: nextId.current++, role: "user" as const, content }];
    setMessages(history);
    setDraft("");
    window.requestAnimationFrame(() => resize(inputRef.current));
    void request(history);
  }

  function startNewChat() {
    abortRef.current?.abort();
    setMessages([]);
    setCards({});
    setCardErrors({});
    setFailed(null);
    setProgress([]);
    setDraft("");
    focusComposer();
  }

  const onSubmit = (event: FormEvent) => { event.preventDefault(); send(draft); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  };

  const fieldLabel = (key: string) => (t.has(`fields.${key}`) ? t(`fields.${key}`) : key);
  const value = (raw: string | number | undefined) => (raw === undefined || raw === "" ? "—" : String(raw));
  const progressList = (items: ProgressItem[]) => (
    <ul className="ls-chat__tool-progress" aria-label={t("toolProgress")}>
      {items.map((item) => (
        <li key={item.id}>
          <span className={`ls-chat__tool-progress-icon is-${item.status}`} aria-hidden="true">{item.status === "running" ? <LoaderCircle className="ls-chat__spin" size={14} /> : item.status === "done" ? <CircleCheck size={14} /> : <CircleAlert size={14} />}</span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="ls-chat ls-chat--staff" aria-labelledby="staff-chat-title" hidden={hidden}>
      <header className="staff-chat__head">
        <h1 id="staff-chat-title" className="staff-chat__title">{t("title")}</h1>
        <span className="staff-chat__badge">{t("badge")}</span>
        <button type="button" className="ls-chat__new staff-chat__new" onClick={startNewChat} disabled={!messages.length && !sending} aria-label={t("newChat")}>
          <SquarePen size={16} aria-hidden="true" /><span>{t("newChat")}</span>
        </button>
      </header>

      <ol className={`ls-chat__log${messages.length === 0 && !sending ? " ls-chat__log--empty" : ""}`} ref={listRef} aria-live="polite" aria-relevant="additions" aria-busy={sending} tabIndex={0} aria-label={t("logLabel")}>
        {messages.length === 0 && !sending ? (
          <li className="ls-chat__intro staff-chat__intro">
            <span className="ls-chat__avatar staff-chat__hero-mark" aria-hidden="true"><BrandMark /></span>
            <p className="ls-chat__intro-title">{t("introTitle")}</p>
            <p className="ls-chat__intro-text">{t("intro")}</p>
            <ul className="ls-chat__examples staff-chat__examples" aria-label={t("examplesLabel")}>
              {EXAMPLES.map(([key, Icon]) => (
                <li key={key}>
                  <button type="button" onClick={() => { setDraft(t(key)); inputRef.current?.focus(); }}>
                    <span className="ls-chat__example-icon" aria-hidden="true"><Icon size={16} /></span>
                    <span className="ls-chat__example-body"><span className="ls-chat__example-text">{t(key)}</span></span>
                    <ArrowUpRight className="ls-chat__example-go" aria-hidden="true" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ) : null}

        {messages.map((message, index) => {
          const grouped = index > 0 && messages[index - 1].role === message.role;
          return (
            <li key={message.id} className={`ls-chat__msg ls-chat__msg--${message.role}${grouped ? " is-grouped" : ""}`}>
              {message.role === "assistant" ? <span className="ls-chat__avatar" aria-hidden="true">{grouped ? null : <BrandMark />}</span> : null}
              <div className="ls-chat__msg-body">
                <span className="ls-chat__sr">{message.role === "user" ? t("you") : t("title")}: </span>
                {message.content
                  ? message.role === "assistant"
                    ? <div className="ls-chat__md">{renderMarkdown(message.content.replace(/!\[/g, "["))}</div>
                    : <p className="ls-chat__bubble">{message.content}</p>
                  : null}
                {message.progress?.length ? progressList(message.progress) : null}
                {message.actions?.map((action, actionIndex) => {
                  const { kind, target, fields, destructive } = action.change;
                  const state = cards[action.token];
                  const settled = state === "done" || state === "cancelled" || state === "stale" || state === "expired";
                  const Icon = KIND_ICON[kind] ?? PencilLine;
                  const titleId = `staff-action-${message.id}-${actionIndex}`;
                  const facts = fields.filter((field) => !QUOTE_FIELDS.has(field.key));
                  const quotes = fields.filter((field) => QUOTE_FIELDS.has(field.key) && field.after);
                  return (
                    <article key={action.token} className={`ls-chat__action${destructive ? " is-destructive" : ""}${state ? ` is-${state}` : ""}`} aria-labelledby={titleId}>
                      <header className="ls-chat__action-head">
                        <span className="ls-chat__action-icon" aria-hidden="true"><Icon size={18} /></span>
                        <h3 id={titleId}>{t.has(`kinds.${kind}`) ? t(`kinds.${kind}`, { target }) : target}</h3>
                      </header>
                      {facts.length ? (
                        <dl className="ls-chat__facts">
                          {facts.map((field) => (
                            <div key={field.key}>
                              <dt>{fieldLabel(field.key)}</dt>
                              <dd>
                                {field.before !== undefined ? <><s>{value(field.before)}</s><ArrowRight size={13} aria-label={t("changesTo")} /></> : null}
                                <span>{value(field.after)}</span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {quotes.map((field) => <blockquote key={field.key} className="ls-chat__quote" aria-label={fieldLabel(field.key)}>{value(field.after)}</blockquote>)}
                      {destructive && !settled ? <p className="ls-chat__action-note">{t("irreversible")}</p> : null}
                      <footer className="ls-chat__action-foot" aria-live="polite">
                        {state === "done" ? (
                          <p className="ls-chat__action-status is-done"><CircleCheck aria-hidden="true" size={16} />{t("statusConfirmed")}</p>
                        ) : state === "cancelled" ? (
                          <p className="ls-chat__action-status"><Ban aria-hidden="true" size={16} />{t("statusCancelled")}</p>
                        ) : state === "stale" ? (
                          <p className="ls-chat__action-status" role="status">{t("statusStale")}</p>
                        ) : state === "expired" ? (
                          <p className="ls-chat__action-status" role="status"><Ban aria-hidden="true" size={16} />{t("statusExpired")}</p>
                        ) : state === "busy" ? (
                          <div className="ls-chat__action-progress" role="status"><span className="ls-chat__progress-bar" aria-hidden="true" /><span>{t("confirming")}</span></div>
                        ) : (
                          <>
                            {state === "error" ? <p className="ls-chat__action-error" role="alert"><CircleAlert aria-hidden="true" size={16} /><span>{cardErrors[action.token] ?? t("errors.generic")}</span></p> : null}
                            <div className="ls-chat__action-buttons">
                              <button type="button" className="ls-chat__action-secondary" onClick={() => cancel(action.token)}>{t("cancelAction")}</button>
                              <button type="button" className="ls-chat__action-primary" onClick={() => void confirm(action)}>
                                {state === "error" ? <RotateCcw aria-hidden="true" size={16} /> : destructive ? <Trash2 aria-hidden="true" size={16} /> : <Check aria-hidden="true" size={16} />}
                                {state === "error" ? t("retry") : destructive ? t("deleteAction") : t("confirmAction")}
                              </button>
                            </div>
                          </>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </li>
          );
        })}

        {sending ? (
          <li className={`ls-chat__msg ls-chat__msg--assistant ls-chat__typing${messages[messages.length - 1]?.role === "assistant" ? " is-grouped" : ""}`} role="status">
            <span className="ls-chat__avatar" aria-hidden="true"><BrandMark /></span>
            <div className="ls-chat__msg-body">
              <span className="ls-chat__dots" aria-hidden="true"><span /><span /><span /></span>
              <span className="ls-chat__sr">{t("typing")}</span>
              {progress.length ? progressList(progress) : null}
            </div>
          </li>
        ) : null}
      </ol>

      {failed ? (
        <div className="ls-chat__error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span>{t(`sendErrors.${failed.reason}`)}</span>
          {failed.reason !== "session" && failed.reason !== "context" ? (
            <button type="button" onClick={() => void request(failed.history)}><RotateCcw aria-hidden="true" size={14} />{t("retry")}</button>
          ) : failed.reason === "context" ? (
            <button type="button" onClick={startNewChat}><SquarePen aria-hidden="true" size={14} />{t("newChat")}</button>
          ) : null}
        </div>
      ) : null}

      <form className="ls-chat__form" onSubmit={onSubmit}>
        <div className="ls-chat__composer" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); inputRef.current?.focus(); } }}>
          <label htmlFor="staff-chat-input" className="ls-chat__sr">{t("inputLabel")}</label>
          <div className="ls-chat__input-wrap">
            <textarea
              id="staff-chat-input"
              ref={inputRef}
              value={draft}
              rows={1}
              maxLength={MAX_CHARS}
              placeholder={t("placeholder")}
              onChange={(event) => { setDraft(event.target.value); resize(event.target); }}
              onKeyDown={onKeyDown}
              aria-describedby="staff-chat-hint"
            />
          </div>
          <div className="ls-chat__toolbar">
            <StaffPermissionControl onResumeTyping={() => inputRef.current?.focus({ preventScroll: true })} />
            <button type="submit" className="ls-chat__send" disabled={sending || !draft.trim()} aria-label={sending ? t("sending") : t("send")}>
              {sending ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={18} /> : <ArrowUp aria-hidden="true" size={18} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
        <p className="ls-chat__sr" id="staff-chat-hint">{t("hint")}</p>
      </form>
    </section>
  );
}
