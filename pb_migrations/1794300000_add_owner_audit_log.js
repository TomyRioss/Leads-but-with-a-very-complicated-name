// Idempotent: scripts/apply-owner-audit-schema.mjs may already have created the collection on the live DB.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "owner_audit_log")) return;

  const audit = new Collection({
    type: "base",
    name: "owner_audit_log",
    fields: [
      new TextField({ name: "actor_email", max: 200 }),
      new TextField({ name: "action", required: true, max: 60 }),
      new TextField({ name: "target_type", max: 30 }),
      new TextField({ name: "target_id", max: 40 }),
      new TextField({ name: "target_label", max: 300 }),
      new JSONField({ name: "details", maxSize: 20000 }),
      new TextField({ name: "ip", max: 64 }),
      new AutodateField({ name: "created", onCreate: true, onUpdate: false }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_owner_audit_log_created ON owner_audit_log (created)",
      "CREATE INDEX idx_owner_audit_log_action ON owner_audit_log (action)",
      "CREATE INDEX idx_owner_audit_log_target_id ON owner_audit_log (target_id)",
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(audit);
}, (app) => {
  const audit = app.findAllCollections().find((collection) => collection.name === "owner_audit_log");
  if (audit) app.delete(audit);
});
