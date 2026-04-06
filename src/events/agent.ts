import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { captureResponseText, createBrowserSession, createPlainSession, retryValidation } from "../agent/shared.js";
import { logger } from "../config/logger.js";
import {
	type EnrichedEvent,
	type EventArticle,
	enrichedEventsSchema,
	eventArticlesSchema,
	type RawEvent,
	rawEventsSchema,
} from "./schema.js";

// ── Constants ────────────────────────────────────────────────────────

const TOP_TICKETED_COUNT = 10;

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

function readPlaybook(cwd: string, name: string): string {
	return readFileSync(join(cwd, "memory", "events", name), "utf-8");
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

	const session = await createPlainSession(cwd, `You are a ${city} events extractor scanning news stories.`);
	try {
		const capture = captureResponseText(session);
		await session.prompt(`Scan the following news stories from ${city} (${today}) for any civic or cultural EVENTS — festivals, inaugurations, exhibitions, public celebrations, sporting events, government ceremonies, cultural programs, etc.

## Stories
${storiesContent}

## Instructions
- Only extract stories that describe an upcoming or ongoing EVENT (something people can attend or witness)
- Skip regular news (crime reports, political statements, weather forecasts, etc.)
- For each event found, extract what you can from the story text

## Output
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

If NO events found, return an empty array: []`);
		capture.stop();

		const events: RawEvent[] = await retryValidation(session, capture.getText(), rawEventsSchema, log);
		log.info({ count: events.length }, "News events collected");
		return events;
	} finally {
		session.dispose();
	}
}

// ── Phase 2a: Collect + enrich BMS events ────────────────────────────

async function collectBmsEvents(city: string, today: string, cwd: string): Promise<EnrichedEvent[]> {
	const log = logger.child({ module: "events-agent", phase: "bms" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const bmsPlaybook = readPlaybook(cwd, "playbook-bookmyshow.md");

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

// ── Phase 2b: Collect + enrich District events ──────────────────────

async function collectDistrictEvents(city: string, today: string, cwd: string): Promise<EnrichedEvent[]> {
	const log = logger.child({ module: "events-agent", phase: "district" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const districtPlaybook = readPlaybook(cwd, "playbook-district.md");

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

// ── Phase 3: Rank events (no browser) ────────────────────────────────

async function rankEvents(
	newsEvents: RawEvent[],
	bmsEvents: EnrichedEvent[],
	districtEvents: EnrichedEvent[],
	city: string,
	today: string,
	cwd: string,
): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", phase: "ranking" });

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

// ── Orchestrator ─────────────────────────────────────────────────────

export async function fetchEventsViaAgent(city: string): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", city });
	const cwd = process.cwd();
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// Phase 1: Collect news events (no browser)
	log.info("Phase 1: Collecting news events");
	const newsEvents = await collectNewsEvents(city, today, cwd);

	// Phase 2a: Collect + enrich BMS events (browser)
	log.info("Phase 2a: Collecting BMS events");
	const bmsEvents = await collectBmsEvents(city, today, cwd);

	// Phase 2b: Collect + enrich District events (browser)
	log.info("Phase 2b: Collecting District events");
	const districtEvents = await collectDistrictEvents(city, today, cwd);

	// Phase 3: Rank all events (no browser)
	log.info("Phase 3: Ranking events");
	const events = await rankEvents(newsEvents, bmsEvents, districtEvents, city, today, cwd);

	log.info({ count: events.length }, "All events collected");
	return events;
}
