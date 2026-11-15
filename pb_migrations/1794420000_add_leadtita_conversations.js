// Leadtita chat history: one server-only `leadtita_conversations` row per (user, local conversation id).
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "leadtita_conversations")) return;
  const users = app.findCollectionByNameOrId("users");
  // Save the columns first, then the indexes that reference them.
  app.save(new Collection({
    type: "base",
    name: "leadtita_conversations",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "client_id", type: "text", required: true, max: 64 },
      { name: "title", type: "text", max: 200 },
      { name: "messages", type: "json", maxSize: 2000000 },
      { name: "extra", type: "json", maxSize: 500000 },
      { name: "message_count", type: "number", onlyInt: true, min: 0 },
      { name: "last_message_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    // Read and written only by the server (superuser), always scoped to the session user.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const saved = app.findCollectionByNameOrId("leadtita_conversations");
  saved.indexes = [
    "CREATE UNIQUE INDEX idx_leadtita_conversations_user_client_id ON leadtita_conversations (user, client_id)",
    "CREATE INDEX idx_leadtita_conversations_user_last_message_at ON leadtita_conversations (user, last_message_at)",
  ];
  app.save(saved);
}, (app) => {
  const conversations = app.findAllCollections().find((collection) => collection.name === "leadtita_conversations");
  if (conversations) app.delete(conversations);
});
