migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");

  if (!users.fields.getByName("verification_sent_at")) {
    users.fields.add(new DateField({ name: "verification_sent_at" }));
  }
  if (!users.fields.getByName("welcome_email_sent_at")) {
    users.fields.add(new DateField({ name: "welcome_email_sent_at" }));
  }
  users.authRule = "verified = true";
  app.save(users);

  const batchSize = 500;
  let offset = 0;
  while (true) {
    const records = app.findRecordsByFilter("users", "", "id", batchSize, offset);
    if (records.length === 0) break;
    for (const record of records) {
      if (!record.get("verified")) record.set("verified", true);
      if (!record.get("welcome_email_sent_at")) {
        record.set("welcome_email_sent_at", new Date().toISOString());
      }
      app.save(record);
    }
    offset += records.length;
  }

}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authRule = "";
  if (users.fields.getByName("verification_sent_at")) users.fields.removeByName("verification_sent_at");
  if (users.fields.getByName("welcome_email_sent_at")) users.fields.removeByName("welcome_email_sent_at");
  app.save(users);
});
