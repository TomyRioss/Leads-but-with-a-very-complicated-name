"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight, CalendarClock, CircleAlert, Clock, MessageSquareReply, Minus, RefreshCw, Send, Sparkles, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyAnalysis, Delta, InsightMetrics } from "@/lib/server/lead-suite-insights";
import { BrandMark } from "@/app/brand-logo";
import "./metrics.css";

type InsightsResponse = { metrics: InsightMetrics; analysis: DailyAnalysis; refreshesLeft: number };
type Result = { key: string; data: InsightsResponse; error?: undefined } | { key: string; data?: undefined; error: string };

const DAY_MS = 86_400_000;
// Paleta AGENTS.md: lime para la serie principal, ash para las secundarias.
const SERIES = { main: "var(--lime-dark)", soft: "var(--lime)", second: "var(--ash-700)", third: "var(--ash-400)", grid: "var(--ash-200)", axis: "var(--ash-600)" };
const PIE_COLORS = ["var(--lime-dark)", "var(--ash-800)", "var(--lime)", "var(--ash-500)", "var(--ash-300)", "var(--ash-600)", "var(--ash-200)"];
const AXIS_TICK = { fill: SERIES.axis, fontSize: 11 };
const TOOLTIP_STYLE = { background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)", fontSize: 12 };

function DeltaBadge({ delta, kind, lowerIsBetter }: { delta: Delta; kind: "percent" | "number" | "hours"; lowerIsBetter?: boolean }) {
  const t = useTranslations("leadSuite.metrics");
  const format = useFormatter();
  if (delta.value === null || delta.previous === null) return <span className="lsm-delta is-flat">{t("noPrevious")}</span>;
  const diff = delta.value - delta.previous;
  if (Math.abs(diff) < 1e-9) return <span className="lsm-delta is-flat"><Minus size={12} aria-hidden />{t("same")}</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  const amount = kind === "percent"
    ? t("points", { value: format.number(Math.abs(diff) * 100, { maximumFractionDigits: 0 }) })
    : kind === "hours" ? t("hoursShort", { value: format.number(Math.abs(diff), { maximumFractionDigits: 1 }) }) : format.number(Math.abs(diff));
  return (
    <span className={`lsm-delta ${good ? "is-good" : "is-bad"}`}>
      <Icon size={12} aria-hidden />
      <span className="ls-sr">{diff > 0 ? t("up") : t("down")} </span>{amount}
    </span>
  );
}

function Kpi({ icon: Icon, label, value, children }: { icon: LucideIcon; label: string; value: string; children?: ReactNode }) {
  return (
    <div className="lsm-kpi">
      <span className="lsm-kpi-label"><Icon size={14} aria-hidden />{label}</span>
      <strong className="lsm-kpi-value">{value}</strong>
      {children}
    </div>
  );
}

function Card({ title, hint, children, className = "" }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`lsm-card ${className}`.trim()} aria-label={title}>
      <header className="lsm-card-head">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** Pestaña Métricas: gráficos, datos clave con variación y análisis diario de Leadtita. Carga solo cuando está visible. */
