# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Operators prospecting local businesses who need short, structured lead lists, with separate accounts and private search histories.

## Product Purpose

Leadta turns Google Maps keywords and an administrative area into a fixed-size lead batch, stores the search and results in PocketBase, and exports the batch to CSV.

## Positioning

Search runs are capped across all submitted keywords, and every export keeps the same complete set of columns.

## Operating Context

Each operator registers or signs in with email and password, then selects a country, may narrow it by province and district, enters one or more keywords, chooses a result count, reviews their own saved batches, and downloads a CSV.

## Capabilities and Constraints

- Uses the Apify Google Maps Scraper Actor `nwua9Gu5YrADL7ZDj`.
- Country is required. Province and district are optional.
- Every lead includes columns for business name, Google Maps link, address, review count, average rating, phone, email, website, category, pain points, and enrichment.
- Missing values remain empty in the table and CSV.
- Apify and PocketBase credentials are server-side environment variables.
- Pain points and enrichment are reserved fields for future work.

## Evidence on Hand

The requested Apify Actor is `compass/crawler-google-places`. No brand assets or sample data were provided.

## Product Principles

- Keep the search inputs explicit and quick to scan.
- Enforce the requested batch maximum across keywords.
- Preserve empty cells and a stable CSV schema.
- Keep credentials out of the browser.
- Keep the shared Ash and Lime brand palette defined in AGENTS.md.
- Never expose another account's batches or leads.
