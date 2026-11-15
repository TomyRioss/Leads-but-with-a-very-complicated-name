// Private account facts: separate rows prevent concurrent changes to different keys from overwriting each other.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "leadtita_account_memory")) return;
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "leadtita_account_memory",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "key", type: "text", required: true, max: 32, pattern: "^(serviceOffering|commercialSectors|preferredTone|businessContext)$" },
      // Four allowlisted keys, each capped at 5 KB: at most 20 KB of fact JSON per account.
      { name: "fact", type: "json", required: true, maxSize: 5000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const memory = app.findCollectionByNameOrId("leadtita_account_memory");
  memory.indexes = ["CREATE UNIQUE INDEX idx_leadtita_account_memory_user_key ON leadtita_account_memory (user, key)"];
  app.save(memory);
}, (app) => {
  const memory = app.findAllCollections().find((collection) => collection.name === "leadtita_account_memory");
  if (memory) app.delete(memory);
});
