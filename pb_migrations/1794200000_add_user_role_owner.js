const indexName = "idx_users_single_owner";
const indexSql = `CREATE UNIQUE INDEX ${indexName} ON users (role) WHERE role = 'owner'`;

// Idempotent: scripts/seed-owner.mjs can apply the same schema through the collections API first.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");

  if (!users.fields.getByName("role")) {
    users.fields.add(new SelectField({ name: "role", values: ["user", "owner"], maxSelect: 1, required: false }));
  }
  if (!users.indexes.some((index) => index.includes(indexName))) {
    users.indexes = [...users.indexes, indexSql];
  }
  users.createRule = "@request.body.credits = 240 && @request.body.role:isset = false";
  users.updateRule = null;
  app.save(users);
}, (app) => {
  // Down never blocks on existing data: an existing owner user is kept and just loses the role value with the field.
  const users = app.findCollectionByNameOrId("users");
  users.indexes = users.indexes.filter((index) => !index.includes(indexName));
  users.fields.removeByName("role");
  users.createRule = "@request.body.credits = 240";
  app.save(users);
});
