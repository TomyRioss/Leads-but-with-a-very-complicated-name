// "Mis negocios / Mis campañas / Mis propuestas": lo que una corrida de /explorar deja en la cuenta.
// Solo el servidor (superuser) lee y escribe: todas las reglas en null. Cada lectura filtra por user en lib/server/workspace.
const NAMES = ["businesses", "sales_campaigns", "proposals"];
const serverOnly = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
const timestamps = [
  { name: "created", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

migrate((app) => {
  const existing = new Set(app.findAllCollections().map((collection) => collection.name));
  if (NAMES.every((name) => existing.has(name))) return;
  const users = app.findCollectionByNameOrId("users");
  const runs = app.findCollectionByNameOrId("landing_runs");
  const leads = app.findCollectionByNameOrId("leads");
  const batches = app.findCollectionByNameOrId("lead_batches");

  if (!existing.has("businesses")) {
    app.save(new Collection({
      type: "base",
      name: "businesses",
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { name: "landing_run", type: "relation", required: false, collectionId: runs.id, cascadeDelete: false, maxSelect: 1 },
        { name: "name", type: "text", required: true, max: 200 },
        { name: "domain", type: "text", max: 255 },
        { name: "summary", type: "text", max: 2000 },
        { name: "location", type: "text", max: 200 },
        { name: "country", type: "text", max: 100 },
        { name: "headline", type: "text", max: 300 },
        { name: "value_props", type: "json", maxSize: 5000 },
        { name: "buyer_searches", type: "json", maxSize: 5000 },
        { name: "competitors", type: "json", maxSize: 20000 },
        ...timestamps,
      ],
      indexes: [
        "CREATE INDEX idx_businesses_user_created ON businesses (user, created)",
        // Un negocio por corrida reclamada: un segundo claim concurrente choca acá en vez de duplicar.
        "CREATE UNIQUE INDEX idx_businesses_landing_run ON businesses (landing_run) WHERE landing_run != ''",
      ],
      ...serverOnly,
    }));
  }
  const businesses = app.findCollectionByNameOrId("businesses");

  if (!existing.has("sales_campaigns")) {
    app.save(new Collection({
      type: "base",
      name: "sales_campaigns",
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { name: "business", type: "relation", required: true, collectionId: businesses.id, cascadeDelete: true, maxSelect: 1 },
        { name: "name", type: "text", required: true, max: 200 },
        { name: "icon", type: "text", max: 40 },
        { name: "fit", type: "number", min: 0, max: 100 },
        { name: "pitch", type: "text", max: 1000 },
        { name: "pain", type: "text", max: 1000 },
        { name: "criteria", type: "json", maxSize: 5000 },
        { name: "examples", type: "json", maxSize: 5000 },
        { name: "keywords", type: "json", maxSize: 5000 },
        { name: "batches", type: "relation", required: false, collectionId: batches.id, cascadeDelete: false, maxSelect: 999 },
        ...timestamps,
      ],
      indexes: [
        "CREATE INDEX idx_sales_campaigns_user_created ON sales_campaigns (user, created)",
        "CREATE INDEX idx_sales_campaigns_business ON sales_campaigns (business)",
      ],
      ...serverOnly,
    }));
  }
  const campaigns = app.findCollectionByNameOrId("sales_campaigns");

  if (!existing.has("proposals")) {
    app.save(new Collection({
      type: "base",
      name: "proposals",
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { name: "business", type: "relation", required: true, collectionId: businesses.id, cascadeDelete: true, maxSelect: 1 },
        { name: "campaign", type: "relation", required: true, collectionId: campaigns.id, cascadeDelete: true, maxSelect: 1 },
        { name: "lead", type: "relation", required: false, collectionId: leads.id, cascadeDelete: false, maxSelect: 1 },
        { name: "lead_name", type: "text", max: 255 },
        { name: "channel", type: "select", required: true, maxSelect: 1, values: ["whatsapp", "gmail"] },
        { name: "to", type: "text", max: 500 },
        { name: "subject", type: "text", max: 200 },
        { name: "body", type: "text", max: 5000 },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "sent", "failed"] },
        { name: "error", type: "text", max: 60 },
        { name: "sent_at", type: "date" },
        ...timestamps,
      ],
      indexes: [
        "CREATE INDEX idx_proposals_user_created ON proposals (user, created)",
        "CREATE INDEX idx_proposals_campaign ON proposals (campaign)",
        "CREATE INDEX idx_proposals_business ON proposals (business)",
      ],
      ...serverOnly,
    }));
  }
}, (app) => {
  // Orden inverso por las relaciones.
  for (const name of [...NAMES].reverse()) {
    const collection = app.findAllCollections().find((item) => item.name === name);
    if (collection) app.delete(collection);
  }
});
