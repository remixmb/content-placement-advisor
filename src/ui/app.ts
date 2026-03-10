import type {
  PlacementMapEntry,
  DatasetMetadata,
  PlacementMapDataset,
  ContentInput,
  PlacementExplanation,
  PlacementLocationContext,
  ParameterFlags,
  ContentTaxonomyDataset,
  ContentTypeTaxonomyField,
} from '../types.js';
import { getContentPlacements } from '../advisor/engine.js';

interface DimensionMeta {
  label: string;
  samples: string[];
}

interface TaxonomyTerm {
  id: string;
  term: string;
  vocabulary: string;
  vocabularyId?: string;
  parent?: string;
  searchText: string;
}

type TaxonomyMap = Map<string, TaxonomyTerm>;
type TaxonomyTermList = TaxonomyTerm[];

interface TaxonomyRowOptions {
  label?: string;
  vocabularyId?: string;
  restrictVocabulary?: boolean;
  required?: boolean;
}

interface ContentTypeOption {
  value: string;
  label: string;
  hasMetadata: boolean;
  canonical: string;
}

type ResultSectionTone = 'confirmed' | 'limited' | 'excluded';

function canonicalizeKey(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function humanizeLabel(value?: string): string {
  if (!value) {
    return '';
  }
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

const DATA_URL = new URL('./placement-map.json', window.location.href).toString();
const TAXONOMY_DATA_URL = new URL('./content-taxonomies.json', window.location.href).toString();
const SITE_ORIGIN = 'https://som.yale.edu';

async function loadPlacementMap(): Promise<PlacementMapEntry[]> {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load placement map (${response.status})`);
  }
  const dataset = (await response.json()) as DatasetMetadata<PlacementMapDataset>;
  return dataset.data.entries;
}

async function loadContentTaxonomies(): Promise<ContentTaxonomyDataset> {
  const response = await fetch(TAXONOMY_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load taxonomy metadata (${response.status})`);
  }
  const dataset = (await response.json()) as DatasetMetadata<ContentTaxonomyDataset>;
  return dataset.data;
}

function buildTaxonomyMapFromDataset(dataset: ContentTaxonomyDataset): TaxonomyMap {
  const map: TaxonomyMap = new Map();
  for (const term of dataset.terms ?? []) {
    const vocabularyLabel = term.vocabularyLabel || term.vocabulary;
    map.set(term.id, {
      id: term.id,
      term: term.term,
      vocabulary: vocabularyLabel,
      vocabularyId: term.vocabulary,
      parent: term.parent,
      searchText: `${term.term} ${term.id} ${vocabularyLabel}`.toLowerCase(),
    });
  }
  return map;
}

function buildTermsByVocabulary(map: TaxonomyMap): Map<string, TaxonomyTerm[]> {
  const byVocabulary = new Map<string, TaxonomyTerm[]>();
  for (const term of map.values()) {
    if (!term.vocabularyId) {
      continue;
    }
    const list = byVocabulary.get(term.vocabularyId) ?? [];
    list.push(term);
    byVocabulary.set(term.vocabularyId, list);
  }
  return byVocabulary;
}

function formatTermValue(id: string, map: TaxonomyMap): string {
  const info = map.get(id);
  if (!info) {
    return id;
  }
  return `${info.term} (${id})`;
}

function describeParameterFlags(flags?: ParameterFlags): string | undefined {
  if (!flags) {
    return undefined;
  }
  const active: string[] = [];
  if (flags.program) active.push('program');
  if (flags.industry) active.push('industry');
  if (flags.profileType) active.push('profile type');
  if (flags.page) active.push('page offset');
  if (!active.length) {
    return undefined;
  }
  return `Query params: ${active.join(', ')}`;
}

