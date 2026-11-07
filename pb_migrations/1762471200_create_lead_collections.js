migrate((app) => {
  const batches = new Collection({
    type: "base",
    name: "lead_batches",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "keywords", type: "json", required: true, maxSize: 10000 },
      { name: "country", type: "text", required: true, max: 100 },
      { name: "province", type: "text", max: 100 },
      { name: "district", type: "text", max: 100 },
      { name: "requested_count", type: "number", required: true, min: 5, max: 30 },
      { name: "result_count", type: "number", min: 0, max: 30 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["running", "completed", "partial", "failed"] },
    ]
  });
  app.save(batches);

  const leads = new Collection({
    type: "base",
    name: "leads",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "batch", type: "relation", required: true, collectionId: batches.id, cascadeDelete: true, maxSelect: 1 },
      { name: "name", type: "text", max: 255 },
      { name: "maps_url", type: "url" },
      { name: "address", type: "text", max: 1000 },
      { name: "review_count", type: "text", max: 30 },
      { name: "average_rating", type: "text", max: 30 },
      { name: "phone", type: "text", max: 100 },
      { name: "email", type: "text", max: 500 },
      { name: "website", type: "url" },
      { name: "category", type: "text", max: 500 },
      { name: "pain_points", type: "text", max: 5000 },
      { name: "enrichment", type: "text", max: 5000 },
    ],
    indexes: ["CREATE INDEX idx_leads_batch ON leads (batch)"]
  });
  app.save(leads);
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  app.delete(leads);
  const batches = app.findCollectionByNameOrId("lead_batches");
  app.delete(batches);
});
