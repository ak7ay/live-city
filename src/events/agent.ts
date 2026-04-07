import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	captureResponseText,
	createBrowserSession,
	createPlainSession,
	retryValidation,
	tryParseJson,
} from "../agent/shared.js";
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

/**
 * Validate enriched events with one retry:
 * 1. Strict parse (event_date required)
 * 2. If fails → send validation error to agent → strict parse again
 * 3. If still fails → log error, return [] to let other sources continue
 */
async function validateEnrichedEvents(
	session: { prompt: (msg: string) => Promise<void> } & { subscribe: (cb: (event: any) => void) => () => void },
	text: string,
	log: { info: (...args: any[]) => void; error: (...args: any[]) => void },
	source: string,
): Promise<EnrichedEvent[]> {
	// 1. Strict parse
	const first = tryParseJson(text, enrichedEventsSchema);
	if (first.data !== null) return first.data;

	// 2. Send validation error as feedback
	log.info({ error: first.error }, `${source}: validation failed, sending feedback to agent`);
	const retry = captureResponseText(session);
	await session.prompt(
		`Your JSON had errors:\n${first.error}\n\nFix and return only the corrected JSON. No markdown fences.`,
	);
	retry.stop();

	const second = tryParseJson(retry.getText(), enrichedEventsSchema);
	if (second.data !== null) return second.data;

	// 3. Still invalid — log and stop processing for this source
	log.error({ error: second.error }, `${source}: validation failed after retry, skipping source`);
	return [];
}

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

// ── Phase 2: Collect + enrich events from a source ───────────────────

interface EventSourceDef {
	key: string;
	label: string;
	playbookFile: string;
	buildPrompt: (params: {
		city: string;
		config: (typeof CITY_CONFIG)[string];
		today: string;
		playbook: string;
	}) => string;
}

const EVENT_SOURCES: EventSourceDef[] = [
	{
		key: "bms",
		label: "BMS",
		playbookFile: "playbook-bookmyshow.md",
		buildPrompt: ({ city, config, today, playbook }) =>
			`Extract and enrich the top 10 events from BookMyShow for ${city}.

Follow this playbook:

${playbook}

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

event_date is MANDATORY — if an event has no date, skip it entirely and substitute the next candidate from the listing.

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
}`,
	},
	{
		key: "district",
		label: "District",
		playbookFile: "playbook-district.md",
		buildPrompt: ({ city, config, today, playbook }) =>
			`Extract and enrich the top 10 events from District.in for ${city}.

Follow this playbook:

${playbook}

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

event_date is MANDATORY — if an event has no date, skip it entirely and substitute the next candidate from the listing.

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
}`,
	},
];

async function collectSourceEvents(
	source: EventSourceDef,
	city: string,
	today: string,
	cwd: string,
): Promise<EnrichedEvent[]> {
	const log = logger.child({ module: "events-agent", phase: source.key });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const playbook = readPlaybook(cwd, source.playbookFile);

	log.info(`Starting ${source.label} collection + enrichment`);

	const session = await createBrowserSession(cwd, `You are a ${city} events extractor using browser tools.`);
	try {
		// ── Prompt 1: List + enrich ──
		const capture = captureResponseText(session);
		await session.prompt(source.buildPrompt({ city, config, today, playbook }));
		capture.stop();

		const events = await validateEnrichedEvents(session, capture.getText(), log, source.label);
		log.info({ count: events.length }, `${source.label} events collected and enriched`);

		// ── Prompt 2: Playbook feedback ──
		log.info(`Requesting ${source.label} playbook feedback`);
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. If you encountered issues with the playbook, edit the file directly:

- Broken selectors (CSS selector or regex returned no/wrong data)
- New quirks (unexpected page structure, changed URL patterns)
- Better approaches (simpler selector, faster extraction)

File: memory/events/${source.playbookFile}

If everything worked, say "No playbook changes needed."`);
		feedbackCapture.stop();
		log.info(`${source.label} feedback phase complete`);

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

	// Phase 2: Collect + enrich ticketed events (browser, sequential per source)
	const enrichedBySource: Record<string, EnrichedEvent[]> = {};
	for (const source of EVENT_SOURCES) {
		log.info(`Phase 2: Collecting ${source.label} events`);
		enrichedBySource[source.key] = await collectSourceEvents(source, city, today, cwd);
	}
	const bmsEvents = enrichedBySource.bms ?? [];
	const districtEvents = enrichedBySource.district ?? [];

	// Phase 3: Rank all events (no browser)
	log.info("Phase 3: Ranking events");
	const events = await rankEvents(newsEvents, bmsEvents, districtEvents, city, today, cwd);

	log.info({ count: events.length }, "All events collected");
	return events;
}