export function LeadSuiteMetricsTab({ days, reloadKey, active }: { days: number; reloadKey: number; active: boolean }) {
  const t = useTranslations("leadSuite.metrics");
  const ts = useTranslations("leadSuite");
  const locale = useLocale();
  const format = useFormatter();
  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [heatMode, setHeatMode] = useState<"sent" | "replies">("sent");
  const requested = useRef({ key: "", refresh: 0 });

  // Carga perezosa: solo con la pestaña visible y una vez por rango/recarga. "Actualizar análisis" pide un análisis nuevo (con límite diario en el servidor).
  useEffect(() => {
    if (!active) return;
    const key = `${days}:${reloadKey}:${retry}:${refresh}`;
    if (requested.current.key === key) return;
    const forceAnalysis = refresh > requested.current.refresh;
    requested.current = { key, refresh };
    const controller = new AbortController();
    const to = new Date();
    const params = new URLSearchParams({
      from: new Date(to.getTime() - days * DAY_MS).toISOString(),
      to: to.toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      locale,
    });
    if (forceAnalysis) params.set("refresh", "1");
    (async () => {
      try {
        const response = await fetch(`/api/lead-suite/insights?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null) as (InsightsResponse & { error?: string }) | null;
        if (controller.signal.aborted) return;
        setResult(response.ok && body?.metrics ? { key, data: body } : { key, error: body?.error || ts("error") });
      } catch {
        if (!controller.signal.aborted) setResult({ key, error: ts("error") });
      }
    })();
    return () => {
      controller.abort();
      requested.current = { key: "", refresh: requested.current.refresh };
    };
  }, [active, days, reloadKey, retry, refresh, locale, ts]);

  if (!result) {
    return <p role="status" className="ls-state"><BrandMark className="brand-mark-loading" />{ts("loadingMetrics")}</p>;
  }
  if (!result.data) {
    return (
      <div role="alert" className="ls-state ls-state-error">
        <CircleAlert size={18} aria-hidden /><span>{result.error}</span>
        <button type="button" className="auth-secondary-button ls-button" onClick={() => setRetry((value) => value + 1)}>{ts("retry")}</button>
      </div>
    );
  }

  const { metrics, analysis, refreshesLeft } = result.data;
  const { kpis } = metrics;
  const percent = (value: number | null) => (value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 0 }));
  const hours = (value: number | null) => (value === null ? "—" : value < 24 ? t("hoursShort", { value: format.number(value, { maximumFractionDigits: 1 }) }) : t("daysShort", { value: format.number(value / 24, { maximumFractionDigits: 1 }) }));
  const hourLabel = (hour: number) => t("hourLabel", { hour });
  const dateLabel = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { day: "numeric", month: "numeric", timeZone: "UTC" });
  const weekdays = Array.from({ length: 7 }, (_, index) => format.dateTime(new Date(Date.UTC(2024, 0, 1 + index)), { weekday: "short", timeZone: "UTC" }));
  const channelName = (channel: string) => ts(`channels.${channel}`);
  const hasData = metrics.totalContacts > 0;

  const trend = metrics.trend.map((point) => ({ ...point, label: dateLabel(point.date) }));
  const funnel = metrics.funnel.map((stage) => ({ ...stage, label: t(`funnel.${stage.stage}`), rateText: stage.rateFromPrev === null ? "" : percent(stage.rateFromPrev) }));
  const channelPie = metrics.channels.map((channel) => ({ name: channelName(channel.channel), value: channel.sent }));
  const heat = metrics.heat[heatMode];
  const heatMax = Math.max(1, ...heat.flat());

  return (
    <div className="lsm">
      <div className="lsm-kpis">
        <Kpi icon={MessageSquareReply} label={t("kpiReplyRate")} value={percent(kpis.replyRate.value)}><DeltaBadge delta={kpis.replyRate} kind="percent" /></Kpi>
        <Kpi icon={Clock} label={t("kpiReplyTime")} value={hours(kpis.avgReplyHours.value)}><DeltaBadge delta={kpis.avgReplyHours} kind="hours" lowerIsBetter /></Kpi>
        <Kpi icon={Send} label={t("kpiContacts")} value={format.number(kpis.contacts.value ?? 0)}><DeltaBadge delta={kpis.contacts} kind="number" /></Kpi>
        <Kpi icon={Trophy} label={t("kpiBestChannel")} value={kpis.bestChannel ? channelName(kpis.bestChannel.channel) : "—"}>
          <span className="lsm-kpi-note">{kpis.bestChannel ? t("bestNote", { rate: percent(kpis.bestChannel.replyRate), leads: kpis.bestChannel.leads }) : t("needMoreData")}</span>
        </Kpi>
        <Kpi icon={Clock} label={t("kpiBestHour")} value={kpis.bestHour ? hourLabel(kpis.bestHour.hour) : "—"}>
          <span className="lsm-kpi-note">{kpis.bestHour ? t("bestNote", { rate: percent(kpis.bestHour.replyRate), leads: kpis.bestHour.leads }) : t("needMoreData")}</span>
        </Kpi>
        <Kpi icon={CalendarClock} label={t("kpiOverdue")} value={format.number(kpis.overdue)}>
          <span className="lsm-kpi-note">{t("overdueNote")}</span>
        </Kpi>
      </div>

      <section className="lsm-card lsm-analysis" aria-labelledby="lsm-analysis-title">
        <header className="lsm-analysis-head">
          <span className="lsm-analysis-icon" aria-hidden><Sparkles size={16} /></span>
          <div>
            <h3 id="lsm-analysis-title">{t("analysisTitle")}</h3>
            <p>{t(analysis.source === "model" ? "analysisModel" : "analysisFallback", { time: format.dateTime(new Date(analysis.generatedAt), { hour: "2-digit", minute: "2-digit" }) })}</p>
          </div>
          <button
            type="button"
            className="auth-secondary-button ls-button lsm-analysis-refresh"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={refreshesLeft <= 0}
            title={refreshesLeft <= 0 ? t("refreshLimit") : t("refreshesLeft", { count: refreshesLeft })}
          >
            <RefreshCw size={14} aria-hidden />{t("refreshAnalysis")}
          </button>
        </header>
        <ul className="lsm-observations">
          {analysis.observations.map((observation, index) => <li key={index}>{observation}</li>)}
        </ul>
        <p className="lsm-analysis-foot">{refreshesLeft <= 0 ? t("refreshLimit") : t("refreshesLeft", { count: refreshesLeft })}</p>
      </section>

      {!hasData ? (
        <div className="ls-empty">
          <Sparkles size={22} aria-hidden />
          <h2>{t("emptyTitle")}</h2>
          <p>{t("emptyBody")}</p>
        </div>
      ) : (
        <div className="lsm-grid">
          <Card title={t(metrics.trendUnit === "day" ? "trendDaily" : "trendWeekly")} hint={t("trendHint")} className="lsm-span-2">
            <p className="ls-sr">{trend.map((point) => `${point.label}: ${point.sent} / ${point.replies}`).join("; ")}</p>
            <div className="lsm-chart" aria-hidden>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke={SERIES.grid} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: SERIES.grid }} minTickGap={16} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: SERIES.third }} />
                  <Area type="monotone" dataKey="sent" name={t("seriesSent")} stroke={SERIES.main} strokeWidth={2} fill={SERIES.soft} fillOpacity={0.35} />
                  <Area type="monotone" dataKey="replies" name={t("seriesReplies")} stroke={SERIES.second} strokeWidth={2} fill={SERIES.third} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <ul className="lsm-legend">
              <li><span className="lsm-swatch is-main" aria-hidden />{t("seriesSent")}</li>
              <li><span className="lsm-swatch is-second" aria-hidden />{t("seriesReplies")}</li>
            </ul>
          </Card>

          <Card title={t("funnelTitle")} hint={t("funnelHint")}>
            <p className="ls-sr">{funnel.map((stage) => `${stage.label}: ${stage.count}${stage.rateText ? ` (${stage.rateText})` : ""}`).join("; ")}</p>
            <div className="lsm-chart" aria-hidden>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={92} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--ash-100)" }} />
                  <Bar dataKey="count" name={t("leadsSeries")} radius={[0, 6, 6, 0]} barSize={22}>
                    {funnel.map((stage, index) => <Cell key={stage.stage} fill={index === 0 ? SERIES.third : SERIES.main} />)}
                    <LabelList dataKey="count" position="right" fill="var(--ink)" fontSize={12} formatter={(value: unknown) => String(value ?? "")} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ol className="lsm-funnel-rates">
              {funnel.slice(1).map((stage) => <li key={stage.stage}><span>{stage.label}</span><strong>{stage.rateText || "—"}</strong></li>)}
            </ol>
          </Card>

          <Card title={t("channelTitle")} hint={t("channelHint")}>
            <div className="lsm-channel">
              <div className="lsm-donut" aria-hidden>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={channelPie} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="var(--paper)">
                      {channelPie.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="lsm-channel-list">
                {metrics.channels.map((channel, index) => (
                  <li key={channel.channel}>
                    <span className="lsm-swatch" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} aria-hidden />
                    <span className="lsm-channel-name">{channelName(channel.channel)}</span>
                    <span className="lsm-channel-sent">{t("sentCount", { count: channel.sent })}</span>
                    <span className="lsm-channel-rate">{t("replyRateShort", { rate: percent(channel.replyRate) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title={t("heatTitle")} hint={t("heatHint")} className="lsm-span-2">
            <div role="radiogroup" aria-label={t("heatMode")} className="filter-segments lsm-heat-toggle">
              {(["sent", "replies"] as const).map((mode) => (
                <label key={mode} className={`filter-segment${heatMode === mode ? " is-selected" : ""}`}>
                  <input type="radio" name="lsm-heat" value={mode} checked={heatMode === mode} onChange={() => setHeatMode(mode)} />
                  <span>{t(mode === "sent" ? "heatSent" : "heatReplies")}</span>
                </label>
              ))}
            </div>
            <div className="lsm-heat-scroll">
              <table className="lsm-heat">
                <caption className="ls-sr">{t("heatCaption", { mode: t(heatMode === "sent" ? "heatSent" : "heatReplies") })}</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="ls-sr">{t("heatDay")}</span></th>
                    {Array.from({ length: 24 }, (_, hour) => <th key={hour} scope="col" aria-label={hourLabel(hour)}>{hour % 3 === 0 ? hour : ""}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {heat.map((row, day) => (
                    <tr key={day}>
                      <th scope="row">{weekdays[day]}</th>
                      {row.map((count, hour) => (
                        <td key={hour} title={`${weekdays[day]} ${hourLabel(hour)}: ${count}`} style={{ ["--lsm-heat" as string]: `${Math.round((count / heatMax) * 100)}%` }} data-empty={count === 0 || undefined}>
                          <span className="ls-sr">{count}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("rankingTitle")} hint={t("rankingHint")}>
            {[["categories", metrics.categories], ["cities", metrics.cities]].map(([key, groups]) => (
              <div key={key as string} className="lsm-ranking">
                <h4>{t(key === "categories" ? "rankingCategories" : "rankingCities")}</h4>
                {(groups as InsightMetrics["categories"]).length ? (
                  <ol>
                    {(groups as InsightMetrics["categories"]).map((group) => (
                      <li key={group.name}>
                        <span className="lsm-ranking-name">{group.name}</span>
                        <span className="lsm-ranking-bar" aria-hidden><span style={{ width: `${Math.max(4, group.replyRate * 100)}%` }} /></span>
                        <span className="lsm-ranking-rate">{percent(group.replyRate)}<small>{t("ofLeads", { count: group.leads })}</small></span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="ls-muted">{t("needMoreData")}</p>}
              </div>
            ))}
          </Card>

          <Card title={t("overdueTitle")} hint={t("overdueHint")}>
            {metrics.overdue.length ? (
              <ul className="lsm-overdue">
                {metrics.overdue.map((lead) => (
                  <li key={lead.id}>
                    <span className="lsm-overdue-name">{lead.name}{lead.category && <small>{lead.category}</small>}</span>
                    <span className="lsm-overdue-days">{t("daysAgo", { count: lead.days })}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="ls-muted">{ts("pendingEmpty")}</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
