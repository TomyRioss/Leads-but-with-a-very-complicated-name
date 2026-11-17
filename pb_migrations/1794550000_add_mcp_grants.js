// MCP connector OAuth grants (claude.ai, ChatGPT…): one row per authorization, tokens stored only as sha256 hashes.
// Server-only (superuser) collection used by lib/server/mcp/oauth.ts. code_hash is unique so each auth code is
// exchanged once; previous_refresh_hash detects reuse of a rotated refresh token (the grant is then revoked).
migrate((app) => {
  const existing = app.findAllCollections().some((collection) => collection.name === "mcp_grants");
  if (existing) return;

  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "mcp_grants",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      // DCR signed blob or CIMD https URL.
      { name: "client_id", type: "text", required: true, max: 2000 },
      { name: "client_name", type: "text", max: 200 },
      { name: "redirect_uri", type: "text", required: true, max: 2000 },
      // Space-separated subset of: read write credits send.
      { name: "scopes", type: "text", max: 100 },
      { name: "code_hash", type: "text", max: 64 },
      { name: "access_hash", type: "text", max: 64 },
      { name: "refresh_hash", type: "text", max: 64 },
      { name: "previous_refresh_hash", type: "text", max: 64 },
      { name: "access_expires_at", type: "date" },
      { name: "refresh_expires_at", type: "date" },
      { name: "last_used_at", type: "date" },
      { name: "revoked_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));

  const saved = app.findCollectionByNameOrId("mcp_grants");
  saved.indexes = [
    "CREATE UNIQUE INDEX idx_mcp_grants_code ON mcp_grants (code_hash) WHERE code_hash != ''",
    "CREATE UNIQUE INDEX idx_mcp_grants_access ON mcp_grants (access_hash) WHERE access_hash != ''",
    "CREATE UNIQUE INDEX idx_mcp_grants_refresh ON mcp_grants (refresh_hash) WHERE refresh_hash != ''",
    "CREATE INDEX idx_mcp_grants_previous_refresh ON mcp_grants (previous_refresh_hash) WHERE previous_refresh_hash != ''",
    "CREATE INDEX idx_mcp_grants_user ON mcp_grants (user, revoked_at)",
  ];
  app.save(saved);
}, (app) => {
  const collection = app.findAllCollections().find((item) => item.name === "mcp_grants");
  if (collection) app.delete(collection);
});
