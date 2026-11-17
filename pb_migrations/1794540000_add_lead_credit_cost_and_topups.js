// leads.credit_cost: credits charged for that lead (0 = free top-up, manual, import or created before this field).
// Refunds of leads discarded by a Leadtita filter sum this, so free leads are never refunded.
// lead_batches.topup_rounds: top-ups already run on the batch (free ones capped at 2; also the replay guard of top-up cards).
migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  if (!leads.fields.getByName("credit_cost")) leads.fields.add(new NumberField({ name: "credit_cost", min: 0, max: 1000 }));
  app.save(leads);
  const batches = app.findCollectionByNameOrId("lead_batches");
  if (!batches.fields.getByName("topup_rounds")) batches.fields.add(new NumberField({ name: "topup_rounds", min: 0, max: 1000, onlyInt: true }));
  app.save(batches);
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  if (leads.fields.getByName("credit_cost")) leads.fields.removeByName("credit_cost");
  app.save(leads);
  const batches = app.findCollectionByNameOrId("lead_batches");
  if (batches.fields.getByName("topup_rounds")) batches.fields.removeByName("topup_rounds");
  app.save(batches);
});
