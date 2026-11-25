// Onboarding de varios negocios por cuenta (lib/server/workspace/onboarding.ts): pasos 2-6 en businesses y negocio activo en users.
// businesses sigue solo superuser (reglas null). users.active_business no se borra en cascada: si el negocio desaparece queda vacío.
const BUSINESS_FIELDS = [
  () => new JSONField({ name: "markets", maxSize: 5000 }),
  () => new JSONField({ name: "business_types", maxSize: 5000 }),
  () => new DateField({ name: "offer_confirmed_at" }),
  () => new DateField({ name: "markets_confirmed_at" }),
  () => new JSONField({ name: "channels", maxSize: 200 }),
  () => new TextField({ name: "onboarding_step", max: 20 }),
  () => new DateField({ name: "onboarding_completed_at" }),
];
const BUSINESS_NAMES = ["markets", "business_types", "offer_confirmed_at", "markets_confirmed_at", "channels", "onboarding_step", "onboarding_completed_at"];

migrate((app) => {
  const businesses = app.findCollectionByNameOrId("businesses");
  let changed = false;
  for (const make of BUSINESS_FIELDS) {
    const field = make();
    if (businesses.fields.getByName(field.name)) continue;
    businesses.fields.add(field);
    changed = true;
  }
  if (changed) app.save(businesses);

  const users = app.findCollectionByNameOrId("users");
  if (users.type !== "auth") throw new Error("The users collection must use PocketBase auth.");
  if (!users.fields.getByName("active_business")) {
    users.fields.add(new RelationField({ name: "active_business", required: false, collectionId: businesses.id, cascadeDelete: false, maxSelect: 1 }));
    app.save(users);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  if (users.fields.getByName("active_business")) {
    users.fields.removeByName("active_business");
    app.save(users);
  }
  const businesses = app.findAllCollections().find((collection) => collection.name === "businesses");
  if (!businesses) return;
  let changed = false;
  for (const name of BUSINESS_NAMES) {
    if (!businesses.fields.getByName(name)) continue;
    businesses.fields.removeByName(name);
    changed = true;
  }
  if (changed) app.save(businesses);
});
