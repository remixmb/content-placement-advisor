# Core Content Guide: Tagging & Placement

This guide outlines exactly where core content types (Stories, Profiles, and Events) will appear on the Yale SOM website based on how they are tagged. 

**Note for Editors:** This document is the source of truth for site business logic. If you are unsure where a piece of content will go, you can dry-run your tags using the **Content Placement Advisor Prototype.**

---

## 1. Profiles

Profiles utilize **Program**, **Center**, and **Profile Type** tags to determine where they appear.

### Explicit Placements
- **Main Directories:** Profiles will appear in the main global directories (e.g., the primary Student Directory, the main Ambassadors page) based directly on their `Profile Type` tag.

### Inherited Context (Node-Detail Views)
- **Related Profiles:** When viewing an individual Profile page, a "Related Profiles" or "Related Ambassadors" section may appear at the bottom.
  - **The Logic:** This view dynamicially uses the *current page's* tags.
  - **What this means for tagging:** If you tag a new Profile with Program `MBA`, Center `ICF`, and Profile Type `Student`, this new profile now qualifies to appear at the bottom of *all other* existing MBA/ICF Student profile pages, subject to sort order and display limits.

---

## 2. Stories

Stories utilize broad taxonomy vocabularies, often relying heavily on the **Context** and **Program** vocabularies, to populate news feeds and topic hubs.

### Explicit Placements
- **News Hubs & Program Pages:** Stories tagged with specific Centers or Programs will appear in the explicit Views placed on those landing pages (e.g., "Related News" paragraphs manually added via Views Reference).

### Inherited Context (Node-Detail Views)
- **Related Stories:** Similar to Profiles, individual Story pages look at their own tags and query the database for other Stories sharing those exact tags.
  - **What this means for tagging:** Tagging a Story with `Sustainability` means it will not only appear on the main Sustainability center page, but will automatically begin surfacing at the bottom of *older stories* that were also tagged with `Sustainability`. Be mindful of diluting highly specific terms with overly broad tags.

---

## 3. Events

Events are primarily driven by date ranges and the **Context** vocabulary. 

### Explicit Placements
- **Calendars:** The main calendar views group by event type (e.g., Academic, Admissions, Recruiting).
- **Section Overrides:** Unlike Stories and Profiles, Events frequently rely on explicit block placement and manual section inclusions (e.g., an Event block explicitly configured to only show Events tagged with a specific Center).

### Inheritance Note
Events do not typically feature the same "Related Events" bottom-of-page contextual takeover as Stories and Profiles. Placements are much more explicit to the specific views embedded on landing pages.

---

*For detailed view-by-view logic maps, please see the Content Placement Advisor Workbook.*
