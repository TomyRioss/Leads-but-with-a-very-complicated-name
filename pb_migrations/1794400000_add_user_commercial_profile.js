// Commercial profile of each user (lib/server/user-profile.ts): the service they sell and their usual target sectors.
// Existing users rules already limit view/update to the owner of the record, so these fields stay private.
const fields = [
  { name: "service_offering", max: 300 },
  { name: "commercial_sectors", max: 300 },
];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");
  for (const field of fields) {
    if (!users.fields.getByName(field.name)) users.fields.add(new TextField(field));
  }
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const field of fields) {
    if (users.fields.getByName(field.name)) users.fields.removeByName(field.name);
  }
  app.save(users);
});
