migrate((app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.fields.add(new DateField({ name: "created_at", required: true }));
  app.save(batches);

  const leads = app.findCollectionByNameOrId("leads");
  leads.fields.add(new DateField({ name: "created_at", required: true }));
  app.save(leads);
}, (app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.fields.removeByName("created_at");
  app.save(batches);

  const leads = app.findCollectionByNameOrId("leads");
  leads.fields.removeByName("created_at");
  app.save(leads);
});
