// Referral program: users.referral_code / users.referred_by and the server-written `referrals` collection.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");

  if (!users.fields.getByName("referral_code")) {
    users.fields.add(new TextField({ name: "referral_code", max: 16 }));
  }
  if (!users.fields.getByName("referred_by")) {
    users.fields.add(new RelationField({ name: "referred_by", collectionId: users.id, cascadeDelete: false, maxSelect: 1 }));
  }
  // Partial unique index: existing users keep an empty code until one is generated lazily.
  if (!users.indexes.some((index) => index.includes("idx_users_referral_code"))) {
    users.indexes.push("CREATE UNIQUE INDEX idx_users_referral_code ON users (referral_code) WHERE referral_code != ''");
  }
  // Only the server (superuser) may set referral fields; clients can't through the public API.
  const guard = " && @request.body.referral_code:isset = false && @request.body.referred_by:isset = false";
  // Wrap the existing rule so a "||" inside it can't bypass the guard.
  const withGuard = (rule) => (rule ? "(" + rule + ")" + guard : "true" + guard);
  if (users.createRule !== null && !users.createRule.includes("referral_code")) users.createRule = withGuard(users.createRule);
  if (users.updateRule !== null && !users.updateRule.includes("referral_code")) users.updateRule = withGuard(users.updateRule);
  app.save(users);

  if (app.findAllCollections().some((collection) => collection.name === "referrals")) return;
  const referrals = new Collection({
    type: "base",
    name: "referrals",
    fields: [
      { name: "referrer", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "referred", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "status", type: "select", required: true, values: ["pending", "rewarded", "rejected"], maxSelect: 1 },
      { name: "referrer_credits", type: "number", min: 0 },
      { name: "referred_credits", type: "number", min: 0 },
      { name: "reject_reason", type: "text", max: 60 },
      { name: "rewarded_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  // Plain { name, type } fields (pattern of 1762471200). Save the columns first, then indexes and rules that reference them.
  app.save(referrals);
  const saved = app.findCollectionByNameOrId("referrals");
  saved.indexes = [
    "CREATE UNIQUE INDEX idx_referrals_referred ON referrals (referred)",
    "CREATE INDEX idx_referrals_referrer_status ON referrals (referrer, status)",
  ];
  // Referrers can list/view their own referrals; every write happens server-side with the superuser.
  saved.listRule = "referrer = @request.auth.id";
  saved.viewRule = "referrer = @request.auth.id";
  app.save(saved);
}, (app) => {
  const referrals = app.findAllCollections().find((collection) => collection.name === "referrals");
  if (referrals) app.delete(referrals);
  const users = app.findCollectionByNameOrId("users");
  const guard = " && @request.body.referral_code:isset = false && @request.body.referred_by:isset = false";
  const withoutGuard = (rule) => {
    if (rule === "true" + guard) return "";
    return rule && rule.startsWith("(") && rule.endsWith(")" + guard) ? rule.slice(1, -(guard.length + 1)) : rule;
  };
  users.createRule = withoutGuard(users.createRule);
  users.updateRule = withoutGuard(users.updateRule);
  users.indexes = users.indexes.filter((index) => !index.includes("idx_users_referral_code"));
  if (users.fields.getByName("referral_code")) users.fields.removeByName("referral_code");
  if (users.fields.getByName("referred_by")) users.fields.removeByName("referred_by");
  app.save(users);
});
