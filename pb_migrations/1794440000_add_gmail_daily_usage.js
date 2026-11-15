// Daily Gmail message quota for Leadtita. Server-only counter, one row per user and Buenos Aires day.
migrate((app) => {
  const existing = app.findAllCollections().some((collection) => collection.name === "gmail_daily_usage");
  if (existing) return;

  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "gmail_daily_usage",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "day", type: "text", required: true, min: 10, max: 10 },
      { name: "used", type: "number", required: true, min: 0, onlyInt: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));

  const saved = app.findCollectionByNameOrId("gmail_daily_usage");
  saved.indexes = [
    "CREATE UNIQUE INDEX idx_gmail_daily_usage_user_day ON gmail_daily_usage (user, day)",
  ];
  app.save(saved);
}, (app) => {
  const collection = app.findAllCollections().find((item) => item.name === "gmail_daily_usage");
  if (collection) app.delete(collection);
});
