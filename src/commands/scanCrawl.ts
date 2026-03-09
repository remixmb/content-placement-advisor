import path from 'node:path';
import { promises as fs } from 'node:fs';
import fg from 'fast-glob';
import minimist from 'minimist';
import { load as loadHtml } from 'cheerio';
import type {
  DatasetMetadata,
  PlacementsDataset,
  PlacementLocationContext,
  PlacementRecord,
  ViewsDataset,
  ViewDisplayDefinition,
} from '../types.js';
import { readJsonFile, writeJsonFile, pathExists } from '../lib/fs.js';
import {
  DEFAULT_CRAWL_HTML_SUBDIR,
  PLACEMENTS_OUTPUT,
  PROJECT_ROOT,
  VIEWS_OUTPUT,
  findLatestCrawlHtmlDir,
  resolveFromRoot,
} from '../lib/env.js';
import { toKebabCase } from '../lib/stringUtils.js';
import { normalizeUrl } from '../lib/url.js';
import { loadViewArgsContext } from '../lib/viewArgsParser.js';

interface ViewsIndex {
  viewClassMap: Map<string, string>;
  displayClassMap: Map<string, Map<string, string>>;
}

interface DrupalViewInstance {
  viewDomId?: string;
  viewId?: string;
  displayId?: string;
  rawArgs?: string;
  argumentList: string[];
}

interface DrupalViewInstanceMaps {
  byDomId: Map<string, DrupalViewInstance>;
  byViewKey: Map<string, DrupalViewInstance[]>;
}

async function resolveCrawlHtmlDir(input?: string): Promise<string> {
  if (input) {
    const resolved = resolveFromRoot(input);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error(`Crawl path "${input}" is not a directory.`);
    }
    if (path.basename(resolved) === DEFAULT_CRAWL_HTML_SUBDIR) {
      return resolved;
    }
    const pageSource = path.join(resolved, DEFAULT_CRAWL_HTML_SUBDIR);
    if (await pathExists(pageSource)) {
      return pageSource;
    }
    return resolved;
  }

  const detected = await findLatestCrawlHtmlDir();
  if (!detected) {
    throw new Error(
      `Unable to find a crawl directory automatically. Pass --crawl-dir to point at the Screaming Frog export.`,
    );
  }
  return detected;
}

function buildViewsIndex(views: ViewDisplayDefinition[]): ViewsIndex {
  const viewClassMap = new Map<string, string>();
  const displayClassMap = new Map<string, Map<string, string>>();

  for (const definition of views) {
    const viewClass = `view--${toKebabCase(definition.viewId)}`;
    viewClassMap.set(viewClass, definition.viewId);

    const displayMap = displayClassMap.get(definition.viewId) ?? new Map<string, string>();
    const displayClass = `view--${toKebabCase(definition.displayId)}`;
    displayMap.set(displayClass, definition.displayId);
    displayClassMap.set(definition.viewId, displayMap);
  }

  return { viewClassMap, displayClassMap };
}

function inferUrlFromFilename(filePath: string): string | null {
  const basename = path.basename(filePath, path.extname(filePath));
  if (!basename.startsWith('original_')) {
    return null;
  }
  const remainder = basename.replace(/^original_/, '');
  const segments = remainder.split('_');
  if (segments.length < 2) {
    return null;
  }
  const protocol = segments.shift();
  const host = segments.shift();
  const route = segments.join('/').replace(/\/\/+/g, '/');
  if (!protocol || !host) {
    return null;
  }
  return `${protocol}://${host}/${route}`;
}

function ensureAbsoluteUrl(rawUrl: string, fallbackBase?: string): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  if (rawUrl.startsWith('//')) {
    return `https:${rawUrl}`;
  }
  if (fallbackBase && /^https?:\/\//i.test(fallbackBase)) {
    const base = new URL(fallbackBase);
    return new URL(rawUrl, `${base.protocol}//${base.host}`).toString();
  }
  const defaultBase = 'https://som.yale.edu';
  return new URL(rawUrl, defaultBase).toString();
}

