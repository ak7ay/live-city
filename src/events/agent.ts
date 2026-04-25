import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TablesDB } from "node-appwrite";
import { captureResponseText, createBrowserSession, createPlainSession, retryValidation } from "../agent/index.js";
import { logger } from "../config/logger.js";
import {
	type EventArticle,
	eventArticlesSchema,
	type ListingCandidate,
	listingCandidatesSchema,
	type RawEvent,
	rawEventsSchema,
} from "./schema.js";
import { getLiveEventsForCity } from "./store.js";
import { findInvalidCandidates, findInvalidFinalEvents } from "./validators.js";

// ── Constants ────────────────────────────────────────────────────────

const TOP_TICKETED_COUNT = 10;
const EVENT_HORIZON_DAYS = 7;
const MIN_CANDIDATES_PER_SOURCE = 10; // symmetric with TOP_TICKETED_COUNT

const CITY_CONFIG: Record<
	string,
	{ bms_slug: string; district_name: string; district_lat: number; district_long: number }
> = {
	bengaluru: { bms_slug: "bengaluru", district_name: "Bangalore", district_lat: 12.9716, district_long: 77.5946 },
	mumbai: { bms_slug: "mumbai", district_name: "Mumbai", district_lat: 19.076, district_long: 72.8777 },
	delhi: { bms_slug: "delhi-ncr", district_name: "Delhi", district_lat: 28.6139, district_long: 77.209 },
	hyderabad: { bms_slug: "hyderabad", district_name: "Hyderabad", district_lat: 17.385, district_long: 78.4867 },
	chennai: { bms_slug: "chennai", district_name: "Chennai", district_lat: 13.0827, district_long: 80.2707 },
	pune: { bms_slug: "pune", district_name: "Pune", district_lat: 18.5204, district_long: 73.8567 },
};

// ── Universal feedback-edit bar ──────────────────────────────────────
//
// Included in every phase's feedback turn. Sets a high bar for what
// counts as a meaningful edit so playbooks don't bloat run-over-run.

const FEEDBACK_EDIT_BAR = `Only edit the playbook if your observation will DEMONSTRABLY help the next run —
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
than a bloated playbook.`;

// ── Helpers ──────────────────────────────────────────────────────────

function findStoryFiles(city: string, today: string): string[] {
	const dir = join(homedir(), ".cache", "news", city, today);
	try {
		return readdirSync(dir)
			.filter((f) => f.startsWith("stories-") && f.endsWith(".md"))
			.map((f) => join(dir, f));
	} catch {
		return [];
	}
}

// ── Prompt builders ─────────────────────────────────────────────────

// Phase 1: News extraction

function newsExtractionSystemPrompt(city: string, today: string): string {
	return `\
You are a ${city} events extractor scanning news stories.

The news stories may be in a non-English language. Translate every text field — title, category, description, venue — to English in your output. Parse date and time mentions in the source language (weekday names, time-of-day phrases) and emit \`event_date\` as \`Day, DD Mon YYYY\` (e.g. \`Fri, 17 Apr 2026\`) and \`event_time\` as a short phrase (e.g. \`7:00 PM\`). URLs are language-neutral; do not modify. If something is ambiguous in translation, prefer \`null\` over guessing.

## Extraction Rules

- Only extract stories about FUTURE or ONGOING events (event_date >= ${today}) that a resident would want to attend
- The event must be something a person can GO TO — a place, a time, an activity
- News stories are NOT curated event listings, so most stories will NOT be events. Be strict.
- SKIP these entirely:
  - Strikes, bandhs, protests, shutdowns (these are disruptions, not events to attend)
  - Past events or match results (already happened)
  - Government policy announcements, political statements
  - Crime reports, accidents, weather forecasts
  - Exam results, school/college administrative news
- For each event found, extract what you can from the story text

## Output Format

Return ONLY a JSON array (no markdown fences). Each object:
{
  "title": "event name",
  "category": "Festival | Civic | Sports | Cultural | Religious | Exhibition | null",
  "event_date": "date if mentioned, or null",
  "event_time": "time if mentioned, or null",
  "venue": "location if mentioned, or null",
  "price": "null for free civic events, or price if mentioned",
  "source": "news",
  "source_url": "the news article URL",
  "image_url": null,
  "description": "1-2 sentence description from the story"
}

If NO events found, return an empty array: []`;
}

