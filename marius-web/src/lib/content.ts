import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  Category,
  EducationItem,
  ExternalLink,
  Project,
  SiteSetting,
  SocialLink,
  StrapiMedia,
  Tag,
} from "./types";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

type FormatMap = Record<
  string,
  {
    thumbnail?: { url: string; width?: number | null; height?: number | null };
    small?: { url: string; width?: number | null; height?: number | null };
    medium?: { url: string; width?: number | null; height?: number | null };
    large?: { url: string; width?: number | null; height?: number | null };
  }
>;

type Store = {
  site: SiteSetting | null;
  categories: Category[];
  tags: Tag[];
  projects: Project[];
};

let store: Store | null = null;

function contentDir(): string {
  return path.resolve(process.cwd(), "../content");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed || null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function namedList(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      items.push(entry.trim());
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const candidate = record[key] ?? record.item ?? record.tag ?? record.name;
    if (typeof candidate === "string" && candidate.trim()) {
      items.push(candidate.trim());
    }
  }
  return items;
}

function mediaFromPath(url: string, formats: FormatMap, alt?: string): StrapiMedia | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const ext = path.extname(trimmed.split("?")[0] || "").toLowerCase();
  return {
    id: 0,
    url: trimmed,
    alternativeText: alt?.trim() || null,
    name: path.basename(trimmed),
    mime: MIME_BY_EXT[ext],
    ext: ext || undefined,
    formats: formats[trimmed],
  };
}

function mediaValue(value: unknown, formats: FormatMap): StrapiMedia | null {
  if (typeof value === "string") return mediaFromPath(value, formats);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url = record.image ?? record.file ?? record.url ?? record.src;
  if (typeof url !== "string") return null;
  const alt = typeof record.alt === "string" ? record.alt : undefined;
  return mediaFromPath(url, formats, alt);
}

