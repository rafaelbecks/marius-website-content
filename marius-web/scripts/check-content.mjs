#!/usr/bin/env node
/**
 * Fail the build when editorial content points at a missing upload.
 * Runs before `next build` so a bad save is not published.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.resolve(webRoot, "../content");
const publicDir = path.resolve(webRoot, "public");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function pathsFrom(value, into) {
  if (!value) return;
  if (typeof value === "string") {
    if (value.startsWith("/uploads/")) into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pathsFrom(item, into);
    return;
  }
  if (typeof value === "object") {
    for (const key of ["image", "file", "url", "src"]) {
      if (typeof value[key] === "string") pathsFrom(value[key], into);
    }
  }
}

const missing = [];
const slugs = new Set();
const projectFiles = readdirSync(path.join(contentDir, "projects")).filter((name) =>
  name.endsWith(".json"),
);

if (projectFiles.length < 1) {
  console.error("No project files in content/projects.");
  process.exit(1);
}

for (const name of projectFiles) {
  const project = readJson(path.join(contentDir, "projects", name));
  const slug = (project.slug || name.replace(/\.json$/, "")).trim();
  if (slugs.has(slug)) {
    console.error(`Duplicate project slug: ${slug}`);
    process.exit(1);
  }
  slugs.add(slug);
  if (!project.title) {
    console.error(`Project ${name} is missing a title.`);
    process.exit(1);
  }

  const urls = [];
  pathsFrom(project.coverImage, urls);
  pathsFrom(project.gallery, urls);
  pathsFrom(project.audioFiles, urls);
  for (const url of urls) {
    const file = path.join(publicDir, url.replace(/^\//, ""));
    if (!existsSync(file)) missing.push(`${slug}: ${url}`);
  }
}

const site = readJson(path.join(contentDir, "site.json"));
const portrait = [];
pathsFrom(site.portrait, portrait);
for (const url of portrait) {
  const file = path.join(publicDir, url.replace(/^\//, ""));
  if (!existsSync(file)) missing.push(`site: ${url}`);
}

if (missing.length) {
  console.error(`Content references ${missing.length} missing file(s):`);
  for (const line of missing.slice(0, 20)) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Content ok: ${projectFiles.length} projects, media files present.`);
