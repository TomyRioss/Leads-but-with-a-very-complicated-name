// Control de costo de IA: caché server-only de resultados (`ai_cache`), más detalle por llamada en `ai_usage`
// y el paso en curso de una corrida de /explorar en `landing_runs`. Todas las reglas en null: solo el servidor (superuser).
const serverOnly = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
// Getters: cada migración crea instancias nuevas de los campos.
const USAGE_FIELDS = () => [
  new NumberField({ name: "cached_tokens", onlyInt: true, min: 0 }),
  new NumberField({ name: "reasoning_tokens", onlyInt: true, min: 0 }),
  new NumberField({ name: "web_search_requests", onlyInt: true, min: 0 }),
  new NumberField({ name: "web_fetch_requests", onlyInt: true, min: 0 }),
  new TextField({ name: "step", max: 60 }),
];
const RUN_FIELDS = () => [
  new TextField({ name: "running_step", max: 20 }),
  new DateField({ name: "running_since" }),
];

function addMissingFields(app, collectionName, fields) {
  const collection = app.findCollectionByNameOrId(collectionName);
  const missing = fields.filter((field) => !collection.fields.getByName(field.name));
  if (missing.length === 0) return;
  for (const field of missing) collection.fields.add(field);
  app.save(collection);
}

function removeFields(app, collectionName, fields) {
  const collection = app.findAllCollections().find((item) => item.name === collectionName);
  if (!collection) return;
  const present = fields.filter((field) => collection.fields.getByName(field.name));
  if (present.length === 0) return;
  for (const field of present) collection.fields.removeByName(field.name);
  app.save(collection);
}

migrate((app) => {
  if (!app.findAllCollections().some((collection) => collection.name === "ai_cache")) {
    // Columnas primero, después los índices que las referencian.
    app.save(new Collection({
      type: "base",
      name: "ai_cache",
      fields: [
        { name: "kind", type: "text", required: true, max: 40 },
        { name: "key_hash", type: "text", required: true, max: 64 },
        { name: "payload", type: "json", maxSize: 200000 },
        { name: "expires_at", type: "date", required: true },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      ...serverOnly,
    }));
    const cache = app.findCollectionByNameOrId("ai_cache");
    cache.indexes = [
      "CREATE UNIQUE INDEX idx_ai_cache_kind_key_hash ON ai_cache (kind, key_hash)",
      "CREATE INDEX idx_ai_cache_expires_at ON ai_cache (expires_at)",
    ];
    app.save(cache);
  }
  addMissingFields(app, "ai_usage", USAGE_FIELDS());
  addMissingFields(app, "landing_runs", RUN_FIELDS());
}, (app) => {
  removeFields(app, "landing_runs", RUN_FIELDS());
  removeFields(app, "ai_usage", USAGE_FIELDS());
  const cache = app.findAllCollections().find((collection) => collection.name === "ai_cache");
  if (cache) app.delete(cache);
});
