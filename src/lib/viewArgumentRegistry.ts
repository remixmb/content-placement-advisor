import type { PageEntityContext, ViewArgument } from '../types.js';
import { pathExists, readJsonFile } from './fs.js';
import { resolveFromRoot } from './env.js';

export interface RegistrySlot {
  dimension?: string;
  skipMatch?: boolean;
  strategy?: 'entity_id' | 'taxonomy:first' | 'taxonomy:all' | 'taxonomy:primary_story_context';
  multiValueMode?: 'single' | 'or' | 'and';
  notes?: string;
}

export interface RegistryEntry {
  viewId: string;
  displayId: string;
  placementSource?: string;
  specificityWeight?: number;
  notes?: string;
  argumentSlots?: RegistrySlot[];
  syntheticFromPageEntity?: {
    bundle: string;
    slots: RegistrySlot[];
  };
}

interface RegistryFile {
  entries?: RegistryEntry[];
}

export interface TaxonomyTermMeta {
  label: string;
  vocabulary: string;
  parent?: string;
}

export interface TaxonomyHelpers {
  termsById: Map<string, TaxonomyTermMeta>;
  childrenById: Map<string, string[]>;
}

const DEFAULT_REGISTRY_PATH = 'docs/placement-registry/view-argument-map.json';
const STORY_CONTEXT_EXCLUSIONS = new Set(['all som', 'headlines']);

export async function loadViewArgumentRegistry(candidate = DEFAULT_REGISTRY_PATH): Promise<Map<string, RegistryEntry>> {
  const resolved = resolveFromRoot(candidate);
  if (!(await pathExists(resolved))) {
    return new Map();
  }

  const file = await readJsonFile<RegistryFile>(resolved);
  const registry = new Map<string, RegistryEntry>();

  for (const entry of file.entries ?? []) {
    if (!entry.viewId || !entry.displayId) {
      continue;
    }
    registry.set(`${entry.viewId}::${entry.displayId}`, entry);
  }

  return registry;
}

export function parseArgumentValue(raw: string): {
  operator: 'single' | 'or' | 'and';
  tokens: string[];
} {
  if (!raw) {
    return { operator: 'single', tokens: [] };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { operator: 'single', tokens: [] };
  }

  if (trimmed.includes(',')) {
    return {
      operator: 'and',
      tokens: trimmed.split(',').map((token) => token.trim()).filter(Boolean),
    };
  }

  if (trimmed.includes('+')) {
    return {
      operator: 'or',
      tokens: trimmed.split('+').map((token) => token.trim()).filter(Boolean),
    };
  }

  return { operator: 'single', tokens: [trimmed] };
}

export function annotateViewArgument(
  argument: ViewArgument,
  mapping: RegistryEntry | undefined,
  taxonomy: TaxonomyHelpers,
): ViewArgument {
  const argumentList = argument.argumentList ?? [];
  if (!argumentList.length) {
    return argument;
  }

  const slotMappings = mapping?.argumentSlots ?? [];
  const argumentDimensions: Array<string | undefined> = [];
  const argumentValueLabels: string[][] = [];
  const argumentSlotOperators: Array<'single' | 'or' | 'and'> = [];
  const argumentSkipMatch: boolean[] = [];
  const argumentTerms: Array<Array<{ value: string; label?: string; dimension?: string }>> = [];

  for (let index = 0; index < argumentList.length; index++) {
    const raw = argumentList[index] ?? '';
    const parsed = parseArgumentValue(raw);
    const slotMapping = slotMappings[index];
    const terms = parsed.tokens.map((token) => {
      const termMeta = taxonomy.termsById.get(token);
      return {
        value: token,
        label: termMeta ? `${termMeta.label} (${token})` : undefined,
        dimension: termMeta?.vocabulary ?? slotMapping?.dimension,
      };
    });
    const explicitDimension = slotMapping?.dimension;
    const inferredDimensions = Array.from(new Set(terms.map((term) => term.dimension).filter(Boolean)));
    const dimension =
      explicitDimension ?? (inferredDimensions.length === 1 ? inferredDimensions[0] : undefined);
    const skipMatch =
      slotMapping?.skipMatch ??
      (dimension === 'nid' || (!dimension && terms.every((term) => !term.dimension)));

    argumentDimensions.push(dimension);
    argumentValueLabels.push(terms.map((term) => term.label ?? term.value));
    argumentSlotOperators.push(slotMapping?.multiValueMode ?? parsed.operator);
    argumentSkipMatch.push(skipMatch);
    argumentTerms.push(terms);
  }

  return {
    ...argument,
    argumentDimensions,
    argumentValueLabels,
    argumentSlotOperators,
    argumentSkipMatch,
    argumentTerms,
    source: argument.source ?? 'drupal-settings',
  };
}

