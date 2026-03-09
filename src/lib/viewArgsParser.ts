import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { PageEntityContext, PlacementLocationContext, ViewArgument } from '../types.js';
import { normalizeUrl } from './url.js';

interface HeaderInfo {
  original: string;
  normalized: string;
}

interface RawRecord {
  [key: string]: string;
}

function normalizeHeader(name: string): string {
  return name.replace(/^\uFEFF/, '').trim().toLowerCase();
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === 'true') return true;
  const num = Number(trimmed);
  return !Number.isNaN(num) && num > 0;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function safeParseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function parseEntityTaxonomy(value: string | undefined): PageEntityContext['taxonomy'] | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidate = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;
  try {
    const parsed = JSON.parse(candidate) as Record<string, Record<string, string>>;
    const taxonomy: Record<string, string[]> = {};
    for (const [dimension, terms] of Object.entries(parsed)) {
      if (!terms || typeof terms !== 'object') {
        continue;
      }
      const ids = Object.keys(terms).filter(Boolean);
      if (ids.length) {
        taxonomy[dimension] = ids;
      }
    }
    return Object.keys(taxonomy).length ? taxonomy : undefined;
  } catch {
    return undefined;
  }
}

function parseEntityTaxonomyLabels(value: string | undefined): PageEntityContext['taxonomyLabels'] | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidate = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;
  try {
    const parsed = JSON.parse(candidate) as Record<string, Record<string, string>>;
    const labels: Record<string, string[]> = {};
    for (const [dimension, terms] of Object.entries(parsed)) {
      if (!terms || typeof terms !== 'object') {
        continue;
      }
      const values = Object.values(terms).map((label) => `${label ?? ''}`.trim()).filter(Boolean);
      if (values.length) {
        labels[dimension] = values;
      }
    }
    return Object.keys(labels).length ? labels : undefined;
  } catch {
    return undefined;
  }
}

function collectPrefixedValues(headers: HeaderInfo[], record: RawRecord, prefix: string): string[] {
  const normalizedPrefix = prefix.toLowerCase();
  const values: string[] = [];
  for (const header of headers) {
    if (header.normalized.startsWith(normalizedPrefix)) {
      const raw = record[header.original];
      if (raw && raw.trim()) {
        values.push(raw.trim());
      }
    }
  }
  return values;
}