function describeContext(context: PlacementLocationContext): string[] {
  const details: string[] = [];
  if (context.hasExposedForm) {
    details.push('Has exposed filters');
  }
  if (context.exposedSelectNames && context.exposedSelectNames.length > 0) {
    details.push(`Form fields: ${context.exposedSelectNames.join(', ')}`);
  }
  const paramDetail = describeParameterFlags(context.parameterFlags);
  if (paramDetail) {
    details.push(paramDetail);
  }
  if (context.hasPager) {
    details.push('Paged results');
  }
  if (context.hasAjaxPager) {
    details.push('AJAX pager');
  }
  if (context.hasBef) {
    details.push('BEF enhancements');
  }
  if (context.hasApplyButton) {
    details.push('Apply button present');
  }
  if (context.viewArguments && context.viewArguments.length > 0) {
    const sourceLabels = Array.from(
      new Set(
        context.viewArguments
          .map((arg) => {
            switch (arg.source) {
              case 'drupal-settings':
                return 'Runtime args from rendered page';
              case 'template-derived':
                return 'Template-derived args';
              case 'section-context':
                return 'Inferred from section context';
              case 'manual-override':
                return 'Manual section override';
              default:
                return undefined;
            }
          })
          .filter(Boolean),
      ),
    );
    if (sourceLabels.length) {
      details.push(`Argument source: ${sourceLabels.join(', ')}`);
    }
    const refs = context.viewArguments
      .map((arg) => {
        const uuid = arg.uuid ?? 'view';
        const argument = arg.argument || arg.itemsPerPage || arg.display;
        return argument ? `${uuid} (${argument})` : uuid;
      })
      .join(', ');
    details.push(`Layout Builder view refs: ${refs}`);
  }
  return details;
}

function absoluteUrlForPath(pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) {
    return undefined;
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (pathOrUrl.startsWith('/')) {
    return `${SITE_ORIGIN}${pathOrUrl}`;
  }
  return undefined;
}

function normalizeReasonFragment(fragment: string): string {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed
    .replace(/^Matches allowed content type /, 'Allowed content type: ')
    .replace(/^Shares term\(s\): /, 'Matches selected terms: ')
    .replace(/^Template uses /, 'Template context: ')
    .replace(/^Matches contextual /, 'Page context: ')
    .replace(/^Requires contextual /, 'Requires ')
    .replace(/^View limited to /, 'Limited to ');
}

function splitReason(reason: string): { lead: string; details: string[] } {
  const fragments = reason
    .split(/\s*;\s*/)
    .map((fragment) => normalizeReasonFragment(fragment))
    .filter(Boolean);
  if (fragments.length === 0) {
    return { lead: 'Matches view rules.', details: [] };
  }
  return {
    lead: fragments.slice(0, 2).join(' • '),
    details: fragments.slice(2),
  };
}

function collectBadges(item: PlacementExplanation): Array<{ label: string; tone?: string }> {
  const badges: Array<{ label: string; tone?: string }> = [];
  if ((item.locationCount ?? 0) > 1) {
    badges.push({ label: 'Grouped surface' });
  }
  if (item.limit && item.limit > 0) {
    badges.push({ label: `Limited to ${item.limit}`, tone: 'warning' });
  }
  const sources = new Set(item.context?.viewArguments?.map((argument) => argument.source).filter(Boolean));
  if (sources.has('drupal-settings')) {
    badges.push({ label: 'Explicit args', tone: 'success' });
    badges.push({ label: 'High confidence', tone: 'success' });
  } else if (sources.has('template-derived')) {
    badges.push({ label: 'Template logic', tone: 'success' });
    badges.push({ label: 'High confidence', tone: 'success' });
  } else if (sources.has('manual-override')) {
    badges.push({ label: 'Manual override', tone: 'warning' });
    badges.push({ label: 'Reviewed rule' });
  } else if (sources.has('section-context')) {
    badges.push({ label: 'Section inferred' });
    badges.push({ label: 'Medium confidence' });
  }
  if (item.context?.hasExposedForm) {
    badges.push({ label: 'Exposed filters' });
  }
  return badges;
}

function createLink(pathOrUrl: string, label?: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = absoluteUrlForPath(pathOrUrl) ?? pathOrUrl;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  anchor.textContent = label ?? pathOrUrl;
  return anchor;
}

function renderSummary(
  container: HTMLElement,
  eligibleCount: number,
  excludedCount: number,
) {
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'results-summary';
  const items: Array<{ label: string; value: number; tone: ResultSectionTone }> = [
    { label: 'Eligible placements', value: eligibleCount, tone: 'confirmed' },
    { label: "Won't appear", value: excludedCount, tone: 'excluded' },
  ];

  for (const item of items) {
    const card = document.createElement('div');
    card.className = `summary-card summary-card--${item.tone}`;
    const value = document.createElement('strong');
    value.className = 'summary-card__value';
    value.textContent = String(item.value);
    const label = document.createElement('span');
    label.className = 'summary-card__label';
    label.textContent = item.label;
    card.append(value, label);
    list.appendChild(card);
  }

  container.appendChild(list);
}

