/**
 * Dump Bengaluru news rows as JSON for baseline comparison.
 * Usage: npx tsx scripts/dump-bengaluru-news.ts [news_date-YYYY-MM-DD]
 * Emits full row data to stdout so we can diff against a later run.
 */
import { Query } from "node-appwrite";
import { createAppwriteClient, createTablesDB } from "../src/config/appwrite.js";
import { DB_ID, TABLE_NEWS_ARTICLES } from "../src/config/constants.js";
import { loadEnv } from "../src/config/env.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const db = createTablesDB(createAppwriteClient(env));

	const today = process.argv[2] ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	const res = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_NEWS_ARTICLES,
		queries: [
			Query.equal("city", "bengaluru"),
			Query.equal("news_date", today),
			Query.orderAsc("rank"),
			Query.limit(50),
		],
	});

	const out = {
		city: "bengaluru",
		news_date: today,
		captured_at: new Date().toISOString(),
		count: res.rows.length,
		rows: res.rows,
	};
	process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((err) => {
	console.error("Dump failed:", err);
	process.exit(1);
});