function cloneContext(context?: PlacementLocationContext): PlacementLocationContext | undefined {
  if (!context) {
    return undefined;
  }
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(context);
  }
  return JSON.parse(JSON.stringify(context)) as PlacementLocationContext;
}

function collectDrupalViewInstances($: ReturnType<typeof loadHtml>): DrupalViewInstanceMaps {
  const byDomId = new Map<string, DrupalViewInstance>();
  const byViewKey = new Map<string, DrupalViewInstance[]>();

  $('script[type="application/json"][data-drupal-selector="drupal-settings-json"]').each((_, element) => {
    const text = $(element).text();
    if (!text) {
      return;
    }
    try {
      const settings = JSON.parse(text);
      const ajaxViews = settings?.views?.ajaxViews;
      if (!ajaxViews || typeof ajaxViews !== 'object') {
        return;
      }
      for (const [key, value] of Object.entries(ajaxViews)) {
        if (!value || typeof value !== 'object') {
          continue;
        }
        const viewId = typeof value.view_name === 'string' ? value.view_name : undefined;
        const displayId = typeof value.view_display_id === 'string' ? value.view_display_id : undefined;
        const rawArgs = typeof value.view_args === 'string' ? value.view_args : '';
        const argumentList = rawArgs ? rawArgs.split('/').filter((segment: string) => segment.length > 0) : [];
        const domIdFromKey = key.includes(':') ? key.split(':')[1] : undefined;
        const viewDomId =
          typeof value.view_dom_id === 'string'
            ? value.view_dom_id
            : typeof domIdFromKey === 'string'
              ? domIdFromKey
              : undefined;
        const instance: DrupalViewInstance = {
          viewDomId,
          viewId,
          displayId,
          rawArgs,
          argumentList,
        };
        if (viewDomId) {
          byDomId.set(viewDomId, instance);
        }
        if (viewId && displayId) {
          const compositeKey = `${viewId}::${displayId}`;
          const list = byViewKey.get(compositeKey) ?? [];
          list.push(instance);
          byViewKey.set(compositeKey, list);
        }
      }
    } catch {
      // Ignore malformed Drupal settings blobs.
    }
  });

  return { byDomId, byViewKey };
}

