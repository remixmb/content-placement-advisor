export interface DatasetMetadata<T> {
  generatedAt: string;
  note?: string;
  data: T;
}

export interface ViewFilterDescriptor {
  id: string;
  label?: string;
  table?: string;
  field?: string;
  pluginId?: string;
  operator?: string;
  values: string[];
  negate?: boolean;
  vid?: string;
  dimension?: string;
  behavior?: 'require-any' | 'require-all' | 'exclude' | 'other';
  description?: string;
}

export interface TaxonomyFilterDescriptor extends ViewFilterDescriptor {
  dimension: string;
  behavior: 'require-any' | 'require-all' | 'exclude';
}

export interface ViewFilterSummary {
  contentTypes: string[];
  taxonomy: TaxonomyFilterDescriptor[];
  other: ViewFilterDescriptor[];
}

export interface ContextualFilterDescriptor {
  id: string;
  label?: string;
  table?: string;
  field?: string;
  pluginId?: string;
  defaultArgumentType?: string;
  defaultArgumentValue?: string;
  summary?: string;
  requireValue?: boolean;
  negate?: boolean;
  dimension?: string;
}

export interface SortDescriptor {
  id: string;
  table?: string;
  field?: string;
  pluginId?: string;
  order?: 'ASC' | 'DESC';
  label?: string;
}

export interface PagerConfig {
  type?: string;
  itemsPerPage?: number | null;
  offset?: number;
}

export interface ViewDisplayDefinition {
  viewId: string;
  viewLabel: string;
  displayId: string;
  displayTitle: string;
  description?: string;
  sourceFile: string;
  filters: ViewFilterSummary;
  contextualFilters: ContextualFilterDescriptor[];
  sorts: SortDescriptor[];
  pager?: PagerConfig;
  limit?: number | null;
}

export interface ViewsDataset {
  views: ViewDisplayDefinition[];
  filesParsed: number;
}

export interface PlacementRecord {
  viewId: string;
  displayId: string;
  page: string;
  url: string;
  htmlFile: string;
  domId?: string;
  viewDomId?: string;
  context?: PlacementLocationContext;
}

export interface PlacementsDataset {
  crawlSource: string;
  totalPagesScanned: number;
  placements: PlacementRecord[];
}

export interface ViewArgument {
  uuid?: string;
  paragraph_type?: string;
  paragraphType?: string;
  display?: string;
  argument?: string;
  items_per_page?: string;
  itemsPerPage?: string;
  include_title?: string;
  includeTitle?: string;
  edit_url?: string;
  editUrl?: string;
  viewId?: string;
  viewDisplayId?: string;
  viewDomId?: string;
  rawArgs?: string;
  argumentList?: string[];
  argumentDimensions?: Array<string | undefined>;
  argumentValueLabels?: string[][];
  argumentSlotOperators?: Array<'single' | 'or' | 'and'>;
  argumentSkipMatch?: boolean[];
  argumentTerms?: Array<Array<{ value: string; label?: string; dimension?: string }>>;
  source?: string;
}

export interface ParameterFlags {
  program?: boolean;
  industry?: boolean;
  profileType?: boolean;
  page?: boolean;
}

export interface PageEntityContext {
  bundle?: string;
  id?: string;
  title?: string;
  taxonomy?: Record<string, string[]>;
  taxonomyLabels?: Record<string, string[]>;
}

export interface SurfaceContext {
  contextLabel?: string;
  titleLabel?: string;
  titlePath?: string;
  sourceTable?: string;
  parentEntityId?: string;
}

export interface PlacementLocationContext {
  viewArguments?: ViewArgument[];
  exposedFormSelectors?: string[];
  exposedSelectNames?: string[];
  exposedFormAction?: string;
  hasViewWrapper?: boolean;
  hasExposedForm?: boolean;
  hasBef?: boolean;
  hasPager?: boolean;
  hasAjaxPager?: boolean;
  hasApplyButton?: boolean;
  hasResetButton?: boolean;
  viewEmbedDisplayCount?: number;
  viewPageDisplayCount?: number;
  viewAjaxPagerCount?: number;
  parameterFlags?: ParameterFlags;
  pageEntity?: PageEntityContext;
  surfaceContext?: SurfaceContext;
}

export interface PlacementLocation {
  page: string;
  url: string;
  context?: PlacementLocationContext;
}

export interface PlacementMapEntry extends ViewDisplayDefinition {
  pages: string[];
  urls: string[];
  locations: PlacementLocation[];
  placementSource?: string;
  specificityWeight?: number;
}

export interface PlacementMapDataset {
  entries: PlacementMapEntry[];
}

export interface TaxonomyTermRecord {
  id: string;
  term: string;
  vocabulary: string;
  vocabularyLabel: string;
  parent?: string;
}

export interface ContentTypeTaxonomyField {
  dimension: string;
  label: string;
  vocabulary: string;
  vocabularyLabel: string;
  fieldNames: string[];
  fieldLabels: string[];
  required: boolean;
}

export interface ContentTaxonomyDataset {
  contentTypes: Record<string, ContentTypeTaxonomyField[]>;
  vocabularies: Record<string, { label: string }>;
  terms: TaxonomyTermRecord[];
}

export interface ContentInput {
  content_type: string;
  taxonomy?: Record<string, Array<string | number>>;
}

export interface PlacementExplanation {
  page?: string;
  url?: string;
  viewId: string;
  viewLabel: string;
  displayId: string;
  displayTitle: string;
  surfaceLabel?: string;
  reason: string;
  limit?: number | null;
  filters?: string[];
  context?: PlacementLocationContext;
  locationCount?: number;
  samplePages?: string[];
}

export interface PlacementAdvisorResult {
  willAppear: PlacementExplanation[];
  eligibleButLimited: PlacementExplanation[];
  excluded: PlacementExplanation[];
}

export interface PlacementAdvisorOptions {
  formatTerm?: (value: string) => string;
}
