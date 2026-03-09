import path from 'node:path';
import { promises as fs } from 'node:fs';
import minimist from 'minimist';
import type { DatasetMetadata, PlacementMapDataset, PlacementMapEntry, PlacementLocation } from '../types.js';
import { PROJECT_ROOT, PLACEMENT_MAP_OUTPUT, resolveFromRoot } from '../lib/env.js';
import { ensureDir, readJsonFile, writeJsonFile } from '../lib/fs.js';

interface ReviewRow {
  page: string;
  url: string;
  pageBundle?: string;
  pageEntityId?: string;
  pageTitle?: string;
  viewId: string;
  displayId: string;
  displayTitle: string;
  contentTypes: string;
  limit?: number | null;
  source: string;
  rawArgs: string;
  argumentDimensions: string;
  argumentValues: string;
  surfaceLabel?: string;
}

const DEFAULT_OUTPUT_DIR = 'docs/placement-registry';
const DEFAULT_JSON = 'inferred-placement-review.json';
const DEFAULT_CSV = 'inferred-placement-review.csv';
const TARGET_SOURCES = new Set(['section-context', 'manual-override']);

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function collectRows(entry: PlacementMapEntry, location: PlacementLocation): ReviewRow[] {
  const argumentsForReview = (location.context?.viewArguments ?? []).filter((argument) =>
    argument.source ? TARGET_SOURCES.has(argument.source) : false,
  );
  if (!argumentsForReview.length) {
    return [];
  }

  return argumentsForReview.map((argument) => ({
    page: location.page,
    url: location.url,
    pageBundle: location.context?.pageEntity?.bundle,
    pageEntityId: location.context?.pageEntity?.id,
    pageTitle: location.context?.pageEntity?.title,
    viewId: entry.viewId,
    displayId: entry.displayId,
    displayTitle: entry.displayTitle,
    contentTypes: entry.filters.contentTypes.join(', '),
    limit: entry.limit ?? undefined,
    source: argument.source ?? '',
    rawArgs: argument.rawArgs ?? '',
    argumentDimensions: (argument.argumentDimensions ?? []).filter(Boolean).join(', '),
    argumentValues: (argument.argumentValueLabels ?? [])
      .flat()
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' | '),
    surfaceLabel:
      location.context?.surfaceContext?.titleLabel ??
      location.context?.surfaceContext?.contextLabel,
  }));
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    string: ['input', 'output-dir'],
    alias: { i: 'input', o: 'output-dir' },
  });

  const inputPath = resolveFromRoot(args.input ?? PLACEMENT_MAP_OUTPUT);
  const outputDir = resolveFromRoot(args['output-dir'] ?? DEFAULT_OUTPUT_DIR);
  const jsonPath = path.join(outputDir, DEFAULT_JSON);
  const csvPath = path.join(outputDir, DEFAULT_CSV);

  const dataset = await readJsonFile<DatasetMetadata<PlacementMapDataset>>(inputPath);
  const rows: ReviewRow[] = [];

  for (const entry of dataset.data.entries) {
    for (const location of entry.locations ?? []) {
      rows.push(...collectRows(entry, location));
    }
  }

  rows.sort((left, right) => {
    const sourceCompare = left.source.localeCompare(right.source);
    if (sourceCompare !== 0) return sourceCompare;
    const pageCompare = left.page.localeCompare(right.page);
    if (pageCompare !== 0) return pageCompare;
    const viewCompare = left.viewId.localeCompare(right.viewId);
    if (viewCompare !== 0) return viewCompare;
    return left.displayId.localeCompare(right.displayId);
  });

  await ensureDir(outputDir);
  await writeJsonFile(jsonPath, {
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(PROJECT_ROOT, inputPath),
    rows,
  });

  const headers: Array<keyof ReviewRow> = [
    'page',
    'url',
    'pageBundle',
    'pageEntityId',
    'pageTitle',
    'viewId',
    'displayId',
    'displayTitle',
    'contentTypes',
    'limit',
    'source',
    'rawArgs',
    'argumentDimensions',
    'argumentValues',
    'surfaceLabel',
  ];
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
  await fs.writeFile(csvPath, csv);

  console.log(
    `Exported ${rows.length} inferred placement row(s) -> ${path.relative(PROJECT_ROOT, jsonPath)} and ${path.relative(
      PROJECT_ROOT,
      csvPath,
    )}`,
  );
}

main().catch((error) => {
  console.error('[report-inferred-placements] ERROR:', error);
  process.exitCode = 1;
});
