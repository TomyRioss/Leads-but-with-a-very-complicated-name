import { setTimeout as sleep } from "node:timers/promises";
import { NextResponse, type NextRequest } from "next/server";
import { EXPLORE_STEPS, EXPLORE_TOKEN_COOKIE, type ExploreProposal, type ExploreRun, type ExploreStep } from "@/lib/explore/types";
import type { ExploreLive, ExploreLocale } from "@/lib/server/explore/ai";
import { once, stepRateLimited } from "@/lib/server/explore/guard";
import { getRunState, releaseLease, takeLease, updateRun } from "@/lib/server/explore/store";
import { hasLiveLease } from "@/lib/server/explore/dedupe";
import { runResearch } from "@/lib/server/explore/research";
import { runCompetitors } from "@/lib/server/explore/competitors";
import { runCampaigns } from "@/lib/server/explore/campaigns";
import { runLeads } from "@/lib/server/explore/leads";
import { runProposals } from "@/lib/server/explore/proposals";

export const maxDuration = 300;

// A second request for a step another request is computing (other tab, reload, other instance) polls the run
// instead of paying again. It gives up before maxDuration so the response still closes cleanly.
const POLL_MS = 2_000;
const WAIT_BUDGET_MS = 280_000;

class PrerequisiteError extends Error {}
class StepFailedError extends Error {}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

type Live = ExploreLive & { item: (proposal: ExploreProposal) => void };
type RunPatch = Parameters<typeof updateRun>[1];

const OUTPUT_FIELD = { research: "product", competitors: "competitors", campaigns: "campaigns", leads: "leads", proposals: "proposals" } as const satisfies Record<ExploreStep, keyof ExploreRun>;
const savedOutput = (run: ExploreRun, step: ExploreStep): unknown => run[OUTPUT_FIELD[step]] ?? null;

/**
 * Runs one step from the run's previous outputs, saves it and returns it. Idempotent: a filled step is returned as is.
 * While it runs the run holds a lease (running_step/running_since); a concurrent request waits for the saved result.
 */
async function runStep(token: string, step: ExploreStep, campaignId: string, locale: ExploreLocale, live: Live): Promise<unknown> {
  const state = await getRunState(token);
  if (!state) throw new PrerequisiteError("not_found");
  const { id, run } = state;
  const saved = savedOutput(run, step);
  if (saved) return saved;
  if (hasLiveLease(state.lease, step, Date.now())) return waitForStep(token, step);

  const need = <T,>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw new PrerequisiteError("prerequisite");
    return value;
  };
  // Prerequisites are checked before taking the lease; `work` is the paid part.
  let work: () => Promise<RunPatch>;
  switch (step) {
    case "research":
      work = async () => ({ product: await runResearch(run.input, locale, live) });
      break;
    case "competitors": {
      const product = need(run.product);
      work = async () => ({ competitors: await runCompetitors(product, locale, live) });
      break;
    }
    case "campaigns": {
      const product = need(run.product);
      const competitors = need(run.competitors);
      work = async () => ({ campaigns: await runCampaigns(product, competitors, locale, live) });
      break;
    }
    case "leads": {
      const product = need(run.product);
      const campaign = need(need(run.campaigns).find((item) => item.id === campaignId));
      work = async () => ({ campaignId: campaign.id, leads: await runLeads(product, campaign, locale) });
      break;
    }
    case "proposals": {
      const product = need(run.product);
      const campaign = need(need(run.campaigns).find((item) => item.id === run.campaignId));
      const leads = need(run.leads);
      work = async () => ({ proposals: await runProposals(product, campaign, leads, locale, live.item) });
      break;
    }
  }

  await takeLease(id, step);
  try {
    const patch = await work();
    await updateRun(token, patch, { recordId: id, clearLease: true });
    return patch[OUTPUT_FIELD[step]];
  } catch (error) {
    await releaseLease(id);
    throw error;
  }
}

/** Polls the run until the lease holder saves the step. Lease released or stale without output → step_failed. */
async function waitForStep(token: string, step: ExploreStep): Promise<unknown> {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  while (Date.now() + POLL_MS < deadline) {
    await sleep(POLL_MS);
    const state = await getRunState(token).catch(() => undefined); // Transient read error: try again next tick.
    if (state === undefined) continue;
    if (!state) throw new PrerequisiteError("not_found");
    const saved = savedOutput(state.run, step);
    if (saved) return saved;
    if (!hasLiveLease(state.lease, step, Date.now())) throw new StepFailedError("lease released or stale without output");
  }
  throw new StepFailedError("wait budget exhausted");
}

/**
 * POST /api/explore/{research|competitors|campaigns|leads|proposals} {campaignId?, locale?}: public, token cookie required.
 * Answers NDJSON so the card builds live: {"t":delta} raw model JSON text, {"reset":true} drop the text so far,
 * {"item":proposal} one finished proposal, then {"data":result} or {"error":code}.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ step: string }> }) {
  const { step } = await ctx.params;
  if (!EXPLORE_STEPS.includes(step as ExploreStep)) return fail("not_found", 404);
  const token = request.cookies.get(EXPLORE_TOKEN_COOKIE)?.value ?? "";
  if (!token || token.length > 200) return fail("not_found", 404);
  if (stepRateLimited(request)) return fail("rate_limited", 429);

  let body: { campaignId?: unknown; locale?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body: defaults apply.
  }
  const locale: ExploreLocale = body?.locale === "en" ? "en" : "es";
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId.slice(0, 60) : "";
  if (step === "leads" && !campaignId) return fail("prerequisite", 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (message: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          open = false; // Visitor left: the step still finishes and is saved.
        }
      };
      const live: Live = { text: (t) => send({ t }), reset: () => send({ reset: true }), item: (item) => send({ item }) };
      try {
        // A duplicate call while the step runs (same instance via once(), other instances via the lease) gets only the final result.
        const data = await once(`${token}:${step}`, () => runStep(token, step as ExploreStep, campaignId, locale, live));
        send({ data });
      } catch (error) {
        if (error instanceof PrerequisiteError) send({ error: error.message === "not_found" ? "not_found" : "prerequisite" });
        else {
          console.error(`Explore step ${step} failed:`, error instanceof Error ? error.message : "unknown");
          send({ error: "step_failed" });
        }
      }
      if (open) controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