function collectContentTypeOptions(
  entries: PlacementMapEntry[],
  taxonomyDataset: ContentTaxonomyDataset,
): ContentTypeOption[] {
  const options = new Map<string, ContentTypeOption>();

  function addOption(value: string, hasMetadata: boolean) {
    const canonical = canonicalizeKey(value);
    if (!canonical) {
      return;
    }
    const label = humanizeLabel(value) || value;
    const existing = options.get(canonical);
    if (existing) {
      if (hasMetadata && !existing.hasMetadata) {
        options.set(canonical, { value, label, hasMetadata: true, canonical });
      }
      return;
    }
    options.set(canonical, { value, label, hasMetadata, canonical });
  }

  for (const contentType of Object.keys(taxonomyDataset.contentTypes ?? {})) {
    if (contentType) {
      addOption(contentType, true);
    }
  }

  for (const entry of entries) {
    for (const type of entry.filters.contentTypes) {
      if (type) {
        addOption(type, Boolean(taxonomyDataset.contentTypes?.[type]));
      }
    }
  }

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildContentTypeFieldMap(
  taxonomyDataset: ContentTaxonomyDataset,
): Map<string, ContentTypeTaxonomyField[]> {
  const map = new Map<string, ContentTypeTaxonomyField[]>();
  for (const [contentType, fields] of Object.entries(taxonomyDataset.contentTypes ?? {})) {
    map.set(canonicalizeKey(contentType), fields);
  }
  return map;
}

function collectDimensionMeta(
  entries: PlacementMapEntry[],
  termMap: TaxonomyMap,
  taxonomyDataset: ContentTaxonomyDataset,
): Map<string, DimensionMeta> {
  const meta = new Map<string, DimensionMeta>();
  for (const entry of entries) {
    for (const filter of entry.filters.taxonomy) {
      if (!filter.dimension) {
        continue;
      }
      const key = filter.dimension;
      const current = meta.get(key) ?? { label: filter.label ?? key, samples: [] };
      for (const value of filter.values.slice(0, 5)) {
        const formatted = formatTermValue(value, termMap);
        if (!current.samples.includes(formatted)) {
          current.samples.push(formatted);
        }
      }
      meta.set(key, current);
    }
  }

  for (const fields of Object.values(taxonomyDataset.contentTypes ?? {})) {
    for (const field of fields) {
      if (!field.dimension) {
        continue;
      }
      const existing = meta.get(field.dimension) ?? { label: field.label ?? field.vocabularyLabel ?? field.dimension, samples: [] };
      const preferredLabel = field.label || field.vocabularyLabel || existing.label;
      existing.label = preferredLabel;
      meta.set(field.dimension, existing);
    }
  }

  return meta;
}

function enrichDimensionSamples(
  meta: Map<string, DimensionMeta>,
  taxonomyDataset: ContentTaxonomyDataset,
  termsByVocabulary: Map<string, TaxonomyTerm[]>,
) {
  for (const fields of Object.values(taxonomyDataset.contentTypes ?? {})) {
    for (const field of fields) {
      const entry = meta.get(field.dimension);
      if (!entry || entry.samples.length >= 3) {
        continue;
      }
      const candidates = termsByVocabulary.get(field.vocabulary);
      if (!candidates) {
        continue;
      }
      for (const term of candidates.slice(0, 3)) {
        const formatted = `${term.term} (${term.id})`;
        if (!entry.samples.includes(formatted)) {
          entry.samples.push(formatted);
        }
      }
    }
  }
}

function buildDimensionVocabularyMap(
  entries: PlacementMapEntry[],
  taxonomyDataset: ContentTaxonomyDataset,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    for (const filter of entry.filters.taxonomy) {
      if (!filter.dimension) {
        continue;
      }
      if (!map.has(filter.dimension)) {
        map.set(filter.dimension, filter.vid ?? filter.dimension);
      }
    }
  }
  for (const fields of Object.values(taxonomyDataset.contentTypes ?? {})) {
    for (const field of fields) {
      if (!field.dimension) {
        continue;
      }
      if (!map.has(field.dimension)) {
        map.set(field.dimension, field.vocabulary);
      }
    }
  }
  return map;
}

function createOption(value: string, label?: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label ?? value;
  return option;
}

