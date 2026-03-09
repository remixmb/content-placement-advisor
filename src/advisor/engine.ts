import {
  ContentInput,
  PlacementLocation,
  PlacementLocationContext,
  PlacementAdvisorOptions,
  PlacementAdvisorResult,
  PlacementExplanation,
  PlacementMapEntry,
  TaxonomyFilterDescriptor,
} from '../types.js';

interface EvaluationResult {
  status: 'match' | 'exclude';
  reason?: string;
  details?: string[];
  filtersUsed?: string[];
  score: number;
}

interface NormalizedContent {
  contentType: string;
  taxonomy: Record<string, Set<string>>;
  allTerms: Set<string>;
}

interface LocationEvaluationResult {
  passed: boolean;
  detail?: string;
  reason?: string;
  score: number;
  argumentDetail?: PlacementLocationContext['viewArguments'] extends Array<infer T> ? T : never;
}

interface ScoredExplanation {
  score: number;
  explanation: PlacementExplanation;
}

function canonicalKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeContent(input: ContentInput): NormalizedContent {
  const contentType = (input.content_type ?? '').trim();
  const taxonomy: Record<string, Set<string>> = {};
  const allTerms = new Set<string>();
  const source = input.taxonomy ?? {};

  for (const [key, values] of Object.entries(source)) {
    const normalizedKey = canonicalKey(key);
    const set = taxonomy[normalizedKey] ?? new Set<string>();
    for (const value of values ?? []) {
      const normalizedValue = `${value ?? ''}`.trim();
      if (normalizedValue) {
        set.add(normalizedValue);
        allTerms.add(normalizedValue);
      }
    }
    taxonomy[normalizedKey] = set;
  }

  return { contentType, taxonomy, allTerms };
}

type TermFormatter = (value: string) => string;

function formatTermValue(value: string, formatter?: TermFormatter): string {
  if (formatter) {
    const formatted = formatter(value);
    if (formatted) {
      return formatted;
    }
  }
  return value;
}

function formatTermList(values: string[], formatter?: TermFormatter): string {
  return values.map((value) => formatTermValue(value, formatter)).join(', ');
}

function getFilterLabel(filter: TaxonomyFilterDescriptor): string {
  return filter.label || filter.dimension;
}

function evaluateTaxonomyFilter(
  filter: TaxonomyFilterDescriptor,
  taxonomy: Record<string, Set<string>>,
  formatter?: TermFormatter,
): { passed: boolean; message?: string } {
  if (!filter.dimension || filter.values.length === 0) {
    return { passed: true };
  }
  const key = canonicalKey(filter.dimension);
  const values = taxonomy[key] ?? new Set<string>();

  if (filter.behavior === 'exclude') {
    const conflict = filter.values.filter((value) => values.has(value));
    if (conflict.length > 0) {
      return {
        passed: false,
        message: `Excluded by ${getFilterLabel(filter)}: ${formatTermList(conflict, formatter)}`,
      };
    }
    return { passed: true, message: `Avoids excluded ${getFilterLabel(filter)}` };
  }

  if (filter.behavior === 'require-all') {
    const missing = filter.values.filter((value) => !values.has(value));
    if (missing.length > 0) {
      return {
        passed: false,
        message: `Missing required ${getFilterLabel(filter)} term(s): ${formatTermList(missing, formatter)}`,
      };
    }
    return {
      passed: true,
      message: `Includes required ${getFilterLabel(filter)} term(s): ${formatTermList(filter.values, formatter)}`,
    };
  }

  const matches = filter.values.filter((value) => values.has(value));
  if (matches.length === 0) {
    return {
      passed: false,
      message: `Needs any ${getFilterLabel(filter)} term from [${formatTermList(filter.values, formatter)}]`,
    };
  }
  return {
    passed: true,
    message: `Shares ${getFilterLabel(filter)} term(s): ${formatTermList(matches, formatter)}`,
  };
}

