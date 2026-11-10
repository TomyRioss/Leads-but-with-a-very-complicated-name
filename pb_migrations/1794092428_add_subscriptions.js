migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const subscriptions = new Collection({
    type: "base",
    name: "subscriptions",
    fields: [
      new RelationField({ name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 }),
      new TextField({ name: "plan_id", required: true, max: 24 }),
      new TextField({ name: "external_reference", required: true, max: 100 }),
      new TextField({ name: "mp_subscription_id", max: 100 }),
      new TextField({ name: "checkout_url", max: 2000 }),
      new TextField({ name: "status", required: true, max: 24 }),
      new NumberField({ name: "price_ars", min: 0, onlyInt: true }),
      new NumberField({ name: "monthly_credits", min: 0, onlyInt: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_subscriptions_external_reference ON subscriptions (external_reference)",
      "CREATE UNIQUE INDEX idx_subscriptions_mp_subscription_id ON subscriptions (mp_subscription_id) WHERE mp_subscription_id != ''",
      "CREATE INDEX idx_subscriptions_user_status ON subscriptions (user, status)",
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(subscriptions);

  const payments = new Collection({
    type: "base",
    name: "subscription_payments",
    fields: [
      new RelationField({ name: "subscription", required: true, collectionId: subscriptions.id, cascadeDelete: true, maxSelect: 1 }),
      new RelationField({ name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 }),
      new TextField({ name: "payment_id", required: true, max: 100 }),
      new TextField({ name: "invoice_id", max: 100 }),
      new TextField({ name: "status", required: true, max: 24 }),
      new NumberField({ name: "amount_ars", min: 0 }),
      new NumberField({ name: "credits", min: 0, onlyInt: true }),
      new NumberField({ name: "balance_before", min: 0, onlyInt: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_subscription_payments_payment_id ON subscription_payments (payment_id)",
      "CREATE INDEX idx_subscription_payments_user ON subscription_payments (user)",
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(payments);

  const locks = new Collection({
    type: "base",
    name: "subscription_checkout_locks",
    fields: [new RelationField({ name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 })],
    indexes: ["CREATE UNIQUE INDEX idx_subscription_checkout_locks_user ON subscription_checkout_locks (user)"],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(locks);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("subscription_checkout_locks"));
  app.delete(app.findCollectionByNameOrId("subscription_payments"));
  app.delete(app.findCollectionByNameOrId("subscriptions"));
});
