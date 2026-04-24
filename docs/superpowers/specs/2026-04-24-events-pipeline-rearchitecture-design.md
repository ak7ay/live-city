# Events Pipeline Rearchitecture — Design

## Context

Current events pipeline (see [2026-04-06-events-per-source-sessions-design.md](2026-04-06-events-per-source-sessions-design.md)):

```
Phase 1: News          (plain session)    → RawEvent[]
Phase 2a: BMS          (browser session)  → scrape listings + enrich top 10
Phase 2b: District     (browser session)  → scrape listings + enrich top 10
Phase 3: Ranking       (plain session)    → pick final top N
```

Two observed problems, both rooted in the same design shape:

1. **Image coverage is poor for BMS.** In the current bengaluru batch: District 100% have images, BMS 29% (5 of 7 null), news 0% (image_url hardcoded null). Screenshot confirms pin-icon fallback on the events page.
2. **Token cost is high, especially on BMS.** Recent session averages (from Claude session files): BMS ~2.67M tokens/run, District ~1.46M tokens/run. Of that, ~90% sits in the per-source detail-page enrichment loop — and events that get enriched are often dropped by Phase 3 ranking. Enrichment is paid for events that never ship.

Root causes, verified:

- **Listing cards are lazy-loaded.** Filtered URL `?daygroups=today|tomorrow|this-weekend` returns 30 cards of which only ~8 have `<img src>` populated at first render. Forcing viewport via `scrollIntoView` for every card followed by a 5s wait did not trigger the remaining images to load. The `<img>` tags are in the DOM with empty `src`, no `data-src`, no `srcset`.
- **Detail pages do carry a reliable banner image** under the `assets-in.bmscdn.com/.../nmcms/...` path, even when `og:image` is empty. Verified on two events that had missing listing images.
- **Cloudflare blocks direct HTTP fetch** (403 "Attention Required" on curl and WebFetch). Browser automation is the only path.
- **Each source session enriches 10 events, then Phase 3 selects fewer.** Every enrichment that doesn't make the final cut is pure waste.

## Goals

- Image coverage for BMS events: from 29% to ≥95%.
- Total tokens per run: from ~4.4M to ≤1.7M (~60% reduction).
- Every detail-page enrichment lands in the final output (zero wasted enrichment).
- Feedback loops tight enough that playbooks self-maintain without bloating.

## Non-goals

- No changes to the news pipeline.
- No changes to the `EventArticle` schema or the Appwrite `events` collection.
- No changes to the client/app rendering.
- No upload of images to Appwrite storage (keep direct CDN URLs).

## Architecture

### New phase layout

```
Phase 1:  News                (plain session)    → RawEvent[]       (unchanged)
Phase 2a: BMS listing-only    (browser session)  → ListingCandidate[] (no detail visits)
Phase 2b: District listing-only (browser session) → ListingCandidate[] (no detail visits)
Phase 3:  Rank + enrich       (browser session)  → EventArticle[]
```

The critical change: enrichment moves to Phase 3 and only runs on the subset that the ranker has selected. Every detail visit is paid for an event that ships.

### Phase 2a/2b: listing-only browser sessions

Each session performs only Step 1 of its source's playbook — navigate, scroll, extract cards, deduplicate by URL. No detail-page enrichment. Output is a small JSON array of `ListingCandidate` objects (title, url, image_url if present on listing, listing_date, venue_line, category, price, source).

For BMS specifically, the session navigates to `https://in.bookmyshow.com/explore/events-{city}?daygroups=today|tomorrow|this-weekend`. Verified in live browser: this narrows the card set to today/tomorrow/weekend relevance (heading reads "Events happening This Weekend"), with the URL params persisted. Card count stays ~30 either way but the set is more relevant, reducing agent-side out-of-window filtering in Phase 3.

District unchanged relative to current Step 1 logic (city cookie setup, listing extraction).

