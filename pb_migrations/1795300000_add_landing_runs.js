// Corridas anónimas del flujo público /explorar. Solo el servidor (superuser) lee y escribe: todas las reglas en null.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "landing_runs")) return;
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "landing_runs",
    fields: [
      { name: "token_hash", type: "text", required: true, max: 64 },
      { name: "ip_hash", type: "text", required: true, max: 64 },
      { name: "input", type: "json", required: true, maxSize: 10000 },
      { name: "campaign_id", type: "text", max: 120 },
      { name: "product", type: "json", maxSize: 10000 },
      { name: "competitors", type: "json", maxSize: 20000 },
      { name: "campaigns", type: "json", maxSize: 100000 },
      { name: "leads", type: "json", maxSize: 500000 },
      { name: "proposals", type: "json", maxSize: 200000 },
      { name: "claimed_by", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "claimed_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const runs = app.findCollectionByNameOrId("landing_runs");
  runs.indexes = [
    "CREATE UNIQUE INDEX idx_landing_runs_token_hash ON landing_runs (token_hash)",
    "CREATE INDEX idx_landing_runs_ip_hash_created ON landing_runs (ip_hash, created)",
  ];
  app.save(runs);
}, (app) => {
  const runs = app.findAllCollections().find((collection) => collection.name === "landing_runs");
  if (runs) app.delete(runs);
});
