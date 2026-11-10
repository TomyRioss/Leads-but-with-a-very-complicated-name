migrate((app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.fields.getByName("requested_count").max = 150;
  batches.fields.getByName("result_count").max = 150;
  app.save(batches);
}, (app) => {
  const batches = app.findCollectionByNameOrId("lead_batches");
  batches.fields.getByName("requested_count").max = 30;
  batches.fields.getByName("result_count").max = 30;
  app.save(batches);
});
