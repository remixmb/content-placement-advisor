# Content Placement Advisor

An internal decision-support tool for Yale SOM content editors. It answers the question: **"If I tag this content with these taxonomy terms, where will it appear on the website?"**

🔗 **[Live Demo →](https://remixmb.github.io/content-placement-advisor/)**

---

## What It Does

The Advisor analyzes Drupal Views configuration, taxonomy relationships, contextual filters, sort order, display limits, and page placements to map:

| Input | Output |
|---|---|
| Content type | Pages/surfaces where content **will appear** |
| Taxonomy terms | Placements where it **qualifies but may not appear** (due to display limits) |
| Contextual args | Placements where it **will not appear**, with explanations |

### Two Workflow Modes

- **Proactive** — *"Where will this content go?"* — Use before publishing to preview all eligible placements.
- **Reactive** — *"Why didn't this appear?"* — Use after publishing to troubleshoot missing content. Emphasizes exclusion reasons.

### Key Features

- Merged "Eligible placements" view with `Limited to X` badges for nuance
- Explicit explanations for inherited context (e.g. Related Profiles on Profile pages share Program, Center, and Profile Type)
- Two-column sticky layout for rapid iteration
- Autocomplete with highlighted matching text
- Fade-in animations on result cards
- Clear form / reset button

---

## Quick Start

```bash
npm install
npm run advisor
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

This uses the included pre-built JSON datasets, so the full Drupal codebase is **not** required.

---

## Project Structure

```
├── src/
│   ├── advisor/          # Core placement engine (engine.ts)
│   ├── ui/               # Browser UI (app.ts)
│   └── commands/         # CLI scripts for data extraction
├── tools/
│   └── content-placement-advisor/   # Static site (deployed to GitHub Pages)
│       ├── index.html
│       ├── styles.css
│       ├── app.js         # Compiled bundle
│       ├── placement-map.json
│       └── content-taxonomies.json
├── docs/
│   └── placement-registry/          # Documentation & review artifacts
├── placement-map.json               # Source dataset
├── content-taxonomies.json           # Source dataset
├── views.json                        # Extracted Drupal Views config
└── placements.json                   # Raw placement data
```

---

## Deployment

This repository deploys automatically to GitHub Pages via a GitHub Action.

**Trigger:** Any push to `main` that touches `src/`, `tools/`, `package.json`, or `*.json` files.

**Manual trigger:** Go to the [Actions tab](../../actions) → "Deploy Content Placement Advisor to GitHub Pages" → "Run workflow".

The deployed site is available at:
**https://remixmb.github.io/content-placement-advisor/**

---

## Rebuilding Datasets

To regenerate datasets from the Drupal source, you need access to the main `som-yale-edu-develop` repository. Provide:

- Drupal Views config files (`config/sync/views.view.*.yml`)
- Screaming Frog crawl HTML export (e.g., `Crawl 2026-03-05/page_source/`)
- `crawl_with_view_args.csv`
- Taxonomy term CSV

Then run:

```bash
npm run extract-views
npm run scan-crawl -- --crawl-dir "<crawl folder>"
npm run extract-taxonomies
npm run build-placement-map
npm run build-advisor-ui
npm run report-inferred-placements
```

---

## Sharing With Stakeholders

| Audience | Resource |
|---|---|
| Content editors | [Live demo](https://remixmb.github.io/content-placement-advisor/) |
| Management | `MANAGER-SUMMARY.md` |
| Confluence | `CONFLUENCE-PAGE.html` / `CONFLUENCE-SUMMARY.md` |
| Technical review | `docs/placement-registry/inferred-placement-review.csv` |

---

## Technical Notes

- Modal-only and search-oriented views are excluded from the placement map
- Some section behavior is inferred from Drupal Context config
- A small number of URLs use explicit manual overrides in `docs/placement-registry/section-path-overrides.json`
- The advisor engine does **not** require a running Drupal instance — it works entirely from exported JSON
