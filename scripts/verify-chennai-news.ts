/**
 * Verify Chennai news rows in Appwrite. One-shot script for manual runs.
 * Usage: npx tsx scripts/verify-chennai-news.ts [news_date-YYYY-MM-DD]
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
			Query.equal("city", "chennai"),
			Query.equal("news_date", today),
			Query.orderAsc("rank"),
			Query.limit(50),
		],
	});

	console.log(`city=chennai  news_date=${today}  rows=${res.rows.length}`);
	for (const row of res.rows as Array<Record<string, unknown>>) {
		const headline = String(row.headline ?? "");
		const summary = String(row.summary ?? "");
		const content = String(row.content ?? "");
		const thumb = String(row.thumbnail_url ?? "");
		console.log(
			`  [${row.rank}] ${row.source} | ${row.category} | thumb=${thumb ? "yes" : "no"} | body=${content.length}c | summary=${summary.length}c`,
		);
		console.log(`         "${headline}"`);
	}
}

main().catch((err) => {
	console.error("Verification failed:", err);
	process.exit(1);
});
