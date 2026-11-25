// Pure channel selection for /explorar proposals (no imports with runtime cost: the selfcheck runs it with plain node).
import type { ExploreLead, ExploreProposal } from "@/lib/explore/types";

export type ChannelPick = { lead: ExploreLead; channel: ExploreProposal["channel"]; to: string };

const waTo = (lead: ExploreLead) => lead.whatsapp.trim() || lead.phone.trim();
const mailTo = (lead: ExploreLead) => (/^\S+@\S+\.\S+$/.test(lead.email.trim()) ? lead.email.trim() : "");

/**
 * Picks up to `count` distinct leads and a channel for each: WhatsApp needs whatsapp/phone, Gmail needs email.
 * The channel most leads can use is the majority; at least `minMinority` picks (or as many leads as have it)
 * go through the other one. Deterministic: lead order decides ties; leads flagged on WhatsApp go first for WhatsApp,
 * and minority picks prefer leads that can't use the majority channel.
 */
export function pickProposalChannels(leads: readonly ExploreLead[], count: number, minMinority: number): ChannelPick[] {
  const seen = new Set<string>();
  const unique = leads.filter((lead) => lead.id && !seen.has(lead.id) && seen.add(lead.id));
  const wa = unique.filter((lead) => waTo(lead));
  const mail = unique.filter((lead) => mailTo(lead));
  const majority: ExploreProposal["channel"] = wa.length >= mail.length ? "whatsapp" : "gmail";
  const minority: ExploreProposal["channel"] = majority === "whatsapp" ? "gmail" : "whatsapp";
  const can = (lead: ExploreLead, channel: ExploreProposal["channel"]) => Boolean(channel === "whatsapp" ? waTo(lead) : mailTo(lead));
  const pick = (lead: ExploreLead, channel: ExploreProposal["channel"]): ChannelPick =>
    ({ lead, channel, to: channel === "whatsapp" ? waTo(lead) : mailTo(lead) });

  const picks: ChannelPick[] = [];
  const used = new Set<string>();
  const take = (pool: ExploreLead[], channel: ExploreProposal["channel"], limit: number) => {
    for (const lead of pool) {
      if (picks.length >= count || limit <= 0) return;
      if (used.has(lead.id)) continue;
      used.add(lead.id);
      picks.push(pick(lead, channel));
      limit--;
    }
  };

  const minorityPool = majority === "whatsapp" ? mail : wa;
  const onlyMinority = minorityPool.filter((lead) => !can(lead, majority));
  const minorityTarget = Math.min(minMinority, minorityPool.length, count);
  take([...onlyMinority, ...minorityPool.filter((lead) => can(lead, majority))], minority, minorityTarget);

  const majorityPool = majority === "whatsapp"
    ? [...wa.filter((lead) => lead.whatsapp.trim()), ...wa.filter((lead) => !lead.whatsapp.trim())]
    : mail;
  take(majorityPool, majority, count);
  take(minorityPool, minority, count); // not enough majority leads: fill with the minority channel
  return picks;
}
