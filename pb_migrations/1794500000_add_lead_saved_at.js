// "Leads guardados" in the Leadtita Lead Suite sidebar: empty = not saved, otherwise when the user saved it.
// Only the server (superuser) writes it; leads keep their existing API rules.
const indexName = "idx_leads_saved_at";

migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  if (!leads.fields.getByName("saved_at")) {
    leads.fields.add(new DateField({ name: "saved_at" }));
    app.save(leads);
  }
  // Save the column first, then the index that references it (pattern of 1794370000).
  const saved = app.findCollectionByNameOrId("leads");
  if (!saved.indexes.some((index) => index.includes(indexName))) {
    saved.indexes = [...saved.indexes, `CREATE INDEX ${indexName} ON leads (saved_at) WHERE saved_at != ''`];
    app.save(saved);
  }
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  leads.indexes = leads.indexes.filter((index) => !index.includes(indexName));
  if (leads.fields.getByName("saved_at")) leads.fields.removeByName("saved_at");
  app.save(leads);
});
