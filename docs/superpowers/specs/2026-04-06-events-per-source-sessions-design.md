# Events Agent: Per-Source Sessions Redesign

## Problem

Currently Phase 2 bundles BMS + District into one browser session, and Phase 3 handles enrichment + playbook feedback in another session far removed from the source extraction. Playbook feedback is most valuable in the same session that actually interacted with the source.

## Design

Three sequential phases, each in its own fresh session. Phase 2 splits into per-source sub-phases (sequential). Playbook feedback moves into the source session that used the playbook.

```
Phase 1: News         (plain session)   → RawEvent[]
Phase 2a: BMS         (browser session)  → EnrichedEvent[] + playbook feedback
Phase 2b: District    (browser session)  → EnrichedEvent[] + playbook feedback
Phase 3: Ranking      (plain session)    → EventArticle[]
```

## Phase 1: News Collection (unchanged)

- Plain session, extracts events from story files
- Outputs `RawEvent[]`
- No playbook, no feedback

## Phase 2: Per-Source Collection + Enrichment + Feedback

Two sequential browser sessions, each handling one source end-to-end.

### Phase 2a — BMS Session

1. Extract listings using playbook Step 1
2. Self-select top 10 most promising (time proximity, significance, has date)
3. Enrich selected via playbook Step 2 (visit detail pages)
4. Review session & edit `playbook-bookmyshow.md` if issues found
5. Output: `EnrichedEvent[]`

### Phase 2b — District Session

1. Set city cookie, extract listings using playbook Steps 1-2
2. Self-select top 10, filter by city
3. Enrich selected via playbook Step 3 (visit detail pages)
4. Review session & edit `playbook-district.md` if issues found
5. Output: `EnrichedEvent[]`

### Selection criteria for top 10

- Events with dates rank higher than null-date events
- Time proximity (sooner = higher)
- Significance (big-name concerts, major sports > small bar gigs)
- Category diversity (aim for a mix)

## Phase 3: Ranking (plain session, no browser)

- Receives `RawEvent[]` (news) + `EnrichedEvent[]` (BMS) + `EnrichedEvent[]` (District)
- Dedupes cross-source matches (same event on both BMS + District — keep the one with more data)
- Ranks: ALL news events + top 10 ticketed combined
- News events get transformed: venue string → venue_name/venue_area, description carried through
- Outputs `EventArticle[]` with rank assigned

## Schema Changes

### New: `EnrichedEvent` (in `src/events/schema.ts`)

Like `EventArticle` but without `rank`. Used as Phase 2 output.

```typescript
export const enrichedEventSchema = z.object({
  title: z.string().min(1).max(512),
  description: z.string().min(1),
  category: z.string().min(1).max(64),
  event_date: z.string().min(1),
  event_time: z.string().nullable(),
  duration: z.string().nullable(),
  venue_name: z.string().nullable(),
  venue_area: z.string().nullable(),
  price: z.string().nullable(),
  source: z.enum(["bookmyshow", "district"]),
  source_url: z.string(),
  image_url: z.string().nullable(),
});

export const enrichedEventsSchema = z.array(enrichedEventSchema);
export type EnrichedEvent = z.infer<typeof enrichedEventSchema>;
```

Existing `RawEvent` and `EventArticle` schemas unchanged.

## Code Changes

### `src/events/agent.ts`

- `collectTicketedListings()` removed
- New `collectBmsEvents(city, cwd)` → returns `EnrichedEvent[]`
  - Creates browser session
  - Single prompt: full BMS playbook (listing + enrichment for top 10)
  - Second prompt: playbook feedback (edit `playbook-bookmyshow.md` if needed)
  - Validates output against `enrichedEventsSchema`
  - Disposes session
- New `collectDistrictEvents(city, cwd)` → returns `EnrichedEvent[]`
  - Creates browser session
  - Single prompt: full District playbook (cookie + listing + enrichment for top 10)
  - Second prompt: playbook feedback (edit `playbook-district.md` if needed)
  - Validates output against `enrichedEventsSchema`
  - Disposes session
- `rankEnrichAndFeedback()` → replaced by `rankEvents(newsEvents, bmsEvents, districtEvents, city, cwd)`
  - Plain session (no browser)
  - Receives pre-enriched events
  - Ranks and outputs `EventArticle[]`
  - No enrichment, no playbook feedback
- `fetchEventsViaAgent()` orchestrator updated:
  - Phase 1: `collectNewsEvents()` — unchanged
  - Phase 2a: `collectBmsEvents()`
  - Phase 2b: `collectDistrictEvents()`
  - Phase 3: `rankEvents()`
  - All sequential

### `memory/events/playbook.md`

Update to reflect new phase structure:
- Phase 1: News collection (no browser)
- Phase 2: Per-source collection + enrichment + feedback (one browser session per source, sequential)
- Phase 3: Ranking only (no browser)
