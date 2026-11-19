# Marius Varhaugvik — CMS + portfolio site

WordPress → Strapi content, with a static Next.js frontend.

| Path | Contents |
|---|---|
| `marius-cms/` | Strapi 5 archive (SQLite). Not what the public site reads. |
| `content/` | The editable copy of the site: one JSON file per project, plus About. |
| `marius-web/` | Static Next.js site. Builds from `content/` and `public/uploads`. |
| `Web_Marius_Original/` | WordPress XML + original media export |

Large media uses **Git LFS** (upload MP3s + original export WAVs).

## Prerequisites

1. **Git** + **Git LFS**
2. **Node.js 20.x or 22–24 LTS** (`marius-cms/.nvmrc`)
3. **FFmpeg** (optional — only for re-converting audio)

```bash
# macOS
brew install ffmpeg

# Windows
winget install --id Gyan.FFmpeg.Essentials -e
```

## Setup

```bash
git clone https://github.com/rafaelbecks/marius-website-content.git
cd marius-website
git lfs install
git lfs pull

# CMS
cd marius-cms
cp .env.example .env   # then generate real secrets (see below)
nvm use                # or: nvm use 20.19.4
npm install
npm run develop
```

CMS admin: http://localhost:1337/admin  
(Create the first admin user on first boot if prompted.)

```bash
# Frontend (reads content/, Strapi does not need to be running)
cd marius-web
npm install
npm run dev
```

Site: http://localhost:3000

### Strapi `.env` secrets

Do not commit `.env`. Generate values:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"  # APP_KEYS ×4
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"  # other secrets
```

Required keys (see `marius-cms/.env.example`):

`HOST`, `PORT`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY`

### Frontend env

The site reads `content/` from disk. `STRAPI_URL` is unused by the static build.

`NEXT_PUBLIC_STRAPI_URL` is still prefixed onto image and audio paths when it is a public URL. `npm run build:static` sets it empty, so media stays `/uploads/...`, and then checks the export for `localhost`.

```bash
cd marius-web
npm run build:static
```

## Daily commands

| Command | Where | Purpose |
|---|---|---|
| `npm run develop` | `marius-cms` | Strapi admin + API |
| `npm run dev` | `marius-web` | Next.js portfolio |
| `npm run build:static` | `marius-web` | Build the static site from `content/` and check media URLs |
| `npm run export:content` | `marius-cms` | Overwrite `content/` from SQLite. Replaces browser edits. |

## Editing the live site

Marius edits in the browser. Saving commits JSON (and any new images or audio) to [rafaelbecks/marius-website-content](https://github.com/rafaelbecks/marius-website-content). GitHub Actions then builds the static site and pushes it to [rafaelbecks/marius-website](https://github.com/rafaelbecks/marius-website), which Netlify already deploys. The public site updates a few minutes after the save, not the moment he clicks save.

The editor is [https://mariusvarhaugvik.com/admin](https://mariusvarhaugvik.com/admin) once this has been published. Until then it is `marius-web/public/admin` in a local build.

Sign-in is a GitHub personal access token, pasted once in that browser:

1. On your account, create a fine-grained token. Resource owner: `rafaelbecks`. Repository: only `marius-website-content`. Permission: **Contents → Read and write**.
2. Send him that token. He opens `/admin`, chooses **Sign in with token**, and pastes it once. It stays in that browser.

He can change projects and the About page, upload images, and upload audio. Turning **Published** off hides a project on the next build. New images and audio land in `marius-web/public/uploads` and are served as `/uploads/...`.

One secret has to exist on `rafaelbecks/marius-website-content` before the pipeline can update Netlify:

- Name: `STATIC_DEPLOY_TOKEN`
- Value: a fine-grained PAT from an account that can push to `rafaelbecks/marius-website`, with **Contents: Read and write** on that repo only.

Without that secret the workflow builds the site and then stops, so Netlify is left unchanged.

`content/` is the copy the site is built from. Strapi remains the local archive. `npm run export:content` rewrites `content/` from SQLite and will replace anything saved in the browser.

## Deploying to Netlify (static)

The frontend is a static export (`output: "export"` in `next.config.ts`). `npm run build:static` reads `content/*.json` and copies `marius-web/public/uploads` into the export. Strapi does not need to be running.

**What gets deployed:** `marius-web/out/`, pushed by `.github/workflows/publish-site.yml` into the static repo. Netlify publishes that repo as it does today (`publish = "."`). `deploy/netlify.toml` is copied in so redirects and cache headers stay with the export.

### Media URLs (must be relative)

After a correct static build, images and audio look like:

```
/uploads/medium_example.jpg
/uploads/track_abc123.mp3
```

**Wrong** (broken on Netlify / any other machine):

```
http://localhost:1337/uploads/medium_example.jpg
```

If you see localhost in the deployed site: rebuild with `npm run build:static`, confirm `node scripts/verify-static-urls.mjs` passes, then redeploy `out/`.

### Local static build

```bash
cd marius-web
npm run build:static
```

That writes `marius-web/out/`. The GitHub workflow is what publishes it. A local build is only for checking the result before it goes out.

### What is on the public site

| On the static site | Stays in this repo |
|---|---|
| Project pages, about page, filters | Strapi and `data.db` |
| Images and audio under `/uploads/` | The editor commits into `content/` and `public/uploads` |
| `/admin` (the editor shell) | GitHub Action that rebuilds after a save |

## Content / media notes

- The published portfolio lives in `content/` (tracked in git). SQLite at `marius-cms/.tmp/data.db` is the archive it was exported from.
- Uploaded media lives in `marius-cms/public/uploads/` (MP3 audio via LFS).
- Site Setting holds About copy, contact, and portrait.
- Work pages filter by category; project pages include gallery + audio.

### Optional: re-convert upload audio WAV → MP3

Stop Strapi first (SQLite lock), then:

```bash
cd marius-cms
npm run convert:uploads:mp3
```

Uses ffmpeg **320 kbps** MP3 and updates SQLite file URLs in place.

### Optional: WordPress import / AAC pipeline

See older helpers in `marius-cms/scripts/` (`parse:wp`, `import:wp`, `convert:audio`). Only needed if re-importing from the WordPress export.

## Troubleshooting

| Problem | Fix |
|---|---|
| Tiny audio / media files | `git lfs pull` |
| `better-sqlite3` build errors | Use Node 20/24 (`nvm use`) |
| DB locked | Stop `npm run develop`, then run scripts |
| About image / content missing on site | Check `content/site.json` and that the portrait file is in `marius-web/public/uploads` |
| Images/audio point at `localhost:1337` on Netlify | Rebuild with `npm run build:static` (not `npm run build`); verify with `node scripts/verify-static-urls.mjs` |
| `ffmpeg not found` | Install FFmpeg (above) |