function evaluateEntry(
  entry: PlacementMapEntry,
  content: NormalizedContent,
  formatter?: TermFormatter,
): EvaluationResult {
  const details: string[] = [];
  const filtersUsed: string[] = [];
  let score = entry.specificityWeight ?? 0;

  if (entry.filters.contentTypes.length > 0) {
    if (!content.contentType) {
      return {
        status: 'exclude',
        reason: `Requires content type ${entry.filters.contentTypes.join(', ')}`,
        score,
      };
    }
    const allowed = entry.filters.contentTypes.map((value) => value.toLowerCase());
    if (!allowed.includes(content.contentType.toLowerCase())) {
      return {
        status: 'exclude',
        reason: `Requires content type ${entry.filters.contentTypes.join(', ')}`,
        score,
      };
    }
    details.push(`Matches allowed content type ${content.contentType}`);
    filtersUsed.push('content_type');
    score += 12;
  }

  for (const filter of entry.filters.taxonomy) {
    const result = evaluateTaxonomyFilter(filter, content.taxonomy, formatter);
    if (!result.passed) {
      return { status: 'exclude', reason: result.message, score };
    }
    if (result.message) {
      details.push(result.message);
    }
    filtersUsed.push(`taxonomy:${filter.dimension}`);
    score += filter.behavior === 'require-all' ? 18 : 14;
  }

  if (entry.placementSource === 'template') {
    score += 10;
  } else if (entry.placementSource === 'views_reference_paragraph') {
    details.push('Views Reference placement');
    score += 6;
  }

  if (entry.contextualFilters.length > 0 || entry.placementSource) {
    const names = entry.contextualFilters
      .map((filter) => filter.label ?? filter.id)
      .filter(Boolean)
      .join(', ');
    if (names) {
      details.push(`Also filtered by contextual parameters: ${names}`);
    }
  }

  return { status: 'match', details, filtersUsed, score };
}

function matchTokenAgainstContent(
  value: string,
  dimension: string | undefined,
  content: NormalizedContent,
): boolean {
  if (dimension) {
    const key = canonicalKey(dimension);
    const values = content.taxonomy[key];
    if (values?.has(value)) {
      return true;
    }
  }
  return content.allTerms.has(value);
}

function formatTokenLabel(
  token: { value: string; label?: string },
  formatter?: TermFormatter,
): string {
  if (token.label) {
    return token.label;
  }
  return formatTermValue(token.value, formatter);
}

