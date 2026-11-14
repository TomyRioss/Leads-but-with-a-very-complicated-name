// Lead Suite: lead_contacts, lead_suite_reports and leads.contact_status / leads.last_contacted_at.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const leads = app.findCollectionByNameOrId("leads");

  if (!leads.fields.getByName("contact_status")) {
    leads.fields.add(new SelectField({ name: "contact_status", maxSelect: 1, values: ["not_contacted", "contacted", "replied", "meeting", "won", "lost"] }));
  }
  if (!leads.fields.getByName("last_contacted_at")) {
    leads.fields.add(new DateField({ name: "last_contacted_at" }));
  }
  // Persist the new fields first; rules are validated against the saved schema (see saveWithRules).
  app.save(leads);
  // Only the server (superuser) may write contact fields.
  const guard = " && @request.body.contact_status:isset = false && @request.body.last_contacted_at:isset = false";
  const withGuard = (rule) => (rule ? "(" + rule + ")" + guard : "true" + guard);
  if (leads.createRule !== null && !leads.createRule.includes("contact_status")) leads.createRule = withGuard(leads.createRule);
  if (leads.updateRule !== null && !leads.updateRule.includes("contact_status")) leads.updateRule = withGuard(leads.updateRule);
  app.save(leads);

  // Fields as plain { name, type } objects (pattern of 1762471200_create_lead_collections.js, the one that applies on the VPS).
  // First save creates the table with its columns; indexes and rules go in a second save, once `user`/`lead` exist.
  const saveWithRules = (collection, rules, indexes) => {
    app.save(collection);
    const saved = app.findCollectionByNameOrId(collection.name);
    saved.indexes = indexes;
    saved.listRule = rules.listRule; // explicit sets: Go-bound collection objects, no Object.assign
    saved.viewRule = rules.viewRule;
    app.save(saved);
  };
  const ownerOnly = { listRule: "user = @request.auth.id", viewRule: "user = @request.auth.id" };

  const existing = app.findAllCollections().map((collection) => collection.name);

  if (!existing.includes("lead_contacts")) {
    saveWithRules(new Collection({
      type: "base",
      name: "lead_contacts",
      fields: [
        { name: "lead", type: "relation", required: true, collectionId: leads.id, cascadeDelete: true, maxSelect: 1 },
        { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { name: "channel", type: "select", required: true, maxSelect: 1, values: ["whatsapp", "email", "phone", "instagram", "linkedin", "in_person", "other"] },
        { name: "message", type: "text", max: 4000 },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["contacted", "replied", "meeting", "won", "lost"] },
        { name: "notes", type: "text", max: 2000 },
        { name: "contacted_at", type: "date", required: true },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    }), ownerOnly, [
      "CREATE INDEX idx_lead_contacts_user_contacted ON lead_contacts (user, contacted_at)",
      "CREATE INDEX idx_lead_contacts_lead_contacted ON lead_contacts (lead, contacted_at)",
    ]);
  }

  if (!existing.includes("lead_suite_reports")) {
    saveWithRules(new Collection({
      type: "base",
      name: "lead_suite_reports",
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { name: "week_start", type: "date", required: true },
        { name: "summary", type: "text" },
        { name: "suggestions", type: "json", maxSize: 20000 },
        { name: "metrics", type: "json", maxSize: 200000 },
        { name: "sent_at", type: "date" },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    }), ownerOnly, ["CREATE UNIQUE INDEX idx_lead_suite_reports_user_week ON lead_suite_reports (user, week_start)"]);
  }
}, (app) => {
  for (const name of ["lead_suite_reports", "lead_contacts"]) {
    const collection = app.findAllCollections().find((item) => item.name === name);
    if (collection) app.delete(collection);
  }
  const leads = app.findCollectionByNameOrId("leads");
  const guard = " && @request.body.contact_status:isset = false && @request.body.last_contacted_at:isset = false";
  const withoutGuard = (rule) => {
    if (rule === "true" + guard) return "";
    return rule && rule.startsWith("(") && rule.endsWith(")" + guard) ? rule.slice(1, -(guard.length + 1)) : rule;
  };
  leads.createRule = withoutGuard(leads.createRule);
  leads.updateRule = withoutGuard(leads.updateRule);
  if (leads.fields.getByName("contact_status")) leads.fields.removeByName("contact_status");
  if (leads.fields.getByName("last_contacted_at")) leads.fields.removeByName("last_contacted_at");
  app.save(leads);
});
