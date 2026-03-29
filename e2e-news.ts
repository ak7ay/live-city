import { createAppwriteClient, createTablesDB } from "./src/config/appwrite.js";
import { loadEnv } from "./src/config/env.js";
import { updateNewsForCity } from "./src/extractor/news-updater.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);
	await updateNewsForCity(db, "bengaluru");
	console.log("Done");
}

main();
