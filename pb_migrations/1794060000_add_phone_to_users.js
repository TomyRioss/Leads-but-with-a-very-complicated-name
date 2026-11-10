migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");
  if (!users.fields.getByName("phone")) {
    users.fields.add(new TextField({ name: "phone", max: 30 }));
  }
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.fields.getByName("phone")) users.fields.removeByName("phone");
  app.save(users);
});
