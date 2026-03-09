import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { pathExists } from './fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_VIEWS_GLOB = 'config/sync/views.view.*.yml';
export const DEFAULT_CRAWL_DIR_PREFIX = 'Crawl ';
export const DEFAULT_CRAWL_HTML_SUBDIR = 'page_source';
export const VIEWS_OUTPUT = path.join(PROJECT_ROOT, 'views.json');
export const PLACEMENTS_OUTPUT = path.join(PROJECT_ROOT, 'placements.json');
export const PLACEMENT_MAP_OUTPUT = path.join(PROJECT_ROOT, 'placement-map.json');
export const CONTENT_TAXONOMIES_OUTPUT = path.join(PROJECT_ROOT, 'content-taxonomies.json');

export function resolveFromRoot(candidate: string): string {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.join(PROJECT_ROOT, candidate);
}

export async function findLatestCrawlHtmlDir(): Promise<string | null> {
  const entries = await fs.readdir(PROJECT_ROOT, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(DEFAULT_CRAWL_DIR_PREFIX))
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const candidate of candidates) {
    const htmlDir = path.join(PROJECT_ROOT, candidate.name, DEFAULT_CRAWL_HTML_SUBDIR);
    if (await pathExists(htmlDir)) {
      return htmlDir;
    }
  }

  return null;
}
