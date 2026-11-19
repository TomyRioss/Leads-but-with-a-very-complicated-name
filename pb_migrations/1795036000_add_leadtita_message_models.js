migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "leadtita_message_models")) return;
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "leadtita_message_models",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "text", type: "text", required: true, max: 4096 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const models = app.findCollectionByNameOrId("leadtita_message_models");
  models.indexes = ["CREATE UNIQUE INDEX idx_leadtita_message_models_user_text ON leadtita_message_models (user, text)", "CREATE INDEX idx_leadtita_message_models_user_created ON leadtita_message_models (user, created)"];
  app.save(models);
}, (app) => {
  const models = app.findAllCollections().find((collection) => collection.name === "leadtita_message_models");
  if (models) app.delete(models);
});