### Phase 3: rank + enrich

One browser session. Inputs: all `ListingCandidate[]` from 2a/2b plus `RawEvent[]` from Phase 1. System prompt carries both sources' **enrichment playbooks** plus the ranking criteria. Steps:

1. Read candidates.
2. Rank to final top N using listing-level signals (title, venue, category, price, listing date, image presence) plus the news set.
3. For each ticketed top-N pick, visit the detail page and enrich — unless a cached entry matches the URL, in which case reuse. News events are passed through (no detail visit; news already has full fields).
4. Output `EventArticle[]` with full enriched fields.

This is a single session both because it keeps system-prompt caching hot across the rank-then-enrich turns and because the ranker's selections flow directly into the enrichment step with no cross-session handoff.

**Combined vs split Phase 3:** starting with combined. If brittleness (one failure loses both steps) or retry complexity pushes back, split into Phase 3a (rank, plain session) and Phase 3b (enrich, browser session).

## Playbook restructure

### Split per source into listing + enrichment halves

```
memory/events/
  bookmyshow/
    listing.md       — URL patterns (incl. daygroups filter), card selector,
                       scroll behaviour, listing date decoding, listing-only quirks
    enrichment.md    — detail-page nav (sleep/chain), SPA reroute handling,
                       date/time/venue/duration regex, description sentinels,
                       /nmcms/ image fallback, enrichment-only quirks
  district/
    listing.md       — ...
    enrichment.md    — ...
```

Rationale: Phase 2a/2b only loads its source's `listing.md`. Phase 3 loads both enrichment halves (they're small without the listing sections) and both sources' ranking hints. Smaller per-session system prompts; cleaner "edit only the file that was in scope for this session" feedback.

### Cleanup pass performed as part of the split

The existing `playbook-bookmyshow.md` has accumulated cruft from multiple agent edits. During the split, apply this rubric to every existing line:

1. **Group related quirks.** All SPA-routing notes merged into one section in `enrichment.md`. All venue-parsing rules merged. All date-regex edge cases merged with a single header.
2. **Drop stale items.** The "browser-eval may timeout on Chrome 147" CDP fallback block moves out of the per-source playbooks into a single shared `memory/events/tooling-fallback.md` (or gets dropped entirely if Option E — stabilize browser-tools — lands first).
3. **De-duplicate.** Multiple quirks assert "detail date is authoritative over listing date" — collapse to one line.
4. **Preserve hard-won edge cases.** The "duration shows 12 Minutes for a concert" and "time captures UI clock :02 PM" quirks stay; group under a clear "## Regex output sanity checks" heading in `enrichment.md`.
5. **Route by phase.** Listing-relevant quirks (PROMOTED cards first, image URL ImageKit date encoding, scroll extraction inconsistency) → `listing.md`. Detail-relevant (SPA reroute, regex failures, description bleed, venue fallback) → `enrichment.md`. Venue parsing → `enrichment.md` (that's where it's applied).

District gets the same treatment.

### New content in enrichment.md (image recovery)

Addition to the existing detail-page `browser-eval` script: extract a fallback image URL by finding the first `<img>` whose `src` contains `/nmcms/` and does not contain `/synopsis/`. The `/synopsis/` exclusion filters out the icon set (calendar.png, duration.png, age_limit.png, etc.) that sits inside synopsis blocks.

Pseudocode for the eval addition:
```js
banner_image: Array.from(document.querySelectorAll("img"))
  .map(i => i.src)
  .find(s => s && s.includes("/nmcms/") && !s.includes("/synopsis/")) || null
```

Store rule: `image_url = listing.image || enrichment.banner_image || null`.

## Prompt architecture

Apply the same pattern to every phase: **static job description goes in the system prompt; per-run task data goes in the user prompt.**

### Phase 2a — BMS listing

