// 1794480000 built its fields with field constructors, which this PocketBase ignores: the live collection only had `id`.
// Adds every missing field (plain-object specs, like the other migrations) and the window index. Idempotent.
const CAMPAIGN_FIELDS = [
  { name: "name", type: "text", required: true, max: 120 },
  { name: "label", type: "text", max: 40 },
  { name: "message", type: "text", required: true, max: 200 },
  { name: "discount_percent", type: "number", required: true, min: 1, max: 100, onlyInt: true },
  { name: "all_features", type: "bool" },
  { name: "features", type: "json", maxSize: 2000 },
  { name: "starts_at", type: "date", required: true },
  { name: "ends_at", type: "date", required: true },
  { name: "active", type: "bool" },
  { name: "created", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

migrate((app) => {
  const campaigns = app.findCollectionByNameOrId("campaigns");
  let changed = false;
  for (const spec of CAMPAIGN_FIELDS) {
    if (campaigns.fields.getByName(spec.name)) continue;
    campaigns.fields.add(new Field(spec));
    changed = true;
  }
  if (changed) app.save(campaigns);
  const saved = app.findCollectionByNameOrId("campaigns");
  if (!saved.indexes.some((index) => index.includes("idx_campaigns_window"))) {
    saved.indexes = [...saved.indexes, "CREATE INDEX idx_campaigns_window ON campaigns (active, starts_at, ends_at)"];
    app.save(saved);
  }
}, () => {
  // Down is a no-op: the fields belong to 1794480000's collection.
});
