"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  cardClass, errorBox, ghostButton, isUnauthorized, mutedText, ownerFetch, rightCell, sectionHead, sectionTitle, stateBox, tableClass, tableWrap,
  tdClass, thClass, theadClass, titleDot, trClass, useOwnerFormat,
} from "../ui";

type Days = 7 | 30 | 90;
type Traffic =
  | { configured: false }
  | { configured: true; error: true }
  | {
    configured: true;
    error?: undefined;
    totals: { pageviews: number; visitors: number };
    daily: { date: string; pageviews: number; visitors: number }[];
    topPages: { path: string; pageviews: number; visitors: number }[];
    referrers: { domain: string; visitors: number }[];
  };
type Spend = { usd: number; calls: number };
type Ai =
  | { available: false }
  | {
    available: true;
    totalUsd: number;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    daily: ({ date: string } & Spend)[];
    byFeature: ({ feature: string } & Spend)[];
    byModel: ({ model: string } & Spend)[];
    topUsers: ({ userId: string; email: string } & Spend)[];
  };
type Feature = { id: string; count: number; units?: number; credits?: number; usd?: number };
type Analytics = {
  days: Days;
  traffic: Traffic;
  features: Feature[];
  credits: { total: number; byFeature: { id: string; credits: number; units: number }[] };
  ai: Ai;
};

const periods: Days[] = [7, 30, 90];
// Paleta AGENTS.md: lime para la serie principal, ash para las secundarias.
const SERIES = { main: "var(--lime-dark)", soft: "var(--lime)", second: "var(--ash-700)", third: "var(--ash-400)", grid: "var(--ash-200)", axis: "var(--ash-600)" };
const AXIS_TICK = { fill: SERIES.axis, fontSize: 11 };
const TOOLTIP_STYLE = { background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)", fontSize: 12 };
const cardTitle = "m-0 mb-2.5 text-[13px] font-semibold";
const segment = "min-h-9 cursor-pointer rounded-md border-0 px-3 text-xs! font-semibold! focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(color:--ash-950)";
const rankPill = "rounded-full px-2 py-0.5 text-[11px] font-bold";

function Card({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`${cardClass} min-w-0 ${className}`} aria-label={title}>
      <h2 className={cardTitle}>{title}</h2>
      {hint && <p className={`${mutedText} -mt-1.5 mb-2.5`}>{hint}</p>}
      {children}
    </section>
  );
}

