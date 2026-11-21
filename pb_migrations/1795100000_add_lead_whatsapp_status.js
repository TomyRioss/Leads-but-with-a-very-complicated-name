// Resultado de verificar el número del lead en WhatsApp: "verified" o "none". Solo lo escribe el servidor.
const guard = " && @request.body.whatsapp_status:isset = false";

migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  if (!leads.fields.getByName("whatsapp_status")) leads.fields.add(new SelectField({ name: "whatsapp_status", maxSelect: 1, values: ["verified", "none"] }));
  app.save(leads);
  const marker = "@request.body.whatsapp_status:isset";
  const withGuard = (rule) => (rule ? "(" + rule + ")" + guard : "true" + guard);
  if (leads.createRule !== null && !leads.createRule.includes(marker)) leads.createRule = withGuard(leads.createRule);
  if (leads.updateRule !== null && !leads.updateRule.includes(marker)) leads.updateRule = withGuard(leads.updateRule);
  app.save(leads);
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  const withoutGuard = (rule) => {
    if (rule === "true" + guard) return "";
    return rule && rule.startsWith("(") && rule.endsWith(")" + guard) ? rule.slice(1, -(guard.length + 1)) : rule;
  };
  leads.createRule = withoutGuard(leads.createRule);
  leads.updateRule = withoutGuard(leads.updateRule);
  if (leads.fields.getByName("whatsapp_status")) leads.fields.removeByName("whatsapp_status");
  app.save(leads);
});
