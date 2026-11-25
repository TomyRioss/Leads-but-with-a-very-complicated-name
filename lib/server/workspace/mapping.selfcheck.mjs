import assert from "node:assert/strict";
import {
  businessRecord,
  campaignRecord,
  isRecordId,
  parseProposalPatch,
  parseSearchCount,
  pbToIso,
  proposalRecord,
  quote,
  searchKeywords,
  toBusiness,
  toProposal,
  toSalesCampaign,
} from "./mapping.ts";

const B1 = "aaaaaaaaaaaaaa1";
const B2 = "aaaaaaaaaaaaaa2";

// 1. Ids y escape de filtros.
assert.equal(isRecordId("abcDEF123456789"), true);
assert.equal(isRecordId("abc"), false);
assert.equal(isRecordId('abcdefghijklmn"'), false);
assert.equal(isRecordId(123), false);
assert.equal(quote('a" || user != "x'), '"a\\" || user != \\"x"');

// 2. Fechas PocketBase → ISO.
assert.equal(pbToIso("2026-11-25 10:00:00.000Z"), "2026-11-25T10:00:00.000Z");
assert.equal(pbToIso(""), "");
assert.equal(pbToIso("nope"), "");

// 3. Registros → contrato, con datos sucios.
const business = toBusiness({ id: "x", name: "Acme", value_props: ["a", 1, "b"], competitors: [{ name: "C", domain: "c.com" }, null], created: "2026-11-25 10:00:00.000Z" });
assert.deepEqual(business.valueProps, ["a", "b"]);
assert.deepEqual(business.buyerSearches, []);
assert.deepEqual(business.competitors, [{ name: "C", domain: "c.com" }]);
assert.equal(business.domain, "");

const campaign = toSalesCampaign({ id: "c", business: "b", name: "Bares", icon: "rocket", fit: 140, batches: [B1, B2, "bad"] }, new Map([[B1, 10], [B2, 5]]));
assert.equal(campaign.icon, "sparkles");
assert.equal(campaign.fit, 100);
assert.deepEqual(campaign.batchIds, [B1, B2]);
assert.equal(campaign.leadCount, 15);

const proposal = toProposal({ id: "p", business: "b", campaign: "c", channel: "x", status: "weird" });
assert.equal(proposal.channel, "whatsapp");
assert.equal(proposal.status, "draft");
assert.equal(proposal.leadId, "");
assert.equal(proposal.sentAt, "");

// 4. PATCH: límites por canal, solo cambios válidos.
assert.deepEqual(parseProposalPatch({ body: "  hola  " }, "whatsapp"), { body: "hola" });
assert.equal(parseProposalPatch({ subject: "x" }, "whatsapp"), null);
assert.deepEqual(parseProposalPatch({ subject: "" }, "whatsapp"), { subject: "" });
assert.equal(parseProposalPatch({ body: "a".repeat(1501) }, "whatsapp"), null);
assert.deepEqual(parseProposalPatch({ body: "a".repeat(5000) }, "gmail"), { body: "a".repeat(5000) });
assert.equal(parseProposalPatch({ body: "a".repeat(5001) }, "gmail"), null);
assert.equal(parseProposalPatch({ subject: "a".repeat(121) }, "gmail"), null);
assert.equal(parseProposalPatch({ subject: "a\nb" }, "gmail"), null);
assert.equal(parseProposalPatch({ subject: "" }, "gmail"), null);
assert.equal(parseProposalPatch({ body: "" }, "gmail"), null);
assert.equal(parseProposalPatch({}, "gmail"), null);
assert.equal(parseProposalPatch(null, "gmail"), null);
assert.equal(parseProposalPatch([], "gmail"), null);

// 5. Búsqueda de campaña.
assert.equal(parseSearchCount(undefined), 25);
assert.equal(parseSearchCount(50), 50);
assert.equal(parseSearchCount(7), null);
assert.equal(parseSearchCount("50"), null);
assert.deepEqual(searchKeywords({ keywords: [" bar ", "bar", "", "cafe"], name: "Bares" }), ["bar", "cafe"]);
assert.deepEqual(searchKeywords({ keywords: [], name: "Bares" }), ["Bares"]);

// 6. /explorar → registros del claim.
const product = { name: "Acme", domain: "acme.com", summary: "s", location: "Argentina", country: "Argentina" };
const record = businessRecord("u", "r", product, null);
assert.equal(record.landing_run, "r");
assert.deepEqual(record.value_props, []);
assert.equal(record.headline, "");

const exploreCampaign = { id: "bares", name: "Bares", icon: "utensils", fit: 82.4, pitch: "p", pain: "x", criteria: ["a"], examples: ["b"], keywords: ["bar"] };
assert.deepEqual(campaignRecord("u", "b", exploreCampaign, [B1, "bad"]).batches, [B1]);
assert.equal(campaignRecord("u", "b", exploreCampaign, []).fit, 82);

const ids = { userId: "u", businessId: "b", campaignId: "c" };
const wa = proposalRecord(ids, { leadId: "l1", channel: "whatsapp", to: "5491100000000", subject: "ignored", body: "a".repeat(2000) }, new Map([["l1", B1]]), new Map([["l1", "Bar Uno"]]));
assert.equal(wa.lead, B1);
assert.equal(wa.lead_name, "Bar Uno");
assert.equal(wa.subject, "");
assert.equal(wa.body.length, 1500);
assert.equal(wa.status, "draft");
const mail = proposalRecord(ids, { leadId: "missing", channel: "gmail", to: "a@b.com", subject: "Hola", body: "x" }, new Map(), new Map());
assert.equal(mail.lead, "");
assert.equal(mail.subject, "Hola");

console.log("workspace mapping selfcheck ok");