export default function AnalyticsSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const t = useTranslations("Owner.analytics");
  const common = useTranslations("Owner.common");
  const locale = useLocale();
  const { formatNumber, errorText } = useOwnerFormat();
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const format = useMemo(() => {
    const tag = locale === "en" ? "en-US" : "es-AR";
    const usd = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const usdSmall = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const day = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", timeZone: "UTC" });
    return {
      usd: (value: number) => (value > 0 && value < 1 ? usdSmall : usd).format(value || 0),
      day: (value: string) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? value : day.format(parsed); },
    };
  }, [locale]);

  const featureLabel = useCallback((id: string) => {
    const key = id.startsWith("ai.") ? `aiFeatures.${id.slice(3)}` : `features.${id}`;
    return t.has(key) ? t(key) : id;
  }, [t]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const result = await ownerFetch<Analytics>(`/api/owner/analytics?days=${days}`);
    if (id !== requestId.current) return;
    setLoading(false);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) { setData(result.data); setError(""); }
    else setError(errorText(result.data.error, t("loadError")));
  }, [days, errorText, onUnauthorized, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch when the period changes; state set after await
  useEffect(() => { void load(); }, [load]);

  const traffic = data?.traffic;
  const trafficReady = traffic && traffic.configured && !traffic.error ? traffic : null;
  const ai = data?.ai.available ? data.ai : null;
  const hasAiData = Boolean(ai && ai.calls > 0);
  const features = useMemo(() => data?.features ?? [], [data]);
  const usedFeatures = features.filter((feature) => feature.count > 0);
  const mostUsed = usedFeatures[0];
  const leastUsed = usedFeatures.length > 1 ? usedFeatures[usedFeatures.length - 1] : undefined;

  const trafficSeries = useMemo(() => trafficReady?.daily.map((point) => ({ ...point, label: format.day(point.date) })) ?? [], [trafficReady, format]);
  const aiSeries = useMemo(() => ai?.daily.map((point) => ({ ...point, label: format.day(point.date) })) ?? [], [ai, format]);
  const featureSeries = useMemo(() => features.map((feature) => ({ ...feature, label: featureLabel(feature.id) })), [features, featureLabel]);

  const kpis: [string, string][] = data ? [
    [t("kpiVisitors"), trafficReady ? formatNumber(trafficReady.totals.visitors) : "—"],
    [t("kpiPageviews"), trafficReady ? formatNumber(trafficReady.totals.pageviews) : "—"],
    [t("kpiAiSpend"), ai ? format.usd(ai.totalUsd) : "—"],
    [t("kpiAiCalls"), ai ? formatNumber(ai.calls) : "—"],
    [t("kpiCredits"), formatNumber(data.credits.total)],
  ] : [];

  const trafficState = !traffic ? null
    : !traffic.configured ? <p className={mutedText} role="status">{t("posthogNotConfigured")}</p>
    : traffic.error ? <p className={mutedText} role="status">{t("posthogError")}</p>
    : null;
  const aiState = !data ? null
    : !ai ? <p className={mutedText} role="status">{t("aiUnavailable")}</p>
    : !hasAiData ? <p className={mutedText} role="status">{t("aiEmpty")}</p>
    : null;

  return (
    <section aria-label={t("title")} aria-busy={loading}>
      <div className={sectionHead}>
        <h1 className={sectionTitle}>{t("title")}<span className={titleDot} aria-hidden="true">.</span></h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-1 rounded-lg border border-(color:--ash-300) bg-(--paper) p-0.5" role="group" aria-label={t("periodLabel")}>
            {periods.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => setDays(value)}
                className={`${segment} ${days === value ? "bg-(--lime) text-(color:--ink)" : "bg-transparent text-(color:--ash-800) hover:bg-(--ash-100)"}`}
              >
                {t("periodDays", { days: value })}
              </button>
            ))}
          </div>
          <button className={ghostButton} type="button" onClick={() => void load()} disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} {common("refresh")}
          </button>
        </div>
      </div>

      {error && <p className={errorBox} role="alert">{error}</p>}
      {!data && !error && <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}

      {data && (
        <div className={`grid gap-3.5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {kpis.map(([label, value]) => (
              <div className={cardClass} key={label}><dt className="text-[11px] font-semibold text-(color:--muted)">{label}</dt><dd className="m-0 mt-1.5 text-[28px] font-[680] tracking-[-0.03em] tabular-nums">{value}</dd></div>
            ))}
          </dl>

          <Card title={t("trafficTitle")} hint={t("trafficHint", { days: data.days })}>
            {trafficState}
            {trafficReady && (trafficReady.totals.pageviews === 0 ? <p className={mutedText}>{t("trafficEmpty")}</p> : <>
              <p className="sr-only">{trafficSeries.map((point) => t("trafficPointSr", { day: point.label, visitors: point.visitors, pageviews: point.pageviews })).join("; ")}</p>
              <div aria-hidden="true">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={trafficSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke={SERIES.grid} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: SERIES.grid }} minTickGap={16} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: SERIES.third }} />
                    <Area type="monotone" dataKey="pageviews" name={t("seriesPageviews")} stroke={SERIES.second} strokeWidth={2} fill={SERIES.third} fillOpacity={0.2} />
                    <Area type="monotone" dataKey="visitors" name={t("seriesVisitors")} stroke={SERIES.main} strokeWidth={2} fill={SERIES.soft} fillOpacity={0.35} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-4 p-0 text-xs text-(color:--muted)">
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-(--lime-dark)" aria-hidden="true" />{t("seriesVisitors")}</li>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-(--ash-700)" aria-hidden="true" />{t("seriesPageviews")}</li>
              </ul>
            </>)}
          </Card>

          {trafficReady && (
            <div className="grid gap-3.5 md:grid-cols-2">
              <Card title={t("topPages")}>
                {trafficReady.topPages.length === 0 ? <p className={mutedText}>{t("trafficEmpty")}</p> : (
                  <ol className="m-0 grid list-none gap-2 p-0">
                    {trafficReady.topPages.map((page) => (
                      <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-(color:--ash-150) pt-2 text-[13px] first:border-t-0 first:pt-0" key={page.path}>
                        <span className="truncate font-medium" title={page.path}>{page.path}</span>
                        <span className="text-(color:--muted) tabular-nums">{t("pageStats", { pageviews: formatNumber(page.pageviews), visitors: formatNumber(page.visitors) })}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
              <Card title={t("referrers")}>
                {trafficReady.referrers.length === 0 ? <p className={mutedText}>{t("trafficEmpty")}</p> : (
                  <ol className="m-0 grid list-none gap-2 p-0">
                    {trafficReady.referrers.map((referrer) => (
                      <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-(color:--ash-150) pt-2 text-[13px] first:border-t-0 first:pt-0" key={referrer.domain}>
                        <span className="truncate font-medium" title={referrer.domain}>{referrer.domain === "$direct" ? t("directTraffic") : referrer.domain}</span>
                        <span className="text-(color:--muted) tabular-nums">{t("visitorsCount", { count: referrer.visitors })}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          )}

          <Card title={t("featuresTitle")} hint={t("featuresHint")}>
            {usedFeatures.length === 0 ? <p className={mutedText}>{t("featuresEmpty")}</p> : <>
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                {mostUsed && <span className="inline-flex items-center gap-1.5"><span className={`${rankPill} bg-(--lime) text-(color:--ink)`}>{t("mostUsed")}</span>{featureLabel(mostUsed.id)} · {formatNumber(mostUsed.count)}</span>}
                {leastUsed && <span className="inline-flex items-center gap-1.5"><span className={`${rankPill} bg-(--ash-200) text-(color:--ash-800)`}>{t("leastUsed")}</span>{featureLabel(leastUsed.id)} · {formatNumber(leastUsed.count)}</span>}
              </div>
              <ol className="sr-only">
                {featureSeries.map((feature) => <li key={feature.id}>{t("featureSr", { feature: feature.label, count: feature.count })}</li>)}
              </ol>
              <div aria-hidden="true">
                <ResponsiveContainer width="100%" height={featureSeries.length * 30 + 16}>
                  <BarChart data={featureSeries} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={150} interval={0} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--ash-100)" }} />
                    <Bar dataKey="count" name={t("seriesUses")} radius={[0, 6, 6, 0]} barSize={18} label={{ position: "right", fill: SERIES.axis, fontSize: 11 }}>
                      {featureSeries.map((feature, index) => <Cell key={feature.id} fill={index === 0 ? SERIES.main : feature.id.startsWith("ai.") ? SERIES.third : SERIES.second} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>}
          </Card>

          <Card title={t("creditsTitle")} hint={t("creditsHint")}>
            <ul className="m-0 grid list-none gap-2 p-0">
              {data.credits.byFeature.map((row) => (
                <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-(color:--ash-150) pt-2 text-[13px] first:border-t-0 first:pt-0" key={row.id}>
                  <span className="font-medium">{featureLabel(row.id)}</span>
                  <span className="text-(color:--muted) tabular-nums">{t("creditsRow", { credits: formatNumber(row.credits), units: formatNumber(row.units) })}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t("aiDailyTitle")} hint={t("aiHint")}>
            {aiState}
            {ai && hasAiData && <>
              <p className="sr-only">{aiSeries.map((point) => t("aiPointSr", { day: point.label, usd: format.usd(point.usd), calls: point.calls })).join("; ")}</p>
              <div aria-hidden="true">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={aiSeries} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke={SERIES.grid} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: SERIES.grid }} minTickGap={16} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => format.usd(value)} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--ash-100)" }} formatter={(value) => format.usd(Number(value))} />
                    <Bar dataKey="usd" name={t("seriesUsd")} fill={SERIES.main} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>}
          </Card>

          {ai && hasAiData && (
            <div className="grid gap-3.5 md:grid-cols-2">
              <SpendTable title={t("aiByFeature")} nameLabel={t("colFeature")} rows={ai.byFeature.map((row) => ({ key: row.feature, name: featureLabel(`ai.${row.feature}`), usd: row.usd, calls: row.calls }))} usd={format.usd} number={formatNumber} usdLabel={t("colUsd")} callsLabel={t("colCalls")} />
              <SpendTable title={t("aiByModel")} nameLabel={t("colModel")} rows={ai.byModel.map((row) => ({ key: row.model, name: row.model, usd: row.usd, calls: row.calls }))} usd={format.usd} number={formatNumber} usdLabel={t("colUsd")} callsLabel={t("colCalls")} />
              <div className="md:col-span-2">
                <SpendTable title={t("aiTopUsers")} nameLabel={t("colUser")} rows={ai.topUsers.map((row) => ({ key: row.userId, name: row.email || row.userId, usd: row.usd, calls: row.calls }))} usd={format.usd} number={formatNumber} usdLabel={t("colUsd")} callsLabel={t("colCalls")} empty={t("aiNoUsers")} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SpendTable({ title, nameLabel, usdLabel, callsLabel, rows, usd, number, empty }: {
  title: string;
  nameLabel: string;
  usdLabel: string;
  callsLabel: string;
  rows: { key: string; name: string; usd: number; calls: number }[];
  usd: (value: number) => string;
  number: (value: number) => string;
  empty?: string;
}) {
  return (
    <section className="grid min-w-0 gap-2" aria-label={title}>
      <h2 className="m-0 text-[13px] font-semibold">{title}</h2>
      {rows.length === 0 ? <p className={`${cardClass} ${mutedText}`}>{empty}</p> : (
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead className={theadClass}><tr><th className={thClass} scope="col">{nameLabel}</th><th className={`${thClass} text-right!`} scope="col">{usdLabel}</th><th className={`${thClass} text-right!`} scope="col">{callsLabel}</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr className={trClass} key={row.key}>
                  <td className={`${tdClass} break-all font-medium`} data-label={nameLabel}>{row.name}</td>
                  <td className={`${tdClass} ${rightCell}`} data-label={usdLabel}>{usd(row.usd)}</td>
                  <td className={`${tdClass} ${rightCell}`} data-label={callsLabel}>{number(row.calls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
