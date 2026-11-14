// Lifetime free-usage counters for accounts without a plan (lib/server/usage-limits.ts). Server-written only.
const fields = ["free_pain_analyses_used", "free_enrichments_used"];
const guard = fields.map((name) => " && @request.body." + name + ":isset = false").join("");

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const name of fields) {
    if (!users.fields.getByName(name)) users.fields.add(new NumberField({ name, min: 0, onlyInt: true }));
  }
  // Persist the new fields before the rules that reference them.
  app.save(users);
  // Wrap the existing rule so a "||" inside it can't bypass the guard.
  const withGuard = (rule) => (rule ? "(" + rule + ")" + guard : "true" + guard);
  if (users.createRule !== null && !users.createRule.includes(fields[0])) users.createRule = withGuard(users.createRule);
  if (users.updateRule !== null && !users.updateRule.includes(fields[0])) users.updateRule = withGuard(users.updateRule);
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const withoutGuard = (rule) => {
    if (rule === "true" + guard) return "";
    return rule && rule.startsWith("(") && rule.endsWith(")" + guard) ? rule.slice(1, -(guard.length + 1)) : rule;
  };
  users.createRule = withoutGuard(users.createRule);
  users.updateRule = withoutGuard(users.updateRule);
  for (const name of fields) {
    if (users.fields.getByName(name)) users.fields.removeByName(name);
  }
  app.save(users);
});
