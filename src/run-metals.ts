import { join } from "node:path";
import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { loadLalithaaConfig } from "./config/source-loader.js";
import { updatePriceForCity } from "./extractor/metals-updater.js";
import { fetchPrice, resolveStateIds } from "./metals/lalithaa.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	const configPath = join(import.meta.dirname, "../config/sources/lalithaa.yaml");
	const config = loadLalithaaConfig(configPath);

	console.log("Resolving state IDs from Lalithaa API...");
	const stateMap = await resolveStateIds(config);
	console.log(`Resolved ${stateMap.size} cities:`, [...stateMap.keys()]);

	if (stateMap.size === 0) {
		console.error("No cities resolved, exiting");
		process.exit(1);
	}

	const results = await Promise.allSettled(
		[...stateMap.entries()].map(async ([city, { stateId }]) => {
			const prices = await fetchPrice(config.api_url, stateId);
			await updatePriceForCity(db, city, config.name, prices);
			console.log(`✅ ${city} metals updated`);
		}),
	);

	for (const [i, result] of results.entries()) {
		if (result.status === "rejected") {
			const city = [...stateMap.keys()][i];
			console.error(`❌ ${city} failed:`, result.reason);
		}
	}

	console.log("Done — metals update complete.");
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
