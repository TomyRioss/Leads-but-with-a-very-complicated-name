import { NextResponse, type NextRequest } from "next/server";
import { EXPLORE_STEPS, EXPLORE_TOKEN_COOKIE, type ExploreProposal, type ExploreRun, type ExploreStep } from "@/lib/explore/types";
import type { ExploreLive, ExploreLocale } from "@/lib/server/explore/ai";
import { once, stepRateLimited } from "@/lib/server/explore/guard";
import { getRun, updateRun } from "@/lib/server/explore/store";
import { runResearch } from "@/lib/server/explore/research";
import { runCompetitors } from "@/lib/server/explore/competitors";
import { runCampaigns } from "@/lib/server/explore/campaigns";
import { runLeads } from "@/lib/server/explore/leads";
import { runProposals } from "@/lib/server/explore/proposals";

export const maxDuration = 300;

class PrerequisiteError extends Error {}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

type Live = ExploreLive & { item: (proposal: ExploreProposal) => void };

/** Runs one step from the run's previous outputs, saves it and returns it. Idempotent: a filled step is returned as is. */
async function runStep(token: string, step: ExploreStep, campaignId: string, locale: ExploreLocale, live: Live): Promise<unknown> {
  const run: ExploreRun | null = await getRun(token);
  if (!run) throw new PrerequisiteError("not_found");
  const need = <T,>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw new PrerequisiteError("prerequisite");
    return value;
  };
  switch (step) {
    case "research": {
      if (run.product) return run.product;
      const product = await runResearch(run.input, locale, live);
      await updateRun(token, { product });
      return product;
    }
    case "competitors": {
      if (run.competitors) return run.competitors;
      const competitors = await runCompetitors(need(run.product), locale, live);
      await updateRun(token, { competitors });
      return competitors;
    }
    case "campaigns": {
      if (run.campaigns) return run.campaigns;
      const campaigns = await runCampaigns(need(run.product), need(run.competitors), locale, live);
      await updateRun(token, { campaigns });
      return campaigns;
    }
    case "leads": {
      if (run.leads) return run.leads;
      const campaign = need(need(run.campaigns).find((item) => item.id === campaignId));
      const leads = await runLeads(need(run.product), campaign, locale);
      await updateRun(token, { campaignId: campaign.id, leads });
      return leads;
    }
    case "proposals": {
      if (run.proposals) return run.proposals;
      const campaign = need(need(run.campaigns).find((item) => item.id === run.campaignId));
      const proposals = await runProposals(need(run.product), campaign, need(run.leads), locale, live.item);
      await updateRun(token, { proposals });
      return proposals;
    }
  }
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
        // A duplicate call while the step runs gets only the final result, not the live text.
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
