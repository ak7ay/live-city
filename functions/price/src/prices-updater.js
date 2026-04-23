import { ID, Query } from "node-appwrite";

export const DB_ID = "live_city";
export const TABLE_METAL_PRICES = "metal_prices";

export function pricesChanged(existing, incoming) {
	return (
		existing.gold_22k_price !== incoming.gold_22k_price ||
		existing.silver_price !== incoming.silver_price ||
		existing.platinum_price !== incoming.platinum_price
	);
}

function getTodayIST() {
	return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getNowISO() {
	return new Date().toISOString();
}

export async function fetchMostRecentRowBefore(db, city, source, beforeDate) {
	const result = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_METAL_PRICES,
		queries: [
			Query.equal("city", city),
			Query.equal("source", source),
			Query.lessThan("price_date", beforeDate),
			Query.orderDesc("price_date"),
			Query.orderDesc("$createdAt"),
			Query.limit(1),
		],
	});
	return result.rows[0];
}

// Returns { action: "new_row" | "price_changed" | "checked", priorRow }
export async function updatePriceForCity(db, city, source, prices) {
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

	const existing = result.rows[0];

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
		const priorRow = existing ?? (await fetchMostRecentRowBefore(db, city, source, today));
		return {
			action: existing ? "price_changed" : "new_row",
			priorRow,
		};
	}

	await db.updateRow({
		databaseId: DB_ID,
		tableId: TABLE_METAL_PRICES,
		rowId: existing.$id,
		data: { last_checked_at: now },
	});
	return { action: "checked", priorRow: undefined };
}
