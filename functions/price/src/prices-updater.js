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

// Pure check: given all of today's rows and yesterday's reference row, is
// exactly one of today's rows diverging from yesterday's gold price? If yes,
// this represents the first gold change of the day and should trigger a push.
// Returning `false` when there are 0 diverging rows (no change yet) or 2+
// (already diverged earlier today) naturally caps pushes at one per day.
export function isFirstGoldChangeOfDay(todayRows, yesterdayRef) {
	if (!yesterdayRef) return false;
	const goldDiffCount = todayRows.filter((r) => r.gold_22k_price !== yesterdayRef.gold_22k_price).length;
	return goldDiffCount === 1;
}

export async function fetchNotificationContext(db, city, source) {
	const today = getTodayIST();
	const yesterdayRef = await fetchMostRecentRowBefore(db, city, source, today);
	const todayResult = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_METAL_PRICES,
		queries: [Query.equal("city", city), Query.equal("source", source), Query.equal("price_date", today)],
	});
	return { yesterdayRef, todayRows: todayResult.rows };
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
