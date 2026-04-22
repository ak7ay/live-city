import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { updateEventsForCity } from "./extractor/events-updater.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	const city = process.argv[2] ?? "bengaluru";

	console.log(`Running events pipeline for ${city}...`);
	await updateEventsForCity(db, city);
	console.log(`Done — events inserted into Appwrite for ${city}.`);
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
