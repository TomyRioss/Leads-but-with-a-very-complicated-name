// Buscar Personas: person batches/leads reuse lead_batches and leads (kind = "person"); only the server writes the new fields.
const batchFields = ["kind", "query", "plan"];
const leadFields = ["kind", "role", "location", "whatsapp", "source", "source_url", "completeness"];
const guardFor = (fields) => fields.map((name) => " && @request.body." + name + ":isset = false").join("");

migrate((app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  if (!batches.fields.getByName("kind")) batches.fields.add(new SelectField({ name: "kind", maxSelect: 1, values: ["business", "person"] }));
  if (!batches.fields.getByName("query")) batches.fields.add(new TextField({ name: "query", max: 300 }));
  if (!batches.fields.getByName("plan")) batches.fields.add(new JSONField({ name: "plan", maxSize: 20000 }));

  const leads = app.findCollectionByNameOrId("leads");
  if (!leads.fields.getByName("kind")) leads.fields.add(new SelectField({ name: "kind", maxSelect: 1, values: ["business", "person"] }));
  if (!leads.fields.getByName("role")) leads.fields.add(new TextField({ name: "role", max: 120 }));
  if (!leads.fields.getByName("location")) leads.fields.add(new TextField({ name: "location", max: 160 }));
  if (!leads.fields.getByName("whatsapp")) leads.fields.add(new TextField({ name: "whatsapp", max: 40 }));
  if (!leads.fields.getByName("source")) leads.fields.add(new SelectField({ name: "source", maxSelect: 1, values: ["serper", "github", "instagram", "facebook", "web"] }));
  if (!leads.fields.getByName("source_url")) leads.fields.add(new TextField({ name: "source_url", max: 1000 }));
  if (!leads.fields.getByName("completeness")) leads.fields.add(new NumberField({ name: "completeness", min: 0, max: 4, onlyInt: true }));

  // Persist the new fields before the rules that reference them.
  app.save(batches);
  app.save(leads);
  // Wrap the existing rule so a "||" inside it can't bypass the guard.
  for (const [collection, fields] of [[batches, batchFields], [leads, leadFields]]) {
    const guard = guardFor(fields);
    const marker = "@request.body." + fields[1] + ":isset";
    const withGuard = (rule) => (rule ? "(" + rule + ")" + guard : "true" + guard);
    if (collection.createRule !== null && !collection.createRule.includes(marker)) collection.createRule = withGuard(collection.createRule);
    if (collection.updateRule !== null && !collection.updateRule.includes(marker)) collection.updateRule = withGuard(collection.updateRule);
    app.save(collection);
  }
}, (app) => {
  for (const [name, fields] of [["leads", leadFields], ["lead_batches", batchFields]]) {
    const collection = app.findCollectionByNameOrId(name);
    const guard = guardFor(fields);
    const withoutGuard = (rule) => {
      if (rule === "true" + guard) return "";
      return rule && rule.startsWith("(") && rule.endsWith(")" + guard) ? rule.slice(1, -(guard.length + 1)) : rule;
    };
    collection.createRule = withoutGuard(collection.createRule);
    collection.updateRule = withoutGuard(collection.updateRule);
    for (const field of fields) if (collection.fields.getByName(field)) collection.fields.removeByName(field);
    app.save(collection);
  }
});
