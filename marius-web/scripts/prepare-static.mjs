#!/usr/bin/env node
/**
 * Legacy helper. The publish build no longer copies or deletes uploads.
 * Media edited in the browser is committed straight into marius-web/public/uploads.
 *
 * This only fills in files that exist in the Strapi folder and are missing
 * from the web folder. It never deletes.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadsSrc = path.resolve(root, "../marius-cms/public/uploads");
const uploadsDest = path.resolve(root, "public/uploads");

if (!existsSync(uploadsSrc)) {
  console.error(`Missing uploads folder: ${uploadsSrc}`);
  process.exit(1);
}

mkdirSync(uploadsDest, { recursive: true });

let copied = 0;
function copyMissing(srcDir, destDir) {
  for (const name of readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    if (statSync(src).isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyMissing(src, dest);
      continue;
    }
    if (existsSync(dest)) continue;
    cpSync(src, dest);
    copied += 1;
  }
}

copyMissing(uploadsSrc, uploadsDest);
console.log(`Added ${copied} missing upload(s) into public/uploads. Existing files were left in place.`);
