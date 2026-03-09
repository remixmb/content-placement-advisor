import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import minimist from 'minimist';
import yaml from 'js-yaml';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { parse as parseCsvStream } from 'csv-parse';
import type {
  ContentTaxonomyDataset,
  ContentTypeTaxonomyField,
  DatasetMetadata,
  TaxonomyTermRecord,
} from '../types.js';
import { pathExists, writeJsonFile } from '../lib/fs.js';
import { CONTENT_TAXONOMIES_OUTPUT, PROJECT_ROOT, resolveFromRoot } from '../lib/env.js';
import { humanizeDimension } from '../lib/stringUtils.js';

interface DrupalFieldConfig {
  id?: string;
  field_name?: string;
  entity_type?: string;
  bundle?: string;
  label?: string;
  required?: boolean;
  field_type?: string;
  settings?: {
    handler?: string;
    handler_settings?: {
      target_bundles?: Record<string, string>;
    };
  };
}

interface DrupalVocabularyConfig {
  vid?: string;
  name?: string;
}

interface TermAccumulator extends TaxonomyTermRecord {
  priority: number;
}

interface TaxonomyFieldAccumulator {
  dimension: string;
  vocabulary: string;
  vocabularyLabel: string;
  fieldNames: Set<string>;
  fieldLabels: Set<string>;
  required: boolean;
}

const DEFAULT_TERMS_CSV = 'docs/terms_with_ids_list.csv';
const DEFAULT_CRAWL_FILE = 'custom_extraction_all.csv';
const VOCABULARY_ALIASES: Record<string, string> = {
  afilliations: 'affiliations',
};

function isTaxonomyField(config: DrupalFieldConfig): boolean {
  if (!config.field_type || config.field_type !== 'entity_reference') {
    return false;
  }
  const handler = config.settings?.handler ?? '';
  return handler.includes('taxonomy') || handler.includes('filter_existing_terms');
}

function normalizeTaxonomyFields(
  entry: TaxonomyFieldAccumulator,
): ContentTypeTaxonomyField {
  const labels = Array.from(entry.fieldLabels).filter(Boolean);
  const label = labels[0] ?? entry.vocabularyLabel ?? humanizeDimension(entry.dimension);
  return {
    dimension: entry.dimension,
    vocabulary: entry.vocabulary,
    vocabularyLabel: entry.vocabularyLabel,
    label,
    fieldLabels: labels,
    fieldNames: Array.from(entry.fieldNames),
    required: entry.required,
  };
}

