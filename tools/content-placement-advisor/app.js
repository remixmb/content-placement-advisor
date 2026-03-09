// src/advisor/engine.ts
function canonicalKey(input) {
  return input.trim().toLowerCase().replace(/\s+/g, "-");
}
function normalizeContent(input) {
  const contentType = (input.content_type ?? "").trim();
  const taxonomy = {};
  const allTerms = /* @__PURE__ */ new Set();
  const source = input.taxonomy ?? {};
  for (const [key, values] of Object.entries(source)) {
    const normalizedKey = canonicalKey(key);
    const set = taxonomy[normalizedKey] ?? /* @__PURE__ */ new Set();
    for (const value of values ?? []) {
      const normalizedValue = `${value ?? ""}`.trim();
      if (normalizedValue) {
        set.add(normalizedValue);
        allTerms.add(normalizedValue);
      }
    }
    taxonomy[normalizedKey] = set;
  }
  return { contentType, taxonomy, allTerms };
}
function formatTermValue(value, formatter) {
  if (formatter) {
    const formatted = formatter(value);
    if (formatted) {
      return formatted;
    }
  }
  return value;
}
function formatTermList(values, formatter) {
  return values.map((value) => formatTermValue(value, formatter)).join(", ");
}
function getFilterLabel(filter) {
  return filter.label || filter.dimension;
}
function evaluateTaxonomyFilter(filter, taxonomy, formatter) {
  if (!filter.dimension || filter.values.length === 0) {
    return { passed: true };
  }
  const key = canonicalKey(filter.dimension);
  const values = taxonomy[key] ?? /* @__PURE__ */ new Set();
  if (filter.behavior === "exclude") {
    const conflict = filter.values.filter((value) => values.has(value));
    if (conflict.length > 0) {
      return {
        passed: false,
        message: `Excluded by ${getFilterLabel(filter)}: ${formatTermList(conflict, formatter)}`
      };
    }
    return { passed: true, message: `Avoids excluded ${getFilterLabel(filter)}` };
  }
  if (filter.behavior === "require-all") {
    const missing = filter.values.filter((value) => !values.has(value));
    if (missing.length > 0) {
      return {
        passed: false,
        message: `Missing required ${getFilterLabel(filter)} term(s): ${formatTermList(missing, formatter)}`
      };
    }
    return {
      passed: true,
      message: `Includes required ${getFilterLabel(filter)} term(s): ${formatTermList(filter.values, formatter)}`
    };
  }
  const matches = filter.values.filter((value) => values.has(value));
  if (matches.length === 0) {
    return {
      passed: false,
      message: `Needs any ${getFilterLabel(filter)} term from [${formatTermList(filter.values, formatter)}]`
    };
  }
  return {
    passed: true,
    message: `Shares ${getFilterLabel(filter)} term(s): ${formatTermList(matches, formatter)}`
  };
}
function evaluateEntry(entry, content, formatter) {
  const details = [];
  const filtersUsed = [];
  let score = entry.specificityWeight ?? 0;
  if (entry.filters.contentTypes.length > 0) {
    if (!content.contentType) {
      return {
        status: "exclude",
        reason: `Requires content type ${entry.filters.contentTypes.join(", ")}`,
        score
      };
    }
    const allowed = entry.filters.contentTypes.map((value) => value.toLowerCase());
    if (!allowed.includes(content.contentType.toLowerCase())) {
      return {
        status: "exclude",
        reason: `Requires content type ${entry.filters.contentTypes.join(", ")}`,
        score
      };
    }
    details.push(`Matches allowed content type ${content.contentType}`);
    filtersUsed.push("content_type");
    score += 12;
  }
  for (const filter of entry.filters.taxonomy) {
    const result = evaluateTaxonomyFilter(filter, content.taxonomy, formatter);
    if (!result.passed) {
      return { status: "exclude", reason: result.message, score };
    }
    if (result.message) {
      details.push(result.message);
    }
    filtersUsed.push(`taxonomy:${filter.dimension}`);
    score += filter.behavior === "require-all" ? 18 : 14;
  }
  if (entry.placementSource === "template") {
    score += 10;
  } else if (entry.placementSource === "views_reference_paragraph") {
    details.push("Views Reference placement");
    score += 6;
  }
  if (entry.contextualFilters.length > 0 || entry.placementSource) {
    const names = entry.contextualFilters.map((filter) => filter.label ?? filter.id).filter(Boolean).join(", ");
    if (names) {
      details.push(`Also filtered by contextual parameters: ${names}`);
    }
  }
  return { status: "match", details, filtersUsed, score };
}
function matchTokenAgainstContent(value, dimension, content) {
  if (dimension) {
    const key = canonicalKey(dimension);
    const values = content.taxonomy[key];
    if (values?.has(value)) {
      return true;
    }
  }
  return content.allTerms.has(value);
}
function formatTokenLabel(token, formatter) {
  if (token.label) {
    return token.label;
  }
  return formatTermValue(token.value, formatter);
}
function evaluateLocationContext(entry, location, content, formatter) {
  const viewArguments = location.context?.viewArguments;
  if (!viewArguments || !viewArguments.length) {
    return { passed: true, score: 0 };
  }
  const matchingArguments = viewArguments.filter(
    (arg) => (!arg.viewId || arg.viewId === entry.viewId) && (!arg.display || arg.display === entry.displayId || arg.viewDisplayId === entry.displayId)
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
    const leftSource = left.source === "drupal-settings" || left.source === "template-derived" || left.source === "section-context" ? 1 : 0;
    const rightSource = right.source === "drupal-settings" || right.source === "template-derived" || right.source === "section-context" ? 1 : 0;
    return rightSource - leftSource;
  })[0];
  if (!argumentDetail || !argumentDetail.argumentList || argumentDetail.argumentList.length === 0) {
    return { passed: true, score: 0, argumentDetail };
  }
  const matched = [];
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
    const operator = argumentSlotOperators[argIndex] ?? "single";
    const slotTerms = terms.length ? terms : (argumentDetail.argumentList[argIndex] ?? "").split(/[,+]/).map((value) => value.trim()).filter(Boolean).map((value) => ({ value, dimension }));
    if (!slotTerms.length) {
      continue;
    }
    const matchedTerms = slotTerms.filter(
      (term) => matchTokenAgainstContent(term.value, term.dimension ?? dimension, content)
    );
    const passed = operator === "and" ? matchedTerms.length === slotTerms.length : matchedTerms.length > 0;
    if (!passed) {
      const labeledValues = argumentLabels[argIndex]?.length ? argumentLabels[argIndex] : slotTerms.map((term) => formatTokenLabel(term, formatter));
      const operatorLabel = operator === "and" ? "all of" : "any of";
      const dimensionLabel = dimension ?? "page taxonomy";
      return {
        passed: false,
        reason: `Requires contextual ${dimensionLabel}: ${operatorLabel} ${labeledValues.join(", ")}`,
        score,
        argumentDetail
      };
    }
    const formattedMatches = matchedTerms.map((term) => formatTokenLabel(term, formatter));
    const detailPrefix = argumentDetail.source === "template-derived" ? "Template uses" : argumentDetail.source === "section-context" ? "Inherits section" : "Matches contextual";
    matched.push(`${detailPrefix} ${dimension ?? "page taxonomy"}: ${formattedMatches.join(", ")}`);
    score += matchedTerms.length * 16;
  }
  if (!evaluated) {
    return { passed: true, score, argumentDetail };
  }
  return { passed: true, detail: matched.join("; ") || void 0, score, argumentDetail };
}
function describeLimit(entry) {
  if (!entry.limit || entry.limit <= 0) {
    return void 0;
  }
  const sort = entry.sorts[0];
  if (sort?.field) {
    return `View limited to ${entry.limit} item(s), sorted by ${sort.field} ${sort.order ?? ""}`.trim();
  }
  return `View limited to ${entry.limit} item(s).`;
}
function buildExplanation(entry, location, baseReason) {
  return {
    page: location.page,
    url: location.url,
    viewId: entry.viewId,
    viewLabel: entry.viewLabel,
    displayId: entry.displayId,
    displayTitle: entry.displayTitle,
    surfaceLabel: surfaceLabelForLocation(entry, location),
    limit: entry.limit ?? void 0,
    reason: baseReason,
    context: location.context
  };
}
function sortScoredExplanations(items) {
  return items.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const leftPage = left.explanation.page ?? "";
    const rightPage = right.explanation.page ?? "";
    return leftPage.localeCompare(rightPage);
  }).map((item) => item.explanation);
}
function templateSurfaceLabel(entry) {
  if (entry.viewId === "profiles_grid") {
    return "Related profiles on profile pages";
  }
  if (entry.viewId === "stories_teaser_cards") {
    return "Related stories on story pages";
  }
  return `${entry.viewLabel} (${entry.displayId})`;
}
function expectedTemplateBundle(entry) {
  if (entry.viewId === "profiles_grid" && (entry.displayId === "related" || entry.displayId === "related_ambassadors")) {
    return "profile";
  }
  if (entry.viewId === "stories_teaser_cards" && entry.displayId === "embed_all") {
    return "story";
  }
  return void 0;
}
function isTemplateLocation(entry, location) {
  const expectedBundle = expectedTemplateBundle(entry);
  if (!expectedBundle) {
    return false;
  }
  return location.context?.pageEntity?.bundle === expectedBundle;
}
function normalizeSurfaceContextLabel(value) {
  if (!value) {
    return void 0;
  }
  return value.replace(/\s*>\s*Main Content(?:\s*\(previous revision\))?$/i, "").trim() || void 0;
}
function getLocationSurfaceName(location) {
  return location.context?.surfaceContext?.titleLabel || normalizeSurfaceContextLabel(location.context?.surfaceContext?.contextLabel);
}
function buildArgumentContextLabel(locationEvaluation) {
  const argumentDetail = locationEvaluation.argumentDetail;
  if (!argumentDetail?.argumentValueLabels?.length) {
    return void 0;
  }
  const labels = argumentDetail.argumentValueLabels.flat().map((value) => value.trim()).filter(Boolean);
  if (!labels.length) {
    return void 0;
  }
  return Array.from(new Set(labels)).join(", ");
}
function friendlySurfaceBase(entry) {
  if (entry.viewId === "profiles_grid") {
    switch (entry.displayId) {
      case "embed_3":
      case "embed_4":
      case "embed_7":
        return "Admissions ambassadors";
      case "embed_5":
        return "Student profiles";
      case "embed_6":
      case "embed_8":
      case "embed_1":
        return "Community profiles";
      case "related":
        return "Related profiles";
      case "related_ambassadors":
        return "Related ambassadors";
      default:
        return "Profiles";
    }
  }
  if (entry.viewId === "stories_teaser_cards") {
    return "Related stories";
  }
  if (entry.viewId === "stories_list") {
    if (entry.displayId === "embed_blog") {
      return "Blog stories";
    }
    if (entry.displayId === "embed_news") {
      return "News stories";
    }
    return "Stories";
  }
  if (entry.viewId === "event_list" || entry.viewId === "event_teaser_list") {
    return "Events";
  }
  return entry.displayTitle || entry.viewLabel;
}
function surfaceLabelForLocation(entry, location) {
  const explicit = location.context?.surfaceContext?.titleLabel ?? location.context?.surfaceContext?.contextLabel;
  if (explicit) {
    return explicit;
  }
  if (isTemplateLocation(entry, location)) {
    return friendlySurfaceBase(entry);
  }
  if (entry.placementSource === "template") {
    return entry.displayTitle || entry.viewLabel;
  }
  return friendlySurfaceBase(entry);
}
function shouldGroupLocationSurface(entry, location) {
  if (isTemplateLocation(entry, location)) {
    return true;
  }
  const bundle = location.context?.pageEntity?.bundle;
  return bundle === "story" || bundle === "profile";
}
function groupedSurfaceLabel(entry, location, locationEvaluation, useGenericFallback = false) {
  if (isTemplateLocation(entry, location)) {
    return templateSurfaceLabel(entry);
  }
  const explicitSurfaceName = getLocationSurfaceName(location);
  if (explicitSurfaceName && !useGenericFallback) {
    return explicitSurfaceName;
  }
  const baseLabel = friendlySurfaceBase(entry);
  const argumentContext = locationEvaluation ? buildArgumentContextLabel(locationEvaluation) : void 0;
  const bundle = location.context?.pageEntity?.bundle;
  if (bundle === "story" || bundle === "profile") {
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
function buildGroupedSurfaceKey(entry, locationEvaluation) {
  const argumentDetail = locationEvaluation.argumentDetail;
  if (!argumentDetail?.argumentList?.length) {
    return `${entry.viewId}::${entry.displayId}`;
  }
  const pieces = [];
  for (let index = 0; index < argumentDetail.argumentList.length; index++) {
    if (argumentDetail.argumentSkipMatch?.[index]) {
      continue;
    }
    const terms = argumentDetail.argumentTerms?.[index] ?? [];
    const dimension = argumentDetail.argumentDimensions?.[index] ?? terms[0]?.dimension ?? `slot_${index}`;
    const values = (terms.length ? terms.map((term) => term.value) : [argumentDetail.argumentList[index]]).filter(Boolean).sort();
    if (values.length) {
      pieces.push(`${dimension}=${values.join("|")}`);
    }
  }
  return `${entry.viewId}::${entry.displayId}::${pieces.join(";")}`;
}
function buildTemplateGroupReason(baseReason) {
  return baseReason;
}
function getContentPlacements(content, entries, options) {
  const normalized = normalizeContent(content);
  const willAppear = [];
  const eligibleButLimited = [];
  const excluded = [];
  const groupedTemplateMatches = /* @__PURE__ */ new Map();
  const groupedTemplateExcluded = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const evaluation = evaluateEntry(entry, normalized, options?.formatTerm);
    if (evaluation.status === "exclude") {
      excluded.push({
        score: evaluation.score,
        explanation: {
          viewId: entry.viewId,
          viewLabel: entry.viewLabel,
          displayId: entry.displayId,
          displayTitle: entry.displayTitle,
          reason: evaluation.reason ?? "Filter mismatch",
          limit: entry.limit ?? void 0
        }
      });
      continue;
    }
    const limitNote = describeLimit(entry);
    const baseReasonParts = [...evaluation.details ?? []];
    if (limitNote) {
      baseReasonParts.push(limitNote);
    }
    for (const location of entry.locations) {
      const locationEvaluation = evaluateLocationContext(entry, location, normalized, options?.formatTerm);
      if (!locationEvaluation.passed) {
        if (isTemplateLocation(entry, location)) {
          const groupKey = `${buildGroupedSurfaceKey(entry, locationEvaluation)}::${locationEvaluation.reason ?? "context"}`;
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
              existing.surfaceNames.size > 1
            );
            if (existing.sampleSet.size < 3) {
              existing.sampleSet.add(location.page);
              existing.explanation.samplePages = Array.from(existing.sampleSet);
            }
          } else {
            const sampleSet = /* @__PURE__ */ new Set([location.page]);
            const surfaceNames = /* @__PURE__ */ new Set();
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
                reason: locationEvaluation.reason ?? "Contextual filter mismatch",
                limit: entry.limit ?? void 0,
                locationCount: 1,
                samplePages: [location.page]
              }
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
            reason: locationEvaluation.reason ?? "Contextual filter mismatch",
            limit: entry.limit ?? void 0
          }
        });
        continue;
      }
      const reasonParts = [...baseReasonParts];
      if (locationEvaluation.detail) {
        reasonParts.push(locationEvaluation.detail);
      }
      const reasonText = reasonParts.join("; ") || "Matches view filters.";
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
            existing.surfaceNames.size > 1
          );
          if (existing.sampleSet.size < 3) {
            existing.sampleSet.add(location.page);
            existing.explanation.samplePages = Array.from(existing.sampleSet);
          }
          existing.explanation.reason = buildTemplateGroupReason(reasonText);
          continue;
        }
        const sampleSet = /* @__PURE__ */ new Set([location.page]);
        const surfaceNames = /* @__PURE__ */ new Set();
        if (surfaceName) {
          surfaceNames.add(surfaceName);
        }
        const groupedExplanation = {
          ...buildExplanation(entry, location, reasonText),
          surfaceLabel: groupedSurfaceLabel(entry, location, locationEvaluation),
          locationCount: 1,
          samplePages: [location.page]
        };
        groupedExplanation.reason = buildTemplateGroupReason(
          reasonText
        );
        groupedTemplateMatches.set(groupKey, {
          score: evaluation.score + locationEvaluation.score,
          explanation: groupedExplanation,
          sampleSet,
          surfaceNames
        });
        continue;
      }
      const explanation = buildExplanation(entry, location, reasonText);
      const scored = {
        score: evaluation.score + locationEvaluation.score,
        explanation
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
    excluded: sortScoredExplanations(excluded)
  };
}

