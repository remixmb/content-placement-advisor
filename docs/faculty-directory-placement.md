# Faculty Directory — Content Placement Rules

## How Faculty Appear in the Faculty Directory

The [Faculty Directory](https://som.yale.edu/faculty-research/faculty-directory) is powered by the **`faculty_directory_solr`** Drupal View (`views.view.faculty_directory_solr.yml`).

This view queries **only the `faculty` content type** — the `profile` content type is not used here.

### Faculty Category Determines Which Section

The Faculty Directory page has multiple embedded view displays, each filtered by **Faculty Category** (`field_faculty_category`):

| View Display | Section | Faculty Category (term ID) |
|---|---|---|
| `embed_2` | Yale SOM Faculty | `141` |
| `embed_3` | Affiliated Faculty | `224` |
| `embed_4` | Visiting Instructors & Scholars | `225` |
| `embed_5` | Emeriti Faculty | `192` |

The Solr-based listing (`faculty_directory_solr` / `embed_1`) shows **all faculty** on the main directory page, sorted by `category_weight` then `field_last_name`, paginated at 150 items.

### Taxonomy Fields on the `faculty` Content Type

| Dimension | Vocabulary | Field | Required |
|---|---|---|---|
| `faculty_expertise` | Faculty Expertise | `field_expertise` | No |
| `faculty_category` | Faculty Category | `field_faculty_category` | **Yes** |
| `faculty_discipline` | Faculty Discipline | `field_faculty_discipline` | No |

### What About the `profile` Content Type?

The **`profile`** content type is a **completely separate** content type used for students, alumni, staff, and other non-faculty profiles. It has its own taxonomy dimensions:

- Affiliations, Area of Focus, Citizenship, Global Network, Industry, Profile Context, **Profile Type**, Program, Topics

**Profile Type** (`field_ert_profile_type`) is a taxonomy dimension on the `profile` content type only. It has no effect on the Faculty Directory.

### Summary

- **To appear in the Faculty Directory** → content must be a **`faculty`** node with `field_faculty_category` set
- **Profile Type** → only relevant to `profile` content type, surfaces in profile grid views on program/center pages
- The two content types (`faculty` vs `profile`) are completely independent in Drupal
