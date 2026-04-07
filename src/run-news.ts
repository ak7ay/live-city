import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { updateNewsForCity } from "./extractor/news-updater.js";

async function main() {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	console.log("Running news pipeline for bengaluru...");
	await updateNewsForCity(db, "bengaluru");
	console.log("Done — news inserted into Appwrite.");
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
