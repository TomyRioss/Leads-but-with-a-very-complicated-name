// Owner-managed discount campaigns. Server-only: owner API writes, a public route exposes only the live banner.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "campaigns")) return;

  app.save(new Collection({
    type: "base",
    name: "campaigns",
    fields: [
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
    ],
    indexes: [
      "CREATE INDEX idx_campaigns_window ON campaigns (active, starts_at, ends_at)",
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
}, (app) => {
  const campaigns = app.findAllCollections().find((collection) => collection.name === "campaigns");
  if (campaigns) app.delete(campaigns);
});