function evaluateLocationContext(
  entry: PlacementMapEntry,
  location: PlacementLocation,
  content: NormalizedContent,
  formatter?: TermFormatter,
): LocationEvaluationResult {
  const viewArguments = location.context?.viewArguments;
  if (!viewArguments || !viewArguments.length) {
    return { passed: true, score: 0 };
  }
  const matchingArguments = viewArguments.filter(
    (arg) =>
      (!arg.viewId || arg.viewId === entry.viewId) &&
      (!arg.display || arg.display === entry.displayId || arg.viewDisplayId === entry.displayId),
  );
  const argumentDetail = matchingArguments.sort((left, right) => {
    const leftExact = left.display === entry.displayId || left.viewDisplayId === entry.displayId ? 1 : 0;
    const rightExact = right.display === entry.displayId || right.viewDisplayId === entry.displayId ? 1 : 0;
    if (rightExact !== leftExact) {
      return rightExact - leftExact;
    }
    const leftArgs = left.argumentList?.length ?? 0;
    const rightArgs = right.argumentList?.length ?? 0;
    if (rightArgs !== leftArgs) {
      return rightArgs - leftArgs;
    }
    const leftSource =
      left.source === 'drupal-settings' || left.source === 'template-derived' || left.source === 'section-context'
        ? 1
        : 0;
    const rightSource =
      right.source === 'drupal-settings' || right.source === 'template-derived' || right.source === 'section-context'
        ? 1
        : 0;
    return rightSource - leftSource;
  })[0];
  if (!argumentDetail || !argumentDetail.argumentList || argumentDetail.argumentList.length === 0) {
    return { passed: true, score: 0, argumentDetail };
  }
  const matched: string[] = [];
  let score = 0;
  let evaluated = false;
  const argumentDimensions = argumentDetail.argumentDimensions ?? [];
  const argumentTerms = argumentDetail.argumentTerms ?? [];
  const argumentLabels = argumentDetail.argumentValueLabels ?? [];
  const argumentSlotOperators = argumentDetail.argumentSlotOperators ?? [];
  const argumentSkipMatch = argumentDetail.argumentSkipMatch ?? [];

  for (let argIndex = 0; argIndex < argumentDetail.argumentList.length; argIndex++) {
    const dimension = argumentDimensions[argIndex];
    const skipMatch = argumentSkipMatch[argIndex];
    const terms = argumentTerms[argIndex] ?? [];
    if (skipMatch) {
      continue;
    }
    if (!dimension && terms.every((term) => !term.dimension)) {
      continue;
    }
    evaluated = true;
    const operator = argumentSlotOperators[argIndex] ?? 'single';
    const slotTerms = terms.length
      ? terms
      : (argumentDetail.argumentList[argIndex] ?? '')
          .split(/[,+]/)
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => ({ value, dimension }));
    if (!slotTerms.length) {
      continue;
    }
    const matchedTerms = slotTerms.filter((term) =>
      matchTokenAgainstContent(term.value, term.dimension ?? dimension, content),
    );
    const passed =
      operator === 'and' ? matchedTerms.length === slotTerms.length : matchedTerms.length > 0;

    if (!passed) {
      const labeledValues = argumentLabels[argIndex]?.length
        ? argumentLabels[argIndex]
        : slotTerms.map((term) => formatTokenLabel(term, formatter));
      const operatorLabel = operator === 'and' ? 'all of' : 'any of';
      const dimensionLabel = dimension ?? 'page taxonomy';
      return {
        passed: false,
        reason: `Requires contextual ${dimensionLabel}: ${operatorLabel} ${labeledValues.join(', ')}`,
        score,
        argumentDetail,
      };
    }
    const formattedMatches = matchedTerms.map((term) => formatTokenLabel(term, formatter));
    const detailPrefix =
      argumentDetail.source === 'template-derived'
        ? 'Template uses'
        : argumentDetail.source === 'section-context'
          ? 'Inherits section'
          : 'Matches contextual';
    matched.push(`${detailPrefix} ${dimension ?? 'page taxonomy'}: ${formattedMatches.join(', ')}`);
    score += matchedTerms.length * 16;
  }

  if (!evaluated) {
    return { passed: true, score, argumentDetail };
  }

  return { passed: true, detail: matched.join('; ') || undefined, score, argumentDetail };
}

function describeLimit(entry: PlacementMapEntry): string | undefined {
  if (!entry.limit || entry.limit <= 0) {
    return undefined;
  }
  const sort = entry.sorts[0];
  if (sort?.field) {
    return `View limited to ${entry.limit} item(s), sorted by ${sort.field} ${sort.order ?? ''}`.trim();
  }
  return `View limited to ${entry.limit} item(s).`;
}

function buildExplanation(
  entry: PlacementMapEntry,
  location: { page: string; url: string; context?: PlacementLocationContext },
  baseReason: string,
): PlacementExplanation {
  return {
    page: location.page,
    url: location.url,
    viewId: entry.viewId,
    viewLabel: entry.viewLabel,
    displayId: entry.displayId,
    displayTitle: entry.displayTitle,
    surfaceLabel: surfaceLabelForLocation(entry, location),
    limit: entry.limit ?? undefined,
    reason: baseReason,
    context: location.context,
  };
}

function sortScoredExplanations(items: ScoredExplanation[]): PlacementExplanation[] {
  return items
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftPage = left.explanation.page ?? '';
      const rightPage = right.explanation.page ?? '';
      return leftPage.localeCompare(rightPage);
    })
    .map((item) => item.explanation);
}

function templateSurfaceLabel(entry: PlacementMapEntry): string {
  if (entry.viewId === 'profiles_grid') {
    return 'Related profiles on profile pages';
  }
  if (entry.viewId === 'stories_teaser_cards') {
    return 'Related stories on story pages';
  }
  return `${entry.viewLabel} (${entry.displayId})`;
}

