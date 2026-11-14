// Google Drive connector: one server-only `google_connections` row per user with encrypted OAuth tokens.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "google_connections")) return;
  const users = app.findCollectionByNameOrId("users");
  // Plain { name, type } fields (pattern of 1762471200). Save the columns first, then the index that references them.
  app.save(new Collection({
    type: "base",
    name: "google_connections",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "google_email", type: "text", max: 320 },
      { name: "google_sub", type: "text", max: 255 },
      { name: "scopes", type: "text", max: 2000 },
      { name: "refresh_token_enc", type: "text", max: 4000 },
      { name: "access_token_enc", type: "text", max: 4000 },
      { name: "access_expires_at", type: "date" },
      { name: "files", type: "json", maxSize: 50000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    // Tokens never leave the server: no client access at all.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));
  const saved = app.findCollectionByNameOrId("google_connections");
  saved.indexes = ["CREATE UNIQUE INDEX idx_google_connections_user ON google_connections (user)"];
  app.save(saved);
}, (app) => {
  const connections = app.findAllCollections().find((collection) => collection.name === "google_connections");
  if (connections) app.delete(connections);
});
