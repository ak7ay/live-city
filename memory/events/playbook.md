# Events Pipeline — Design Reference

Orchestration is in `src/events/agent.ts`, not in agent prompts.

## Phases

1. **Collect news events** — read `~/.cache/news/{city}/{date}/stories-*.md`, extract event mentions (plain session, no browser)
2. **Per-source collection + enrichment + feedback** — each source gets its own browser session, sequential:
   - **2a: BookMyShow** — list → select top 10 → enrich from detail pages → playbook feedback → dispose
   - **2b: District.in** — cookie setup → list → filter by city → select top 10 → enrich from detail pages → playbook feedback → dispose
3. **Ranking** — rank all pre-enriched events together, dedup cross-source, output final list (plain session, no browser)

## Source Playbooks

- `playbook-bookmyshow.md` — BMS extraction + enrichment steps
- `playbook-district.md` — District.in extraction + enrichment steps

Each playbook is used entirely within its source session. Playbook feedback (self-correction) happens in the same session that used the playbook.

## Ranking Rules

1. News events always included (editorially significant)
2. Time proximity (sooner = higher)
3. Significance (big-name > small bar gigs)
4. Category diversity
5. Cross-source boost (same event on both BMS + District)
6. Skip null dates