function expectedTemplateBundle(entry: PlacementMapEntry): string | undefined {
  if (entry.viewId === 'profiles_grid' && (entry.displayId === 'related' || entry.displayId === 'related_ambassadors')) {
    return 'profile';
  }
  if (entry.viewId === 'stories_teaser_cards' && entry.displayId === 'embed_all') {
    return 'story';
  }
  return undefined;
}

function isTemplateLocation(entry: PlacementMapEntry, location: PlacementLocation): boolean {
  const expectedBundle = expectedTemplateBundle(entry);
  if (!expectedBundle) {
    return false;
  }
  return location.context?.pageEntity?.bundle === expectedBundle;
}

function normalizeSurfaceContextLabel(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .replace(/\s*>\s*Main Content(?:\s*\(previous revision\))?$/i, '')
    .trim() || undefined;
}

function getLocationSurfaceName(location: PlacementLocation): string | undefined {
  return (
    location.context?.surfaceContext?.titleLabel ||
    normalizeSurfaceContextLabel(location.context?.surfaceContext?.contextLabel)
  );
}

function buildArgumentContextLabel(locationEvaluation: LocationEvaluationResult): string | undefined {
  const argumentDetail = locationEvaluation.argumentDetail;
  if (!argumentDetail?.argumentValueLabels?.length) {
    return undefined;
  }
  const labels = argumentDetail.argumentValueLabels
    .flat()
    .map((value) => value.trim())
    .filter(Boolean);
  if (!labels.length) {
    return undefined;
  }
  return Array.from(new Set(labels)).join(', ');
}

function friendlySurfaceBase(entry: PlacementMapEntry): string {
  if (entry.viewId === 'profiles_grid') {
    switch (entry.displayId) {
      case 'embed_3':
      case 'embed_4':
      case 'embed_7':
        return 'Admissions ambassadors';
      case 'embed_5':
        return 'Student profiles';
      case 'embed_6':
      case 'embed_8':
      case 'embed_1':
        return 'Community profiles';
      case 'related':
        return 'Related profiles';
      case 'related_ambassadors':
        return 'Related ambassadors';
      default:
        return 'Profiles';
    }
  }

  if (entry.viewId === 'stories_teaser_cards') {
    return 'Related stories';
  }

  if (entry.viewId === 'stories_list') {
    if (entry.displayId === 'embed_blog') {
      return 'Blog stories';
    }
    if (entry.displayId === 'embed_news') {
      return 'News stories';
    }
    return 'Stories';
  }

  if (entry.viewId === 'event_list' || entry.viewId === 'event_teaser_list') {
    return 'Events';
  }

  return entry.displayTitle || entry.viewLabel;
}

function surfaceLabelForLocation(
  entry: PlacementMapEntry,
  location: PlacementLocation,
): string {
  const explicit =
    location.context?.surfaceContext?.titleLabel ??
    location.context?.surfaceContext?.contextLabel;
  if (explicit) {
    return explicit;
  }
  if (isTemplateLocation(entry, location)) {
    return friendlySurfaceBase(entry);
  }
  if (entry.placementSource === 'template') {
    return entry.displayTitle || entry.viewLabel;
  }
  return friendlySurfaceBase(entry);
}

function shouldGroupLocationSurface(
  entry: PlacementMapEntry,
  location: PlacementLocation,
): boolean {
  if (isTemplateLocation(entry, location)) {
    return true;
  }
  const bundle = location.context?.pageEntity?.bundle;
  return bundle === 'story' || bundle === 'profile';
}

function groupedSurfaceLabel(
  entry: PlacementMapEntry,
  location: PlacementLocation,
  locationEvaluation?: LocationEvaluationResult,
  useGenericFallback = false,
): string {
  if (isTemplateLocation(entry, location)) {
    return templateSurfaceLabel(entry);
  }
  const explicitSurfaceName = getLocationSurfaceName(location);
  if (explicitSurfaceName && !useGenericFallback) {
    return explicitSurfaceName;
  }
  const baseLabel = friendlySurfaceBase(entry);
  const argumentContext = locationEvaluation ? buildArgumentContextLabel(locationEvaluation) : undefined;
  const bundle = location.context?.pageEntity?.bundle;
  if (bundle === 'story' || bundle === 'profile') {
    if (argumentContext) {
      return `${baseLabel} for ${argumentContext} on ${bundle} pages`;
    }
    return `${baseLabel} on ${bundle} pages`;
  }
  if (argumentContext) {
    return `${baseLabel} for ${argumentContext}`;
  }
  return baseLabel;
}

