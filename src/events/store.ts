import { ID, Query, type TablesDB } from "node-appwrite";
import { DB_ID, TABLE_EVENTS } from "../config/constants.js";
import { logger } from "../config/logger.js";
import type { EventArticle } from "./schema.js";

export async function replaceEventsForCity(db: TablesDB, city: string, events: EventArticle[]): Promise<void> {
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
	const fetchedAt = new Date().toISOString();

	// Delete ALL existing rows for this city (replaced by merged set)
	const existing = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_EVENTS,
		queries: [Query.equal("city", city)],
	});

	for (const row of existing.rows) {
		await db.deleteRow({
			databaseId: DB_ID,
			tableId: TABLE_EVENTS,
			rowId: (row as { $id: string }).$id,
		});
	}

	if (existing.rows.length > 0) {
		logger.info({ city, count: existing.rows.length }, "Deleted existing event rows");
	}

	// Insert new events
	for (const event of events) {
		await db.createRow({
			databaseId: DB_ID,
			tableId: TABLE_EVENTS,
			rowId: ID.unique(),
			data: {
				city,
				title: event.title,
				description: event.description,
				category: event.category,
				event_date: event.event_date,
				event_time: event.event_time,
				duration: event.duration,
				venue_name: event.venue_name,
				venue_area: event.venue_area,
				price: event.price,
				source: event.source,
				source_url: event.source_url,
				image_url: event.image_url,
				rank: event.rank,
				fetch_date: today,
				fetched_at: fetchedAt,
			},
		});
	}

	logger.info({ city, count: events.length }, "Inserted events");
}

export async function getLiveEventsForCity(db: TablesDB, city: string): Promise<EventArticle[]> {
	const result = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_EVENTS,
		queries: [Query.equal("city", city)],
	});

	return result.rows.map((row: any) => ({
		title: row.title,
		description: row.description,
		category: row.category,
		event_date: row.event_date,
		event_time: row.event_time ?? null,
		duration: row.duration ?? null,
		venue_name: row.venue_name ?? null,
		venue_area: row.venue_area ?? null,
		price: row.price ?? null,
		source: row.source,
		source_url: row.source_url,
		image_url: row.image_url ?? null,
		rank: row.rank,
	}));
}
