migrate((app) => {
  const collection = app.findCollectionByNameOrId("leadtita_message_models");
  const names = collection.fields.map((field) => field.name);
  if (!names.includes("name")) collection.fields.add(new Field({ name: "name", type: "text", max: 80 }));
  if (!names.includes("is_default")) collection.fields.add(new Field({ name: "is_default", type: "bool" }));
  collection.indexes = collection.indexes.filter((index) => !index.includes("idx_leadtita_message_models_user_default"));
  collection.indexes.push("CREATE UNIQUE INDEX idx_leadtita_message_models_user_default ON leadtita_message_models (user) WHERE is_default = 1");
  app.save(collection);
}, (app) => {
  const collection = app.findAllCollections().find((item) => item.name === "leadtita_message_models");
  if (!collection) return;
  collection.indexes = collection.indexes.filter((index) => !index.includes("idx_leadtita_message_models_user_default"));
  for (const name of ["name", "is_default"]) {
    const field = collection.fields.getByName(name);
    if (field) collection.fields.removeById(field.id);
  }
  app.save(collection);
});