// src/ui/app.ts
function canonicalizeKey(value) {
  return (value ?? "").trim().toLowerCase();
}
function humanizeLabel(value) {
  if (!value) {
    return "";
  }
  return value.split(/[-_]/).filter(Boolean).map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ");
}
var DATA_URL = new URL("./placement-map.json", window.location.href).toString();
var TAXONOMY_DATA_URL = new URL("./content-taxonomies.json", window.location.href).toString();
var SITE_ORIGIN = "https://som.yale.edu";
async function loadPlacementMap() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load placement map (${response.status})`);
  }
  const dataset = await response.json();
  return dataset.data.entries;
}
async function loadContentTaxonomies() {
  const response = await fetch(TAXONOMY_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load taxonomy metadata (${response.status})`);
  }
  const dataset = await response.json();
  return dataset.data;
}
function buildTaxonomyMapFromDataset(dataset) {
  const map = /* @__PURE__ */ new Map();
  for (const term of dataset.terms ?? []) {
    const vocabularyLabel = term.vocabularyLabel || term.vocabulary;
    map.set(term.id, {
      id: term.id,
      term: term.term,
      vocabulary: vocabularyLabel,
      vocabularyId: term.vocabulary,
      parent: term.parent,
      searchText: `${term.term} ${term.id} ${vocabularyLabel}`.toLowerCase()
    });
  }
  return map;
}
function buildTermsByVocabulary(map) {
  const byVocabulary = /* @__PURE__ */ new Map();
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
function formatTermValue2(id, map) {
  const info = map.get(id);
  if (!info) {
    return id;
  }
  return `${info.term} (${id})`;
}
function describeParameterFlags(flags) {
  if (!flags) {
    return void 0;
  }
  const active = [];
  if (flags.program) active.push("program");
  if (flags.industry) active.push("industry");
  if (flags.profileType) active.push("profile type");
  if (flags.page) active.push("page offset");
  if (!active.length) {
    return void 0;
  }
  return `Query params: ${active.join(", ")}`;
}
function describeContext(context) {
  const details = [];
  if (context.hasExposedForm) {
    details.push("Has exposed filters");
  }
  if (context.exposedSelectNames && context.exposedSelectNames.length > 0) {
    details.push(`Form fields: ${context.exposedSelectNames.join(", ")}`);
  }
  const paramDetail = describeParameterFlags(context.parameterFlags);
  if (paramDetail) {
    details.push(paramDetail);
  }
  if (context.hasPager) {
    details.push("Paged results");
  }
  if (context.hasAjaxPager) {
    details.push("AJAX pager");
  }
  if (context.hasBef) {
    details.push("BEF enhancements");
  }
  if (context.hasApplyButton) {
    details.push("Apply button present");
  }
  if (context.viewArguments && context.viewArguments.length > 0) {
    const sourceLabels = Array.from(
      new Set(
        context.viewArguments.map((arg) => {
          switch (arg.source) {
            case "drupal-settings":
              return "Runtime args from rendered page";
            case "template-derived":
              return "Template-derived args";
            case "section-context":
              return "Inferred from section context";
            case "manual-override":
              return "Manual section override";
            default:
              return void 0;
          }
        }).filter(Boolean)
      )
    );
    if (sourceLabels.length) {
      details.push(`Argument source: ${sourceLabels.join(", ")}`);
    }
    const refs = context.viewArguments.map((arg) => {
      const uuid = arg.uuid ?? "view";
      const argument = arg.argument || arg.itemsPerPage || arg.display;
      return argument ? `${uuid} (${argument})` : uuid;
    }).join(", ");
    details.push(`Layout Builder view refs: ${refs}`);
  }
  return details;
}
function absoluteUrlForPath(pathOrUrl) {
  if (!pathOrUrl) {
    return void 0;
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (pathOrUrl.startsWith("/")) {
    return `${SITE_ORIGIN}${pathOrUrl}`;
  }
  return void 0;
}
function normalizeReasonFragment(fragment) {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.replace(/^Matches allowed content type /, "Allowed content type: ").replace(/^Shares term\(s\): /, "Matches selected terms: ").replace(/^Template uses /, "Template context: ").replace(/^Matches contextual /, "Page context: ").replace(/^Requires contextual /, "Requires ").replace(/^View limited to /, "Limited to ");
}
function splitReason(reason) {
  const fragments = reason.split(/\s*;\s*/).map((fragment) => normalizeReasonFragment(fragment)).filter(Boolean);
  if (fragments.length === 0) {
    return { lead: "Matches view rules.", details: [] };
  }
  return {
    lead: fragments.slice(0, 2).join(" \u2022 "),
    details: fragments.slice(2)
  };
}
function collectBadges(item) {
  const badges = [];
  if ((item.locationCount ?? 0) > 1) {
    badges.push({ label: "Grouped surface" });
  }
  if (item.limit && item.limit > 0) {
    badges.push({ label: `Limited to ${item.limit}`, tone: "warning" });
  }
  const sources = new Set(item.context?.viewArguments?.map((argument) => argument.source).filter(Boolean));
  if (sources.has("drupal-settings")) {
    badges.push({ label: "Explicit args", tone: "success" });
    badges.push({ label: "High confidence", tone: "success" });
  } else if (sources.has("template-derived")) {
    badges.push({ label: "Template logic", tone: "success" });
    badges.push({ label: "High confidence", tone: "success" });
  } else if (sources.has("manual-override")) {
    badges.push({ label: "Manual override", tone: "warning" });
    badges.push({ label: "Reviewed rule" });
  } else if (sources.has("section-context")) {
    badges.push({ label: "Section inferred" });
    badges.push({ label: "Medium confidence" });
  }
  if (item.context?.hasExposedForm) {
    badges.push({ label: "Exposed filters" });
  }
  return badges;
}
function createLink(pathOrUrl, label) {
  const anchor = document.createElement("a");
  anchor.href = absoluteUrlForPath(pathOrUrl) ?? pathOrUrl;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label ?? pathOrUrl;
  return anchor;
}
function renderSummary(container, confirmedCount, limitedCount, excludedCount) {
  container.innerHTML = "";
  const list = document.createElement("div");
  list.className = "results-summary";
  const items = [
    { label: "Will appear", value: confirmedCount, tone: "confirmed" },
    { label: "May appear", value: limitedCount, tone: "limited" },
    { label: "Won't appear", value: excludedCount, tone: "excluded" }
  ];
  for (const item of items) {
    const card = document.createElement("div");
    card.className = `summary-card summary-card--${item.tone}`;
    const value = document.createElement("strong");
    value.className = "summary-card__value";
    value.textContent = String(item.value);
    const label = document.createElement("span");
    label.className = "summary-card__label";
    label.textContent = item.label;
    card.append(value, label);
    list.appendChild(card);
  }
  container.appendChild(list);
}
function collectContentTypeOptions(entries, taxonomyDataset) {
  const options = /* @__PURE__ */ new Map();
  function addOption(value, hasMetadata) {
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
function buildContentTypeFieldMap(taxonomyDataset) {
  const map = /* @__PURE__ */ new Map();
  for (const [contentType, fields] of Object.entries(taxonomyDataset.contentTypes ?? {})) {
    map.set(canonicalizeKey(contentType), fields);
  }
  return map;
}
function collectDimensionMeta(entries, termMap, taxonomyDataset) {
  const meta = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    for (const filter of entry.filters.taxonomy) {
      if (!filter.dimension) {
        continue;
      }
      const key = filter.dimension;
      const current = meta.get(key) ?? { label: filter.label ?? key, samples: [] };
      for (const value of filter.values.slice(0, 5)) {
        const formatted = formatTermValue2(value, termMap);
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
function enrichDimensionSamples(meta, taxonomyDataset, termsByVocabulary) {
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
function buildDimensionVocabularyMap(entries, taxonomyDataset) {
  const map = /* @__PURE__ */ new Map();
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
function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label ?? value;
  return option;
}
function renderTaxonomyOptions(select, button, meta, allowed) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  if (allowed === null) {
    select.innerHTML = "";
    select.append(createOption("", "Select a content type first"));
    select.disabled = true;
    button.disabled = true;
    return;
  }
  if (allowed && allowed.length === 0) {
    select.innerHTML = "";
    select.append(createOption("", "No taxonomy filters available"));
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
  select.innerHTML = "";
  const hasEntries = entries.length > 0;
  if (!hasEntries) {
    select.append(createOption("", "No taxonomy filters available"));
    select.disabled = true;
    button.disabled = true;
    return;
  }
  select.disabled = false;
  button.disabled = false;
  select.append(createOption("", "Select taxonomy dimension"));
  for (const entry of entries) {
    select.append(createOption(entry.value, entry.label));
  }
}
function renderContentTypeSelect(select, contentTypes) {
  select.innerHTML = "";
  select.append(createOption("", "Select a content type"));
  for (const option of contentTypes) {
    const label = option.hasMetadata ? option.label : `${option.label} (filters unavailable)`;
    const element = createOption(option.value, label);
    element.dataset.canonical = option.canonical;
    element.dataset.hasMetadata = String(option.hasMetadata);
    select.append(element);
  }
}
function addTaxonomyRow(container, dimension, meta, existing, allTerms, termsByVocabulary, options) {
  if (existing.has(dimension)) {
    const existingRow = container.querySelector(`[data-dimension="${dimension}"]`);
    existingRow?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const row = document.createElement("div");
  row.className = "taxonomy-row";
  row.dataset.dimension = dimension;
  const selectedTerms = /* @__PURE__ */ new Set();
  const label = document.createElement("label");
  const labelText = options?.label ?? meta.label ?? dimension;
  label.textContent = `${labelText} (${dimension})${options?.required ? " *" : ""}`;
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search a term name or ID, then press Enter or click a suggestion";
  const hint = document.createElement("small");
  const defaultHint = meta.samples.length ? `Examples: ${meta.samples.join(", ")}` : "Enter taxonomy term IDs, names, or slugs";
  if (options?.vocabularyId && !options?.restrictVocabulary) {
    hint.textContent = `${defaultHint}. Term dictionary unavailable for this field\u2014paste IDs or slugs manually.`;
  } else {
    hint.textContent = defaultHint;
  }
  const selectedContainer = document.createElement("div");
  selectedContainer.className = "taxonomy-selected";
  const suggestions = document.createElement("div");
  suggestions.className = "taxonomy-suggestions";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "plain-button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    existing.delete(dimension);
    row.remove();
  });
  function updateDataset() {
    row.dataset.selectedTerms = JSON.stringify(Array.from(selectedTerms));
  }
  function renderSelectedChips() {
    selectedContainer.innerHTML = "";
    if (selectedTerms.size === 0) {
      const empty = document.createElement("span");
      empty.className = "taxonomy-selected__empty";
      empty.textContent = "No terms selected.";
      selectedContainer.appendChild(empty);
      return;
    }
    for (const id of selectedTerms) {
      const term = allTerms.find((t) => t.id === id);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "taxonomy-chip";
      chip.textContent = term ? `${term.term} (${term.id}) \xD7` : `${id} \xD7`;
      chip.addEventListener("click", () => {
        selectedTerms.delete(id);
        updateDataset();
        renderSelectedChips();
      });
      selectedContainer.appendChild(chip);
    }
  }
  const restrictVocabulary = Boolean(options?.restrictVocabulary && options.vocabularyId);
  const normalizedDimensionKey = (options?.vocabularyId ?? dimension).toLowerCase().replace(/[_-]+/g, " ");
  function buildTermPool() {
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
  function searchTerms(query) {
    const trimmed = query.trim().toLowerCase();
    if (!termPool.length) {
      return [];
    }
    if (!trimmed) {
      return termPool.slice(0, 6);
    }
    const matches = termPool.map((term) => {
      if (!term.searchText.includes(trimmed)) {
        return null;
      }
      let score = 0;
      if (term.term.toLowerCase().startsWith(trimmed)) score += 3;
      if (term.id === trimmed) score += 4;
      if (term.term.toLowerCase().includes(trimmed)) score += 1;
      const vocabKey = term.vocabulary.toLowerCase().replace(/\s+/g, " ");
      if (vocabKey.includes(normalizedDimensionKey)) score += 1;
      return { term, score };
    }).filter((item) => Boolean(item)).sort((a, b) => b.score - a.score || a.term.term.localeCompare(b.term.term));
    return matches.slice(0, 6).map((item) => item.term);
  }
  function addTerm(termId) {
    if (!termId) return;
    selectedTerms.add(termId);
    updateDataset();
    renderSelectedChips();
    suggestions.innerHTML = "";
  }
  function resolveTermId(candidate) {
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
    return void 0;
  }
  function addTermByQuery(query) {
    const trimmed = query.trim();
    if (!trimmed) return;
    const segments = trimmed.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);
    if (segments.length > 1) {
      let addedAny = false;
      for (const value of segments) {
        const resolved2 = resolveTermId(value) ?? value;
        if (!selectedTerms.has(resolved2)) {
          addTerm(resolved2);
          addedAny = true;
        }
      }
      if (addedAny) {
        input.value = "";
        suggestions.innerHTML = "";
      }
      return;
    }
    const resolved = resolveTermId(trimmed);
    if (resolved) {
      addTerm(resolved);
      input.value = "";
      suggestions.innerHTML = "";
      return;
    }
    const suggestionsList = searchTerms(trimmed).filter((term) => !selectedTerms.has(term.id));
    if (suggestionsList.length === 0) {
      addTerm(trimmed);
      input.value = "";
      suggestions.innerHTML = "";
      return;
    }
    if (suggestionsList.length === 1) {
      addTerm(suggestionsList[0].id);
      input.value = "";
      suggestions.innerHTML = "";
      return;
    }
    renderSuggestions(trimmed);
  }
  function renderSuggestions(query) {
    suggestions.innerHTML = "";
    const suggestionTerms = searchTerms(query).filter((term) => !selectedTerms.has(term.id));
    if (!suggestionTerms.length) {
      const empty = document.createElement("div");
      empty.className = "taxonomy-suggestions__empty";
      empty.textContent = query.trim() ? "No matches. Try another term or paste an ID." : "No indexed suggestions. Paste term IDs or start typing to search.";
      suggestions.appendChild(empty);
      return;
    }
    suggestionTerms.forEach((term) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "taxonomy-suggestion";
      button.textContent = `${term.term} (${term.id}) \u2014 ${term.vocabulary}`;
      button.addEventListener("click", () => {
        addTerm(term.id);
        input.value = "";
      });
      suggestions.appendChild(button);
    });
  }
  input.addEventListener("input", () => {
    const value = input.value.trim();
    renderSuggestions(value);
  });
  input.addEventListener("focus", () => {
    if (!input.value.trim()) {
      renderSuggestions("");
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTermByQuery(input.value);
      input.value = "";
    }
  });
  renderSelectedChips();
  updateDataset();
  label.appendChild(input);
  row.append(label, hint, selectedContainer, suggestions, removeButton);
  container.appendChild(row);
  existing.add(dimension);
}
function collectTaxonomyValues(container) {
  const taxonomy = {};
  const rows = Array.from(container.querySelectorAll(".taxonomy-row"));
  for (const row of rows) {
    const dimension = row.dataset.dimension;
    if (!dimension) continue;
    const selected = row.dataset.selectedTerms ? JSON.parse(row.dataset.selectedTerms) : [];
    if (selected.length) {
      taxonomy[dimension] = selected;
      continue;
    }
    const input = row.querySelector("input");
    if (!input) continue;
    const values = input.value.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length > 0) {
      taxonomy[dimension] = values;
    }
  }
  return taxonomy;
}
function pruneTaxonomyRows(container, active, allowed) {
  if (!allowed || allowed.size === 0) {
    return;
  }
  const rows = Array.from(container.querySelectorAll(".taxonomy-row"));
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
function renderSection(container, heading, items, emptyState, tone) {
  container.innerHTML = "";
  container.className = `results-group results-group--${tone}`;
  const title = document.createElement("h3");
  title.textContent = `${heading} (${items.length})`;
  container.appendChild(title);
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyState;
    container.appendChild(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "placements-list";
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "placement-card";
    const header = document.createElement("div");
    header.className = "placement-header";
    const titleLine = document.createElement("div");
    titleLine.className = "placement-title";
    if (item.surfaceLabel) {
      const surface = document.createElement("strong");
      surface.textContent = item.surfaceLabel;
      titleLine.appendChild(surface);
    } else if (item.page) {
      const page = document.createElement("strong");
      page.textContent = item.page;
      titleLine.appendChild(page);
    } else {
      titleLine.textContent = item.viewLabel;
    }
    header.appendChild(titleLine);
    const badges = collectBadges(item);
    if (badges.length > 0) {
      const badgeRow = document.createElement("div");
      badgeRow.className = "placement-badges";
      for (const badge of badges) {
        const element = document.createElement("span");
        element.className = `placement-badge${badge.tone ? ` placement-badge--${badge.tone}` : ""}`;
        element.textContent = badge.label;
        badgeRow.appendChild(element);
      }
      header.appendChild(badgeRow);
    }
    const reason = document.createElement("div");
    reason.className = "placement-reason";
    const reasonParts = splitReason(item.reason);
    reason.textContent = reasonParts.lead;
    li.append(header, reason);
    if (item.locationCount || item.samplePages?.length) {
      const summary = document.createElement("div");
      summary.className = "placement-summary";
      if (item.locationCount) {
        const count = document.createElement("span");
        count.textContent = `${item.locationCount} matching page${item.locationCount === 1 ? "" : "s"}`;
        summary.appendChild(count);
      }
      if (item.samplePages?.length) {
        const sample = document.createElement("span");
        sample.append("Sample page: ");
        sample.appendChild(createLink(item.samplePages[0], item.samplePages[0]));
        const remainder = item.samplePages.length > 1 ? item.samplePages.length - 1 : 0;
        if (remainder > 0) {
          sample.append(` +${remainder} more`);
        }
        summary.appendChild(sample);
      }
      li.appendChild(summary);
    } else if (item.page) {
      const summary = document.createElement("div");
      summary.className = "placement-summary";
      const sample = document.createElement("span");
      sample.append("Page: ");
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
      const details = document.createElement("details");
      details.className = "placement-details";
      const summary = document.createElement("summary");
      summary.textContent = "Details";
      details.appendChild(summary);
      const meta = document.createElement("div");
      meta.className = "placement-context";
      const technicalBits = [`View: ${item.viewLabel} (${item.displayId})`];
      if (item.displayTitle && item.displayTitle !== item.viewLabel) {
        technicalBits.push(`Display title: ${item.displayTitle}`);
      }
      if (detailLines.length) {
        technicalBits.push(...detailLines);
      }
      meta.textContent = technicalBits.join(" \u2022 ");
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
  const form = document.querySelector("#advisor-form");
  const contentTypeSelect = document.querySelector("#content-type");
  const taxonomySelect = document.querySelector("#taxonomy-select");
  const addTaxonomyButton = document.querySelector("#add-taxonomy");
  const taxonomyContainer = document.querySelector("#taxonomy-container");
  const taxonomyHelper = document.querySelector("#taxonomy-helper");
  const resultsSummary = document.querySelector("#results-summary");
  const resultsConfirmed = document.querySelector("#results-confirmed");
  const resultsLimited = document.querySelector("#results-limited");
  const resultsExcluded = document.querySelector("#results-excluded");
  if (!form || !contentTypeSelect || !taxonomySelect || !addTaxonomyButton || !taxonomyContainer || !resultsSummary || !resultsConfirmed || !resultsLimited || !resultsExcluded) {
    throw new Error("Placement Advisor UI elements are missing.");
  }
  renderContentTypeSelect(contentTypeSelect, contentTypeOptions);
  const activeDimensions = /* @__PURE__ */ new Set();
  let currentFieldMap = /* @__PURE__ */ new Map();
  const clearTaxonomyRows = () => {
    activeDimensions.clear();
    taxonomyContainer.innerHTML = "";
  };
  const setTaxonomyHelper = (message) => {
    if (taxonomyHelper) {
      taxonomyHelper.textContent = message;
    }
  };
  function updateTaxonomyControls() {
    const selectedType = contentTypeSelect.value;
    if (!selectedType) {
      currentFieldMap = /* @__PURE__ */ new Map();
      renderTaxonomyOptions(taxonomySelect, addTaxonomyButton, dimensionMeta, null);
      clearTaxonomyRows();
      setTaxonomyHelper("Select a content type to see available taxonomy filters.");
      return;
    }
    const canonicalType = canonicalizeKey(selectedType);
    const allowedFields = canonicalType ? taxonomyFieldsByType.get(canonicalType) : void 0;
    if (!allowedFields || allowedFields.length === 0) {
      currentFieldMap = /* @__PURE__ */ new Map();
      renderTaxonomyOptions(taxonomySelect, addTaxonomyButton, dimensionMeta, []);
      clearTaxonomyRows();
      setTaxonomyHelper("This content type does not expose taxonomy filters in Drupal.");
      return;
    }
    currentFieldMap = new Map(allowedFields.map((field) => [field.dimension, field]));
    renderTaxonomyOptions(taxonomySelect, addTaxonomyButton, dimensionMeta, allowedFields);
    const allowedSet = new Set(currentFieldMap.keys());
    pruneTaxonomyRows(taxonomyContainer, activeDimensions, allowedSet);
    const helperList = allowedFields.map((field) => field.label ?? field.dimension);
    setTaxonomyHelper(helperList.length ? `Available filters: ${helperList.join(", ")}.` : "");
  }
  updateTaxonomyControls();
  contentTypeSelect.addEventListener("change", () => {
    updateTaxonomyControls();
  });
  addTaxonomyButton.addEventListener("click", (event) => {
    event.preventDefault();
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
    addTaxonomyRow(taxonomyContainer, value, meta, activeDimensions, taxonomyTermsList, termsByVocabulary, {
      label: fieldOverride?.label ?? meta.label,
      vocabularyId,
      restrictVocabulary,
      required: fieldOverride?.required
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const taxonomy = collectTaxonomyValues(taxonomyContainer);
    const payload = {
      content_type: contentTypeSelect.value,
      taxonomy
    };
    const result = getContentPlacements(payload, entries, {
      formatTerm: (value) => formatTermValue2(value, taxonomyMap)
    });
    renderSummary(resultsSummary, result.willAppear.length, result.eligibleButLimited.length, result.excluded.length);
    renderSection(resultsConfirmed, "Will appear", result.willAppear, "No confirmed placements yet.", "confirmed");
    renderSection(
      resultsLimited,
      "May appear",
      result.eligibleButLimited,
      "No limited placements detected.",
      "limited"
    );
    renderSection(
      resultsExcluded,
      "Won't appear",
      result.excluded,
      "No exclusions based on the provided filters.",
      "excluded"
    );
  });
}
window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    const container = document.getElementById("app");
    if (container) {
      container.innerHTML = `<p class="error">Failed to initialize: ${error instanceof Error ? error.message : String(
        error
      )}</p>`;
    }
    console.error(error);
  });
});
//# sourceMappingURL=app.js.map
