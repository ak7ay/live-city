import { ID, Query, type TablesDB } from "node-appwrite";
import { DB_ID, TABLE_NEWS_ARTICLES } from "../config/constants.js";
import { logger } from "../config/logger.js";
import type { NewsArticle } from "./schema.js";

export async function replaceNewsForCity(db: TablesDB, city: string, articles: NewsArticle[]): Promise<void> {
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
	const fetchedAt = new Date().toISOString();

	// List existing rows for this city and today's date
	const existing = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_NEWS_ARTICLES,
		queries: [Query.equal("city", city), Query.equal("news_date", today)],
	});

	// Delete each existing row
	for (const row of existing.rows) {
		await db.deleteRow({
			databaseId: DB_ID,
			tableId: TABLE_NEWS_ARTICLES,
			rowId: (row as { $id: string }).$id,
		});
	}

	if (existing.rows.length > 0) {
		logger.info({ city, count: existing.rows.length }, "Deleted existing news rows");
	}

	// Insert each new article
	for (const article of articles) {
		await db.createRow({
			databaseId: DB_ID,
			tableId: TABLE_NEWS_ARTICLES,
			rowId: ID.unique(),
			data: {
				city,
				headline: article.headline,
				summary: article.summary,
				content: article.content,
				category: article.category,
				source: article.source,
				source_count: article.source_count,
				original_url: article.original_url,
				thumbnail_url: article.thumbnail_url,
				news_date: today,
				rank: article.rank,
				fetched_at: fetchedAt,
			},
		});
	}

	logger.info({ city, count: articles.length }, "Inserted news articles");
}
