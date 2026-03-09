import path from 'node:path';
import minimist from 'minimist';
import fg from 'fast-glob';
import { load as loadYaml } from 'js-yaml';
import { parse } from 'csv-parse/sync';
import type {
  ContentTaxonomyDataset,
  DatasetMetadata,
  PlacementMapDataset,
  PlacementMapEntry,
  PlacementLocationContext,
  SurfaceContext,
  PlacementsDataset,
  ViewsDataset,
  ViewDisplayDefinition,
} from '../types.js';
import { pathExists, readJsonFile, writeJsonFile } from '../lib/fs.js';
import {
  CONTENT_TAXONOMIES_OUTPUT,
  PLACEMENT_MAP_OUTPUT,
  PLACEMENTS_OUTPUT,
  PROJECT_ROOT,
  VIEWS_OUTPUT,
  resolveFromRoot,
} from '../lib/env.js';
import {
  annotateViewArgument,
  buildSyntheticViewArgument,
  loadViewArgumentRegistry,
  type RegistryEntry,
  type TaxonomyHelpers,
} from '../lib/viewArgumentRegistry.js';

interface PlacementAccumulator {
  base: ViewDisplayDefinition;
  pages: Set<string>;
  urls: Set<string>;
  locations: Map<string, { page: string; url: string; context?: PlacementLocationContext }>;
}

interface RawCsvRecord {
  [key: string]: string;
}

interface ContextConfigFile {
  name?: string;
  label?: string;
  group?: string;
  conditions?: {
    request_path?: {
      pages?: string;
    };
    'entity_bundle:node'?: {
      bundles?: Record<string, string>;
    };
    som_primary_context_term?: {
      tid?: Array<{ target_id?: string }>;
    };
  };
}

interface SectionRoot {
  bundle: 'program' | 'center';
  termId: string;
  path: string;
}

interface SectionPathRule {
  label: string;
  paths: string[];
  argumentsByContentType: Map<
    string,
    PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never
  >;
}

interface ManualSectionPathOverride {
  label: string;
  paths: string[];
  termsByContentType: Record<string, { dimension: string; values: string[] }>;
}

const SECTION_PATH_OVERRIDES_PATH = resolveFromRoot(
  'docs/placement-registry/section-path-overrides.json',
);

function buildSurfaceKey(url: string, viewId: string, displayId: string): string {
  return `${url}::${viewId}::${displayId}`;
}

