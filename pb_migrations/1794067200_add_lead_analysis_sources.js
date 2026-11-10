migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  leads.fields.add(new JSONField({ name: "source_reviews", maxSize: 100000 }));
  leads.fields.add(new JSONField({ name: "source_context", maxSize: 30000 }));
  leads.fields.add(new JSONField({ name: "pain_points_detail", maxSize: 30000 }));
  leads.fields.add(new JSONField({ name: "enrichment_detail", maxSize: 30000 }));
  app.save(leads);
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  for (const name of ["source_reviews", "source_context", "pain_points_detail", "enrichment_detail"]) {
    if (leads.fields.getByName(name)) leads.fields.removeByName(name);
  }
  app.save(leads);
});
