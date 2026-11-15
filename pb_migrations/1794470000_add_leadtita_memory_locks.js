// Cross-instance serialization for concurrent account-memory updates.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "leadtita_memory_locks")) return;
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "leadtita_memory_locks",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "key", type: "text", required: true, max: 32, pattern: "^(serviceOffering|commercialSectors|preferredTone|businessContext)$" },
      { name: "token", type: "text", required: true, max: 64 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const locks = app.findCollectionByNameOrId("leadtita_memory_locks");
  locks.indexes = ["CREATE UNIQUE INDEX idx_leadtita_memory_locks_user_key ON leadtita_memory_locks (user, key)"];
  app.save(locks);
}, (app) => {
  const locks = app.findAllCollections().find((collection) => collection.name === "leadtita_memory_locks");
  if (locks) app.delete(locks);
});
