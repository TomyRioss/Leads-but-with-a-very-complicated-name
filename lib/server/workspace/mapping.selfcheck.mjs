import assert from "node:assert/strict";
import {
  businessRecord,
  canEditStep,
  furthestStep,
  nextStep,
  onboardingBusinessRecord,
  parseOnboardingStep,
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


// 7. Onboarding: campos nuevos del negocio, saneados y acotados.
assert.equal(business.onboardingStep, "company"); // sin summary ni paso guardado
assert.equal(toBusiness({ id: "x", summary: "De /explorar" }).onboardingStep, "company");
assert.equal(toBusiness({ id: "x", summary: "s", onboarding_step: "plan" }).onboardingStep, "plan");
assert.equal(toBusiness({ id: "x", onboarding_step: "nope" }).onboardingStep, "company");
assert.equal(toBusiness({ id: "x", onboarding_step: "done" }).onboardingStep, "done");
const onboarded = toBusiness({
  id: "x",
  markets: [{ country: " AR ", region: "CABA" }, { country: "" }, "x", ...Array.from({ length: 12 }, () => ({ country: "UY" }))],
  business_types: ["Bares", 3, " ", ...Array.from({ length: 20 }, () => "a".repeat(80))],
  channels: ["gmail", "fax", "gmail", "whatsapp"],
  offer_confirmed_at: "2026-11-25 10:00:00.000Z",
  markets_confirmed_at: "",
});
assert.equal(onboarded.markets.length, 10);
assert.deepEqual(onboarded.markets[0], { country: "AR", region: "CABA" });
assert.deepEqual(onboarded.markets[1], { country: "UY", region: "" });
assert.equal(onboarded.businessTypes.length, 11); // 12 leídos, " " descartado
assert.equal(onboarded.businessTypes[1].length, 60);
assert.deepEqual(onboarded.channels, ["gmail", "whatsapp"]);
assert.equal(onboarded.offerConfirmed, true);
assert.equal(onboarded.marketsConfirmed, false);
assert.deepEqual(toBusiness({ id: "x" }).markets, []);

// 8. Orden de pasos.
assert.equal(nextStep("company"), "customers");
assert.equal(nextStep("channels"), "capacity");
assert.equal(nextStep("capacity"), "done");
assert.equal(canEditStep("confirm", "company"), true);
assert.equal(canEditStep("confirm", "confirm"), true);
assert.equal(canEditStep("confirm", "plan"), false);
assert.equal(canEditStep("done", "capacity"), true);
assert.equal(canEditStep("done", "done"), false);
assert.equal(canEditStep("company", "nope"), false);
assert.equal(furthestStep("plan", "customers"), "plan");
assert.equal(furthestStep("customers", "confirm"), "confirm");
assert.equal(furthestStep("done", "capacity"), "done");

// 9. PATCH por paso: válidos → campos PocketBase; fuera de rango → null.
const NOW = new Date("2026-11-25T10:00:00.000Z");
assert.equal(parseOnboardingStep("nope", {}), null);
assert.equal(parseOnboardingStep("done", {}), null);
assert.equal(parseOnboardingStep("company", []), null);
assert.deepEqual(parseOnboardingStep("company", { name: " Acme ", summary: " s ", competitors: [{ name: "C", domain: "c.com" }, { name: "c2", domain: "C.com" }, { name: "D" }] }), {
  name: "Acme",
  summary: "s",
  competitors: [{ name: "C", domain: "c.com" }, { name: "D", domain: "" }],
});
assert.deepEqual(parseOnboardingStep("company", { name: "Acme" }), { name: "Acme", summary: "", competitors: [] });
assert.equal(parseOnboardingStep("company", { name: "" }), null);
assert.equal(parseOnboardingStep("company", { name: "a".repeat(201) }), null);
assert.equal(parseOnboardingStep("company", { name: "A", summary: "a".repeat(2001) }), null);
assert.equal(parseOnboardingStep("company", { name: "A", competitors: Array.from({ length: 21 }, (_, i) => ({ name: `c${i}` })) }), null);
assert.equal(parseOnboardingStep("company", { name: "A", competitors: [{ domain: "x.com" }] }), null);

assert.deepEqual(parseOnboardingStep("customers", { markets: [{ country: "Argentina", region: "Córdoba" }, { country: "argentina", region: "córdoba" }, { country: "Uruguay" }], businessTypes: ["Bares", "bares", " Cafés "] }), {
  markets: [{ country: "Argentina", region: "Córdoba" }, { country: "Uruguay", region: "" }],
  business_types: ["Bares", "Cafés"],
});
assert.deepEqual(parseOnboardingStep("customers", { markets: [{ country: "AR" }] }), { markets: [{ country: "AR", region: "" }], business_types: [] });
assert.equal(parseOnboardingStep("customers", { markets: [] }), null);
assert.equal(parseOnboardingStep("customers", {}), null);
assert.equal(parseOnboardingStep("customers", { markets: Array.from({ length: 11 }, () => ({ country: "AR" })) }), null);
assert.equal(parseOnboardingStep("customers", { markets: [{ country: "a".repeat(101) }] }), null);
assert.equal(parseOnboardingStep("customers", { markets: [{ country: "AR", region: "a".repeat(101) }] }), null);
assert.equal(parseOnboardingStep("customers", { markets: [{ country: "AR" }], businessTypes: Array.from({ length: 13 }, () => "x") }), null);
assert.equal(parseOnboardingStep("customers", { markets: [{ country: "AR" }], businessTypes: ["a".repeat(61)] }), null);

assert.deepEqual(parseOnboardingStep("confirm", { offerConfirmed: true, marketsConfirmed: true }, NOW), {
  offer_confirmed_at: "2026-11-25 10:00:00.000Z",
  markets_confirmed_at: "2026-11-25 10:00:00.000Z",
});
assert.equal(parseOnboardingStep("confirm", { offerConfirmed: true }), null);
assert.equal(parseOnboardingStep("confirm", { offerConfirmed: "true", marketsConfirmed: true }), null);

assert.deepEqual(parseOnboardingStep("plan", {}), {});
assert.deepEqual(parseOnboardingStep("plan", undefined), {});
assert.deepEqual(parseOnboardingStep("capacity", {}), {});
assert.deepEqual(parseOnboardingStep("channels", { channels: ["gmail", "gmail"] }), { channels: ["gmail"] });
assert.deepEqual(parseOnboardingStep("channels", { channels: ["whatsapp", "gmail"] }), { channels: ["whatsapp", "gmail"] });
assert.equal(parseOnboardingStep("channels", { channels: [] }), null);
assert.equal(parseOnboardingStep("channels", { channels: ["sms"] }), null);
assert.equal(parseOnboardingStep("channels", { channels: ["gmail", "gmail", "gmail"] }), null);

const created = onboardingBusinessRecord("u", product, { headline: "h", valueProps: ["v"], buyerSearches: ["b"], competitors: [{ name: "C", domain: "c.com" }] });
assert.equal(created.user, "u");
assert.equal(created.landing_run, "");
assert.equal(created.onboarding_step, "company");
assert.deepEqual(created.competitors, [{ name: "C", domain: "c.com" }]);

console.log("workspace mapping selfcheck ok");
