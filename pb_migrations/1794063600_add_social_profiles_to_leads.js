migrate((app) => {
  const leads = app.findCollectionByNameOrId("leads");
  if (!leads.fields.getByName("social_profiles")) {
    leads.fields.add(new TextField({ name: "social_profiles", max: 5000 }));
  }
  app.save(leads);
}, (app) => {
  const leads = app.findCollectionByNameOrId("leads");
  if (leads.fields.getByName("social_profiles")) leads.fields.removeByName("social_profiles");
  app.save(leads);
});
