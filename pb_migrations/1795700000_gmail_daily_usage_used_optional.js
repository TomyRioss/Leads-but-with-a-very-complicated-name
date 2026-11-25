// gmail_daily_usage.used: number "required" en PocketBase rechaza 0 ("Cannot be blank"), y el contador arranca en 0 y
// vuelve a 0 al devolver cupos. Se deja opcional (min 0 se mantiene): sin esto falla el primer envío de Gmail del día.
migrate((app) => {
  const collection = app.findAllCollections().find((item) => item.name === "gmail_daily_usage");
  if (!collection) return;
  const field = collection.fields.getByName("used");
  if (!field || !field.required) return;
  field.required = false;
  app.save(collection);
}, (app) => {
  const collection = app.findAllCollections().find((item) => item.name === "gmail_daily_usage");
  if (!collection) return;
  const field = collection.fields.getByName("used");
  if (!field || field.required) return;
  field.required = true;
  app.save(collection);
});