async function collectPlacements(
  htmlFile: string,
  index: ViewsIndex,
  seenKeys: Set<string>,
  contextMap?: Map<string, PlacementLocationContext>,
): Promise<PlacementRecord[]> {
  const raw = await fs.readFile(htmlFile, 'utf8');
  const $ = loadHtml(raw);
  const viewInstances = collectDrupalViewInstances($);

  const canonicalAttr = $('link[rel="canonical"]').attr('href') ?? '';
  const inferred = inferUrlFromFilename(htmlFile) ?? '';
  const canonical = canonicalAttr || inferred;
  if (!canonical) {
    return [];
  }
  const absoluteUrl = ensureAbsoluteUrl(canonical, inferred);
  const normalizedUrl = normalizeUrl(absoluteUrl);
  const pageContext = contextMap?.get(normalizedUrl.url);
  const placements: PlacementRecord[] = [];

  const viewScope = $('main');
  if (viewScope.length === 0) {
    return [];
  }

  viewScope.find('.view').each((_, element) => {
    const wrappedByModal = $(element).closest('details.som-modal__details, .som-modal__expandable, .som-modal')
      .length > 0;
    if (wrappedByModal) {
      return;
    }
    const classAttr = ($(element).attr('class') ?? '').trim();
    if (!classAttr) {
      return;
    }
    const classes = classAttr.split(/\s+/);
    const viewDomIdClass = classes.find((cls) => cls.startsWith('js-view-dom-id-'));
    const viewDomId = viewDomIdClass ? viewDomIdClass.replace('js-view-dom-id-', '') : undefined;
    const viewClass = classes.find((cls) => index.viewClassMap.has(cls));
    if (!viewClass) {
      return;
    }
    const viewId = index.viewClassMap.get(viewClass)!;
    const displayMap = index.displayClassMap.get(viewId);
    if (!displayMap) {
      return;
    }
    const displayClass = classes.find((cls) => displayMap.has(cls));
    if (!displayClass) {
      return;
    }
    const displayId = displayMap.get(displayClass)!;
    const dedupeKey = `${normalizedUrl.path}|${viewId}|${displayId}`;
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    let context = cloneContext(pageContext);
    const instance =
      (viewDomId ? viewInstances.byDomId.get(viewDomId) : undefined) ??
      viewInstances.byViewKey.get(`${viewId}::${displayId}`)?.[0];
    if (instance && (instance.rawArgs || instance.argumentList.length)) {
      const detail = {
        viewDomId: instance.viewDomId,
        viewId: instance.viewId,
        display: instance.displayId,
        viewDisplayId: instance.displayId,
        rawArgs: instance.rawArgs,
        argumentList: instance.argumentList,
      };
      if (context) {
        context.viewArguments = [...(context.viewArguments ?? []), detail];
      } else {
        context = { viewArguments: [detail] };
      }
    }
    placements.push({
      viewId,
      displayId,
      page: normalizedUrl.path,
      url: normalizedUrl.url,
      htmlFile: path.relative(PROJECT_ROOT, htmlFile),
      viewDomId,
      domId: $(element).attr('id') ?? undefined,
      context,
    });
  });

  return placements;
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    string: ['crawl-dir', 'output', 'views', 'view-args'],
    alias: { c: 'crawl-dir', o: 'output', v: 'views' },
  });

  const crawlHtmlDir = await resolveCrawlHtmlDir(args['crawl-dir']);
  const crawlRoot =
    path.basename(crawlHtmlDir) === DEFAULT_CRAWL_HTML_SUBDIR ? path.dirname(crawlHtmlDir) : crawlHtmlDir;
  const viewsPath = resolveFromRoot(args.views ?? VIEWS_OUTPUT);
  const outputPath = resolveFromRoot(args.output ?? PLACEMENTS_OUTPUT);
  const viewArgsPath = args['view-args']
    ? resolveFromRoot(args['view-args'])
    : path.join(crawlRoot, 'crawl_with_view_args.csv');

  if (!(await pathExists(viewsPath))) {
    throw new Error(`Views dataset not found at ${viewsPath}. Run "npm run extract-views" first.`);
  }

  const viewsDataset = await readJsonFile<DatasetMetadata<ViewsDataset>>(viewsPath);
  const index = buildViewsIndex(viewsDataset.data.views);
  const htmlFiles = await fg(['**/*.html'], { cwd: crawlHtmlDir, absolute: true });

  if (htmlFiles.length === 0) {
    throw new Error(`No HTML files found under ${crawlHtmlDir}.`);
  }

  const seenKeys = new Set<string>();
  const placements: PlacementRecord[] = [];
  let contextMap: Map<string, PlacementLocationContext> | undefined;
  if (await pathExists(viewArgsPath)) {
    contextMap = await loadViewArgsContext(viewArgsPath);
  } else {
    console.warn(`[scan-crawl] View args CSV not found at ${path.relative(PROJECT_ROOT, viewArgsPath)}. Skipping.`);
  }

  for (const file of htmlFiles) {
    const records = await collectPlacements(file, index, seenKeys, contextMap);
    placements.push(...records);
  }

  const dataset: DatasetMetadata<PlacementsDataset> = {
    generatedAt: new Date().toISOString(),
    note: `Source: ${path.relative(PROJECT_ROOT, crawlHtmlDir)}`,
    data: {
      crawlSource: path.relative(PROJECT_ROOT, crawlHtmlDir),
      totalPagesScanned: htmlFiles.length,
      placements,
    },
  };

  await writeJsonFile(outputPath, dataset);
  console.log(
    `Detected ${placements.length} placements across ${htmlFiles.length} pages -> ${path.relative(
      PROJECT_ROOT,
      outputPath,
    )}`,
  );
}

main().catch((error) => {
  console.error('[scan-crawl] ERROR:', error);
  process.exitCode = 1;
});