function renderTaxonomyOptions(
  select: HTMLSelectElement,
  button: HTMLButtonElement,
  meta: Map<string, DimensionMeta>,
  allowed?: ContentTypeTaxonomyField[] | null,
) {
  const entries: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  if (allowed === null) {
    select.innerHTML = '';
    select.append(createOption('', 'Select a content type first'));
    select.disabled = true;
    button.disabled = true;
    return;
  }

  if (allowed && allowed.length === 0) {
    select.innerHTML = '';
    select.append(createOption('', 'No taxonomy filters available'));
    select.disabled = true;
    button.disabled = true;
    return;
  }

  if (allowed && allowed.length > 0) {
    for (const field of allowed) {
      if (!field.dimension || seen.has(field.dimension)) {
        continue;
      }
      seen.add(field.dimension);
      const label = field.label ?? meta.get(field.dimension)?.label ?? field.dimension;
      entries.push({ value: field.dimension, label });
    }
  } else {
    for (const [dimension, info] of meta.entries()) {
      if (!dimension || seen.has(dimension)) {
        continue;
      }
      seen.add(dimension);
      entries.push({ value: dimension, label: info.label ?? dimension });
    }
  }

  entries.sort((a, b) => a.label.localeCompare(b.label));
  select.innerHTML = '';
  const hasEntries = entries.length > 0;

  if (!hasEntries) {
    select.append(createOption('', 'No taxonomy filters available'));
    select.disabled = true;
    button.disabled = true;
    return;
  }

  select.disabled = false;
  button.disabled = false;
  select.append(createOption('', 'Select taxonomy dimension'));
  for (const entry of entries) {
    select.append(createOption(entry.value, entry.label));
  }
}

function renderContentTypeSelect(select: HTMLSelectElement, contentTypes: ContentTypeOption[]) {
  select.innerHTML = '';
  select.append(createOption('', 'Select a content type'));
  for (const option of contentTypes) {
    const label = option.hasMetadata ? option.label : `${option.label} (filters unavailable)`;
    const element = createOption(option.value, label);
    element.dataset.canonical = option.canonical;
    element.dataset.hasMetadata = String(option.hasMetadata);
    select.append(element);
  }
}

