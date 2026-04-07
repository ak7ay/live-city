import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { updateEventsForCity } from "./extractor/events-updater.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	console.log("Running events pipeline for bengaluru...");
	await updateEventsForCity(db, "bengaluru");
	console.log("Done — events inserted into Appwrite.");
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
