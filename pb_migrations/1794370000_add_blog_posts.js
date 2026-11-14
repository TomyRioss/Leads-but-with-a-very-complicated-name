// Blog: server-written `blog_posts` collection; the public can only read published posts.
migrate((app) => {
  if (app.findAllCollections().some((collection) => collection.name === "blog_posts")) return;
  const posts = new Collection({
    type: "base",
    name: "blog_posts",
    fields: [
      { name: "title", type: "text", required: true, max: 160 },
      { name: "slug", type: "text", required: true, max: 120, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
      { name: "locale", type: "select", required: true, maxSelect: 1, values: ["es", "en"] },
      { name: "excerpt", type: "text", max: 300 },
      { name: "content", type: "text", max: 100000 },
      { name: "cover", type: "file", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { name: "cover_alt", type: "text", max: 200 },
      { name: "seo_title", type: "text", max: 70 },
      { name: "seo_description", type: "text", max: 170 },
      { name: "tags", type: "json", maxSize: 5000 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "published"] },
      { name: "published_at", type: "date" },
      { name: "author_name", type: "text", max: 80 },
      { name: "reading_minutes", type: "number", min: 0, onlyInt: true },
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
  app.save(posts);
  const saved = app.findCollectionByNameOrId("blog_posts");
  saved.indexes = [
    "CREATE UNIQUE INDEX idx_blog_posts_locale_slug ON blog_posts (locale, slug)",
    "CREATE INDEX idx_blog_posts_status_locale_published ON blog_posts (status, locale, published_at)",
  ];
  saved.listRule = 'status = "published"';
  saved.viewRule = 'status = "published"';
  app.save(saved);
}, (app) => {
  const posts = app.findAllCollections().find((collection) => collection.name === "blog_posts");
  if (posts) app.delete(posts);
});
