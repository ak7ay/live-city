import { join } from "node:path";
import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { loadLalithaaConfig } from "./config/source-loader.js";
import { updatePriceForCity } from "./extractor/price-updater.js";
import { startScheduler } from "./scheduler.js";
import { fetchPrice, resolveStateIds } from "./sources/lalithaa.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

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
				await updatePriceForCity(db, city, config.name, prices);
			}),
		);

		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				const city = [...stateMap.keys()][i];
				logger.error({ city, error: result.reason }, "Failed to update price");
			}
		}
	};

	// Run once immediately on startup
	logger.info("Running initial price fetch...");
	await onTick();

	startScheduler("lalithaa-prices", onTick);
	logger.info("Price extractor running. Press Ctrl+C to stop.");
}

main().catch((error) => {
	logger.error({ error }, "Fatal error");
	process.exit(1);
});
