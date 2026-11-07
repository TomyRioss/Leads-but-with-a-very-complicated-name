migrate((app) => {
  let users;
  try {
    users = app.findCollectionByNameOrId("users");
  } catch {
    users = new Collection({ type: "auth", name: "users" });
  }
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");
  if (!users.fields.getByName("name")) {
    users.fields.add(new TextField({ name: "name", max: 120 }));
  }
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = "";
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = "id = @request.auth.id";
  users.passwordAuth = { enabled: true, identityFields: ["email"] };
  app.save(users);

  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.fields.getByName("requested_count").min = 1;
  batches.fields.add(new RelationField({
    name: "user",
    required: false,
    collectionId: users.id,
    cascadeDelete: true,
    maxSelect: 1,
  }));
  batches.listRule = "user = @request.auth.id";
  batches.viewRule = "user = @request.auth.id";
  batches.createRule = "user = @request.auth.id";
  batches.updateRule = "user = @request.auth.id";
  batches.deleteRule = "user = @request.auth.id";
  app.save(batches);

  const leads = app.findCollectionByNameOrId("leads");
  leads.listRule = "batch.user = @request.auth.id";
  leads.viewRule = "batch.user = @request.auth.id";
  leads.createRule = "batch.user = @request.auth.id";
  leads.updateRule = "batch.user = @request.auth.id";
  leads.deleteRule = "batch.user = @request.auth.id";
  app.save(leads);
}, (app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.fields.removeByName("user");
  batches.fields.getByName("requested_count").min = 5;
  batches.listRule = null;
  batches.viewRule = null;
  batches.createRule = null;
  batches.updateRule = null;
  batches.deleteRule = null;
  app.save(batches);

  const leads = app.findCollectionByNameOrId("leads");
  leads.listRule = null;
  leads.viewRule = null;
  leads.createRule = null;
  leads.updateRule = null;
  leads.deleteRule = null;
  app.save(leads);
});