function isSearchDisplay(view: ViewDisplayDefinition): boolean {
  const haystack = [
    view.viewId,
    view.viewLabel,
    view.displayId,
    view.displayTitle,
    view.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /\bsearch\b/.test(haystack);
}

async function loadTaxonomyHelpers(taxonomyPath?: string): Promise<TaxonomyHelpers> {
  const termsById = new Map<string, { label: string; vocabulary: string; parent?: string }>();
  const childrenById = new Map<string, string[]>();
  const candidates: string[] = [];
  if (taxonomyPath) {
    candidates.push(resolveFromRoot(taxonomyPath));
  }
  candidates.push(CONTENT_TAXONOMIES_OUTPUT);

  for (const candidate of candidates) {
    try {
      const dataset = await readJsonFile<DatasetMetadata<ContentTaxonomyDataset>>(candidate);
      for (const term of dataset.data.terms ?? []) {
        if (term.id) {
          termsById.set(term.id, { label: term.term, vocabulary: term.vocabulary, parent: term.parent });
          if (term.parent) {
            const children = childrenById.get(term.parent) ?? [];
            children.push(term.id);
            childrenById.set(term.parent, children);
          }
        }
      }
      if (termsById.size > 0) {
        return { termsById, childrenById };
      }
    } catch {
      // Ignore and try next candidate.
    }
  }

  if (!termsById.size) {
    console.warn('[build-placement-map] Taxonomy dictionary not found; contextual argument labels will be limited.');
  }
  return { termsById, childrenById };
}

async function loadSurfaceMetadata(): Promise<Map<string, SurfaceContext>> {
  const metadata = new Map<string, SurfaceContext>();
  const csvPath = resolveFromRoot('docs/placement-registry/views-reference-runtime-args-enriched.csv');
  if (!(await pathExists(csvPath))) {
    return metadata;
  }

  const buffer = await readJsonSafeCsv(csvPath);
  for (const record of buffer) {
    const pageUrl = record.page_url?.trim();
    const viewId = record.view_id?.trim();
    const displayId = record.display_id?.trim();
    const scope = record.content_scope?.trim();
    if (!pageUrl || !viewId || !displayId || scope !== 'main') {
      continue;
    }
    const key = buildSurfaceKey(pageUrl, viewId, displayId);
    const candidate: SurfaceContext = {
      contextLabel: record.context_label?.trim() || undefined,
      titleLabel: record.title_label?.trim() || undefined,
      titlePath: record.title_path?.trim() || undefined,
      sourceTable: record.table_source?.trim() || undefined,
      parentEntityId: record.parent_entity_id?.trim() || undefined,
    };
    const existing = metadata.get(key);
    if (!existing) {
      metadata.set(key, candidate);
      continue;
    }
    const existingScore = (existing.titleLabel ? 10 : 0) + (existing.titlePath ? 5 : 0);
    const candidateScore = (candidate.titleLabel ? 10 : 0) + (candidate.titlePath ? 5 : 0);
    if (candidateScore > existingScore) {
      metadata.set(key, candidate);
    }
  }
  return metadata;
}

function canonicalTermVocabulary(value?: string): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeContextLabel(value?: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/:\s*(content|submenu(?:\s+staged)?)$/, '')
    .replace(/\s+staged$/, '')
    .replace(/^program on\s+/, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitRequestPaths(pages?: string): string[] {
  return (pages ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\*+$/, '').trim())
    .filter(Boolean);
}

function createSectionArgument(
  viewId: string,
  displayId: string,
  dimension: string,
  values: string[],
  taxonomy: TaxonomyHelpers,
) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (!uniqueValues.length) {
    return undefined;
  }

  return {
    viewId,
    display: displayId,
    viewDisplayId: displayId,
    rawArgs: uniqueValues.join('+'),
    argumentList: [uniqueValues.join('+')],
    argumentDimensions: [dimension],
    argumentValueLabels: [
      uniqueValues.map((value) => {
        const term = taxonomy.termsById.get(value);
        return term ? `${term.label} (${value})` : value;
      }),
    ],
    argumentSlotOperators: [uniqueValues.length > 1 ? 'or' : 'single'],
    argumentSkipMatch: [false],
    argumentTerms: [
      uniqueValues.map((value) => {
        const term = taxonomy.termsById.get(value);
        return {
          value,
          label: term ? `${term.label} (${value})` : value,
          dimension,
        };
      }),
    ],
    source: 'section-context',
  };
}

async function loadSectionContextArguments(
  taxonomy: TaxonomyHelpers,
): Promise<Map<string, PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never>> {
  const sectionArguments = new Map<
    string,
    PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never
  >();
  const configPaths = await fg('config/sync/context.context.*content*.yml', {
    cwd: PROJECT_ROOT,
    absolute: true,
  });

  for (const configPath of configPaths) {
    let parsed: ContextConfigFile | undefined;
    try {
      const buffer = await (await import('node:fs/promises')).readFile(configPath, 'utf8');
      parsed = loadYaml(buffer) as ContextConfigFile;
    } catch {
      continue;
    }

    const termIds = (parsed?.conditions?.som_primary_context_term?.tid ?? [])
      .map((item) => `${item?.target_id ?? ''}`.trim())
      .filter(Boolean);
    if (!termIds.length) {
      continue;
    }

    const terms = termIds.map((termId) => ({
      id: termId,
      meta: taxonomy.termsById.get(termId),
    }));
    const contextIds = terms
      .filter((term) => canonicalTermVocabulary(term.meta?.vocabulary) === 'context')
      .map((term) => term.id);
    const programIds = terms
      .filter((term) => canonicalTermVocabulary(term.meta?.vocabulary) === 'program')
      .map((term) => term.id);

    for (const pageBundle of ['program', 'center'] as const) {
      const matchingPageTerms = terms
        .filter((term) => canonicalTermVocabulary(term.meta?.vocabulary) === pageBundle)
        .map((term) => term.id);
      for (const pageTermId of matchingPageTerms) {
        for (const contentType of ['story', 'event', 'course']) {
          const argument = createSectionArgument('', '', 'context', contextIds, taxonomy);
          if (argument) {
            sectionArguments.set(`${pageBundle}:${pageTermId}:${contentType}`, argument);
          }
        }
        if (pageBundle === 'program') {
          const profileArgument = createSectionArgument('', '', 'program', programIds, taxonomy);
          if (profileArgument) {
            sectionArguments.set(`${pageBundle}:${pageTermId}:profile`, profileArgument);
          }
        }
      }
    }
  }

  return sectionArguments;
}

