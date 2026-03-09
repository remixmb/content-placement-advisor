import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  ContextualFilterDescriptor,
  PagerConfig,
  SortDescriptor,
  TaxonomyFilterDescriptor,
  ViewDisplayDefinition,
  ViewFilterDescriptor,
  ViewFilterSummary,
} from '../types.js';
import { PROJECT_ROOT } from './env.js';
import { humanizeDimension, normalizeValues, toDimensionKey } from './stringUtils.js';

type DrupalDisplayMap = Record<
  string,
  {
    id: string;
    display_title?: string;
    display_description?: string;
    display_options?: DrupalDisplayOptions;
  }
>;

interface DrupalDisplayOptions {
  filters?: Record<string, DrupalFilter>;
  arguments?: Record<string, DrupalArgument>;
  sorts?: Record<string, DrupalSort>;
  pager?: DrupalPager;
  defaults?: Record<string, boolean>;
}

interface DrupalFilter {
  id: string;
  field?: string;
  table?: string;
  plugin_id?: string;
  value?: unknown;
  operator?: string;
  expose?: {
    label?: string;
    identifier?: string;
  };
  admin_label?: string;
  vid?: string;
  not?: boolean;
  group?: number;
}

interface DrupalArgument {
  id: string;
  field?: string;
  table?: string;
  plugin_id?: string;
  default_argument_type?: string;
  default_argument_options?: {
    argument?: string;
  };
  title?: string;
  require_value?: boolean;
  not?: boolean;
}

interface DrupalSort {
  id: string;
  field?: string;
  table?: string;
  plugin_id?: string;
  order?: 'ASC' | 'DESC';
  admin_label?: string;
}

interface DrupalPager {
  type?: string;
  options?: {
    items_per_page?: number;
    offset?: number;
  };
}

function resolveSection<T>(
  section: keyof DrupalDisplayOptions,
  defaultOptions: DrupalDisplayOptions,
  displayOptions: DrupalDisplayOptions | undefined,
  displayId: string,
): T | undefined {
  if (displayId === 'default') {
    return defaultOptions[section] as T | undefined;
  }

  const overrides = displayOptions?.[section];
  const defaultsConfig = displayOptions?.defaults;
  const inheritsDefault = defaultsConfig?.[section];

  if (inheritsDefault === false) {
    return (overrides as T) ?? undefined;
  }

  if (overrides !== undefined) {
    return overrides as T;
  }

  return defaultOptions[section] as T | undefined;
}

function normalizeFilterSummary(filters?: Record<string, DrupalFilter>): ViewFilterSummary {
  const summary: ViewFilterSummary = {
    contentTypes: [],
    taxonomy: [],
    other: [],
  };

  if (!filters) {
    return summary;
  }

  for (const filter of Object.values(filters)) {
    if (isContentTypeFilter(filter)) {
      summary.contentTypes.push(...normalizeValues(filter.value));
      continue;
    }

    if (isTaxonomyFilter(filter)) {
      const descriptor = toTaxonomyFilter(filter);
      if (descriptor) {
        summary.taxonomy.push(descriptor);
      }
      continue;
    }

    summary.other.push(toGenericFilter(filter));
  }

  summary.contentTypes = Array.from(new Set(summary.contentTypes));
  return summary;
}

function isContentTypeFilter(filter: DrupalFilter): boolean {
  return (
    filter.plugin_id === 'bundle' ||
    (filter.field === 'type' && (filter.table === 'node_field_data' || filter.table === 'node_revision')) ||
    filter.id === 'type'
  );
}

function isTaxonomyFilter(filter: DrupalFilter): boolean {
  return Boolean(
    filter.vid ||
      (filter.plugin_id && filter.plugin_id.includes('taxonomy')) ||
      (filter.table && filter.table.includes('taxonomy')),
  );
}

