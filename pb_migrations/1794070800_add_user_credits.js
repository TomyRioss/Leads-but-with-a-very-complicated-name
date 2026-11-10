migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");
  users.fields.add(new NumberField({ name: "credits", min: 0, onlyInt: true }));
  users.createRule = "@request.body.credits = 240";
  users.updateRule = null;
  app.save(users);

  let existingUsers;
  do {
    existingUsers = app.findRecordsByFilter("users", "credits = 0", "id", 500, 0);
    for (const user of existingUsers) {
      user.set("credits", 240);
      app.save(user);
    }
  } while (existingUsers.length === 500);

  const locks = new Collection({
    type: "base",
    name: "credit_locks",
    fields: [new RelationField({ name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 })],
    indexes: ["CREATE UNIQUE INDEX idx_credit_locks_user ON credit_locks (user)"],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(locks);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("credit_locks"));
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("credits");
  users.createRule = "";
  users.updateRule = "id = @request.auth.id";
  app.save(users);
});
