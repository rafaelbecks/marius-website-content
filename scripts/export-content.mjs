#!/usr/bin/env node
/**
 * One-way export of published Strapi content into content/*.json.
 *
 * The public site and the browser editor read those files.
 * Running this again overwrites whatever was edited in the browser.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "marius-cms/package.json"));
const Database = require("better-sqlite3");

const db = new Database(path.join(root, "marius-cms/.tmp/data.db"), {
  readonly: true,
  fileMustExist: true,
});

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicPath(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  return url.startsWith("/") ? url : `/${url}`;
}

function bodyToText(body) {
  const value = parseJson(body, null);
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  const paragraphs = [];
  for (const block of value) {
    if (!block || typeof block !== "object") continue;
    const children = Array.isArray(block.children) ? block.children : [];
    if (block.type === "list") {
      for (const item of children) {
        const text = (item.children || [])
          .map((child) => child.text || "")
          .join("")
          .trim();
        if (text) paragraphs.push(text);
      }
      continue;
    }
    const text = children
      .map((child) => child.text || "")
      .join("")
      .trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

function formatsOf(raw) {
  const parsed = parseJson(raw, null);
  if (!parsed || typeof parsed !== "object") return undefined;
  const formats = {};
  for (const key of ["thumbnail", "small", "medium", "large"]) {
    const format = parsed[key];
    if (!format?.url) continue;
    formats[key] = {
      url: publicPath(format.url),
      width: format.width ?? null,
      height: format.height ?? null,
    };
  }
  return Object.keys(formats).length ? formats : undefined;
}

const mediaFormats = {};

function rememberMedia(file) {
  if (!file?.url) return "";
  const url = publicPath(file.url);
  const formats = formatsOf(file.formats);
  if (formats) mediaFormats[url] = formats;
  return url;
}

function filesFor(relatedId, relatedType, field) {
  return db
    .prepare(
      `SELECT f.url, f.alternative_text, f.mime, f.ext, f.formats, f.name
       FROM files_related_mph m
       JOIN files f ON f.id = m.file_id
       WHERE m.related_id = ? AND m.related_type = ? AND m.field = ?
       ORDER BY m."order" ASC, m.id ASC`,
    )
    .all(relatedId, relatedType, field);
}

function components(table, entityId, field, componentType) {
  return db
    .prepare(
      `SELECT c.*
       FROM ${table}_cmps l
       JOIN ${componentTable(componentType)} c ON c.id = l.cmp_id
       WHERE l.entity_id = ? AND l.field = ? AND l.component_type = ?
       ORDER BY l."order" ASC, l.id ASC`,
    )
    .all(entityId, field, componentType);
}

function componentTable(componentType) {
  const tables = {
    "shared.link": "components_shared_links",
    "shared.social-link": "components_shared_social_links",
    "about.education-item": "components_about_education_items",
    "about.award-item": "components_about_award_items",
  };
  const table = tables[componentType];
  if (!table) throw new Error(`Unknown component ${componentType}`);
  return table;
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const categories = db
  .prepare(
    `SELECT name, slug, description, sort_order AS sortOrder, is_primary_nav AS isPrimaryNav
     FROM categories
     WHERE published_at IS NOT NULL
     ORDER BY sort_order ASC, name ASC`,
  )
  .all()
  .map((category) => ({
    name: category.name,
    slug: category.slug,
    description: category.description || "",
    sortOrder: category.sortOrder ?? 0,
    isPrimaryNav: Boolean(category.isPrimaryNav),
  }));

const tags = db
  .prepare(
    `SELECT name, slug FROM tags ORDER BY name COLLATE NOCASE ASC`,
  )
  .all();

const projects = db
  .prepare(
    `SELECT * FROM projects
     WHERE published_at IS NOT NULL
     ORDER BY COALESCE(year, -1) DESC, COALESCE(sort_order, 0) ASC, title COLLATE NOCASE ASC`,
  )
  .all();

if (projects.length < 1) {
  console.error("Refusing to export: no published projects in SQLite.");
  process.exit(1);
}

const projectsDir = path.join(root, "content/projects");
rmSync(projectsDir, { recursive: true, force: true });
mkdirSync(projectsDir, { recursive: true });

const categoryById = new Map(
  db.prepare(`SELECT id, name, slug FROM categories`).all().map((row) => [row.id, row]),
);
const tagById = new Map(
  db.prepare(`SELECT id, name, slug FROM tags`).all().map((row) => [row.id, row]),
);

for (const project of projects) {
  const categoryLink = db
    .prepare(
      `SELECT category_id FROM projects_category_lnk WHERE project_id = ? LIMIT 1`,
    )
    .get(project.id);
  const category = categoryLink ? categoryById.get(categoryLink.category_id) : null;

  const projectTags = db
    .prepare(
      `SELECT tag_id FROM projects_tags_lnk WHERE project_id = ? ORDER BY tag_ord ASC, id ASC`,
    )
    .all(project.id)
    .map((row) => tagById.get(row.tag_id)?.name)
    .filter(Boolean)
    .map((tag) => ({ tag }));

  const cover = filesFor(project.id, "api::project.project", "coverImage")[0];
  const gallery = filesFor(project.id, "api::project.project", "gallery").map(
    (file) => ({
      image: rememberMedia(file),
      alt: file.alternative_text || "",
    }),
  );
  const audioFiles = filesFor(project.id, "api::project.project", "audioFiles").map(
    (file) => ({ file: rememberMedia(file) }),
  );

  const links = components("projects", project.id, "externalLinks", "shared.link").map(
    (link) => ({ label: link.label || "", url: link.url || "" }),
  );

  const entry = {
    title: project.title,
    slug: project.slug,
    published: true,
    category: category?.name || "",
    year: project.year ?? null,
    sortOrder: project.sort_order ?? 0,
    role: project.role || "",
    venue: project.venue || "",
    collaborators: project.collaborators || "",
    summary: project.summary || "",
    body: bodyToText(project.body),
    embedUrl: project.embed_url || "",
    coverImage: cover ? rememberMedia(cover) : "",
    gallery: gallery.filter((item) => item.image),
    audioFiles: audioFiles.filter((item) => item.file),
    externalLinks: links.filter((link) => link.label || link.url),
    tags: projectTags,
  };

  writeJson(path.join(projectsDir, `${project.slug}.json`), entry);
}

const site = db
  .prepare(`SELECT * FROM site_settings ORDER BY id DESC LIMIT 1`)
  .get();

if (!site) {
  console.error("Refusing to export: site settings row is missing.");
  process.exit(1);
}

const portrait = filesFor(site.id, "api::site-setting.site-setting", "portrait")[0];
const whatIDo = parseJson(site.what_i_do, []);

const siteJson = {
  siteName: site.site_name || "Marius Varhaugvik",
  tagline: site.tagline || "",
  email: site.email || "",
  phone: site.phone || "",
  bioIntro: site.bio_intro || "",
  locationNote: site.location_note || "",
  whatIDo: (Array.isArray(whatIDo) ? whatIDo : [])
    .map((item) => (typeof item === "string" ? item : ""))
    .filter(Boolean)
    .map((item) => ({ item })),
  portrait: portrait ? rememberMedia(portrait) : "",
  education: components(
    "site_settings",
    site.id,
    "education",
    "about.education-item",
  ).map((item) => ({
    institution: item.institution || "",
    program: item.program || "",
    years: item.years || "",
  })),
  awards: components("site_settings", site.id, "awards", "about.award-item").map(
    (item) => ({
      title: item.title || "",
      year: item.year || "",
      organization: item.organization || "",
    }),
  ),
  socialLinks: components(
    "site_settings",
    site.id,
    "socialLinks",
    "shared.social-link",
  ).map((item) => ({
    platform: item.platform || "other",
    url: item.url || "",
    label: item.label || "",
  })),
  internships: components(
    "site_settings",
    site.id,
    "internships",
    "shared.link",
  ).map((item) => ({
    label: item.label || "",
    url: item.url || "",
  })),
};

writeJson(path.join(root, "content/site.json"), siteJson);
writeJson(path.join(root, "content/categories.json"), categories);
writeJson(path.join(root, "content/tags.json"), tags);
writeJson(path.join(root, "content/media-formats.json"), mediaFormats);

console.log(
  `Exported ${projects.length} projects, ${categories.length} categories, ${tags.length} tags, ${Object.keys(mediaFormats).length} responsive images.`,
);
console.log("This replaced content/*.json. Browser edits are the copy that gets published.");
