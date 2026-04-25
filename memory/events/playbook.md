# Events Pipeline — Design Reference

Orchestration is in `src/events/agent.ts`, not in agent prompts.

## Phases

1. **Phase 1 — News** — read `~/.cache/news/{city}/{date}/stories-*.md`, extract event mentions (plain session, no browser).
2. **Phase 2a — BMS listing-only** — extract top listing candidates from BookMyShow (browser session, no detail visits, scoped feedback to bookmyshow/listing.md).
3. **Phase 2b — District listing-only** — extract top listing candidates from District.in (browser session, cookie setup, scoped feedback to district/listing.md).
4. **Phase 3 — Rank + enrich** — single browser session that ranks all candidates + news + carry-forward, then enriches only the top N ticketed picks by visiting detail pages (reuse-from-cache for previously-enriched URLs; scoped feedback to both enrichment.md files).

## Source Playbooks

- `bookmyshow/listing.md` — BMS listing extraction
- `bookmyshow/enrichment.md` — BMS detail-page enrichment (incl. /nmcms/ image fallback)
- `district/listing.md` — District.in listing extraction
- `district/enrichment.md` — District.in detail-page enrichment

Each playbook is used entirely within its source session. Playbook feedback (self-correction) happens in the same session that used the playbook.

## Data Lifecycle

- Before Phase 3, previous events are fetched from DB via `getLiveEventsForCity()`
- Phase 3 agent merges today's scrape with previous still-live events
- Store replaces ALL events for the city (not just today's fetch_date)
- DB always has exactly one clean set per city — no duplicates, no gaps
- Frontend queries `city=X` — works before and after daily run

## Ranking Rules

1. News events always included (editorially significant)
2. Time proximity (sooner = higher)
3. Significance (big-name > small bar gigs)
4. Category diversity
5. Cross-source boost (same event on both BMS + District)
6. Skip null dates
7. Ranking stability (don't reshuffle without reason)
8. Category consistency (keep previous categories unless wrong)
