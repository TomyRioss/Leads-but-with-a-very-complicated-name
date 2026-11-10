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

- Uses the Apify Actor `k-data-lab/google-maps-scraper` with a per-user, per-location monitor to return new places across repeat searches.
- Country is required. Province and district are optional.
- Every lead includes columns for business name, Google Maps link, address, review count, average rating, phone, email, website, social profiles, category, pain points, and enrichment.
- Missing values remain empty in the table and CSV.
- Apify and PocketBase credentials are server-side environment variables.
- Searches save the sample reviews and place details returned by the normal Apify search. Users can run post-generation pain analysis or lead enrichment on a batch with DeepSeek V4.1 Flash via OpenRouter.
- Pain analysis and lead enrichment use OpenRouter server web search and fetch tools. Pain analysis prioritizes review text persisted by the normal search and may try the Maps URL if that text is missing; Maps review text is not guaranteed to be readable through web fetch. Findings require review text as evidence. Enrichment checks selected public social networks. Neither analysis calls Apify.

## Evidence on Hand

The active Apify Actor is `k-data-lab/google-maps-scraper`, with a monitor scoped to each user's location. No brand assets or sample data were provided.

## Product Principles

- Keep the search inputs explicit and quick to scan.
- Enforce the requested batch maximum across keywords.
- Preserve empty cells and a stable CSV schema.
- Keep credentials out of the browser.
- Never present review topics, ratings, or a Maps URL as review text. If a search result has no saved review text and Maps fetch is empty, return no pain findings and surface the access limitation.
- Every lead-enrichment run must execute at least one web search on the selected social networks before saving a result; if no search runs, report an error instead of marking it complete.
- Persist verified social profile URLs with the selected network list; show only those selected networks as separate lead-table columns.
- Keep the shared Ash and Lime brand palette defined in AGENTS.md.
- Never expose another account's batches or leads.

## Backprop

- B1 | 2026-11-07 | OpenRouter server tools were optional and the model completed without searching; usage parsing also read an outdated field. | V1
- B2 | 2026-11-07 | VPS PocketBase lacked the migrations for lead review data, so it silently saved leads without the new JSON fields. | V2
- V1: Every social enrichment request selects at least one network, executes at least one OpenRouter web search, and is not saved as complete when that search did not run.
- V2: Every deployment verifies that PocketBase has the required `users.phone` and lead fields, including `social_profiles`, `source_reviews`, and `source_context`, before treating saved leads as complete.
- B3 | 2026-11-07 | Enrichment returned narrative text without persisting profile URLs per network, while the UI exposed one generic social column. | V3
- V3: Enrichment validates and persists official profile URLs by selected network, then renders only those networks as separate columns.
- B4 | 2026-11-09 | Pain analysis relied on a JSON prompt without response_format, allowing narrative output that the parser could not save. | Mechanical omission corrected by requiring the existing strict schema for all analysis requests.