function addTaxonomyRow(
  container: HTMLElement,
  dimension: string,
  meta: DimensionMeta,
  existing: Set<string>,
  allTerms: TaxonomyTermList,
  termsByVocabulary: Map<string, TaxonomyTerm[]>,
  options?: TaxonomyRowOptions,
) {
  if (existing.has(dimension)) {
    const existingRow = container.querySelector<HTMLElement>(`[data-dimension="${dimension}"]`);
    existingRow?.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const row = document.createElement('div');
  row.className = 'taxonomy-row';
  row.dataset.dimension = dimension;

  const selectedTerms = new Set<string>();
  const label = document.createElement('label');
  const labelText = options?.label ?? meta.label ?? dimension;
  label.textContent = `${labelText} (${dimension})${options?.required ? ' *' : ''}`;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search a term name or ID, then press Enter or click a suggestion';

  const hint = document.createElement('small');
  const defaultHint = meta.samples.length
    ? `Examples: ${meta.samples.join(', ')}`
    : 'Enter taxonomy term IDs, names, or slugs';
  if (options?.vocabularyId && !options?.restrictVocabulary) {
    hint.textContent = `${defaultHint}. Term dictionary unavailable for this field—paste IDs or slugs manually.`;
  } else {
    hint.textContent = defaultHint;
  }

  const selectedContainer = document.createElement('div');
  selectedContainer.className = 'taxonomy-selected';

  const suggestions = document.createElement('div');
  suggestions.className = 'taxonomy-suggestions';

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'plain-button';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    existing.delete(dimension);
    row.remove();
  });

  function updateDataset() {
    row.dataset.selectedTerms = JSON.stringify(Array.from(selectedTerms));
  }

  function renderSelectedChips() {
    selectedContainer.innerHTML = '';
    if (selectedTerms.size === 0) {
      const empty = document.createElement('span');
      empty.className = 'taxonomy-selected__empty';
      empty.textContent = 'No terms selected.';
      selectedContainer.appendChild(empty);
      return;
    }
    for (const id of selectedTerms) {
      const term = allTerms.find((t) => t.id === id);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'taxonomy-chip';
      chip.textContent = term ? `${term.term} (${term.id}) ×` : `${id} ×`;
      chip.addEventListener('click', () => {
        selectedTerms.delete(id);
        updateDataset();
        renderSelectedChips();
      });
      selectedContainer.appendChild(chip);
    }
  }

  const restrictVocabulary = Boolean(options?.restrictVocabulary && options.vocabularyId);
  const normalizedDimensionKey = (options?.vocabularyId ?? dimension).toLowerCase().replace(/[_-]+/g, ' ');

  function buildTermPool(): TaxonomyTerm[] {
    if (restrictVocabulary && options?.vocabularyId) {
      const catalog = termsByVocabulary.get(options.vocabularyId);
      if (catalog && catalog.length) {
        return catalog.slice().sort((a, b) => a.term.localeCompare(b.term));
      }
      const filtered = allTerms.filter((term) => term.vocabularyId === options.vocabularyId);
      if (filtered.length) {
        return filtered.slice().sort((a, b) => a.term.localeCompare(b.term));
      }
    }
    return allTerms.slice().sort((a, b) => a.term.localeCompare(b.term));
  }

  const termPool = buildTermPool();

  function searchTerms(query: string): TaxonomyTerm[] {
    const trimmed = query.trim().toLowerCase();
    if (!termPool.length) {
      return [];
    }
    if (!trimmed) {
      return termPool.slice(0, 6);
    }
    const matches = termPool
      .map((term) => {
        if (!term.searchText.includes(trimmed)) {
          return null;
        }
        let score = 0;
        if (term.term.toLowerCase().startsWith(trimmed)) score += 3;
        if (term.id === trimmed) score += 4;
        if (term.term.toLowerCase().includes(trimmed)) score += 1;
        const vocabKey = term.vocabulary.toLowerCase().replace(/\s+/g, ' ');
        if (vocabKey.includes(normalizedDimensionKey)) score += 1;
        return { term, score };
      })
      .filter((item): item is { term: TaxonomyTerm; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score || a.term.term.localeCompare(b.term.term));
    return matches.slice(0, 6).map((item) => item.term);
  }

  function addTerm(termId: string) {
    if (!termId) return;
    selectedTerms.add(termId);
    updateDataset();
    renderSelectedChips();
    suggestions.innerHTML = '';
  }

  function resolveTermId(candidate: string): string | undefined {
    const normalized = candidate.toLowerCase();
    const byId = allTerms.find((term) => term.id === candidate);
    if (byId) {
      return byId.id;
    }
    const byLabel = termPool.find((term) => term.term.toLowerCase() === normalized);
    if (byLabel) {
      return byLabel.id;
    }
    const suggestionsList = searchTerms(candidate).filter((term) => !selectedTerms.has(term.id));
    if (suggestionsList.length === 1) {
      return suggestionsList[0].id;
    }
    return undefined;
  }

  function addTermByQuery(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    const segments = trimmed
      .split(/[,;\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (segments.length > 1) {
      let addedAny = false;
      for (const value of segments) {
        const resolved = resolveTermId(value) ?? value;
        if (!selectedTerms.has(resolved)) {
          addTerm(resolved);
          addedAny = true;
        }
      }
      if (addedAny) {
        input.value = '';
        suggestions.innerHTML = '';
      }
      return;
    }
    const resolved = resolveTermId(trimmed);
    if (resolved) {
      addTerm(resolved);
      input.value = '';
      suggestions.innerHTML = '';
      return;
    }
    const suggestionsList = searchTerms(trimmed).filter((term) => !selectedTerms.has(term.id));
    if (suggestionsList.length === 0) {
      addTerm(trimmed);
      input.value = '';
      suggestions.innerHTML = '';
      return;
    }
    if (suggestionsList.length === 1) {
      addTerm(suggestionsList[0].id);
      input.value = '';
      suggestions.innerHTML = '';
      return;
    }
    renderSuggestions(trimmed);
  }

  function renderSuggestions(query: string) {
    suggestions.innerHTML = '';
    const suggestionTerms = searchTerms(query).filter((term) => !selectedTerms.has(term.id));
    if (!suggestionTerms.length) {
      const empty = document.createElement('div');
      empty.className = 'taxonomy-suggestions__empty';
      empty.textContent = query.trim()
        ? 'No matches. Try another term or paste an ID.'
        : 'No indexed suggestions. Paste term IDs or start typing to search.';
      suggestions.appendChild(empty);
      return;
    }
    suggestionTerms.forEach((term) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'taxonomy-suggestion';

      const labelText = `${term.term} (${term.id}) — ${term.vocabulary}`;
      if (query.length > 0) {
        const lowerLabel = labelText.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const matchIndex = lowerLabel.indexOf(lowerQuery);

        if (matchIndex >= 0) {
          const pre = labelText.substring(0, matchIndex);
          const match = labelText.substring(matchIndex, matchIndex + query.length);
          const post = labelText.substring(matchIndex + query.length);
          button.innerHTML = `${pre}<b>${match}</b>${post}`;
        } else {
          button.textContent = labelText;
        }
      } else {
        button.textContent = labelText;
      }

      button.addEventListener('click', () => {
        addTerm(term.id);
        input.value = '';
        suggestions.innerHTML = '';
      });
      suggestions.appendChild(button);
    });
  }

  input.addEventListener('input', () => {
    const value = input.value.trim();
    renderSuggestions(value);
  });

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      renderSuggestions('');
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTermByQuery(input.value);
      input.value = '';
    }
  });

  renderSelectedChips();
  updateDataset();

  label.appendChild(input);
  row.append(label, hint, selectedContainer, suggestions, removeButton);
  container.appendChild(row);
  existing.add(dimension);
}