function newsExtractionUserPrompt(city: string, today: string, storiesContent: string): string {
	return `\
Scan the following news stories from ${city} (${today}) for UPCOMING events that people can voluntarily attend or participate in — festivals, concerts, exhibitions, inaugurations, public celebrations, cultural programs, sporting events (upcoming, not results), etc.

## Stories
${storiesContent}`;
}

// ── Phase 2a: BMS listing-only ───────────────────────────────────────

function bmsListingSystemPrompt(city: string, listingPlaybook: string): string {
	return `\
You are a BookMyShow listing extractor for ${city}.

## Scraping Playbook

${listingPlaybook}

## Steps

1. Navigate to the filtered listing URL exactly as written in Step 1 of the playbook (use the daygroups filter URL).
2. Execute Step 1 extraction (eval + scroll + re-extract + dedup by URL).
3. Return ONLY a JSON array of listing candidates — no markdown fences, no detail-page visits.

## Output Format

Each object:
{
  "source": "bookmyshow",
  "title": "string (non-empty)",
  "source_url": "string (the card's href)",
  "image_url": "string from card img.src, or null if the card had no image",
  "listing_date": "string from the listing, or null",
  "venue_line": "string from the card's venue line, or null",
  "category": "string from the card, or null",
  "price": "string from the card, or null"
}

Return at minimum ${MIN_CANDIDATES_PER_SOURCE} candidates. Include every card you extracted — the ranking phase will filter.`;
}

function bmsListingUserPrompt(city: string, config: (typeof CITY_CONFIG)[string], today: string): string {
	return `\
Extract the BookMyShow listing for ${city}.

City slug: ${config.bms_slug}
Today: ${today}
Target window: this-weekend (today|tomorrow|this-weekend)`;
}

// ── Phase 2b: District listing-only ──────────────────────────────────

function districtListingSystemPrompt(city: string, listingPlaybook: string): string {
	return `\
You are a District.in listing extractor for ${city}.

## Scraping Playbook

${listingPlaybook}

## Steps

1. Set the city cookie exactly as Step 1 of the playbook instructs.
2. Chain nav + eval with \`&&\` (no sleep) to extract Step 2's listing.
3. Filter by target city per the playbook.
4. Dedup by title+listing_date+venue_line.
5. Return ONLY a JSON array of listing candidates — no markdown fences, no detail-page visits.

## Output Format

Each object:
{
  "source": "district",
  "title": "string (non-empty)",
  "source_url": "string (the card's href)",
  "image_url": "string from img.src, or null",
  "listing_date": "string from the datetime field in the listing, or null",
  "venue_line": "string from the card's venue line, or null",
  "category": null,
  "price": "string from the card, or null"
}

Note: District does not expose category on the listing — set to null; Phase 3 infers it during enrichment.

Return at minimum ${MIN_CANDIDATES_PER_SOURCE} candidates.`;
}

function districtListingUserPrompt(city: string, config: (typeof CITY_CONFIG)[string], today: string): string {
	return `\
Extract the District.in listing for ${city}.

City config:
- city_slug: ${city}
- city_name: ${config.district_name}
- lat: ${config.district_lat}
- long: ${config.district_long}
Today: ${today}`;
}

// ── Phase 3: Rank + enrich ───────────────────────────────────────────