**System prompt (stable across runs):**
- Role ("You are a BookMyShow listing extractor for {city}.")
- The `bookmyshow/listing.md` playbook verbatim
- Output schema (ListingCandidate[] — small: title, url, image_url, listing_date, venue_line, category, price)
- Steps list: 1) Navigate to filtered URL, 2) Execute Step 1 extraction from playbook, 3) Deduplicate by URL, 4) Return JSON

**User prompt (per-run):**
- City slug
- Today's date (IST YYYY-MM-DD)
- Target window ("this-weekend")

### Phase 2b — District listing

Same shape, District listing playbook and District-specific steps.

### Phase 3 — rank + enrich

**System prompt:**
- Role ("You are the events editor for {city}.")
- `bookmyshow/enrichment.md` + `district/enrichment.md` playbooks
- Ranking criteria (proximity, significance, category diversity, image-availability as a quality signal)
- Reuse-from-cache policy (see below)
- Output schema (`EventArticle[]` — full fields)
- Steps list: 1) Read candidates, 2) Rank to target count, 3) Enrich each ticketed pick via its source's enrichment playbook (unless cache hit), 4) Return JSON

**User prompt (per-run):**
- City, today, target count
- Previous-run cache file path (absolute)
- Listing JSON inline: news + BMS + District candidates

### Reuse-from-cache policy

Applied only in Phase 3. System prompt:

> If a `source_url` for a selected event appears in the previous-run cache file you've been given, reuse its enriched fields (`description`, `event_date`, `event_time`, `duration`, `venue_name`, `venue_area`, `image_url`) instead of visiting the detail page. If the cache file is empty or missing, enrich all selected events normally.

User prompt carries the concrete absolute path so the system-prompt template stays 100% stable across runs.

## Validation & feedback hooks

Mirror the news pattern: per-phase validation with in-session retry on specific errors, then a scoped feedback turn where the agent may edit the playbook directly. All feedback turns use the same high-bar edit criteria.

### Phase 2a / 2b — listing

**Validation** (run after the agent returns):
- Array length ≥ 10 candidates
- Every candidate has `title` and `source_url`
- Every candidate has a non-null `listing_date` OR `image_url` (fully blank cards fail — the agent probably extracted from a loading state)

**In-session retry** (one attempt): point at the specific malformed cards, ask for re-extraction in the same session. Cache stays hot.

**Feedback turn:** "You may edit only `bookmyshow/listing.md` (or `district/listing.md` for Phase 2b). Do NOT touch any enrichment playbook — that's Phase 3's concern." Uses the universal edit bar (see below).

### Phase 3 — rank + enrich

**Validation:**
- Final array length equals target count
- Every event has non-empty `event_date`, valid `source`, valid `source_url`
- Every ticketed event (`source` in `bookmyshow | district`) has non-null `image_url` — news events are exempt since news extraction does not produce image URLs today
- No duplicate `source_url` entries

**In-session retry** (one attempt): name the specific failing events, ask the agent to either re-fix that event (re-navigate and re-extract) or substitute the next-best candidate from the listing pool.

**Feedback turn:** scoped two-ways based on what the agent reports having observed:
- BMS-related enrichment issues → edit `bookmyshow/enrichment.md`
- District-related enrichment issues → edit `district/enrichment.md`
- Do NOT touch either listing playbook (Phase 2a/2b concern)

Phase 3 extra guard, appended to the feedback prompt:

> Before editing, name the specific events where you observed the issue. If the issue appeared on only one event out of the N you enriched, treat it as a one-off and do not edit.

### Universal feedback-edit bar

Included verbatim in every feedback turn (Phase 2a, 2b, 3):