function collectTaxonomyValues(container: HTMLElement): Record<string, string[]> {
  const taxonomy: Record<string, string[]> = {};
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.taxonomy-row'));
  for (const row of rows) {
    const dimension = row.dataset.dimension;
    if (!dimension) continue;
    const selected = row.dataset.selectedTerms ? (JSON.parse(row.dataset.selectedTerms) as string[]) : [];
    if (selected.length) {
      taxonomy[dimension] = selected;
      continue;
    }
    const input = row.querySelector<HTMLInputElement>('input');
    if (!input) continue;
    const values = input.value
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length > 0) {
      taxonomy[dimension] = values;
    }
  }
  return taxonomy;
}

function pruneTaxonomyRows(container: HTMLElement, active: Set<string>, allowed?: Set<string>) {
  if (!allowed || allowed.size === 0) {
    return;
  }
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.taxonomy-row'));
  for (const row of rows) {
    const dimension = row.dataset.dimension;
    if (!dimension) {
      continue;
    }
    if (!allowed.has(dimension)) {
      active.delete(dimension);
      row.remove();
    }
  }
}

function renderSection(
  container: HTMLElement,
  heading: string,
  items: PlacementExplanation[],
  emptyState: string,
  tone: ResultSectionTone,
  isReactive = false,
) {
  container.innerHTML = '';
  container.className = `results-group results-group--${tone}`;
  const title = document.createElement('h3');
  title.textContent = `${heading} (${items.length})`;
  container.appendChild(title);

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = emptyState;
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'placements-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'placement-card';
    const header = document.createElement('div');
    header.className = 'placement-header';
    const titleLine = document.createElement('div');
    titleLine.className = 'placement-title';
    if (item.surfaceLabel) {
      const surface = document.createElement('strong');
      surface.textContent = item.surfaceLabel;
      titleLine.appendChild(surface);
    } else if (item.page) {
      const page = document.createElement('strong');
      page.textContent = item.page;
      titleLine.appendChild(page);
    } else {
      titleLine.textContent = item.viewLabel;
    }

    header.appendChild(titleLine);
    const badges = collectBadges(item);
    if (badges.length > 0) {
      const badgeRow = document.createElement('div');
      badgeRow.className = 'placement-badges';
      for (const badge of badges) {
        const element = document.createElement('span');
        element.className = `placement-badge${badge.tone ? ` placement-badge--${badge.tone}` : ''}`;
        element.textContent = badge.label;
        badgeRow.appendChild(element);
      }
      header.appendChild(badgeRow);
    }

    const reason = document.createElement('div');
    reason.className = 'placement-reason';
    const reasonParts = splitReason(item.reason);
    reason.textContent = reasonParts.lead;

    li.append(header, reason);

    if (item.locationCount || item.samplePages?.length) {
      const summary = document.createElement('div');
      summary.className = 'placement-summary';
      if (item.locationCount) {
        const count = document.createElement('span');
        count.textContent = `${item.locationCount} matching page${item.locationCount === 1 ? '' : 's'}`;
        summary.appendChild(count);
      }
      if (item.samplePages?.length) {
        const sample = document.createElement('span');
        sample.append('Sample page: ');
        sample.appendChild(createLink(item.samplePages[0], item.samplePages[0]));
        const remainder = item.samplePages.length > 1 ? item.samplePages.length - 1 : 0;
        if (remainder > 0) {
          sample.append(` +${remainder} more`);
        }
        summary.appendChild(sample);
      }
      li.appendChild(summary);
    } else if (item.page) {
      const summary = document.createElement('div');
      summary.className = 'placement-summary';
      const sample = document.createElement('span');
      sample.append('Page: ');
      sample.appendChild(createLink(item.url ?? item.page, item.page));
      summary.appendChild(sample);
      li.appendChild(summary);
    }

    const detailLines = [...reasonParts.details];
    if (item.context) {
      const ctxDetails = describeContext(item.context);
      if (ctxDetails.length) {
        detailLines.push(...ctxDetails);
      }
    }

    if (detailLines.length || item.viewId || item.displayId) {
      const details = document.createElement('details');
      details.className = 'placement-details';
      if (isReactive && tone === 'excluded') {
        details.open = true;
      }
      const summary = document.createElement('summary');
      summary.textContent = 'Details';
      details.appendChild(summary);

      const meta = document.createElement('div');
      meta.className = 'placement-context';
      const technicalBits = [`View: ${item.viewLabel} (${item.displayId})`];
      if (item.displayTitle && item.displayTitle !== item.viewLabel) {
        technicalBits.push(`Display title: ${item.displayTitle}`);
      }
      if (detailLines.length) {
        technicalBits.push(...detailLines);
      }
      meta.textContent = technicalBits.join(' • ');
      details.appendChild(meta);
      li.appendChild(details);
    }

    list.appendChild(li);
  }

  container.appendChild(list);
}

