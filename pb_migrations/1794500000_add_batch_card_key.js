// Ties a lead batch to the Leadtita card that launched it, so confirming a card twice returns its own batch
// and a different card from the same turn (e.g. same search without filters) still runs. Idempotent.
migrate((app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  if (!batches.fields.getByName("card_key")) {
    batches.fields.add(new Field({ type: "text", name: "card_key", max: 64 }));
    app.save(batches);
  }
  const saved = app.findCollectionByNameOrId("lead_batches");
  if (!saved.indexes.some((index) => index.includes("idx_lead_batches_card_key"))) {
    saved.indexes = [...saved.indexes, "CREATE INDEX idx_lead_batches_card_key ON lead_batches (user, card_key)"];
    app.save(saved);
  }
}, (app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.indexes = batches.indexes.filter((index) => !index.includes("idx_lead_batches_card_key"));
  const field = batches.fields.getByName("card_key");
  if (field) batches.fields.removeById(field.id);
  app.save(batches);
});
