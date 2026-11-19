// Owner-only user outreach marker. Clients cannot set this administrative field.
const field = "owner_contacted";
const guard = " && @request.body." + field + ":isset = false";

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName(field)) users.fields.add(new BoolField({ name: field }));
  app.save(users);
  const withGuard = (rule) => (rule ? "(" + rule + ")" + guard : "true" + guard);
  if (users.createRule !== null && !users.createRule.includes(field)) users.createRule = withGuard(users.createRule);
  if (users.updateRule !== null && !users.updateRule.includes(field)) users.updateRule = withGuard(users.updateRule);
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const withoutGuard = (rule) => {
    if (rule === "true" + guard) return "";
    return rule && rule.startsWith("(") && rule.endsWith(")" + guard) ? rule.slice(1, -(guard.length + 1)) : rule;
  };
  users.createRule = withoutGuard(users.createRule);
  users.updateRule = withoutGuard(users.updateRule);
  if (users.fields.getByName(field)) users.fields.removeByName(field);
  app.save(users);
});