function rankAndEnrichSystemPrompt(
	city: string,
	today: string,
	maxDate: string,
	bmsEnrichmentPlaybook: string,
	districtEnrichmentPlaybook: string,
): string {
	return `\
You are the events editor for ${city}.

Your job: rank a pool of listing candidates plus news events to a final top ${TOP_TICKETED_COUNT} ticketed events (plus all news events passed through), then enrich each ticketed pick by visiting its detail page.

## Ranking Rules

1. **HARD CUTOFF**: Only include events with event_date between ${today} and ${maxDate} (7-day window).
2. **Time proximity** — events happening sooner rank higher (today is ${today}).
3. **Significance** — big concerts, major sports, large festivals > small bar gigs.
4. **Cross-source boost** — if the same event appears on both BMS and District, pick one (prefer the one with more listing fields populated) and treat it as higher signal.
5. **Image presence as a quality signal** — BMS lists low-priority events with null listing images; treat them as lower confidence.
6. **Category diversity** — avoid clustering same-category picks.
7. **Skip null listing dates** unless you have another reason to include.

## Enrichment Rules

After selecting the top ${TOP_TICKETED_COUNT} ticketed events, visit each one's detail page to enrich fields. The enrichment playbooks below (one per source) describe exactly how.

### Reuse from previous run

If the user provides a \`previous_events_path\` that references a JSON file of previously-enriched events, load it. For any selected candidate whose \`source_url\` matches an entry in that file, **reuse the enriched fields (description, event_date, event_time, duration, venue_name, venue_area, image_url)** instead of visiting the detail page. Only visit detail pages for URLs not in the cache.

### News events

News events are already enriched — pass them through without detail visits. Transform the venue string per the ranking transformation rules (split on comma/colon, or use full string as venue_name with null area).

### Carry-forward news events

The user prompt provides a "Previously captured news events" block — these are news events captured in earlier runs that may still be live. Apply these rules:

1. **Drop if stale**: If a carry-forward event's \`event_date\` is before ${today} or null, drop it.
2. **Dedup against current news**: If a carry-forward event's \`source_url\` matches an entry in this run's news list, drop the carry-forward (current news is authoritative).
3. **Keep otherwise**: Pass through unchanged with its existing enriched fields. Do not re-enrich.

The number of carry-forward events you keep is variable — there is no minimum. Output may include 0 or more depending on staleness/dedup.

## BookMyShow enrichment playbook

${bmsEnrichmentPlaybook}

---

## District enrichment playbook

${districtEnrichmentPlaybook}

---

## Output Format

Return ONLY a JSON array (no markdown fences). One object per final event. Must have exactly ${TOP_TICKETED_COUNT} ticketed entries + all news events:

{
  "title": "string",
  "description": "string (1-3 sentences)",
  "category": "string",
  "event_date": "string (non-empty, e.g. Fri, 17 Apr 2026)",
  "event_time": "string or null",
  "duration": "string or null",
  "venue_name": "string or null",
  "venue_area": "string or null",
  "price": "string or null",
  "source": "news | bookmyshow | district",
  "source_url": "string",
  "image_url": "string (non-null for ticketed sources per image fallback) or null (news only)",
  "rank": 1
}

Rank 1 = most important. News events first, then ticketed by rank.`;
}

function rankAndEnrichUserPrompt(
	city: string,
	today: string,
	newsEvents: RawEvent[],
	bmsCandidates: ListingCandidate[],
	districtCandidates: ListingCandidate[],
	previousEvents: EventArticle[],
	previousEventsPath: string,
): string {
	return `\
Rank and enrich events for ${city}. Today: ${today}

## Previous-run cache

previous_events_path: ${previousEventsPath}

(Reuse policy is in the system prompt. Apply only if a selected source_url matches an entry.)

## News events (already enriched — pass through)
${newsEvents.length > 0 ? JSON.stringify(newsEvents, null, 2) : "None found today."}

## BookMyShow listing candidates
${bmsCandidates.length > 0 ? JSON.stringify(bmsCandidates, null, 2) : "None."}

## District.in listing candidates
${districtCandidates.length > 0 ? JSON.stringify(districtCandidates, null, 2) : "None."}

## Previously captured news events (carry-forward candidates)
${previousEvents.length > 0 ? JSON.stringify(previousEvents, null, 2) : "None."}

## Steps

1. Rank candidates per the system prompt's ranking rules.
2. For each selected ticketed event: if its source_url is in the cache file, reuse; otherwise visit the detail page and enrich using the appropriate source's enrichment playbook.
3. Return the final JSON array.`;
}