function buildGroupedSurfaceKey(
  entry: PlacementMapEntry,
  locationEvaluation: LocationEvaluationResult,
): string {
  const argumentDetail = locationEvaluation.argumentDetail;
  if (!argumentDetail?.argumentList?.length) {
    return `${entry.viewId}::${entry.displayId}`;
  }

  const pieces: string[] = [];
  for (let index = 0; index < argumentDetail.argumentList.length; index++) {
    if (argumentDetail.argumentSkipMatch?.[index]) {
      continue;
    }
    const terms = argumentDetail.argumentTerms?.[index] ?? [];
    const dimension = argumentDetail.argumentDimensions?.[index] ?? terms[0]?.dimension ?? `slot_${index}`;
    const values = (terms.length ? terms.map((term) => term.value) : [argumentDetail.argumentList[index]])
      .filter(Boolean)
      .sort();
    if (values.length) {
      pieces.push(`${dimension}=${values.join('|')}`);
    }
  }

  return `${entry.viewId}::${entry.displayId}::${pieces.join(';')}`;
}

function buildTemplateGroupReason(
  baseReason: string,
): string {
  return baseReason;
}

export function getContentPlacements(
  content: ContentInput,
  entries: PlacementMapEntry[],
  options?: PlacementAdvisorOptions,
): PlacementAdvisorResult {
  const normalized = normalizeContent(content);
  const willAppear: ScoredExplanation[] = [];
  const eligibleButLimited: ScoredExplanation[] = [];
  const excluded: ScoredExplanation[] = [];
  const groupedTemplateMatches = new Map<
    string,
    { score: number; explanation: PlacementExplanation; sampleSet: Set<string>; surfaceNames: Set<string> }
  >();
  const groupedTemplateExcluded = new Map<
    string,
    { score: number; explanation: PlacementExplanation; sampleSet: Set<string>; surfaceNames: Set<string> }
  >();

  for (const entry of entries) {
    const evaluation = evaluateEntry(entry, normalized, options?.formatTerm);
    if (evaluation.status === 'exclude') {
      excluded.push({
        score: evaluation.score,
        explanation: {
          viewId: entry.viewId,
          viewLabel: entry.viewLabel,
          displayId: entry.displayId,
          displayTitle: entry.displayTitle,
          reason: evaluation.reason ?? 'Filter mismatch',
          limit: entry.limit ?? undefined,
        },
      });
      continue;
    }

    const limitNote = describeLimit(entry);
    const baseReasonParts = [...(evaluation.details ?? [])];
    if (limitNote) {
      baseReasonParts.push(limitNote);
    }

    for (const location of entry.locations) {
      const locationEvaluation = evaluateLocationContext(entry, location, normalized, options?.formatTerm);
      if (!locationEvaluation.passed) {
        if (isTemplateLocation(entry, location)) {
          const groupKey = `${buildGroupedSurfaceKey(entry, locationEvaluation)}::${locationEvaluation.reason ?? 'context'}`;
          const existing = groupedTemplateExcluded.get(groupKey);
          const surfaceName = getLocationSurfaceName(location);
          if (existing) {
            existing.score = Math.max(existing.score, evaluation.score + locationEvaluation.score);
            existing.explanation.locationCount = (existing.explanation.locationCount ?? 1) + 1;
            if (surfaceName) {
              existing.surfaceNames.add(surfaceName);
            }
            existing.explanation.surfaceLabel = groupedSurfaceLabel(
              entry,
              location,
              locationEvaluation,
              existing.surfaceNames.size > 1,
            );
            if (existing.sampleSet.size < 3) {
              existing.sampleSet.add(location.page);
              existing.explanation.samplePages = Array.from(existing.sampleSet);
            }
          } else {
            const sampleSet = new Set<string>([location.page]);
            const surfaceNames = new Set<string>();
            if (surfaceName) {
              surfaceNames.add(surfaceName);
            }
            groupedTemplateExcluded.set(groupKey, {
              score: evaluation.score + locationEvaluation.score,
              sampleSet,
              surfaceNames,
              explanation: {
                viewId: entry.viewId,
                viewLabel: entry.viewLabel,
                displayId: entry.displayId,
                displayTitle: entry.displayTitle,
                surfaceLabel: groupedSurfaceLabel(entry, location, locationEvaluation),
                page: location.page,
                url: location.url,
                reason: locationEvaluation.reason ?? 'Contextual filter mismatch',
                limit: entry.limit ?? undefined,
                locationCount: 1,
                samplePages: [location.page],
              },
            });
          }
          continue;
        }
        excluded.push({
          score: evaluation.score + locationEvaluation.score,
          explanation: {
            viewId: entry.viewId,
            viewLabel: entry.viewLabel,
            displayId: entry.displayId,
            displayTitle: entry.displayTitle,
            page: location.page,
            url: location.url,
            reason: locationEvaluation.reason ?? 'Contextual filter mismatch',
            limit: entry.limit ?? undefined,
          },
        });
        continue;
      }
      const reasonParts = [...baseReasonParts];
      if (locationEvaluation.detail) {
        reasonParts.push(locationEvaluation.detail);
      }
      const reasonText = reasonParts.join('; ') || 'Matches view filters.';
      if (shouldGroupLocationSurface(entry, location)) {
        const groupKey = buildGroupedSurfaceKey(entry, locationEvaluation);
        const existing = groupedTemplateMatches.get(groupKey);
        const surfaceName = getLocationSurfaceName(location);
        if (existing) {
          existing.score = Math.max(existing.score, evaluation.score + locationEvaluation.score);
          existing.explanation.locationCount = (existing.explanation.locationCount ?? 1) + 1;
          if (surfaceName) {
            existing.surfaceNames.add(surfaceName);
          }
          existing.explanation.surfaceLabel = groupedSurfaceLabel(
            entry,
            location,
            locationEvaluation,
            existing.surfaceNames.size > 1,
          );
          if (existing.sampleSet.size < 3) {
            existing.sampleSet.add(location.page);
            existing.explanation.samplePages = Array.from(existing.sampleSet);
          }
          existing.explanation.reason = buildTemplateGroupReason(reasonText);
          continue;
        }

        const sampleSet = new Set<string>([location.page]);
        const surfaceNames = new Set<string>();
        if (surfaceName) {
          surfaceNames.add(surfaceName);
        }
        const groupedExplanation: PlacementExplanation = {
          ...buildExplanation(entry, location, reasonText),
          surfaceLabel: groupedSurfaceLabel(entry, location, locationEvaluation),
          locationCount: 1,
          samplePages: [location.page],
        };
        groupedExplanation.reason = buildTemplateGroupReason(
          reasonText,
        );
        groupedTemplateMatches.set(groupKey, {
          score: evaluation.score + locationEvaluation.score,
          explanation: groupedExplanation,
          sampleSet,
          surfaceNames,
        });
        continue;
      }

      const explanation = buildExplanation(entry, location, reasonText);
      const scored = {
        score: evaluation.score + locationEvaluation.score,
        explanation,
      };
      if (entry.limit && entry.limit > 0) {
        eligibleButLimited.push(scored);
      } else {
        willAppear.push(scored);
      }
    }
  }

  for (const grouped of groupedTemplateMatches.values()) {
    const scored = { score: grouped.score, explanation: grouped.explanation };
    if (grouped.explanation.limit && grouped.explanation.limit > 0) {
      eligibleButLimited.push(scored);
    } else {
      willAppear.push(scored);
    }
  }

  for (const grouped of groupedTemplateExcluded.values()) {
    excluded.push({ score: grouped.score, explanation: grouped.explanation });
  }

  return {
    willAppear: sortScoredExplanations(willAppear),
    eligibleButLimited: sortScoredExplanations(eligibleButLimited),
    excluded: sortScoredExplanations(excluded),
  };
}
