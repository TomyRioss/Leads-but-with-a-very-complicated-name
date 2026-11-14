// AI spend tracking: one server-only `ai_usage` row per OpenRouter call (feature, model, user, tokens, cost).
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "ai_usage")) return;
  const users = app.findCollectionByNameOrId("users");
  // Save the columns first, then the indexes that reference them.
  app.save(new Collection({
    type: "base",
    name: "ai_usage",
    fields: [
      { name: "feature", type: "text", required: true, max: 40 },
      { name: "model", type: "text", max: 120 },
      { name: "user", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "prompt_tokens", type: "number", onlyInt: true, min: 0 },
      { name: "completion_tokens", type: "number", onlyInt: true, min: 0 },
      { name: "cost_usd", type: "number", min: 0 },
      { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
    ],
    // Written and read only by the server (superuser).
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const saved = app.findCollectionByNameOrId("ai_usage");
  saved.indexes = [
    "CREATE INDEX idx_ai_usage_created_at ON ai_usage (created_at)",
    "CREATE INDEX idx_ai_usage_feature_created_at ON ai_usage (feature, created_at)",
  ];
  app.save(saved);
}, (app) => {
  const usage = app.findAllCollections().find((collection) => collection.name === "ai_usage");
  if (usage) app.delete(usage);
});