async function rankAndEnrich(
	newsEvents: RawEvent[],
	bmsCandidates: ListingCandidate[],
	districtCandidates: ListingCandidate[],
	previousEvents: EventArticle[],
	previousEventsPath: string,
	city: string,
	today: string,
	maxDate: string,
	cwd: string,
): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", phase: "3-rank-enrich" });

	const bmsEnrichmentPlaybook = readFileSync(join(cwd, "memory", "events", "bookmyshow", "enrichment.md"), "utf-8");
	const districtEnrichmentPlaybook = readFileSync(join(cwd, "memory", "events", "district", "enrichment.md"), "utf-8");

	log.info(
		{
			news: newsEvents.length,
			bms: bmsCandidates.length,
			district: districtCandidates.length,
			previousCached: previousEvents.length,
		},
		"Starting Phase 3 rank + enrich",
	);

	const session = await createBrowserSession(
		cwd,
		rankAndEnrichSystemPrompt(city, today, maxDate, bmsEnrichmentPlaybook, districtEnrichmentPlaybook),
	);
	try {
		const capture = captureResponseText(session);
		await session.prompt(
			rankAndEnrichUserPrompt(
				city,
				today,
				newsEvents,
				bmsCandidates,
				districtCandidates,
				previousEvents,
				previousEventsPath,
			),
		);
		capture.stop();

		let events: EventArticle[] = await retryValidation(session, capture.getText(), eventArticlesSchema, log);

		// ── Post-schema validation ──
		const targetCount = TOP_TICKETED_COUNT + newsEvents.length + previousEvents.length;
		const check = findInvalidFinalEvents(events, targetCount);
		if (!check.countOk || check.invalid.length > 0 || check.duplicates.length > 0) {
			log.info(
				{ count: events.length, target: targetCount, invalid: check.invalid, duplicates: check.duplicates },
				"Phase 3 validation failed, asking for fixes",
			);
			const msg = [
				check.countOk ? null : `Expected ${targetCount} events; got ${events.length}.`,
				check.invalid.length > 0
					? `Malformed events:\n${check.invalid
							.map((i) => `  - ${i.source_url}: ${i.reasons.join(", ")}`)
							.join(
								"\n",
							)}\n\nFor each malformed ticketed event, either re-enrich it (re-navigate and re-extract) or substitute the next-best candidate from the listing pool.`
					: null,
				check.duplicates.length > 0
					? `Duplicate source_urls: ${check.duplicates.join(", ")} — keep only one.`
					: null,
				"Return the corrected JSON array only. No markdown fences.",
			]
				.filter(Boolean)
				.join("\n\n");
			const retry = captureResponseText(session);
			await session.prompt(msg);
			retry.stop();
			events = await retryValidation(session, retry.getText(), eventArticlesSchema, log);
		}

		log.info({ count: events.length }, "Phase 3 events finalized");

		// ── Scoped playbook feedback ──
		log.info("Requesting Phase 3 enrichment feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session.

You may edit ONLY the enrichment playbooks:
  - memory/events/bookmyshow/enrichment.md (for BMS issues)
  - memory/events/district/enrichment.md (for District issues)

Do NOT touch either listing playbook — those are Phase 2a/2b's concern.

Before editing, name the specific events where you observed the issue. If the issue appeared on only one event out of the ${TOP_TICKETED_COUNT} you enriched, treat it as a one-off and do not edit.

${FEEDBACK_EDIT_BAR}`);
		feedbackCapture.stop();
		log.info("Phase 3 feedback complete");

		return events;
	} finally {
		session.dispose();
	}
}

// ── Phase 1: Collect news events ─────────────────────────────────────

async function collectNewsEvents(city: string, today: string, cwd: string): Promise<RawEvent[]> {
	const log = logger.child({ module: "events-agent", phase: "news" });
	const storyFiles = findStoryFiles(city, today);

	if (storyFiles.length === 0) {
		log.info("No story files found, skipping news events");
		return [];
	}

	log.info({ files: storyFiles.length }, "Reading story files for event extraction");
	const storiesContent = storyFiles.map((f) => readFileSync(f, "utf-8")).join("\n\n---\n\n");

	const session = await createPlainSession(cwd, newsExtractionSystemPrompt(city, today));
	try {
		const capture = captureResponseText(session);
		await session.prompt(newsExtractionUserPrompt(city, today, storiesContent));
		capture.stop();

		const events: RawEvent[] = await retryValidation(session, capture.getText(), rawEventsSchema, log);
		log.info({ count: events.length }, "News events collected");
		return events;
	} finally {
		session.dispose();
	}
}

async function collectBmsListings(city: string, today: string, cwd: string): Promise<ListingCandidate[]> {
	const log = logger.child({ module: "events-agent", phase: "2a-bms-listing" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const listingPlaybook = readFileSync(join(cwd, "memory", "events", "bookmyshow", "listing.md"), "utf-8");
	log.info("Starting BMS listing-only extraction");

	const session = await createBrowserSession(cwd, bmsListingSystemPrompt(city, listingPlaybook));
	try {
		// ── Prompt 1: extract listing ──
		const capture = captureResponseText(session);
		await session.prompt(bmsListingUserPrompt(city, config, today));
		capture.stop();

		let candidates: ListingCandidate[] = await retryValidation(
			session,
			capture.getText(),
			listingCandidatesSchema,
			log,
		);

		// ── Post-schema validation (count + required-field check) ──
		const check = findInvalidCandidates(candidates, MIN_CANDIDATES_PER_SOURCE);
		if (!check.countOk || check.invalid.length > 0) {
			log.info({ count: candidates.length, invalid: check.invalid }, "Listing validation failed, asking for fixes");
			const msg = [
				check.countOk
					? null
					: `Your output had only ${candidates.length} candidates; we need at least ${MIN_CANDIDATES_PER_SOURCE}.`,
				check.invalid.length > 0
					? `The following candidates are malformed:\n${check.invalid
							.map((i) => `  - ${i.source_url}: ${i.reasons.join(", ")}`)
							.join("\n")}`
					: null,
				"Re-extract the listing (or expand scroll if needed) and return the corrected JSON array only. No markdown fences.",
			]
				.filter(Boolean)
				.join("\n\n");
			const retry = captureResponseText(session);
			await session.prompt(msg);
			retry.stop();
			candidates = await retryValidation(session, retry.getText(), listingCandidatesSchema, log);
		}

		log.info({ count: candidates.length }, "BMS listing candidates collected");

		// ── Prompt 2: Scoped playbook feedback ──
		log.info("Requesting BMS listing playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. You may edit ONLY memory/events/bookmyshow/listing.md.
Do NOT touch memory/events/bookmyshow/enrichment.md — that's Phase 3's concern.

${FEEDBACK_EDIT_BAR}`);
		feedbackCapture.stop();
		log.info("BMS listing feedback complete");

		return candidates;
	} finally {
		session.dispose();
	}
}