async function init() {
  const [entries, taxonomyData] = await Promise.all([loadPlacementMap(), loadContentTaxonomies()]);
  const taxonomyMap = buildTaxonomyMapFromDataset(taxonomyData);
  const taxonomyTermsList = Array.from(taxonomyMap.values());
  const termsByVocabulary = buildTermsByVocabulary(taxonomyMap);
  const contentTypeOptions = collectContentTypeOptions(entries, taxonomyData);
  const taxonomyFieldsByType = buildContentTypeFieldMap(taxonomyData);
  const dimensionMeta = collectDimensionMeta(entries, taxonomyMap, taxonomyData);
  enrichDimensionSamples(dimensionMeta, taxonomyData, termsByVocabulary);
  const dimensionVocabularyMap = buildDimensionVocabularyMap(entries, taxonomyData);

  const form = document.querySelector<HTMLFormElement>('#advisor-form');
  const contentTypeSelect = document.querySelector<HTMLSelectElement>('#content-type');
  const taxonomySelect = document.querySelector<HTMLSelectElement>('#taxonomy-select');
  const addTaxonomyButton = document.querySelector<HTMLButtonElement>('#add-taxonomy');
  const taxonomyContainer = document.querySelector<HTMLElement>('#taxonomy-container');
  const taxonomyHelper = document.querySelector<HTMLElement>('#taxonomy-helper');
  const resultsSummary = document.querySelector<HTMLElement>('#results-summary');
  const resultsConfirmed = document.querySelector<HTMLElement>('#results-confirmed');
  const resultsLimited = document.querySelector<HTMLElement>('#results-limited');
  const resultsExcluded = document.querySelector<HTMLElement>('#results-excluded');

  const submitButton = document.querySelector<HTMLButtonElement>('#submit-button');
  const resetButton = document.querySelector<HTMLButtonElement>('#reset-button');
  const initialEmptyState = document.querySelector<HTMLElement>('#initial-empty-state');

  if (
    !form ||
    !contentTypeSelect ||
    !taxonomySelect ||
    !addTaxonomyButton ||
    !taxonomyContainer ||
    !resultsSummary ||
    !resultsConfirmed ||
    !resultsLimited ||
    !resultsExcluded ||
    !submitButton ||
    !resetButton ||
    !initialEmptyState
  ) {
    throw new Error('Placement Advisor UI elements are missing.');
  }

  renderContentTypeSelect(contentTypeSelect, contentTypeOptions);
  const activeDimensions = new Set<string>();
  let currentFieldMap = new Map<string, ContentTypeTaxonomyField>();

  const clearTaxonomyRows = () => {
    activeDimensions.clear();
    if (taxonomyContainer) taxonomyContainer.innerHTML = '';
  };

  const setTaxonomyHelper = (message: string) => {
    if (taxonomyHelper) {
      taxonomyHelper.textContent = message;
    }
  };

  function updateTaxonomyControls() {
    if (!contentTypeSelect || !taxonomySelect || !addTaxonomyButton || !submitButton || !taxonomyContainer) return;

    const selectedType = contentTypeSelect.value;
    if (!selectedType) {
      currentFieldMap = new Map();
      renderTaxonomyOptions(taxonomySelect, addTaxonomyButton, dimensionMeta, null);
      clearTaxonomyRows();
      setTaxonomyHelper('Select a content type to see available taxonomy filters.');
      submitButton.disabled = true;
      return;
    }
    submitButton.disabled = false;
    const canonicalType = canonicalizeKey(selectedType);
    const allowedFields = canonicalType ? taxonomyFieldsByType.get(canonicalType) : undefined;
    if (!allowedFields || allowedFields.length === 0) {
      currentFieldMap = new Map();
      renderTaxonomyOptions(taxonomySelect, addTaxonomyButton, dimensionMeta, []);
      clearTaxonomyRows();
      setTaxonomyHelper('This content type does not expose taxonomy filters in Drupal.');
      return;
    }
    currentFieldMap = new Map(allowedFields.map((field) => [field.dimension, field]));
    renderTaxonomyOptions(taxonomySelect, addTaxonomyButton, dimensionMeta, allowedFields);
    const allowedSet = new Set(currentFieldMap.keys());
    pruneTaxonomyRows(taxonomyContainer, activeDimensions, allowedSet);
    const helperList = allowedFields.map((field) => field.label ?? field.dimension);
    setTaxonomyHelper(helperList.length ? `Available filters: ${helperList.join(', ')}.` : '');
  }

  updateTaxonomyControls();

  contentTypeSelect.addEventListener('change', () => {
    updateTaxonomyControls();
  });

  addTaxonomyButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (!taxonomySelect) return;
    const value = taxonomySelect.value;
    if (!value) {
      return;
    }
    const meta = dimensionMeta.get(value);
    if (!meta) {
      return;
    }
    const fieldOverride = currentFieldMap.get(value);
    const vocabularyId = fieldOverride?.vocabulary ?? dimensionVocabularyMap.get(value);
    const restrictVocabulary = Boolean(vocabularyId && termsByVocabulary.has(vocabularyId));
    if (taxonomyContainer) {
      addTaxonomyRow(taxonomyContainer, value, meta, activeDimensions, taxonomyTermsList, termsByVocabulary, {
        label: fieldOverride?.label ?? meta.label,
        vocabularyId,
        restrictVocabulary,
        required: fieldOverride?.required,
      });
    }
  });

  resetButton.addEventListener('click', () => {
    if (contentTypeSelect) contentTypeSelect.value = '';
    updateTaxonomyControls();
    if (resultsSummary) resultsSummary.innerHTML = '';
    if (resultsConfirmed) resultsConfirmed.innerHTML = '';
    if (resultsLimited) resultsLimited.style.display = 'block';
    if (resultsExcluded) resultsExcluded.innerHTML = '';
    if (initialEmptyState) initialEmptyState.style.display = 'block';
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (initialEmptyState) initialEmptyState.style.display = 'none';
    const isReactive = document.querySelector<HTMLInputElement>('input[name="workflow-mode"]:checked')?.value === 'reactive';
    const taxonomy = taxonomyContainer ? collectTaxonomyValues(taxonomyContainer) : {};
    const payload: ContentInput = {
      content_type: contentTypeSelect?.value ?? '',
      taxonomy,
    };
    const result = getContentPlacements(payload, entries, {
      formatTerm: (value) => formatTermValue(value, taxonomyMap),
    });

    const eligible = [...result.willAppear, ...result.eligibleButLimited];

    if (resultsLimited) resultsLimited.style.display = 'none';

    if (resultsConfirmed && resultsExcluded) {
      if (isReactive) {
        resultsConfirmed.style.opacity = '0.6';
        resultsExcluded.style.opacity = '1';
        resultsExcluded.style.order = '-1';
      } else {
        resultsConfirmed.style.opacity = '1';
        resultsExcluded.style.opacity = '0.6';
        resultsExcluded.style.order = '0';
      }
    }

    if (resultsSummary) renderSummary(resultsSummary, eligible.length, result.excluded.length);
    if (resultsConfirmed) renderSection(resultsConfirmed, 'Eligible placements', eligible, 'No eligible placements detected.', 'confirmed', isReactive);
    if (resultsExcluded) {
      renderSection(
        resultsExcluded,
        "Won't appear",
        result.excluded,
        'No exclusions based on the provided filters.',
        'excluded',
        isReactive
      );
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    const container = document.getElementById('app');
    if (container) {
      container.innerHTML = `<p class="error">Failed to initialize: ${error instanceof Error ? error.message : String(
        error,
      )}</p>`;
    }
    console.error(error);
  });
});