function buildArgumentsByContentType(
  parsed: ContextConfigFile,
  taxonomy: TaxonomyHelpers,
): Map<string, PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never> {
  const argumentsByContentType = new Map<
    string,
    PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never
  >();
  const bundles = Object.keys(parsed.conditions?.['entity_bundle:node']?.bundles ?? {});
  const termIds = (parsed.conditions?.som_primary_context_term?.tid ?? [])
    .map((item) => `${item?.target_id ?? ''}`.trim())
    .filter(Boolean);
  if (!bundles.length || !termIds.length) {
    return argumentsByContentType;
  }

  const terms = termIds.map((termId) => ({
    id: termId,
    meta: taxonomy.termsById.get(termId),
  }));
  const contextIds = terms
    .filter((term) => canonicalTermVocabulary(term.meta?.vocabulary) === 'context')
    .map((term) => term.id);
  const programIds = terms
    .filter((term) => canonicalTermVocabulary(term.meta?.vocabulary) === 'program')
    .map((term) => term.id);
  const affiliationIds = terms
    .filter((term) => canonicalTermVocabulary(term.meta?.vocabulary) === 'affiliations')
    .map((term) => term.id);

  for (const bundle of bundles) {
    const contentType = bundle.toLowerCase();
    if (contentType === 'story' || contentType === 'event' || contentType === 'course') {
      const argument = createSectionArgument('', '', 'context', contextIds, taxonomy);
      if (argument) {
        argumentsByContentType.set(contentType, argument);
      }
      continue;
    }

    if (contentType === 'profile') {
      const programArgument = createSectionArgument('', '', 'program', programIds, taxonomy);
      if (programArgument) {
        argumentsByContentType.set(contentType, programArgument);
        continue;
      }
      const affiliationArgument = createSectionArgument('', '', 'affiliation', affiliationIds, taxonomy);
      if (affiliationArgument) {
        argumentsByContentType.set(contentType, affiliationArgument);
      }
    }
  }

  return argumentsByContentType;
}

