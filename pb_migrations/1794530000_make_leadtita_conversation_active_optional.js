// leadtita_conversations.is_active was a required bool. In PocketBase a required bool must be true, so marking a
// conversation inactive (is_active = false) failed validation and "delete" never worked. Make it optional; the app
// always sends is_active: true on create (lib/server/leadtita-conversations.ts). No data changes.
migrate((app) => {
  const conversations = app.findCollectionByNameOrId("leadtita_conversations");
  const field = conversations.fields.getByName("is_active");
  if (!field || !field.required) return;
  field.required = false;
  app.save(conversations);
}, (app) => {
  const conversations = app.findCollectionByNameOrId("leadtita_conversations");
  const field = conversations.fields.getByName("is_active");
  if (!field || field.required) return;
  field.required = true;
  app.save(conversations);
});
