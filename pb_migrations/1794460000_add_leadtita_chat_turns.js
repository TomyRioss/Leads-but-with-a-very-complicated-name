// Server-only idempotency records for Leadtita chat turns.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "leadtita_chat_turns")) return;
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "leadtita_chat_turns",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "conversation_id", type: "text", required: true, min: 1, max: 64 },
      { name: "turn_id", type: "text", required: true, min: 1, max: 64 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["running", "completed", "failed"] },
      { name: "result", type: "json", maxSize: 500000 },
      { name: "error_code", type: "text", max: 32 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const turns = app.findCollectionByNameOrId("leadtita_chat_turns");
  turns.indexes = [
    "CREATE UNIQUE INDEX idx_leadtita_chat_turns_owner_key ON leadtita_chat_turns (user, conversation_id, turn_id)",
  ];
  app.save(turns);
}, (app) => {
  const turns = app.findAllCollections().find((collection) => collection.name === "leadtita_chat_turns");
  if (turns) app.delete(turns);
});
