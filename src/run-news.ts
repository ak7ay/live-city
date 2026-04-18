import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { updateNewsForCity } from "./extractor/news-updater.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	const city = process.argv[2] ?? "bengaluru";

	console.log(`Running news pipeline for ${city}...`);
	await updateNewsForCity(db, city);
	console.log(`Done — news inserted into Appwrite for ${city}.`);
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
