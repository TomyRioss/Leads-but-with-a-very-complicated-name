// Keep a WhatsApp schedule pending until the worker confirms delivery.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("scheduled_messages");
  const status = collection.fields.getByName("status");
  for (const value of ["queued", "delivered"]) {
    if (!status.values.includes(value)) status.values = [...status.values, value];
  }
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("scheduled_messages");
  $app.db().newQuery("UPDATE scheduled_messages SET status = 'scheduled' WHERE status = 'queued'").execute();
  $app.db().newQuery("UPDATE scheduled_messages SET status = 'sent' WHERE status = 'delivered'").execute();
  collection.fields.getByName("status").values = ["scheduled", "sending", "sent", "failed", "cancelled"];
  app.save(collection);
});
