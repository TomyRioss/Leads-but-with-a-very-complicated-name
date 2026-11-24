// Paid plans moved from Mercado Pago to Rebill: subscriptions.mp_subscription_id becomes rebill_subscription_id
// (same data, same partial unique index). checkout_url is no longer written (Rebill's widget has no redirect URL).
// Index first, then the column, then the index again (pattern of 1794500000), so the rename never leaves a dangling index.
const oldIndex = "idx_subscriptions_mp_subscription_id";
const newIndex = "idx_subscriptions_rebill_subscription_id";

migrate((app) => {
  const subscriptions = app.findCollectionByNameOrId("subscriptions");
  if (!subscriptions.fields.getByName("mp_subscription_id")) return; // already renamed
  subscriptions.indexes = subscriptions.indexes.filter((index) => !index.includes(oldIndex));
  app.save(subscriptions);

  const renamed = app.findCollectionByNameOrId("subscriptions");
  renamed.fields.getByName("mp_subscription_id").name = "rebill_subscription_id";
  app.save(renamed);

  const indexed = app.findCollectionByNameOrId("subscriptions");
  indexed.indexes = [...indexed.indexes, `CREATE UNIQUE INDEX ${newIndex} ON subscriptions (rebill_subscription_id) WHERE rebill_subscription_id != ''`];
  app.save(indexed);
}, (app) => {
  const subscriptions = app.findCollectionByNameOrId("subscriptions");
  if (!subscriptions.fields.getByName("rebill_subscription_id")) return;
  subscriptions.indexes = subscriptions.indexes.filter((index) => !index.includes(newIndex));
  app.save(subscriptions);

  const renamed = app.findCollectionByNameOrId("subscriptions");
  renamed.fields.getByName("rebill_subscription_id").name = "mp_subscription_id";
  app.save(renamed);

  const indexed = app.findCollectionByNameOrId("subscriptions");
  indexed.indexes = [...indexed.indexes, `CREATE UNIQUE INDEX ${oldIndex} ON subscriptions (mp_subscription_id) WHERE mp_subscription_id != ''`];
  app.save(indexed);
});
