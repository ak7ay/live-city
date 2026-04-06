import { fetchEventsViaAgent } from "./events/agent.js";

async function main() {
	console.log("=== Testing events pipeline for bengaluru ===\n");

	const start = Date.now();
	try {
		const events = await fetchEventsViaAgent("bengaluru");
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);

		console.log(`\n=== RESULTS: ${events.length} events in ${elapsed}s ===\n`);
		for (const e of events) {
			const missing = ["title", "description", "category", "event_date", "source", "source_url", "rank"].filter(
				(k) => !e[k as keyof typeof e],
			);

			console.log(`[${e.rank}] ${e.source.padEnd(11)} | ${e.title}`);
			console.log(
				`    ${e.event_date ?? "no date"} ${e.event_time ?? ""} | ${e.venue_name ?? "?"}, ${e.venue_area ?? "?"}`,
			);
			console.log(`    ${e.category} | ${e.price ?? "Free"}`);
			console.log(`    desc: ${e.description?.slice(0, 80)}...`);
			if (missing.length) console.log(`    ⚠️  MISSING: ${missing.join(", ")}`);
			console.log();
		}

		// Summary
		const sources = { news: 0, bookmyshow: 0, district: 0 };
		for (const e of events) sources[e.source]++;
		console.log("=== SOURCE BREAKDOWN ===");
		console.log(`  news: ${sources.news}, bookmyshow: ${sources.bookmyshow}, district: ${sources.district}`);

		const withDesc = events.filter((e) => e.description && e.description.length > 20).length;
		const withDate = events.filter((e) => e.event_date).length;
		const withVenue = events.filter((e) => e.venue_name).length;
		console.log(`  with description: ${withDesc}/${events.length}`);
		console.log(`  with date: ${withDate}/${events.length}`);
		console.log(`  with venue: ${withVenue}/${events.length}`);
	} catch (err) {
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		console.error(`\n=== FAILED after ${elapsed}s ===`);
		console.error(err);
		process.exit(1);
	}
}

main();
