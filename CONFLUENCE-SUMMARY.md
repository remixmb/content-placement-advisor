# Main SOM Taxonomy Audit and Placement Documentation

## Executive summary

This effort documents how taxonomy and section context drive content placement across the Yale SOM website.

The primary output is the documentation itself: a clearer explanation of how tagged content is surfaced across Programs, Centers, landing pages, and related-content areas. A supporting prototype, Content Placement Advisor, was built to validate and demonstrate that logic, but it is secondary to the documentation.

At a high level, this work answers a common editorial question:

> If a content editor applies certain tags, where will that content appear?

## Why this matters

Today, content placement is not always obvious to editors because it depends on several overlapping rules:

- Drupal Views configuration
- taxonomy filters
- contextual page logic
- template-driven related content
- section-specific rules for Programs and Centers

Documenting this reduces guesswork, supports more consistent tagging, and makes placement behavior easier to explain and maintain.

## What has been accomplished

This work has produced:

- a documented model of how taxonomy and context affect placement
- an audit of the main placement mechanisms currently in use
- a clearer distinction between descriptive taxonomy and placement-driving taxonomy
- a supporting prototype that can test likely placements for selected content/tag combinations

## What the documentation now clarifies

The documentation now captures four main placement patterns:

### 1. Direct View-driven placement

Some placements are controlled directly by embedded Drupal Views with explicit filters or arguments.

### 2. Template-driven related content

Some placements are driven by page templates, such as related Stories or related Profiles.

### 3. Section inheritance

Some Program and Center pages imply a placement context even when that context is not explicitly visible in the rendered View arguments.

### 4. Explicit exceptions

A small number of sections require manual exception rules because the relationship is not fully exposed in site configuration.

## Supporting prototype

To support the documentation effort, a local prototype called Content Placement Advisor was created.

The prototype can:

- accept a content type and selected terms
- show likely placements
- identify placements that are limited by view constraints
- explain why something appears or does not appear
- distinguish between direct evidence, inferred rules, and manual exceptions

The prototype is best understood as a working validation tool for the documented rules, not as the primary deliverable.

## Current state

The project is now in a strong documentation and audit phase:

- major placement rules have been identified and modeled
- several false positives have been removed by improving section-context handling
- related-content logic has been separated from page-level placement logic
- search views and modal-only views have been excluded from the placement model

## Current limitations

There are still some limits to accuracy:

- some site behavior depends on conventions that are not fully explicit in Drupal configuration
- a small number of section rules require manual maintenance
- the results depend on the freshness of the crawl and exported data

These limitations are documented and reviewable.

## Recommended next steps

1. Use this Confluence page as the primary reference for taxonomy and placement behavior
2. Review the remaining inferred and manual rules with stakeholders
3. Validate representative examples with editors and site owners
4. Decide whether the supporting prototype should remain an internal audit tool or become a more formal internal utility

## Supporting materials

Supporting implementation and audit files are available separately for review, including:

- the local prototype
- placement review exports
- manual override registry files
- a standalone snapshot of the supporting implementation