```
Only edit the playbook if your observation will DEMONSTRABLY help the next run —
i.e., something that would otherwise cause failure, waste tokens, or produce
wrong output if the next run doesn't know about it.

Qualifies:
  - A selector/URL/endpoint that stopped working (page structure changed)
  - A quirk observed MULTIPLE times in this session (not a one-off)
  - A simplification where the playbook's approach was clearly worse than
    what you did, and you can state why

Does NOT qualify — respond "No playbook changes needed":
  - One-off SPA timing glitch that resolved on retry
  - Stylistic rewording of existing instructions
  - Reminders of things already stated
  - Speculative "just in case" notes
  - Minor observations that didn't affect extraction

If editing, prefer delete-or-replace over append. Do not add to "Quirks"
unless the failure class is clearly not already covered.

Default: if unsure, answer "No playbook changes needed." A terse run is better
than a bloated playbook.
```

## Schema changes

None to Appwrite. One new intermediate type in `src/events/schema.ts`:

```ts
ListingCandidate = {
  source: "bookmyshow" | "district",
  title: string,
  source_url: string,         // the event's canonical URL
  image_url: string | null,   // from listing card if present
  listing_date: string | null,
  venue_line: string | null,
  category: string | null,
  price: string | null,
}
```

`RawEvent` (news) and `EventArticle` (final) remain as today.

## Token estimate

Based on observed current averages and expected-work scaling:

| Phase | Current | Proposed |
|-------|---------:|---------:|
| Phase 1 — News | ~90k | ~90k |
| Phase 2a — BMS | ~2,670k (scrape + enrich 10) | ~200k (listing only) |
| Phase 2b — District | ~1,460k (scrape + enrich 10) | ~150k (listing only) |
| Phase 3 — Rank (+ enrich in new) | ~75k (rank only) | ~1,200k (rank + enrich top 10) |
| **Total / run** | **~4,295k** | **~1,640k** |

~62% reduction. Assumes filter URL + fewer out-of-window candidates shave Phase 3 enrichment slightly versus today's per-source enrichment; the bigger win is enriching 10 events once instead of 20 and discarding.

## Rollout

1. **Image fix first (low risk).** Land the `/nmcms/` banner-image fallback in the *current* architecture's Phase 2a enrichment script. Verifies the selector against real sessions, ships user-visible improvement immediately. Independent of the rest.
2. **Playbook split + cleanup pass.** No behavior change. Pure file reorganization. The current `agent.ts` keeps loading what it loads today (concatenated `listing.md + enrichment.md`) until step 3.
3. **Architecture migration.** Implement Phase 2a/2b listing-only sessions and Phase 3 rank+enrich session. Update `src/events/agent.ts` orchestrator. Update prompt builders to use the system/user split.
4. **Measure over 5–10 runs.** Compare token cost and image coverage against the targets. Revisit split-session Phase 3 only if combined brittleness shows up.

## Open questions

1. **Phase 3 combined vs split.** Starting combined; will reassess after observed behavior.
2. **Chrome-147 CDP fallback.** Currently embedded in `playbook-bookmyshow.md`. Planned home is a shared `memory/events/tooling-fallback.md` during the split. Stabilizing `browser-tools` (Option E from brainstorming) is a separate thread; if that lands first, drop the fallback entirely.
3. **Per-source minimum in Phase 3.** The ranker could in principle pick all BMS and zero District. If this skew is observed in practice, add a minimum (e.g., "pick at least 2 from each source that has candidates"); not in v1.

## Appendix: key source files touched

- `src/events/agent.ts` — replace per-source enrich loops, add listing-only sessions, add rank+enrich session, wire validation + feedback hooks
- `src/events/schema.ts` — add `ListingCandidate`
- `src/extractor/events-updater.ts` — update orchestration entry points if phase count changes surface there
- `memory/events/playbook-bookmyshow.md` → split into `memory/events/bookmyshow/listing.md` + `memory/events/bookmyshow/enrichment.md`
- `memory/events/playbook-district.md` → split into `memory/events/district/listing.md` + `memory/events/district/enrichment.md`
- `memory/events/tooling-fallback.md` — new, holds the Chrome 147 CDP fallback