async function loadSectionPathRules(taxonomy: TaxonomyHelpers): Promise<SectionPathRule[]> {
  const rules: SectionPathRule[] = [];
  const configPaths = await fg('config/sync/context.context.*.yml', {
    cwd: PROJECT_ROOT,
    absolute: true,
  });

  const contentConfigs: Array<{
    label: string;
    normalizedLabel: string;
    argumentsByContentType: SectionPathRule['argumentsByContentType'];
  }> = [];
  const pathConfigs: Array<{ label: string; normalizedLabel: string; paths: string[] }> = [];

  for (const configPath of configPaths) {
    let parsed: ContextConfigFile | undefined;
    try {
      const buffer = await (await import('node:fs/promises')).readFile(configPath, 'utf8');
      parsed = loadYaml(buffer) as ContextConfigFile;
    } catch {
      continue;
    }

    const label = `${parsed?.label ?? ''}`.trim();
    const normalizedLabel = normalizeContextLabel(label);
    if (!normalizedLabel) {
      continue;
    }

    const paths = splitRequestPaths(parsed?.conditions?.request_path?.pages);
    if (paths.length) {
      pathConfigs.push({ label, normalizedLabel, paths });
    }

    const argumentsByContentType = buildArgumentsByContentType(parsed ?? {}, taxonomy);
    if (argumentsByContentType.size) {
      contentConfigs.push({ label, normalizedLabel, argumentsByContentType });
    }
  }

  for (const pathConfig of pathConfigs) {
    const matches = contentConfigs
      .filter((candidate) => candidate.normalizedLabel === pathConfig.normalizedLabel)
      .sort((left, right) => right.argumentsByContentType.size - left.argumentsByContentType.size);
    const contentConfig = matches[0];
    if (!contentConfig) {
      continue;
    }
    rules.push({
      label: pathConfig.label,
      paths: pathConfig.paths,
      argumentsByContentType: contentConfig.argumentsByContentType,
    });
  }

  const overrideData = await loadSectionPathOverrides();
  for (const override of overrideData) {
    const argumentsByContentType = new Map<
      string,
      PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never
    >();
    for (const [contentType, config] of Object.entries(override.termsByContentType)) {
      const argument = createSectionArgument('', '', config.dimension, config.values, taxonomy);
      if (argument) {
        argumentsByContentType.set(contentType, {
          ...argument,
          source: 'manual-override',
        });
      }
    }
    if (!argumentsByContentType.size) {
      continue;
    }
    rules.push({
      label: override.label,
      paths: override.paths,
      argumentsByContentType,
    });
  }

  return rules.sort(
    (left, right) =>
      Math.max(...right.paths.map((item) => item.length)) - Math.max(...left.paths.map((item) => item.length)),
  );
}

