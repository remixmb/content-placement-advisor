# Content Placement Advisor Summary

## What this is

Content Placement Advisor is a local decision-support tool for Yale SOM content editors. It answers:

> If I tag a piece of content with these taxonomy terms, where will it appear on the website?

It does this by combining Drupal Views logic, rendered crawl evidence, and site section/context rules.

## What it currently covers

- Drupal Views configuration parsing
- Embedded Views placement detection from the crawl
- Content-type-aware taxonomy input
- Contextual argument matching
- Related Story and Related Profile template logic
- Page and section context inference for Program and Center surfaces
- Manual overrides for section URLs where Drupal config does not expose the relationship directly

## Inputs used

- Drupal Views YAML exports
- Screaming Frog crawl export and rendered page HTML
- Taxonomy term dictionary
- Views Reference runtime argument exports
- Supplemental parent/page label tables

## Current outputs

- `views.json` - parsed Views logic
- `placements.json` - detected view placements
- `placement-map.json` - merged surface map used by the advisor
- `tools/content-placement-advisor/` - static UI for local review
- `docs/placement-registry/inferred-placement-review.csv` - audit of inferred/manual section logic

## Why this is useful

- Reduces guesswork for editors
- Makes placement behavior explainable
- Surfaces view limits and exclusions
- Gives maintainers a review path for inferred logic

## Current confidence model

The UI distinguishes between:

- `Explicit args` - derived from rendered Drupal runtime data
- `Template logic` - derived from node/template behavior
- `Section inferred` - derived from Drupal Context config and section URL inheritance
- `Manual override` - maintained exceptions for URLs that require a fixed inherited term

## Known limitations

- Some site behavior still depends on section conventions that are not fully explicit in Drupal config
- Manual overrides are required for a small number of surfaces
- Results are only as current as the crawl and exported datasets

## How to review it

1. Install dependencies: `npm install`
2. Start the advisor: `npm run advisor`
3. Open: `http://127.0.0.1:4173`

## Recommended next steps

1. Review `docs/placement-registry/inferred-placement-review.csv`
2. Confirm or adjust manual section overrides
3. Validate 10-20 representative editor scenarios
4. Decide whether to keep this as a private standalone repo or fold it into a longer-term internal tool
