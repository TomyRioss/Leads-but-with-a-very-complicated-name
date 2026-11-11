// Signup grants 240 free credits; the create rule must require exactly that amount.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "@request.body.credits = 240 && @request.body.role:isset = false";
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "@request.body.credits = 25 && @request.body.role:isset = false";
  app.save(users);
});