async function collectDistrictListings(city: string, today: string, cwd: string): Promise<ListingCandidate[]> {
	const log = logger.child({ module: "events-agent", phase: "2b-district-listing" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const listingPlaybook = readFileSync(join(cwd, "memory", "events", "district", "listing.md"), "utf-8");
	log.info("Starting District listing-only extraction");

	const session = await createBrowserSession(cwd, districtListingSystemPrompt(city, listingPlaybook));
	try {
		const capture = captureResponseText(session);
		await session.prompt(districtListingUserPrompt(city, config, today));
		capture.stop();

		let candidates: ListingCandidate[] = await retryValidation(
			session,
			capture.getText(),
			listingCandidatesSchema,
			log,
		);

		const check = findInvalidCandidates(candidates, MIN_CANDIDATES_PER_SOURCE);
		if (!check.countOk || check.invalid.length > 0) {
			log.info({ count: candidates.length, invalid: check.invalid }, "Listing validation failed, asking for fixes");
			const msg = [
				check.countOk
					? null
					: `Your output had only ${candidates.length} candidates; we need at least ${MIN_CANDIDATES_PER_SOURCE}.`,
				check.invalid.length > 0
					? `The following candidates are malformed:\n${check.invalid
							.map((i) => `  - ${i.source_url}: ${i.reasons.join(", ")}`)
							.join("\n")}`
					: null,
				"Re-extract the listing and return the corrected JSON array only. No markdown fences.",
			]
				.filter(Boolean)
				.join("\n\n");
			const retry = captureResponseText(session);
			await session.prompt(msg);
			retry.stop();
			candidates = await retryValidation(session, retry.getText(), listingCandidatesSchema, log);
		}

		log.info({ count: candidates.length }, "District listing candidates collected");

		log.info("Requesting District listing playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. You may edit ONLY memory/events/district/listing.md.
Do NOT touch memory/events/district/enrichment.md — that's Phase 3's concern.

${FEEDBACK_EDIT_BAR}`);
		feedbackCapture.stop();
		log.info("District listing feedback complete");

		return candidates;
	} finally {
		session.dispose();
	}
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function fetchEventsViaAgent(db: TablesDB, city: string): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", city });
	const cwd = process.cwd();
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
	const maxDateObj = new Date(today);
	maxDateObj.setDate(maxDateObj.getDate() + EVENT_HORIZON_DAYS);
	const maxDate = maxDateObj.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// Fetch previous events for cache reuse + news carry-forward
	log.info("Fetching previous events from DB");
	const allPreviousEvents = await getLiveEventsForCity(db, city);
	log.info({ count: allPreviousEvents.length }, "Previous events fetched");

	// Write combined previous-run cache (both sources) for Phase 3 reuse
	const cacheDir = join(homedir(), ".cache", "events", city);
	mkdirSync(cacheDir, { recursive: true });
	const previousTicketed = allPreviousEvents.filter((e) => e.source === "bookmyshow" || e.source === "district");
	const previousEventsPath = join(cacheDir, "ticketed-previous.json");
	writeFileSync(previousEventsPath, JSON.stringify(previousTicketed, null, 2));
	log.info({ cached: previousTicketed.length, path: previousEventsPath }, "Wrote previous-ticketed cache");

	// Phase 1: news (unchanged plain session)
	log.info("Phase 1: Collecting news events");
	const newsEvents = await collectNewsEvents(city, today, cwd);

	// Phase 2a: BMS listing-only
	log.info("Phase 2a: Collecting BMS listing candidates");
	const bmsCandidates = await collectBmsListings(city, today, cwd);

	// Phase 2b: District listing-only
	log.info("Phase 2b: Collecting District listing candidates");
	const districtCandidates = await collectDistrictListings(city, today, cwd);

	// Phase 3: rank + enrich
	const previousNewsEvents = allPreviousEvents.filter((e) => e.source === "news");
	log.info("Phase 3: Ranking and enriching");
	const events = await rankAndEnrich(
		newsEvents,
		bmsCandidates,
		districtCandidates,
		previousNewsEvents,
		previousEventsPath,
		city,
		today,
		maxDate,
		cwd,
	);

	log.info({ count: events.length }, "All events collected");
	return events;
}