function getFirstValue(pageEntity: PageEntityContext | undefined, dimension: string): string | undefined {
  return pageEntity?.taxonomy?.[dimension]?.find(Boolean);
}

function getPrimaryStoryContext(
  pageEntity: PageEntityContext | undefined,
  taxonomy: TaxonomyHelpers,
): string | undefined {
  const contextTerms = pageEntity?.taxonomy?.context ?? [];
  if (!contextTerms.length) {
    return undefined;
  }

  let fallback: string | undefined;
  for (const termId of contextTerms) {
    const label = taxonomy.termsById.get(termId)?.label?.toLowerCase();
    if (label && STORY_CONTEXT_EXCLUSIONS.has(label)) {
      continue;
    }
    if (!fallback) {
      fallback = termId;
    }
    const children = taxonomy.childrenById.get(termId) ?? [];
    if (children.length === 0) {
      return termId;
    }
  }

  return fallback ?? contextTerms[0];
}

function resolveSyntheticValues(
  slot: RegistrySlot,
  pageEntity: PageEntityContext | undefined,
  taxonomy: TaxonomyHelpers,
): string[] {
  if (!pageEntity) {
    return [];
  }

  switch (slot.strategy) {
    case 'entity_id':
      return pageEntity.id ? [pageEntity.id] : [];
    case 'taxonomy:first':
      return slot.dimension ? [getFirstValue(pageEntity, slot.dimension)].filter(Boolean) as string[] : [];
    case 'taxonomy:all':
      return slot.dimension ? [...(pageEntity.taxonomy?.[slot.dimension] ?? [])] : [];
    case 'taxonomy:primary_story_context': {
      const termId = getPrimaryStoryContext(pageEntity, taxonomy);
      return termId ? [termId] : [];
    }
    default:
      return [];
  }
}

export function buildSyntheticViewArgument(
  viewId: string,
  displayId: string,
  mapping: RegistryEntry | undefined,
  pageEntity: PageEntityContext | undefined,
  taxonomy: TaxonomyHelpers,
): ViewArgument | undefined {
  const synthetic = mapping?.syntheticFromPageEntity;
  if (!synthetic || !pageEntity?.bundle || pageEntity.bundle !== synthetic.bundle) {
    return undefined;
  }

  const argumentList: string[] = [];
  const argumentDimensions: Array<string | undefined> = [];
  const argumentValueLabels: string[][] = [];
  const argumentSlotOperators: Array<'single' | 'or' | 'and'> = [];
  const argumentSkipMatch: boolean[] = [];
  const argumentTerms: Array<Array<{ value: string; label?: string; dimension?: string }>> = [];

  for (const slot of synthetic.slots) {
    const values = resolveSyntheticValues(slot, pageEntity, taxonomy);
    if (!values.length) {
      return undefined;
    }
    const operator = slot.multiValueMode ?? (values.length > 1 ? 'or' : 'single');
    const rawValue =
      operator === 'and'
        ? values.join(',')
        : operator === 'or'
          ? values.join('+')
          : values[0];
    const terms = values.map((value) => {
      const termMeta = taxonomy.termsById.get(value);
      const label =
        termMeta?.label ??
        pageEntity.taxonomyLabels?.[slot.dimension ?? '']?.[
          (pageEntity.taxonomy?.[slot.dimension ?? ''] ?? []).indexOf(value)
        ];
      return {
        value,
        label: label ? `${label} (${value})` : value,
        dimension: slot.dimension ?? termMeta?.vocabulary,
      };
    });

    argumentList.push(rawValue);
    argumentDimensions.push(slot.dimension ?? terms[0]?.dimension);
    argumentValueLabels.push(terms.map((term) => term.label ?? term.value));
    argumentSlotOperators.push(operator);
    argumentSkipMatch.push(Boolean(slot.skipMatch));
    argumentTerms.push(terms);
  }

  return {
    viewId,
    display: displayId,
    viewDisplayId: displayId,
    rawArgs: argumentList.join('/'),
    argumentList,
    argumentDimensions,
    argumentValueLabels,
    argumentSlotOperators,
    argumentSkipMatch,
    argumentTerms,
    source: 'template-derived',
  };
}
