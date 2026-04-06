# Events Agent: Per-Source Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor events agent so each source (BMS, District) runs in its own browser session with enrichment + playbook feedback, and ranking becomes a plain session with no browser.

**Architecture:** Split `collectTicketedListings()` into `collectBmsEvents()` and `collectDistrictEvents()`, each creating a browser session that does listing → enrich top 10 → playbook feedback → dispose. Replace `rankEnrichAndFeedback()` with `rankEvents()` using a plain session. All phases sequential.

**Tech Stack:** TypeScript, Zod v4, vitest, pi-coding-agent SDK

**Spec:** `docs/superpowers/specs/2026-04-06-events-per-source-sessions-design.md`

---

### Task 1: Add EnrichedEvent schema + tests

**Files:**
- Modify: `src/events/schema.ts`
- Create: `test/events/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/events/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { enrichedEventSchema, enrichedEventsSchema, type EnrichedEvent } from "../../src/events/schema.js";

function makeEnrichedEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
	return {
		title: "Arijit Singh Live",
		description: "A live concert by Arijit Singh at NICE Grounds.",
		category: "Music",
		event_date: "Sat, 12 Apr 2026",
		event_time: "7:00 PM",
		duration: "3 hours",
		venue_name: "NICE Grounds",
		venue_area: "Bengaluru",
		price: "₹999 onwards",
		source: "bookmyshow",
		source_url: "https://in.bookmyshow.com/events/arijit-singh/ET00123",
		image_url: "https://example.com/img.jpg",
		...overrides,
	};
}

describe("enrichedEventSchema", () => {
	it("accepts a valid enriched event", () => {
		const result = enrichedEventSchema.safeParse(makeEnrichedEvent());
		expect(result.success).toBe(true);
	});

	it("accepts nullable fields as null", () => {
		const result = enrichedEventSchema.safeParse(
			makeEnrichedEvent({
				event_time: null,
				duration: null,
				venue_name: null,
				venue_area: null,
				price: null,
				image_url: null,
			}),
		);
		expect(result.success).toBe(true);
	});

	it("rejects missing title", () => {
		const event = makeEnrichedEvent();
		delete (event as any).title;
		expect(enrichedEventSchema.safeParse(event).success).toBe(false);
	});

	it("rejects empty description", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ description: "" })).success).toBe(false);
	});

	it("rejects empty category", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ category: "" })).success).toBe(false);
	});

	it("rejects empty event_date", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ event_date: "" })).success).toBe(false);
	});

	it("only accepts bookmyshow or district as source", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ source: "bookmyshow" })).success).toBe(true);
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ source: "district" })).success).toBe(true);
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ source: "news" as any })).success).toBe(false);
	});

	it("rejects title over 512 chars", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ title: "a".repeat(513) })).success).toBe(false);
	});

	it("rejects category over 64 chars", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ category: "a".repeat(65) })).success).toBe(false);
	});
});

describe("enrichedEventsSchema", () => {
	it("accepts an array of enriched events", () => {
		const events = [makeEnrichedEvent(), makeEnrichedEvent({ title: "Comedy Night" })];
		expect(enrichedEventsSchema.safeParse(events).success).toBe(true);
	});

	it("accepts empty array", () => {
		expect(enrichedEventsSchema.safeParse([]).success).toBe(true);
	});

	it("rejects array with invalid event", () => {
		const events = [makeEnrichedEvent(), { title: "" }];
		expect(enrichedEventsSchema.safeParse(events).success).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run test/events/schema.test.ts`
Expected: FAIL — `enrichedEventSchema` not found in `../../src/events/schema.js`

- [ ] **Step 3: Add EnrichedEvent schema to schema.ts**

Add the following after the existing `RawEvent` types in `src/events/schema.ts`:

```typescript
// ── Enriched events (from per-source collection phases) ──────────────

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run test/events/schema.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/schema.ts test/events/schema.test.ts
git commit -m "feat(events): add EnrichedEvent schema for per-source output"
```

---

### Task 2: Implement collectBmsEvents

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Add the import for EnrichedEvent types**

In `src/events/agent.ts`, update the import from `./schema.js` to include the new types:

```typescript
import { enrichedEventsSchema, eventArticlesSchema, rawEventsSchema, type EnrichedEvent, type EventArticle, type RawEvent } from "./schema.js";
```

- [ ] **Step 2: Add collectBmsEvents function**

Add this function after `collectNewsEvents` in `src/events/agent.ts` (before `collectTicketedListings`):

```typescript
// ── Phase 2a: Collect + enrich BMS events ────────────────────────────

async function collectBmsEvents(city: string, cwd: string): Promise<EnrichedEvent[]> {
	const log = logger.child({ module: "events-agent", phase: "bms" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const bmsPlaybook = readPlaybook(cwd, "playbook-bookmyshow.md");
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	log.info("Starting BMS collection + enrichment");

	const session = await createBrowserSession(cwd, `You are a ${city} events extractor using browser tools.`);
	try {
		// ── Prompt 1: List + enrich ──
		const capture = captureResponseText(session);
		await session.prompt(`Extract and enrich the top 10 events from BookMyShow for ${city}.

