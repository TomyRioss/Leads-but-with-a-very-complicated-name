// /personas scrapers added after 1794380000: leads.source must accept them so people leads keep their real platform
// instead of "web". Values match SEARCH_SOURCES in lib/people.ts. Idempotent: only appends the missing ones.
const NEW_SOURCES = ["tiktok", "youtube", "fiverr", "behance"];

migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  const source = leads.fields.getByName("source");
  if (!source) return;
  const missing = NEW_SOURCES.filter((value) => !source.values.includes(value));
  if (!missing.length) return;
  source.values = [...source.values, ...missing];
  app.save(leads);
}, (app) => {
  // Down: records already saved with these values keep them, but can't be re-saved until they change source.
  const leads = app.findCollectionByNameOrId("leads");
  const source = leads.fields.getByName("source");
  if (!source) return;
  source.values = source.values.filter((value) => !NEW_SOURCES.includes(value));
  app.save(leads);
});
