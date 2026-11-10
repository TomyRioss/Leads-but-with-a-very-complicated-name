function hasFractionalValues(app, collectionName, fieldName) {
  let offset = 0;
  while (true) {
    const records = app.findRecordsByFilter(collectionName, `${fieldName} >= 0`, "id", 500, offset);
    if (records.some((record) => Number(record.get(fieldName)) % 1 !== 0)) return true;
    if (records.length < 500) return false;
    offset += records.length;
  }
}

function findOptionalCollection(app, collectionName) {
  return app.findAllCollections().find((collection) => collection.name === collectionName);
}

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.getByName("credits").onlyInt = false;
  app.save(users);

  const payments = findOptionalCollection(app, "subscription_payments");
  if (payments) {
    payments.fields.getByName("balance_before").onlyInt = false;
    app.save(payments);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const payments = findOptionalCollection(app, "subscription_payments");
  if (hasFractionalValues(app, "users", "credits") || (payments && hasFractionalValues(app, "subscription_payments", "balance_before"))) {
    throw new Error("Cannot restore integer credits while fractional balances or payment snapshots exist.");
  }
  users.fields.getByName("credits").onlyInt = true;
  app.save(users);

  if (payments) {
    payments.fields.getByName("balance_before").onlyInt = true;
    app.save(payments);
  }
});
