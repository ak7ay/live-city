import { ID, Query, type TablesDB } from "node-appwrite";
import { DB_ID, TABLE_METAL_PRICES } from "../config/constants.js";
import { logger } from "../config/logger.js";

export interface PriceRecord {
	$id: string;
	city: string;
	source: string;
	gold_22k_price: number;
	silver_price: number;
	platinum_price: number;
	price_date: string;
	price_changed_at: string;
	last_checked_at: string;
}

export interface PriceInput {
	gold_22k_price: number;
	silver_price: number;
	platinum_price: number;
}

function getTodayIST(): string {
	return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getNowISO(): string {
	return new Date().toISOString();
}

function pricesChanged(existing: PriceRecord, incoming: PriceInput): boolean {
	return (
		existing.gold_22k_price !== incoming.gold_22k_price ||
		existing.silver_price !== incoming.silver_price ||
		existing.platinum_price !== incoming.platinum_price
	);
}

export async function updatePriceForCity(
	db: TablesDB,
	city: string,
	source: string,
	prices: PriceInput,
): Promise<void> {
	const today = getTodayIST();
	const now = getNowISO();

	const result = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_METAL_PRICES,
		queries: [
			Query.equal("city", city),
			Query.equal("source", source),
			Query.equal("price_date", today),
			Query.orderDesc("$createdAt"),
			Query.limit(1),
		],
	});

	const existing = result.rows[0] as unknown as PriceRecord | undefined;

	if (!existing || pricesChanged(existing, prices)) {
		await db.createRow({
			databaseId: DB_ID,
			tableId: TABLE_METAL_PRICES,
			rowId: ID.unique(),
			data: {
				city,
				source,
				gold_22k_price: prices.gold_22k_price,
				silver_price: prices.silver_price,
				platinum_price: prices.platinum_price,
				price_date: today,
				price_changed_at: now,
				last_checked_at: now,
			},
		});
		logger.info({ city, source, prices, action: existing ? "price_changed" : "new_row" }, "Created new price row");
	} else {
		await db.updateRow({
			databaseId: DB_ID,
			tableId: TABLE_METAL_PRICES,
			rowId: existing.$id,
			data: { last_checked_at: now },
		});
		logger.info({ city, source, action: "checked" }, "Prices unchanged, updated last_checked_at");
	}
}
