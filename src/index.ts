import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { updateEventsForCity } from "./extractor/events-updater.js";
import { updateNewsForCity } from "./extractor/news-updater.js";
import { startScheduler } from "./scheduler.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	// NOTE: Price fetching moved to the Appwrite `price` function on 2026-04-23
	// (see functions/price/README.md). Manual backfill via
	// `npx tsx src/run-price.ts` still works — it uses its own imports.

	const NEWS_EVENT_CITIES = ["bengaluru", "chennai"];

	// Serialize per tick so the two cities don't each spawn concurrent Claude
	// Agent sessions — back-to-back is cheaper and keeps logs readable.
	startScheduler("news-all-cities", "0 8,18 * * *", async () => {
		for (const city of NEWS_EVENT_CITIES) {
			try {
				await updateNewsForCity(db, city);
			} catch (error) {
				logger.error({ error, city }, "News update failed");
			}
		}
	});

	startScheduler("events-all-cities", "0 9 * * *", async () => {
		for (const city of NEWS_EVENT_CITIES) {
			try {
				await updateEventsForCity(db, city);
			} catch (error) {
				logger.error({ error, city }, "Events update failed");
			}
		}
	});

	logger.info("News & events extractors running (prices run on Appwrite). Press Ctrl+C to stop.");
}

main().catch((error) => {
	logger.error({ error }, "Fatal error");
	process.exit(1);
});