async function loadSectionPathOverrides(): Promise<ManualSectionPathOverride[]> {
  if (!(await pathExists(SECTION_PATH_OVERRIDES_PATH))) {
    return [];
  }

  try {
    const overrides = await readJsonFile<ManualSectionPathOverride[]>(SECTION_PATH_OVERRIDES_PATH);
    return overrides.filter((override) => override?.paths?.length && override?.termsByContentType);
  } catch (error) {
    console.warn(
      `[build-placement-map] Unable to read section path overrides at ${path.relative(
        PROJECT_ROOT,
        SECTION_PATH_OVERRIDES_PATH,
      )}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function findSectionPathArgument(
  page: string,
  contentType: string,
  rules: SectionPathRule[],
): PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never | undefined {
  let bestMatch:
    | {
        pathLength: number;
        argument: PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never;
      }
    | undefined;

  for (const rule of rules) {
    const argument = rule.argumentsByContentType.get(contentType);
    if (!argument) {
      continue;
    }
    for (const candidatePath of rule.paths) {
      if (page === candidatePath || page.startsWith(`${candidatePath}/`)) {
        if (!bestMatch || candidatePath.length > bestMatch.pathLength) {
          bestMatch = {
            pathLength: candidatePath.length,
            argument,
          };
        }
      }
    }
  }

  return bestMatch?.argument;
}

function buildSectionRoots(placements: PlacementsDataset['placements']): SectionRoot[] {
  const roots = new Map<string, SectionRoot>();
  for (const placement of placements) {
    const pageBundle = placement.context?.pageEntity?.bundle;
    const pageEntityId = placement.context?.pageEntity?.id;
    if ((pageBundle !== 'program' && pageBundle !== 'center') || !pageEntityId || !placement.page) {
      continue;
    }
    const key = `${pageBundle}:${pageEntityId}`;
    const existing = roots.get(key);
    if (!existing || placement.page.length < existing.path.length) {
      roots.set(key, {
        bundle: pageBundle,
        termId: pageEntityId,
        path: placement.page,
      });
    }
  }
  return Array.from(roots.values()).sort((left, right) => right.path.length - left.path.length);
}

function findSectionRootForPage(page: string, roots: SectionRoot[]): SectionRoot | undefined {
  return roots.find((root) => page === root.path || page.startsWith(`${root.path}/`));
}

async function readJsonSafeCsv(csvPath: string): Promise<RawCsvRecord[]> {
  const buffer = await (await import('node:fs/promises')).readFile(csvPath, 'utf8');
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
  }) as RawCsvRecord[];
}

function annotatePlacementContext(
  context: PlacementLocationContext | undefined,
  page: string,
  placementViewId: string,
  placementDisplayId: string,
  contentTypes: string[],
  taxonomy: TaxonomyHelpers,
  registry: Map<string, RegistryEntry>,
  sectionContextArguments: Map<
    string,
    PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never
  >,
  sectionRoots: SectionRoot[],
  sectionPathRules: SectionPathRule[],
  surfaceContext?: SurfaceContext,
): PlacementLocationContext | undefined {
  if (!context && !surfaceContext) {
    return context;
  }

  const workingContext: PlacementLocationContext = context ? { ...context } : {};

  const viewArguments = (workingContext.viewArguments ?? []).map((argument) => {
    const viewId = argument.viewId ?? placementViewId;
    const displayId = argument.display ?? argument.viewDisplayId ?? placementDisplayId;
    const mapping = registry.get(`${viewId}::${displayId}`);
    return annotateViewArgument(
      {
        ...argument,
        viewId,
        display: displayId,
        viewDisplayId: displayId,
      },
      mapping,
      taxonomy,
    );
  });

  const currentKey = `${placementViewId}::${placementDisplayId}`;
  let hasCurrentArgument = viewArguments.some(
    (argument) =>
      (argument.viewId ?? placementViewId) === placementViewId &&
      (argument.display ?? argument.viewDisplayId ?? placementDisplayId) === placementDisplayId,
  );

  if (!hasCurrentArgument) {
    const synthetic = buildSyntheticViewArgument(
      placementViewId,
      placementDisplayId,
      registry.get(currentKey),
      context?.pageEntity,
      taxonomy,
    );
    if (synthetic) {
      viewArguments.push(synthetic);
      hasCurrentArgument = true;
    }
  }

  if (!hasCurrentArgument) {
    const pageBundle = context?.pageEntity?.bundle;
    const pageEntityId = context?.pageEntity?.id;
    const contentType = contentTypes[0]?.toLowerCase();
    if (pageBundle && pageEntityId && contentType) {
      const sectionArgument = sectionContextArguments.get(`${pageBundle}:${pageEntityId}:${contentType}`);
      if (sectionArgument) {
        viewArguments.push({
          ...sectionArgument,
          viewId: placementViewId,
          display: placementDisplayId,
          viewDisplayId: placementDisplayId,
        });
        hasCurrentArgument = true;
      }
    }
  }

  if (!hasCurrentArgument) {
    const pageBundle = context?.pageEntity?.bundle;
    const contentType = contentTypes[0]?.toLowerCase();
    if ((pageBundle === 'page' || pageBundle === 'landing_page') && contentType) {
      const sectionRoot = findSectionRootForPage(page, sectionRoots);
      if (sectionRoot) {
        const sectionArgument = sectionContextArguments.get(
          `${sectionRoot.bundle}:${sectionRoot.termId}:${contentType}`,
        );
        if (sectionArgument) {
          viewArguments.push({
            ...sectionArgument,
            viewId: placementViewId,
            display: placementDisplayId,
            viewDisplayId: placementDisplayId,
          });
        }
      }
    }
  }

  if (!hasCurrentArgument) {
    const pageBundle = context?.pageEntity?.bundle;
    const contentType = contentTypes[0]?.toLowerCase();
    if (
      contentType &&
      (pageBundle === 'page' ||
        pageBundle === 'landing_page' ||
        pageBundle === 'center' ||
        pageBundle === 'program')
    ) {
      const sectionArgument = findSectionPathArgument(page, contentType, sectionPathRules);
      if (sectionArgument) {
        viewArguments.push({
          ...sectionArgument,
          viewId: placementViewId,
          display: placementDisplayId,
          viewDisplayId: placementDisplayId,
        });
      }
    }
  }

  return {
    ...workingContext,
    viewArguments: viewArguments.length ? viewArguments : undefined,
    surfaceContext: surfaceContext ?? workingContext.surfaceContext,
  };
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    string: ['views', 'placements', 'output', 'taxonomy'],
    alias: { v: 'views', p: 'placements', o: 'output', t: 'taxonomy' },
  });

  const viewsPath = resolveFromRoot(args.views ?? VIEWS_OUTPUT);
  const placementsPath = resolveFromRoot(args.placements ?? PLACEMENTS_OUTPUT);
  const outputPath = resolveFromRoot(args.output ?? PLACEMENT_MAP_OUTPUT);

  const viewsDataset = await readJsonFile<DatasetMetadata<ViewsDataset>>(viewsPath);
  const placementsDataset = await readJsonFile<DatasetMetadata<PlacementsDataset>>(placementsPath);
  const taxonomy = await loadTaxonomyHelpers(args.taxonomy);
  const registry = await loadViewArgumentRegistry();
  const surfaceMetadata = await loadSurfaceMetadata();
  const sectionContextArguments = await loadSectionContextArguments(taxonomy);
  const sectionRoots = buildSectionRoots(placementsDataset.data.placements);
  const sectionPathRules = await loadSectionPathRules(taxonomy);

  const viewMap = new Map<string, ViewDisplayDefinition>();
  for (const view of viewsDataset.data.views) {
    if (isSearchDisplay(view)) {
      continue;
    }
    const key = `${view.viewId}::${view.displayId}`;
    viewMap.set(key, view);
  }

  const accumulators = new Map<string, PlacementAccumulator>();
  const orphanedPlacements: string[] = [];

  for (const placement of placementsDataset.data.placements) {
    const key = `${placement.viewId}::${placement.displayId}`;
    const base = viewMap.get(key);
    if (!base) {
      orphanedPlacements.push(key);
      continue;
    }
    let acc = accumulators.get(key);
    if (!acc) {
      acc = {
        base,
        pages: new Set<string>(),
        urls: new Set<string>(),
        locations: new Map(),
      };
      accumulators.set(key, acc);
    }
    acc.pages.add(placement.page);
    acc.urls.add(placement.url);
    const context = annotatePlacementContext(
      placement.context,
      placement.page,
      placement.viewId,
      placement.displayId,
      base.filters.contentTypes,
      taxonomy,
      registry,
      sectionContextArguments,
      sectionRoots,
      sectionPathRules,
      surfaceMetadata.get(buildSurfaceKey(placement.url, placement.viewId, placement.displayId)),
    );
    const locKey = `${placement.page}|${placement.url}`;
    const existingLocation = acc.locations.get(locKey);
    if (!existingLocation) {
      acc.locations.set(locKey, { page: placement.page, url: placement.url, context });
    } else if (!existingLocation.context && context) {
      existingLocation.context = context;
    }
  }

  const entries: PlacementMapEntry[] = Array.from(accumulators.values()).map((acc) => ({
    ...acc.base,
    pages: Array.from(acc.pages).sort(),
    urls: Array.from(acc.urls).sort(),
    locations: Array.from(acc.locations.values()).sort((a, b) => a.page.localeCompare(b.page)),
    placementSource: registry.get(`${acc.base.viewId}::${acc.base.displayId}`)?.placementSource,
    specificityWeight: registry.get(`${acc.base.viewId}::${acc.base.displayId}`)?.specificityWeight,
  }));

  const dataset: DatasetMetadata<PlacementMapDataset> = {
    generatedAt: new Date().toISOString(),
    note: orphanedPlacements.length
      ? `Skipped ${orphanedPlacements.length} placement(s) without matching view definitions.`
      : undefined,
    data: {
      entries,
    },
  };

  await writeJsonFile(outputPath, dataset);
  console.log(
    `Mapped ${entries.length} view/display pairs across ${placementsDataset.data.placements.length} placements -> ${path.relative(
      PROJECT_ROOT,
      outputPath,
    )}`,
  );
  if (orphanedPlacements.length) {
    console.warn(`[build-placement-map] ${orphanedPlacements.length} placements missing view definitions.`);
  }
}

main().catch((error) => {
  console.error('[build-placement-map] ERROR:', error);
  process.exitCode = 1;
});