Follow this playbook:

${bmsPlaybook}

City slug: ${config.bms_slug}
Today: ${today}

## Instructions

1. **Step 1 from playbook**: Extract all listings
2. **Select top 10**: Pick the 10 most promising events based on:
   - Events with dates rank higher than null-date events
   - Time proximity (sooner = higher, today is ${today})
   - Significance (big-name concerts, major sports > small bar gigs)
   - Category diversity (aim for a mix)
3. **Step 2 from playbook**: Visit each selected event's detail page and enrich with description, full date, time, duration, venue details

## Output

Return ONLY a JSON array (no markdown fences). Each object:
{
  "title": "string",
  "description": "string (1-3 sentences from detail page)",
  "category": "string",
  "event_date": "string (e.g. Fri, 17 Apr 2026)",
  "event_time": "string or null",
  "duration": "string or null",
  "venue_name": "string (parsed from venue, see playbook)",
  "venue_area": "string or null (parsed from venue, see playbook)",
  "price": "string or null",
  "source": "bookmyshow",
  "source_url": "string",
  "image_url": "string or null"
}`);
		capture.stop();

		const events: EnrichedEvent[] = await retryValidation(session, capture.getText(), enrichedEventsSchema, log);
		log.info({ count: events.length }, "BMS events collected and enriched");

		// ── Prompt 2: Playbook feedback ──
		log.info("Requesting BMS playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. If you encountered issues with the playbook, edit the file directly:

- Broken selectors (CSS selector or regex returned no/wrong data)
- New quirks (unexpected page structure, changed URL patterns)
- Better approaches (simpler selector, faster extraction)

File: memory/events/playbook-bookmyshow.md

If everything worked, say "No playbook changes needed."`);
		feedbackCapture.stop();
		log.info("BMS feedback phase complete");

		return events;
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/events/agent.ts
git commit -m "feat(events): add collectBmsEvents with enrichment + playbook feedback"
```

---

### Task 3: Implement collectDistrictEvents

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Add collectDistrictEvents function**

Add this function after `collectBmsEvents` in `src/events/agent.ts`:

```typescript
// ── Phase 2b: Collect + enrich District events ──────────────────────

