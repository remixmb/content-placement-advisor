# View Argument Mapping Workflow

Use `view-argument-map.json` to document view displays whose placement logic is not obvious from raw crawl data alone.

Each entry is keyed by `viewId` + `displayId` and can do three jobs:

1. Assign a `placementSource`
   - `template` for node templates like related profiles / related stories
   - `views_reference_paragraph` for paragraph embeds whose arguments come from page context

2. Describe positional arguments with `argumentSlots`
   - `dimension` names the taxonomy or entity dimension for that slot
   - `skipMatch: true` marks slots like `nid` that should not be compared against editor-entered taxonomy

3. Synthesize missing arguments from the crawled page entity with `syntheticFromPageEntity`
   - `bundle` is the page entity bundle, e.g. `story` or `profile`
   - `strategy` values:
     - `entity_id`
     - `taxonomy:first`
     - `taxonomy:all`
     - `taxonomy:primary_story_context`

Recommended workflow:

1. Find the display in the theme or paragraph implementation.
2. Add an entry to `view-argument-map.json`.
3. Rebuild:
   - `npm run build-placement-map`
   - `npm run build-advisor-ui`
4. Spot-check the output against a real page in the advisor.

Current mapped examples:

- `profiles_grid.related`
- `profiles_grid.related_ambassadors`
- `stories_teaser_cards.embed_all`
- program-specific profile embeds like `profiles_grid.embed_3` through `embed_8`
