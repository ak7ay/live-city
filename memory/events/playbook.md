# Events Pipeline — Design Reference

Orchestration is in `src/events/agent.ts`, not in agent prompts.

## Phases

1. **Collect news events** — read `~/.cache/news/{city}/{date}/stories-*.md`, extract event mentions (plain session, no browser)
2. **Per-source collection + enrichment + feedback** — each source gets its own browser session, sequential:
   - **2a: BookMyShow** — list → select top 10 → enrich from detail pages → playbook feedback → dispose
   - **2b: District.in** — cookie setup → list → filter by city → select top 10 → enrich from detail pages → playbook feedback → dispose
3. **Ranking** — merge today's events with previous still-live events from DB, rank, dedup cross-source, output final list (plain session, no browser)

## Source Playbooks

- `bookmyshow/listing.md` — BMS listing extraction
- `bookmyshow/enrichment.md` — BMS detail-page enrichment (incl. /nmcms/ image fallback)
- `playbook-district.md` — District.in extraction + enrichment steps

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
