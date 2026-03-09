# Content placement registry and editor tools

This folder holds **documentation and tools** so content editors can see where their content will appear when they add tags (Profile Type, Program, Industry, Context, Topics, etc.) and so maintainers can keep placement data in sync with the live site.

---

## For content editors — start here

| Goal | Tool | Link |
|------|------|------|
| **“If I apply these terms, where will it show?”** | **Content Placement Advisor** | [content_placement_advisor.html](content_placement_advisor.html) |
| **Browse by content type and vocabulary** | Content placement page (table + surfaces) | [content_placement_page.html](content_placement_page.html) |
| **Filterable table (Content Type, Vocabulary, Terms, Surfaces)** | Editor placement table | [editor_placement_table.html](editor_placement_table.html) |
| **“Which views/terms affect this URL?”** | URL lookup | [url_lookup.html](url_lookup.html) |
| **Understand Topics vs Context** | Tagging guide | [TAGGING_GUIDE.md](TAGGING_GUIDE.md) |
| **One-page printable summary** | Cheat sheet | [CHEAT-SHEET.md](CHEAT-SHEET.md) |
| **Context term → where it surfaces** | Tag placement reference | [content_creator_tag_reference.html](content_creator_tag_reference.html) / [tag_placement_reference.csv](tag_placement_reference.csv) |
| **Three ways: by tags, by destination, by content type** | Taxonomy Placement Finder | [dashboard/index.html](dashboard/index.html) |

**Quick flow:** Open the **Content Placement Advisor**, choose a content type (e.g. Profile or Story), pick terms for each field, and see the surfaces and URLs where that content can appear. Use **URL lookup** to see which views affect a given page. Use the **tagging guide** and **tag reference** for Stories (Context vs Topics). **Cheat sheet:** [CHEAT-SHEET.md](CHEAT-SHEET.md).

---

## For maintainers — data and regeneration

| Task | Doc / script |
|------|----------------|
| **Regenerate placement data from a new crawl** | [REGENERATE-FROM-CRAWL.md](REGENERATE-FROM-CRAWL.md) and `scripts/regenerate_placement_from_crawl.sh` |
| **How surfaces are derived from Views Reference** | [SURFACES-FROM-VIEWS-REFERENCE.md](SURFACES-FROM-VIEWS-REFERENCE.md) |
| **Full taxonomy → placement guide (by type, by vocabulary)** | [TAXONOMY-TO-PLACEMENT.md](TAXONOMY-TO-PLACEMENT.md) |
| **Dashboard data shape and refresh** | [dashboard/README.md](dashboard/README.md) |
| **Map terms to each embedded view / better placement helper** | [TERMS-PER-VIEW-PLAN.md](TERMS-PER-VIEW-PLAN.md) |
| **Manual section-context overrides for URLs that cannot be inferred from config alone** | `section-path-overrides.json` |
| **Review all inferred/manual placement surfaces in one export** | `npm run report-inferred-placements` |
| **Drupal views config and logic (this repo)** | [DRUPAL-VIEWS-INVESTIGATION.md](DRUPAL-VIEWS-INVESTIGATION.md) |

After a new Screaming Frog crawl, run the regeneration script so the Advisor, placement page, and editor table use the latest URLs and surface counts. See [REGENERATE-FROM-CRAWL.md](REGENERATE-FROM-CRAWL.md) for the one-command option and step-by-step.

If a section URL needs a fixed inherited taxonomy term and Drupal config does not expose that relationship directly, add it to `section-path-overrides.json` and rebuild `placement-map.json`.
Use `npm run report-inferred-placements` to export all placements currently relying on inferred section context or manual overrides.

---

## Content placement at a glance

- **Profiles:** Placement is driven by **Profile Type**, **Program**, and **Industry**. Main surface: Community Profiles; same view is embedded on program and profile pages.
- **Stories:** **Context** tags control *where* the story can appear (sections, centers, programs, Headlines, Media Appearance, etc.). **Topics** describe what the story is about and drive topic-based discovery.
- **Surfaces** in the tools are the **Siteimprove "Pages with content policy matches"** list (when the CSV is used). The placement report is built with `--surfaces-csv` so only those URLs appear. Regenerate after a new crawl or Siteimprove export to refresh.

---

## File overview

| File | Purpose |
|------|---------|
| **content_placement_advisor.html** | Interactive “pick content type + terms → see surfaces” |
| **content_placement_page.html** | Table of content type / field / vocabulary / surfaces (loads JSON) |
| **editor_placement_table.html** | Filterable table (loads editor_placement_table.json) |
| **url_lookup.html** | Paste a URL → which placement views/filters affect that page (loads url_lookup.json) |
| **dashboard/** | Three-tab Taxonomy Placement Finder (by tags, destination, content type) |
| **advisor_data.json** | Data for the Advisor (from placement report + workbook) |
| **editor_placement_table.json** | Data for placement page and editor table |
| **TAXONOMY-TO-PLACEMENT.md** | Main doc: by content type, by vocabulary, editor table, dashboard |
| **TAGGING_GUIDE.md** | Topics vs Context for content creators |
| **REGENERATE-FROM-CRAWL.md** | How to regenerate from a new crawl |
| **SCREAMING-FROG-CRAWL-GUIDE.md** | Custom Extractions & Custom Search for a better crawl |
| **DRUPAL-VIEWS-INVESTIGATION.md** | View config, displays, taxonomy filters, and embedding (views reference) |
| **CONTENT-PLACEMENT-MAP-NEXT.md** | Next steps to make the content placement map and Advisor more useful |
| **content_placement_map.csv** / **.json** | Term → pages map (from views filters + pages); use `--enrich` for labels |

---

## Next steps to strengthen the tool (prioritized)

1. **Single entry point for editors** — Share or host **README.md** (or a link to **content_placement_advisor.html**) so editors have one place to start. The Advisor is the strongest “what happens if I tag this?” flow.
2. **Advisor UX** — Add a short “How to use” (2–3 bullets) at the top of the Advisor; optionally add preset scenarios (e.g. “Story for Headlines + All SOM”) for one-click examples.
3. **Connect Advisor to tagging guide** — In the Advisor, add a visible link to [TAGGING_GUIDE.md](TAGGING_GUIDE.md) and [content_creator_tag_reference.html](content_creator_tag_reference.html) so Story editors see Topics vs Context without leaving the flow.
4. **Dashboard in the pipeline** — Generate **dashboard/data.json** from the same sources as the placement report (or document the exact steps) so one regeneration updates the Advisor, placement page, editor table, and dashboard.
5. **Optional: URL lookup** — “I’m editing this page URL — which views and terms affect it?” (reverse lookup from surfaces). Could be a small addition to the Advisor or a separate tool.
6. **Optional: one-page cheat sheet** — A printable or shareable one-pager: “Content placement at a glance” with the one URL for the Advisor and 3–4 sentences on Profiles vs Stories tagging.
