// Private, bounded account context. Only the server's superuser can access it.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "leadtita_account_memory")) return;
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "leadtita_account_memory",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "facts", type: "json", maxSize: 20000 },
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
  memory.indexes = ["CREATE UNIQUE INDEX idx_leadtita_account_memory_user ON leadtita_account_memory (user)"];
  app.save(memory);
}, (app) => {
  const memory = app.findAllCollections().find((collection) => collection.name === "leadtita_account_memory");
  if (memory) app.delete(memory);
});