function normalizeVocabularyName(value?: string): string {
  if (!value) {
    return '';
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeTermId(input?: string | number): string {
  if (typeof input === 'number') {
    return `${input}`;
  }
  return (input ?? '').trim();
}

function extractDataLayerTaxonomy(script: string): Array<{ dimension: string; id: string; label: string }> {
  const match = script.match(/window\.dataLayer\.push\((\{[\s\S]*?\})\);?/);
  if (!match) {
    return [];
  }
  try {
    const payload = JSON.parse(match[1]) as { entityTaxonomy?: unknown };
    const taxonomy = payload.entityTaxonomy;
    if (!taxonomy || typeof taxonomy !== 'object') {
      return [];
    }
    const entries: Array<{ dimension: string; id: string; label: string }> = [];
    for (const [dimension, values] of Object.entries(taxonomy)) {
      if (!values || typeof values !== 'object') {
        continue;
      }
      for (const [id, label] of Object.entries(values as Record<string, unknown>)) {
        const termId = normalizeTermId(id);
        const termLabel = `${label ?? ''}`.trim();
        if (termId && termLabel) {
          entries.push({ dimension, id: termId, label: termLabel });
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function findLatestCrawlFile(filename: string): Promise<string | null> {
  const entries = await fsp.readdir(PROJECT_ROOT, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('Crawl '))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const candidate of candidates) {
    const candidatePath = path.join(PROJECT_ROOT, candidate.name, filename);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    string: ['output', 'terms', 'crawl'],
    alias: { o: 'output' },
  });

  const outputPath = resolveFromRoot(args.output ?? CONTENT_TAXONOMIES_OUTPUT);
  const termsCsvPath = resolveFromRoot(args.terms ?? DEFAULT_TERMS_CSV);
  let crawlExtractionPath = args.crawl ? resolveFromRoot(args.crawl) : undefined;
  if (!crawlExtractionPath) {
    crawlExtractionPath = await findLatestCrawlFile(DEFAULT_CRAWL_FILE) ?? undefined;
  }

  const [fieldFiles, vocabFiles] = await Promise.all([
    fg('config/sync/field.field.node.*.yml', { cwd: PROJECT_ROOT, absolute: true }),
    fg('config/sync/taxonomy.vocabulary.*.yml', { cwd: PROJECT_ROOT, absolute: true }),
  ]);

  if (!fieldFiles.length) {
    throw new Error('No node field configuration files were found.');
  }

  const vocabMap = new Map<string, string>();
  const normalizedLabelToVid = new Map<string, string>();
  const normalizedVidMap = new Map<string, string>();

  for (const vocabFile of vocabFiles) {
    const raw = await fsp.readFile(vocabFile, 'utf8');
    const doc = yaml.load(raw) as DrupalVocabularyConfig;
    if (!doc?.vid) {
      continue;
    }
    const label = (doc.name ?? '').trim() || humanizeDimension(doc.vid);
    vocabMap.set(doc.vid, label);
    normalizedVidMap.set(normalizeVocabularyName(doc.vid), doc.vid);
    normalizedLabelToVid.set(normalizeVocabularyName(label), doc.vid);
  }

  for (const [alias, target] of Object.entries(VOCABULARY_ALIASES)) {
    const realVid = target;
    if (vocabMap.has(realVid)) {
      normalizedLabelToVid.set(alias, realVid);
      normalizedVidMap.set(alias, realVid);
    }
  }

  const contentTypeMap = new Map<string, Map<string, TaxonomyFieldAccumulator>>();

  for (const configFile of fieldFiles) {
    const raw = await fsp.readFile(configFile, 'utf8');
    const doc = yaml.load(raw) as DrupalFieldConfig;
    if (!doc || doc.entity_type !== 'node' || !doc.bundle || !doc.field_name) {
      continue;
    }
    if (!isTaxonomyField(doc)) {
      continue;
    }
    const targetBundles = doc.settings?.handler_settings?.target_bundles;
    if (!targetBundles) {
      continue;
    }
    const vocabularies = Object.keys(targetBundles);
    if (!vocabularies.length) {
      continue;
    }

    const contentTypeKey = doc.bundle;
    let contentEntry = contentTypeMap.get(contentTypeKey);
    if (!contentEntry) {
      contentEntry = new Map<string, TaxonomyFieldAccumulator>();
      contentTypeMap.set(contentTypeKey, contentEntry);
    }

    for (const vocabulary of vocabularies) {
      if (!vocabulary) {
        continue;
      }
      const vocabLabel = vocabMap.get(vocabulary) ?? humanizeDimension(vocabulary);
      let accumulator = contentEntry.get(vocabulary);
      if (!accumulator) {
        accumulator = {
          dimension: vocabulary,
          vocabulary,
          vocabularyLabel: vocabLabel,
          fieldNames: new Set<string>(),
          fieldLabels: new Set<string>(),
          required: false,
        };
        contentEntry.set(vocabulary, accumulator);
      }
      accumulator.fieldNames.add(doc.field_name);
      if (doc.label) {
        accumulator.fieldLabels.add(doc.label);
      }
      if (doc.required) {
        accumulator.required = true;
      }
    }
  }

  const contentTypes: Record<string, ContentTypeTaxonomyField[]> = {};
  const vocabularies: Record<string, { label: string }> = {};
  const termsMap = new Map<string, TermAccumulator>();

  for (const [vid, label] of vocabMap.entries()) {
    vocabularies[vid] = { label };
  }

  for (const [contentType, dimensionMap] of contentTypeMap.entries()) {
    const entries = Array.from(dimensionMap.values())
      .map(normalizeTaxonomyFields)
      .sort((a, b) => a.label.localeCompare(b.label));
    contentTypes[contentType] = entries;
  }

  function upsertTerm(record: Omit<TaxonomyTermRecord, 'vocabularyLabel'> & { vocabularyLabel?: string }, priority: number) {
    const existing = termsMap.get(record.id);
    const vocabularyLabel = record.vocabularyLabel ?? vocabMap.get(record.vocabulary) ?? humanizeDimension(record.vocabulary);
    if (!existing || priority > existing.priority || (existing.term === existing.id && record.term !== record.id)) {
      termsMap.set(record.id, {
        id: record.id,
        term: record.term,
        vocabulary: record.vocabulary,
        vocabularyLabel,
        parent: record.parent,
        priority,
      });
    }
  }

  if (await pathExists(termsCsvPath)) {
    const raw = await fsp.readFile(termsCsvPath, 'utf8');
    const records = parseCsvSync(raw, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
    }) as Array<Record<string, string>>;
    for (const row of records) {
      const vocabName =
        row.Vocabulary?.trim() ??
        row['\uFEFFVocabulary']?.trim() ??
        row['﻿Vocabulary']?.trim() ??
        '';
      const id = normalizeTermId(row['Term ID']);
      const term = (row.Term ?? '').trim();
      const parent = (row['Parent Term'] ?? '').trim();
      if (!vocabName || !id || !term) {
        continue;
      }
      const normalized = normalizeVocabularyName(vocabName);
      const aliasTarget = VOCABULARY_ALIASES[normalized];
      const vocab =
        normalizedVidMap.get(normalized) ??
        normalizedLabelToVid.get(normalized) ??
        (aliasTarget ? aliasTarget : normalized);
      upsertTerm(
        {
          id,
          term,
          vocabulary: vocab,
          vocabularyLabel: vocabMap.get(vocab) ?? vocabName,
          parent: parent || undefined,
        },
        2,
      );
    }
  } else {
    console.warn(`[extract-taxonomies] Terms CSV not found at ${termsCsvPath}.`);
  }

  if (crawlExtractionPath && (await pathExists(crawlExtractionPath))) {
    const stream = fs.createReadStream(crawlExtractionPath);
    const parser = stream.pipe(
      parseCsvStream({
        columns: true,
        bom: true,
      }),
    );
    for await (const record of parser) {
      for (const [key, value] of Object.entries(record)) {
        if (!key.toLowerCase().startsWith('content_metadata')) {
          continue;
        }
        if (typeof value !== 'string' || !value.includes('window.dataLayer')) {
          continue;
        }
        const entries = extractDataLayerTaxonomy(value);
        for (const entry of entries) {
          const normalizedDim = normalizeVocabularyName(entry.dimension);
          const vocab =
            normalizedVidMap.get(normalizedDim) ??
            normalizedLabelToVid.get(normalizedDim) ??
            entry.dimension;
          upsertTerm(
            {
              id: entry.id,
              term: entry.label,
              vocabulary: vocab,
            },
            1,
          );
        }
      }
    }
  } else if (crawlExtractionPath) {
    console.warn(`[extract-taxonomies] Crawl extraction CSV not found at ${crawlExtractionPath}.`);
  } else {
    console.warn('[extract-taxonomies] No crawl extraction CSV detected; crawl-derived term labels skipped.');
  }

  const terms: TaxonomyTermRecord[] = Array.from(termsMap.values())
    .map(({ priority, ...rest }) => rest)
    .sort((a, b) => {
      if (a.vocabulary === b.vocabulary) {
        return a.term.localeCompare(b.term);
      }
      return a.vocabulary.localeCompare(b.vocabulary);
    });

  const dataset: DatasetMetadata<ContentTaxonomyDataset> = {
    generatedAt: new Date().toISOString(),
    data: {
      contentTypes,
      vocabularies,
      terms,
    },
  };

  await writeJsonFile(outputPath, dataset);
  console.log(
    `Extracted taxonomy field metadata for ${Object.keys(contentTypes).length} content types with ${terms.length} term labels -> ${path.relative(
      PROJECT_ROOT,
      outputPath,
    )}`,
  );
}

main().catch((error) => {
  console.error('[extract-content-taxonomies] ERROR:', error);
  process.exitCode = 1;
});