export async function loadViewArgsContext(csvPath: string): Promise<Map<string, PlacementLocationContext>> {
  const result = new Map<string, PlacementLocationContext>();
  try {
    const buffer = await fs.readFile(csvPath, 'utf8');
    const records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
    }) as RawRecord[];
    if (!records.length) {
      return result;
    }
    const headers = Object.keys(records[0]).map<HeaderInfo>((name) => ({
      original: name,
      normalized: normalizeHeader(name),
    }));
    const findColumn = (target: string): string | undefined => {
      const normalizedTarget = target.toLowerCase();
      const match = headers.find((h) => h.normalized === normalizedTarget);
      return match?.original;
    };

    const addressCol = headers.find((h) => h.normalized.includes('address'))?.original;
    if (!addressCol) {
      return result;
    }

    const exposedSelectorCols = headers.filter((h) => h.normalized.startsWith('exposed_form_selector'));
    const exposedSelectNameCols = headers.filter((h) => h.normalized.startsWith('exposed_select_names'));
    const exposedFormActionCol = findColumn('exposed_form_action 1');
    const viewArgsCol = findColumn('view_args');
    const hasViewWrapperCol = findColumn('has_view_wrapper');
    const hasExposedFormCol = findColumn('has_exposed_form');
    const hasBefCol = findColumn('has_bef');
    const hasPagerCol = findColumn('has_pager');
    const viewEmbedDisplayCol = findColumn('view_embed_display');
    const viewPageDisplayCol = findColumn('view_page_display');
    const viewAjaxPagerCol = findColumn('view_ajax_pager');
    const paramProgramCol = findColumn('param_program');
    const paramIndustryCol = findColumn('param_industry');
    const paramProfileCol = findColumn('param_profile_type');
    const paramPageCol = findColumn('param_page');
    const hasApplyButtonCol = findColumn('has_apply_button');
    const hasResetButtonCol = findColumn('has_reset_button');
    const entityBundleCol = findColumn('entity_bundle');
    const entityIdCol = findColumn('entity_id');
    const entityTitleCol = findColumn('entity_title');
    const entityTaxonomyCol = findColumn('entitytaxonomy');

    for (const record of records) {
      const urlRaw = record[addressCol];
      if (!urlRaw) {
        continue;
      }
      const normalized = normalizeUrl(urlRaw);
      if (!normalized.url) {
        continue;
      }

      const viewArgumentsRaw = viewArgsCol ? record[viewArgsCol] : '';
      const parsedViewArgs = Array.isArray(safeParseJson(viewArgumentsRaw))
        ? (safeParseJson(viewArgumentsRaw) as ViewArgument[])
        : undefined;
      const viewArguments = parsedViewArgs?.length ? parsedViewArgs : undefined;
      const pageEntityTaxonomy = entityTaxonomyCol ? parseEntityTaxonomy(record[entityTaxonomyCol]) : undefined;
      const pageEntityTaxonomyLabels = entityTaxonomyCol
        ? parseEntityTaxonomyLabels(record[entityTaxonomyCol])
        : undefined;
      const pageEntity: PageEntityContext | undefined =
        (entityBundleCol && record[entityBundleCol]?.trim()) ||
        (entityIdCol && record[entityIdCol]?.trim()) ||
        (entityTitleCol && record[entityTitleCol]?.trim()) ||
        pageEntityTaxonomy
          ? {
              bundle: entityBundleCol ? record[entityBundleCol]?.trim() || undefined : undefined,
              id: entityIdCol ? record[entityIdCol]?.trim() || undefined : undefined,
              title: entityTitleCol ? record[entityTitleCol]?.trim() || undefined : undefined,
              taxonomy: pageEntityTaxonomy,
              taxonomyLabels: pageEntityTaxonomyLabels,
            }
          : undefined;

      const exposedFormSelectors = exposedSelectorCols
        .map((col) => record[col.original]?.trim())
        .filter((value): value is string => Boolean(value));
      const exposedSelectNames = exposedSelectNameCols
        .map((col) => record[col.original]?.trim())
        .filter((value): value is string => Boolean(value));

      const context: PlacementLocationContext = {
        viewArguments,
        exposedFormSelectors: exposedFormSelectors.length ? exposedFormSelectors : undefined,
        exposedSelectNames: exposedSelectNames.length ? exposedSelectNames : undefined,
        exposedFormAction: exposedFormActionCol ? record[exposedFormActionCol]?.trim() || undefined : undefined,
        hasViewWrapper: parseBoolean(hasViewWrapperCol ? record[hasViewWrapperCol] : undefined),
        hasExposedForm: parseBoolean(hasExposedFormCol ? record[hasExposedFormCol] : undefined),
        hasBef: parseBoolean(hasBefCol ? record[hasBefCol] : undefined),
        hasPager: parseBoolean(hasPagerCol ? record[hasPagerCol] : undefined),
        hasAjaxPager: parseBoolean(viewAjaxPagerCol ? record[viewAjaxPagerCol] : undefined),
        hasApplyButton: parseBoolean(hasApplyButtonCol ? record[hasApplyButtonCol] : undefined),
        hasResetButton: parseBoolean(hasResetButtonCol ? record[hasResetButtonCol] : undefined),
        viewEmbedDisplayCount: parseInteger(viewEmbedDisplayCol ? record[viewEmbedDisplayCol] : undefined),
        viewPageDisplayCount: parseInteger(viewPageDisplayCol ? record[viewPageDisplayCol] : undefined),
        viewAjaxPagerCount: parseInteger(viewAjaxPagerCol ? record[viewAjaxPagerCol] : undefined),
        parameterFlags: {
          program: parseBoolean(paramProgramCol ? record[paramProgramCol] : undefined),
          industry: parseBoolean(paramIndustryCol ? record[paramIndustryCol] : undefined),
          profileType: parseBoolean(paramProfileCol ? record[paramProfileCol] : undefined),
          page: parseBoolean(paramPageCol ? record[paramPageCol] : undefined),
        },
        pageEntity,
      };

      // Remove empty parameterFlags object if all false
      if (
        context.parameterFlags &&
        !context.parameterFlags.program &&
        !context.parameterFlags.industry &&
        !context.parameterFlags.profileType &&
        !context.parameterFlags.page
      ) {
        context.parameterFlags = undefined;
      }

      if (
        !context.viewArguments &&
        !context.exposedFormSelectors &&
        !context.exposedSelectNames &&
        !context.hasExposedForm &&
        !context.hasPager &&
        !context.hasAjaxPager &&
        !context.hasBef &&
        !context.parameterFlags &&
        !context.viewEmbedDisplayCount &&
        !context.viewPageDisplayCount &&
        !context.viewAjaxPagerCount &&
        !context.hasApplyButton &&
        !context.hasResetButton &&
        !context.pageEntity
      ) {
        continue;
      }

      result.set(normalized.url, context);
    }
  } catch (error) {
    console.warn(`[view-args] Unable to load ${csvPath}:`, error instanceof Error ? error.message : error);
  }
  return result;
}