function mediaList(value: unknown, formats: FormatMap): StrapiMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => mediaValue(item, formats))
    .filter((item): item is StrapiMedia => Boolean(item));
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadStore(): Store {
  if (store && process.env.NODE_ENV !== "development") return store;

  const dir = contentDir();
  const formats = readJson<FormatMap>(path.join(dir, "media-formats.json"));
  const categoryRows = readJson<
    Array<{
      name: string;
      slug: string;
      description?: string;
      sortOrder?: number;
      isPrimaryNav?: boolean;
    }>
  >(path.join(dir, "categories.json"));
  const tagRows = readJson<Array<{ name: string; slug: string }>>(
    path.join(dir, "tags.json"),
  );

  const categories: Category[] = categoryRows
    .filter((category) => category.isPrimaryNav !== false)
    .map((category, index) => ({
      id: index + 1,
      documentId: category.slug,
      name: category.name,
      slug: category.slug,
      description: category.description || null,
      sortOrder: category.sortOrder ?? index,
      isPrimaryNav: category.isPrimaryNav !== false,
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const tagsBySlug = new Map<string, Tag>();
  tagRows.forEach((tag, index) => {
    tagsBySlug.set(tag.slug, {
      id: index + 1,
      documentId: tag.slug,
      name: tag.name,
      slug: tag.slug,
    });
  });

  const categoryByName = new Map(
    categories.map((category) => [category.name.toLowerCase(), category]),
  );

  const siteRaw = readJson<Record<string, unknown>>(path.join(dir, "site.json"));
  const site: SiteSetting = {
    id: 1,
    documentId: "site",
    siteName: text(siteRaw.siteName) || "Marius Varhaugvik",
    tagline: optionalText(siteRaw.tagline),
    email: optionalText(siteRaw.email),
    phone: optionalText(siteRaw.phone),
    bioIntro: optionalText(siteRaw.bioIntro),
    locationNote: optionalText(siteRaw.locationNote),
    whatIDo: namedList(siteRaw.whatIDo, "item"),
    portrait: mediaValue(siteRaw.portrait, formats),
    education: Array.isArray(siteRaw.education)
      ? (siteRaw.education as EducationItem[])
      : [],
    awards: Array.isArray(siteRaw.awards)
      ? (siteRaw.awards as SiteSetting["awards"])
      : [],
    socialLinks: Array.isArray(siteRaw.socialLinks)
      ? (siteRaw.socialLinks as SocialLink[])
      : [],
    internships: Array.isArray(siteRaw.internships)
      ? (siteRaw.internships as ExternalLink[])
      : [],
  };

  const projectsDir = path.join(dir, "projects");
  const projects: Project[] = readdirSync(projectsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const raw = readJson<Record<string, unknown>>(path.join(projectsDir, name));
      if (raw.published === false) return null;

      const title = text(raw.title) || path.basename(name, ".json");
      const slug = text(raw.slug) || path.basename(name, ".json");
      const categoryName = text(raw.category);
      const tagNames = namedList(raw.tags, "tag");
      const tags = tagNames.map((tagName, index) => {
        const slugValue = slugify(tagName);
        const known = tagsBySlug.get(slugValue);
        if (known) return known;
        return {
          id: 1000 + index,
          documentId: slugValue || `tag-${index}`,
          name: tagName,
          slug: slugValue || `tag-${index}`,
        };
      });

      const project: Project = {
        id: 0,
        documentId: slug,
        title,
        slug,
        role: optionalText(raw.role),
        venue: optionalText(raw.venue),
        collaborators: optionalText(raw.collaborators),
        year: optionalNumber(raw.year),
        summary: optionalText(raw.summary),
        body: typeof raw.body === "string" ? raw.body : raw.body,
        embedUrl: optionalText(raw.embedUrl),
        sortOrder: optionalNumber(raw.sortOrder) ?? 0,
        coverImage: mediaValue(raw.coverImage, formats),
        gallery: mediaList(raw.gallery, formats),
        audioFiles: mediaList(raw.audioFiles, formats),
        externalLinks: Array.isArray(raw.externalLinks)
          ? (raw.externalLinks as ExternalLink[]).filter(
              (link) => link && (link.label || link.url),
            )
          : [],
        category: categoryName
          ? categoryByName.get(categoryName.toLowerCase()) || {
              id: 0,
              documentId: slugify(categoryName),
              name: categoryName,
              slug: slugify(categoryName),
              isPrimaryNav: true,
            }
          : null,
        tags,
      };
      return project;
    })
    .filter((project): project is Project => Boolean(project))
    .sort((a, b) => {
      const yearA = a.year ?? Number.NEGATIVE_INFINITY;
      const yearB = b.year ?? Number.NEGATIVE_INFINITY;
      if (yearA !== yearB) return yearB - yearA;
      const sortA = a.sortOrder ?? 0;
      const sortB = b.sortOrder ?? 0;
      if (sortA !== sortB) return sortA - sortB;
      return a.title.localeCompare(b.title, "sv");
    });

  store = { site, categories, tags: [...tagsBySlug.values()], projects };
  return store;
}

export async function getSiteSetting(): Promise<SiteSetting | null> {
  return loadStore().site;
}

export async function getCategories(): Promise<Category[]> {
  return loadStore().categories;
}

export async function getTags(): Promise<Tag[]> {
  return loadStore().tags;
}

export async function getProjects(): Promise<Project[]> {
  return loadStore().projects;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  return loadStore().projects.find((project) => project.slug === slug) || null;
}

/** Flatten a markdown/plain body or Strapi Blocks into paragraphs. */
export function blocksToPlainText(blocks: unknown): string[] {
  if (typeof blocks === "string") {
    const trimmed = blocks.trim();
    if (!trimmed) return [];
    const chunks = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    if (chunks.length > 1) return chunks;
    return trimmed
      .split(/\n/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(blocks)) return [];

  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const entry = block as { type?: string; children?: Array<{ text?: string }> };
    if (entry.type === "paragraph" || entry.type === "heading") {
      const paragraph = (entry.children || [])
        .map((child) => child.text || "")
        .join("")
        .trim();
      if (paragraph) paragraphs.push(paragraph);
    }
  }
  return paragraphs;
}
