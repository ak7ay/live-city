import { join } from "node:path";
import { createAppwriteClient, createMessaging, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { loadLalithaaConfig } from "./config/source-loader.js";
import { updateEventsForCity } from "./extractor/events-updater.js";
import { updatePriceForCity } from "./extractor/metals-updater.js";
import { updateNewsForCity } from "./extractor/news-updater.js";
import { fetchPrice, resolveStateIds } from "./metals/lalithaa.js";
import { startScheduler } from "./scheduler.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);
	const messaging = createMessaging(client);

	const configPath = join(import.meta.dirname, "../config/sources/lalithaa.yaml");
	const config = loadLalithaaConfig(configPath);

	logger.info("Resolving state IDs from Lalithaa API...");
	const stateMap = await resolveStateIds(config);
	logger.info({ cities: [...stateMap.keys()] }, `Resolved ${stateMap.size} cities`);

	if (stateMap.size === 0) {
		logger.error("No cities resolved, exiting");
		process.exit(1);
	}

	const onTick = async () => {
		const results = await Promise.allSettled(
			[...stateMap.entries()].map(async ([city, { stateId }]) => {
				const prices = await fetchPrice(config.api_url, stateId);
				await updatePriceForCity(db, messaging, city, config.name, prices);
			}),
		);

		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				const city = [...stateMap.keys()][i];
				logger.error({ city, error: result.reason }, "Failed to update price");
			}
		}
	};

	startScheduler("lalithaa-prices", "*/10 9-16 * * *", onTick);

	const NEWS_EVENT_CITIES = ["bengaluru", "chennai"];

	for (const city of NEWS_EVENT_CITIES) {
		startScheduler(`${city}-news`, "0 7,18 * * *", async () => {
			try {
				await updateNewsForCity(db, city);
			} catch (error) {
				logger.error({ error, city }, "News update failed");
			}
		});

		startScheduler(`${city}-events`, "0 9 * * *", async () => {
			try {
				await updateEventsForCity(db, city);
			} catch (error) {
				logger.error({ error, city }, "Events update failed");
			}
		});
	}

	logger.info("Price, news & events extractors running. Press Ctrl+C to stop.");
}

main().catch((error) => {
	logger.error({ error }, "Fatal error");
	process.exit(1);
});