async function collectDistrictEvents(city: string, cwd: string): Promise<EnrichedEvent[]> {
	const log = logger.child({ module: "events-agent", phase: "district" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const districtPlaybook = readPlaybook(cwd, "playbook-district.md");
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	log.info("Starting District collection + enrichment");

	const session = await createBrowserSession(cwd, `You are a ${city} events extractor using browser tools.`);
	try {
		// ── Prompt 1: List + enrich ──
		const capture = captureResponseText(session);
		await session.prompt(`Extract and enrich the top 10 events from District.in for ${city}.

Follow this playbook:

${districtPlaybook}

City config:
- city_slug: ${city}
- city_name: ${config.district_name}
- lat: ${config.district_lat}
- long: ${config.district_long}
Today: ${today}

## Instructions

1. **Steps 1-2 from playbook**: Set city cookie and extract all listings
2. **Filter**: Remove events NOT in ${config.district_name}
3. **Select top 10**: Pick the 10 most promising events based on:
   - Events with dates rank higher than null-date events
   - Time proximity (sooner = higher, today is ${today})
   - Significance (big-name concerts, major sports > small bar gigs)
   - Category diversity (aim for a mix)
4. **Step 3 from playbook**: Visit each selected event's detail page and enrich with description, duration, etc.
5. **Step 4 from playbook**: Parse datetime into event_date and event_time

## Output

Return ONLY a JSON array (no markdown fences). Each object:
{
  "title": "string",
  "description": "string (1-3 sentences from detail page)",
  "category": "string (inferred per playbook guidelines)",
  "event_date": "string (e.g. Fri, 17 Apr 2026)",
  "event_time": "string or null",
  "duration": "string or null",
  "venue_name": "string (parsed from venue, see playbook)",
  "venue_area": "string or null (parsed from venue, see playbook)",
  "price": "string or null",
  "source": "district",
  "source_url": "string",
  "image_url": "string or null"
}`);
		capture.stop();

		const events: EnrichedEvent[] = await retryValidation(session, capture.getText(), enrichedEventsSchema, log);
		log.info({ count: events.length }, "District events collected and enriched");

		// ── Prompt 2: Playbook feedback ──
		log.info("Requesting District playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. If you encountered issues with the playbook, edit the file directly:

- Broken selectors (CSS selector or regex returned no/wrong data)
- New quirks (unexpected page structure, changed URL patterns)
- Better approaches (simpler selector, faster extraction)

File: memory/events/playbook-district.md

If everything worked, say "No playbook changes needed."`);
		feedbackCapture.stop();
		log.info("District feedback phase complete");

		return events;
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/events/agent.ts
git commit -m "feat(events): add collectDistrictEvents with enrichment + playbook feedback"
```

---

### Task 4: Replace rankEnrichAndFeedback with rankEvents

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Add rankEvents function**

Add this function after `collectDistrictEvents` in `src/events/agent.ts` (before the old `rankEnrichAndFeedback`):

```typescript
// ── Phase 3: Rank events (no browser) ────────────────────────────────

async function rankEvents(
	newsEvents: RawEvent[],
	bmsEvents: EnrichedEvent[],
	districtEvents: EnrichedEvent[],
	city: string,
	cwd: string,
): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", phase: "ranking" });
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	log.info(
		{ news: newsEvents.length, bms: bmsEvents.length, district: districtEvents.length },
		"Starting ranking phase",
	);

	const session = await createPlainSession(cwd, `You are a ${city} events curator.`);
	try {
		const capture = captureResponseText(session);
		await session.prompt(`You have pre-enriched event listings from 3 sources for ${city}. Rank them and output the final list.

## Source A: News Events (HIGH PRIORITY — include all)
${newsEvents.length > 0 ? JSON.stringify(newsEvents, null, 2) : "None found today."}

## Source B: BookMyShow (pre-enriched)
${bmsEvents.length > 0 ? JSON.stringify(bmsEvents, null, 2) : "None found."}

## Source C: District.in (pre-enriched)
${districtEvents.length > 0 ? JSON.stringify(districtEvents, null, 2) : "None found."}

## Ranking Rules

1. **News events** — always include all (editorially significant)
2. **Time proximity** — events happening sooner rank higher (today is ${today})
3. **Significance** — big concerts, major sports, large festivals > small bar gigs
4. **Category diversity** — aim for a mix
5. **Cross-source boost** — same event on both BMS and District is more notable (dedup — keep the one with more data)
6. **Skip null dates** — events without any date are low confidence

Select: ALL news events + top ${TOP_TICKETED_COUNT} from BMS+District combined.

## News Event Transformation

For news events, transform the venue field:
- Use the venue string as venue_name, set venue_area to null if no area info is embedded
- If the venue contains a comma or colon separator, split into venue_name and venue_area
- Keep description from the news event
- Set duration to null

## Output

Return ONLY a JSON array (no markdown fences). Each object:
{
  "title": "string",
  "description": "string (1-3 sentences)",
  "category": "string",
  "event_date": "string (e.g. Fri, 17 Apr 2026)",
  "event_time": "string or null",
  "duration": "string or null",
  "venue_name": "string or null",
  "venue_area": "string or null",
  "price": "string or null",
  "source": "news | bookmyshow | district",
  "source_url": "string",
  "image_url": "string or null",
  "rank": 1
}

Rank 1 = most important. News events first, then ticketed by rank.`);
		capture.stop();

		const events: EventArticle[] = await retryValidation(session, capture.getText(), eventArticlesSchema, log);
		log.info({ count: events.length }, "Events ranked");
		return events;
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 2: Remove old collectTicketedListings and rankEnrichAndFeedback functions**

Delete the entire `collectTicketedListings` function (the `// ── Phase 2: Collect ticketed listings` section) and the entire `rankEnrichAndFeedback` function (the `// ── Phase 3: Rank, enrich, and feedback` section) from `src/events/agent.ts`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/events/agent.ts
git commit -m "refactor(events): replace combined phases with rankEvents, remove old functions"
```

---

### Task 5: Update orchestrator

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Update fetchEventsViaAgent**

Replace the existing `fetchEventsViaAgent` function body with:

```typescript
export async function fetchEventsViaAgent(city: string): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", city });
	const cwd = process.cwd();
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// Phase 1: Collect news events (no browser)
	log.info("Phase 1: Collecting news events");
	const newsEvents = await collectNewsEvents(city, today, cwd);

	// Phase 2a: Collect + enrich BMS events (browser)
	log.info("Phase 2a: Collecting BMS events");
	const bmsEvents = await collectBmsEvents(city, cwd);

	// Phase 2b: Collect + enrich District events (browser)
	log.info("Phase 2b: Collecting District events");
	const districtEvents = await collectDistrictEvents(city, cwd);

	// Phase 3: Rank all events (no browser)
	log.info("Phase 3: Ranking events");
	const events = await rankEvents(newsEvents, bmsEvents, districtEvents, city, cwd);

	log.info({ count: events.length }, "All events collected");
	return events;
}
```

- [ ] **Step 2: Clean up unused imports**

Remove `extractJson` from the import line in `src/events/agent.ts` since it was only used in `collectTicketedListings` (which is now deleted). The remaining functions use `retryValidation` which handles JSON extraction internally.

Check the import line — it should be:

```typescript
import { captureResponseText, createBrowserSession, createPlainSession, retryValidation } from "../agent/shared.js";
```

(`extractJson` removed)

- [ ] **Step 3: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npx vitest --run`
Expected: No errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/events/agent.ts
git commit -m "refactor(events): update orchestrator for sequential per-source sessions"
```

---

### Task 6: Update playbook.md

**Files:**
- Modify: `memory/events/playbook.md`

- [ ] **Step 1: Update playbook.md to reflect new phase structure**

Replace the entire contents of `memory/events/playbook.md` with:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add memory/events/playbook.md
git commit -m "docs: update playbook.md to reflect per-source session architecture"
```
