// "Programados": emails and WhatsApp messages the user scheduled from Leadtita. Server-only (superuser) collection;
// the dispatcher (/api/scheduled/dispatch, called every minute by the WhatsApp worker) sends the due ones.
migrate((app) => {
  const existing = app.findAllCollections().some((collection) => collection.name === "scheduled_messages");
  if (existing) return;

  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "scheduled_messages",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "channel", type: "select", required: true, maxSelect: 1, values: ["email", "whatsapp"] },
      { name: "lead_id", type: "text", required: true, min: 15, max: 15 },
      { name: "lead_name", type: "text", max: 300 },
      // Email address or WhatsApp digits (E.164 without +).
      { name: "recipient", type: "text", required: true, max: 254 },
      { name: "subject", type: "text", max: 200 },
      { name: "body", type: "text", required: true, max: 5000 },
      { name: "send_at", type: "date", required: true },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["scheduled", "sending", "sent", "failed", "cancelled"] },
      { name: "error", type: "text", max: 80 },
      { name: "sent_at", type: "date" },
      // One schedule per lead per confirmed card: replays hit the unique index instead of duplicating.
      { name: "card_ref", type: "text", required: true, max: 64 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  }));

  const saved = app.findCollectionByNameOrId("scheduled_messages");
  saved.indexes = [
    "CREATE UNIQUE INDEX idx_scheduled_messages_card ON scheduled_messages (user, card_ref)",
    "CREATE INDEX idx_scheduled_messages_due ON scheduled_messages (status, send_at)",
    "CREATE INDEX idx_scheduled_messages_user ON scheduled_messages (user, send_at)",
  ];
  app.save(saved);
}, (app) => {
  const collection = app.findAllCollections().find((item) => item.name === "scheduled_messages");
  if (collection) app.delete(collection);
});
