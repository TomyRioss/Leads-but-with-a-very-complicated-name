// Soft-delete Leadtita conversations so users can hide them without losing their records.
migrate((app) => {
  const conversations = app.findCollectionByNameOrId("leadtita_conversations");
  if (!conversations.fields.getByName("is_active")) {
    conversations.fields.add(new BoolField({ name: "is_active", required: true, default: true }));
    app.save(conversations);
  }
  const saved = app.findCollectionByNameOrId("leadtita_conversations");
  if (!saved.indexes.some((index) => index.includes("idx_leadtita_conversations_user_active_last_message"))) {
    saved.indexes.push("CREATE INDEX idx_leadtita_conversations_user_active_last_message ON leadtita_conversations (user, is_active, last_message_at)");
    app.save(saved);
  }
}, (app) => {
  const conversations = app.findAllCollections().find((collection) => collection.name === "leadtita_conversations");
  if (!conversations) return;
  conversations.indexes = conversations.indexes.filter((index) => !index.includes("idx_leadtita_conversations_user_active_last_message"));
  if (conversations.fields.getByName("is_active")) conversations.fields.removeById(conversations.fields.getByName("is_active").id);
  app.save(conversations);
});
