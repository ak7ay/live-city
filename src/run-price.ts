import { join } from "node:path";
import { createAppwriteClient, createMessaging, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { loadLalithaaConfig } from "./config/source-loader.js";
import { updatePriceForCity } from "./extractor/metals-updater.js";
import { fetchPrice, resolveStateIds } from "./metals/lalithaa.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);
	const messaging = createMessaging(client);

	const configPath = join(import.meta.dirname, "../config/sources/lalithaa.yaml");
	const config = loadLalithaaConfig(configPath);

	console.log("Resolving state IDs...");
	const stateMap = await resolveStateIds(config);
	console.log(`Resolved ${stateMap.size} cities`);

	for (const [city, { stateId }] of stateMap) {
		const prices = await fetchPrice(config.api_url, stateId);
		await updatePriceForCity(db, messaging, city, config.name, prices);
		console.log(`Updated prices for ${city}`);
	}

	console.log("Done — prices updated.");
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
