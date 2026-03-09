# Content Placement Advisor

This folder is the standalone shareable snapshot of the Content Placement Advisor work. It is intended to be safe to share without exposing the full SOM Drupal repository.

## What is included

- advisor source code in `src/`
- static review UI in `tools/content-placement-advisor/`
- generated datasets:
  - `views.json`
  - `placements.json`
  - `placement-map.json`
  - `content-taxonomies.json`
- placement registry docs in `docs/placement-registry/`
- manager-facing overview in `MANAGER-SUMMARY.md`

## What is intentionally excluded

This package does not include the broader Drupal codebase or raw crawl source inputs.

Excluded on purpose:

- `web/`
- `config/sync/`
- raw `Crawl ...` folders
- unrelated Drupal/theme/module code

## Run the current snapshot

```bash
npm install
npm run advisor
```

Open:

- [http://127.0.0.1:4173](http://127.0.0.1:4173)

This uses the included generated JSON, so the current state is viewable without the original Drupal repo.

## Rebuild the datasets later

To regenerate from source, provide these inputs in a separate workspace:

- Drupal Views config under `config/sync/views.view.*.yml`
- crawl HTML export under a folder like `Crawl 2026-03-05/page_source/`
- `crawl_with_view_args.csv`
- taxonomy term CSV

Then run:

```bash
npm run extract-views
npm run scan-crawl -- --crawl-dir "<crawl folder>"
npm run extract-taxonomies
npm run build-placement-map
npm run build-advisor-ui
npm run report-inferred-placements
```

## Files to share with management

- `MANAGER-SUMMARY.md` - concise project summary
- `docs/placement-registry/inferred-placement-review.csv` - review list of inferred/manual surfaces
- `tools/content-placement-advisor/` - runnable demo UI

## Notes

- modal-only views are excluded
- search-oriented views are excluded
- some section behavior is inferred from Drupal Context config
- a small number of URLs use explicit manual section overrides in `docs/placement-registry/section-path-overrides.json`
