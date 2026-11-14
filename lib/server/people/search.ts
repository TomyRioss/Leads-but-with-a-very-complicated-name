import type { PeopleSearchPlan, PeopleSearchRequest, PersonCandidate, SearchSource } from "@/lib/people";
import type { Lead } from "@/lib/types";
import { candidateCountry, enrichCandidates, filterPeople, fitsCountry } from "@/lib/server/people/enrich";
import { keepPeople } from "@/lib/server/people/classify";
import { extraQueries, planPeopleSearch } from "@/lib/server/people/planner";
import { createPeopleBatch, finishPeopleBatch, savePeople } from "@/lib/server/people/repository";
import { routeSources } from "@/lib/server/people/router";
import { searchGithub } from "@/lib/server/people/sources/github";
import { searchInstagram } from "@/lib/server/people/sources/instagram";
import { searchBehance, searchFiverr } from "@/lib/server/people/sources/marketplaces";
import { searchFacebookGroups } from "@/lib/server/people/sources/meta";
import { searchSerper } from "@/lib/server/people/sources/serper";
import { searchTiktok } from "@/lib/server/people/sources/tiktok";
import { searchYoutube } from "@/lib/server/people/sources/youtube";

/** Sources + enrichment must end before this so saving fits inside the route's maxDuration. */
export const PEOPLE_SEARCH_DEADLINE_MS = 220_000;
/** The extra Serper round only starts if this much time is left before the deadline. */
const EXTRA_ROUND_MIN_LEFT_MS = 60_000;

export class PeopleSearchAbortedError extends Error {
  constructor() {
    super("People search aborted.");
    this.name = "PeopleSearchAbortedError";
  }
}

export type PeopleSearchResult = { batchId: string; plan: PeopleSearchPlan; leads: Lead[]; failedSources: string[] };

/** "Incluir Instagram y Facebook" apagado: fuera las fuentes de Meta. */
const META_SOURCES: SearchSource[] = ["instagram", "facebook"];

type SourceRun = (plan: PeopleSearchPlan, ctx: { location: string; signal: AbortSignal; limit: number }) => Promise<PersonCandidate[]>;
// Cada scraper pide ~2× lo pedido: parte se pierde por empresa, duplicado o sin contacto.
const runners: Record<SearchSource, SourceRun> = {
  serper: (plan, ctx) => searchSerper(plan.webQueries, { location: ctx.location, signal: ctx.signal }),
  github: (plan, ctx) => searchGithub(plan, { signal: ctx.signal, limit: ctx.limit }),
  instagram: (plan, ctx) => searchInstagram(plan, { signal: ctx.signal, limit: ctx.limit }),
  facebook: (plan, ctx) => searchFacebookGroups(plan, { signal: ctx.signal }),
  tiktok: (plan, ctx) => searchTiktok(plan, { signal: ctx.signal, limit: ctx.limit }),
  youtube: (plan, ctx) => searchYoutube(plan, { signal: ctx.signal, limit: ctx.limit }),
  fiverr: (plan, ctx) => searchFiverr(plan, { signal: ctx.signal, limit: ctx.limit }),
  behance: (plan, ctx) => searchBehance(plan, { signal: ctx.signal, limit: ctx.limit }),
};

/** DeepSeek interpreta la búsqueda; Jev elige los scrapers. Sin persistencia. */
export async function planAndRoute(req: PeopleSearchRequest, signal?: AbortSignal, userId?: string): Promise<PeopleSearchPlan> {
  const draft = await planPeopleSearch(req.query, req.location, req.locale, userId);
  if (signal?.aborted) throw new PeopleSearchAbortedError();
  const routed = await routeSources(draft, signal, userId);
  console.info(`[people/search] sources by ${routed.routedBy}: ${routed.sources.join(", ")}`);
  return { ...draft, sources: routed.sources.filter((id) => req.includeMeta !== false || !META_SOURCES.includes(id)) };
}

/** Las fuentes elegidas en paralelo → país → personas → enriquecer → ronda extra de Google → recorte. Sin persistencia. */
export async function collectPeople(plan: PeopleSearchPlan, req: PeopleSearchRequest, signal?: AbortSignal, userId?: string): Promise<{ people: PersonCandidate[]; failedSources: string[] }> {
  const startedAt = Date.now();
  // Sources stop at the internal deadline; whatever they found by then is still used.
  const sourceSignal = AbortSignal.any([AbortSignal.timeout(PEOPLE_SEARCH_DEADLINE_MS), ...(signal ? [signal] : [])]);
  const location = req.location || plan.location;
  const ctx = { location, signal: sourceSignal, limit: Math.min(50, req.count * 2) };
  const settled = await Promise.allSettled(plan.sources.map((id) => runners[id](plan, ctx)));
  const failedSources = plan.sources.filter((_, index) => settled[index].status === "rejected");
  // Las búsquedas por plataforma son mundiales: fuera quien es claramente de otro país.
  const country = candidateCountry({ phone: "", whatsapp: "", location });
  const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []).filter((person) => fitsCountry(person, country));

  // Companies, articles and directories are dropped before enrichment (no page reads, never charged).
  const { people: classified } = await keepPeople(candidates, { role: plan.role, signal: sourceSignal, userId });
  let people = await enrichCandidates(classified, { signal: sourceSignal });

  // One extra Serper round (≤3 queries) when filtering left fewer than requested and there is time left.
  const extra = extraQueries(plan, plan.webQueries).slice(0, 3);
  if (people.length < req.count && extra.length && !sourceSignal.aborted && Date.now() - startedAt < PEOPLE_SEARCH_DEADLINE_MS - EXTRA_ROUND_MIN_LEFT_MS) {
    const more = await searchSerper(extra, { location, signal: sourceSignal }).catch(() => []);
    const { people: moreClassified } = await keepPeople(more, { role: plan.role, signal: sourceSignal, userId });
    // Only the new candidates are read; filterPeople re-dedupes the merged list.
    people = filterPeople([...people, ...await enrichCandidates(moreClassified, { signal: sourceSignal })]);
  }
  return { people: people.slice(0, req.count), failedSources };
}

/**
 * planAndRoute → batch → collectPeople → persist.
 * `signal` is the client's: if it aborts, nothing is delivered (the caller refunds everything).
 */
export async function runPeopleSearch(userId: string, req: PeopleSearchRequest, signal?: AbortSignal): Promise<PeopleSearchResult> {
  const plan = await planAndRoute(req, signal, userId);
  if (signal?.aborted) throw new PeopleSearchAbortedError();
  const batch = await createPeopleBatch(userId, req, plan);
  try {
    const { people, failedSources } = await collectPeople(plan, req, signal, userId);
    if (signal?.aborted) throw new PeopleSearchAbortedError();
    const leads = await savePeople(batch.id, people);
    await finishPeopleBatch(batch.id, leads.length >= req.count ? "completed" : leads.length > 0 ? "partial" : "failed", leads.length);
    return { batchId: batch.id, plan, leads, failedSources };
  } catch (error) {
    await finishPeopleBatch(batch.id, "failed", 0).catch(() => undefined);
    throw error;
  }
}