function toTaxonomyFilter(filter: DrupalFilter): TaxonomyFilterDescriptor | null {
  const values = normalizeValues(filter.value);
  const dimension = filter.vid ?? toDimensionKey(filter.expose?.identifier ?? filter.field ?? filter.id);
  if (!dimension) {
    return null;
  }

  const operator = (filter.operator ?? '').toLowerCase();
  let behavior: TaxonomyFilterDescriptor['behavior'] = 'require-any';

  if (filter.not || operator.includes('not')) {
    behavior = 'exclude';
  } else if (operator === 'and') {
    behavior = 'require-all';
  }

  return {
    id: filter.id,
    field: filter.field,
    table: filter.table,
    pluginId: filter.plugin_id,
    operator: filter.operator,
    values,
    negate: filter.not ?? false,
    vid: filter.vid,
    dimension,
    behavior,
    label: filter.expose?.label ?? filter.admin_label ?? humanizeDimension(dimension),
    description: filter.admin_label,
  };
}

function toGenericFilter(filter: DrupalFilter): ViewFilterDescriptor {
  return {
    id: filter.id,
    field: filter.field,
    table: filter.table,
    pluginId: filter.plugin_id,
    operator: filter.operator,
    values: normalizeValues(filter.value),
    negate: filter.not ?? false,
    label: filter.expose?.label ?? filter.admin_label ?? humanizeDimension(filter.id),
  };
}

function inferArgumentDimension(arg: DrupalArgument): string | undefined {
  const bundles = arg.validate_options?.bundles;
  if (bundles) {
    const first = Object.keys(bundles)[0];
    if (first) {
      return toDimensionKey(first);
    }
  }
  if (arg.field) {
    return toDimensionKey(arg.field);
  }
  if (arg.id) {
    return toDimensionKey(arg.id);
  }
  return undefined;
}

function normalizeArguments(args?: Record<string, DrupalArgument>): ContextualFilterDescriptor[] {
  if (!args) {
    return [];
  }
  return Object.values(args).map((arg) => ({
    id: arg.id,
    field: arg.field,
    table: arg.table,
    pluginId: arg.plugin_id,
    defaultArgumentType: arg.default_argument_type,
    defaultArgumentValue: arg.default_argument_options?.argument,
    label: arg.title,
    requireValue: arg.require_value,
    negate: arg.not ?? false,
    dimension: inferArgumentDimension(arg),
  }));
}

function normalizeSorts(sorts?: Record<string, DrupalSort>): SortDescriptor[] {
  if (!sorts) {
    return [];
  }
  return Object.values(sorts).map((sort) => ({
    id: sort.id,
    field: sort.field,
    table: sort.table,
    pluginId: sort.plugin_id,
    order: sort.order,
    label: sort.admin_label,
  }));
}

function normalizePager(pager?: DrupalPager): PagerConfig | undefined {
  if (!pager) {
    return undefined;
  }
  const type = pager.type;
  const itemsPerPage = pager.options?.items_per_page;
  const offset = pager.options?.offset;
  return {
    type,
    itemsPerPage: typeof itemsPerPage === 'number' ? itemsPerPage : null,
    offset: typeof offset === 'number' ? offset : undefined,
  };
}

export async function parseViewFile(filePath: string): Promise<ViewDisplayDefinition[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(raw) as {
    id: string;
    label: string;
    description?: string;
    display?: DrupalDisplayMap;
  };

  if (!parsed?.display) {
    return [];
  }

  const defaultOptions = parsed.display.default?.display_options ?? {};
  const definitions: ViewDisplayDefinition[] = [];

  for (const [displayId, displayConfig] of Object.entries(parsed.display)) {
    const displayOptions = displayConfig.display_options;
    const filters = normalizeFilterSummary(resolveSection('filters', defaultOptions, displayOptions, displayId));
    const contextualFilters = normalizeArguments(
      resolveSection('arguments', defaultOptions, displayOptions, displayId),
    );
    const sorts = normalizeSorts(resolveSection('sorts', defaultOptions, displayOptions, displayId));
    const pager = normalizePager(resolveSection('pager', defaultOptions, displayOptions, displayId));
    const limit =
      pager?.itemsPerPage && pager.itemsPerPage > 0 && pager.type && pager.type !== 'none'
        ? pager.itemsPerPage
        : null;

    definitions.push({
      viewId: parsed.id,
      viewLabel: parsed.label,
      displayId: displayId,
      displayTitle: displayConfig.display_title ?? displayId,
      description: displayConfig.display_description ?? parsed.description,
      sourceFile: path.relative(PROJECT_ROOT, filePath),
      filters,
      contextualFilters,
      sorts,
      pager,
      limit,
    });
  }

  return definitions;
}
