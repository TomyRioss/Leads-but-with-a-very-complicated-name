// Signup grants 50 free credits; the create rule must require exactly that amount.
// Only the credits clause changes: guards appended by later migrations (referrals, free usage) are kept.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.createRule) users.createRule = users.createRule.replace("@request.body.credits = 240", "@request.body.credits = 50");
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.createRule) users.createRule = users.createRule.replace("@request.body.credits = 50", "@request.body.credits = 240");
  app.save(users);
});
