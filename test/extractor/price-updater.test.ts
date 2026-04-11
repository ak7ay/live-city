import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchMostRecentRowBefore,
	type PriceInput,
	type PriceRecord,
	updatePriceForCity,
} from "../../src/extractor/metals-updater.js";

vi.mock("../../src/config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeDb() {
	return {
		listRows: vi.fn(),
		createRow: vi.fn(),
		updateRow: vi.fn(),
	};
}

function makeMessaging() {
	return {
		createPush: vi.fn().mockResolvedValue({}),
	};
}

const basePrices: PriceInput = {
	gold_22k_price: 7500,
	silver_price: 95,
	platinum_price: 3200,
};

const existingRow: PriceRecord = {
	$id: "row-123",
	city: "chennai",
	source: "lalithaa",
	gold_22k_price: 7500,
	silver_price: 95,
	platinum_price: 3200,
	price_date: "2026-03-29",
	price_changed_at: "2026-03-29T04:00:00.000Z",
	last_checked_at: "2026-03-29T04:00:00.000Z",
};

describe("updatePriceForCity", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-29T10:00:00+05:30"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("inserts new row when no row exists for today", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", basePrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(db.updateRow).not.toHaveBeenCalled();

		const call = db.createRow.mock.calls[0][0];
		expect(call.data.city).toBe("chennai");
		expect(call.data.source).toBe("lalithaa");
		expect(call.data.gold_22k_price).toBe(7500);
		expect(call.data.silver_price).toBe(95);
		expect(call.data.platinum_price).toBe(3200);
		expect(call.data.price_date).toBe("2026-03-29");
		expect(call.data.price_changed_at).toBe("2026-03-29T04:30:00.000Z");
		expect(call.data.last_checked_at).toBe("2026-03-29T04:30:00.000Z");
	});

	it("inserts new row when prices differ", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValue({ rows: [existingRow], total: 1 });
		db.createRow.mockResolvedValue({});

		const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7600 };
		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(db.updateRow).not.toHaveBeenCalled();

		const call = db.createRow.mock.calls[0][0];
		expect(call.data.gold_22k_price).toBe(7600);
	});

	it("updates last_checked_at when prices are the same", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValue({ rows: [existingRow], total: 1 });
		db.updateRow.mockResolvedValue({});

		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", basePrices);

		expect(db.updateRow).toHaveBeenCalledOnce();
		expect(db.createRow).not.toHaveBeenCalled();

		const call = db.updateRow.mock.calls[0][0];
		expect(call.rowId).toBe("row-123");
		expect(call.data).toEqual({ last_checked_at: "2026-03-29T04:30:00.000Z" });
	});

	it("does not send a notification when this is the first row ever for the city", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValueOnce({ rows: [], total: 0 }); // no row for today
		db.listRows.mockResolvedValueOnce({ rows: [], total: 0 }); // no prior row before today
		db.createRow.mockResolvedValue({});

		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", basePrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(messaging.createPush).not.toHaveBeenCalled();
	});

	it("sends a notification when an earlier-today row exists and gold changed", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValueOnce({ rows: [existingRow], total: 1 });
		db.createRow.mockResolvedValue({});

		const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7600 };
		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(messaging.createPush).toHaveBeenCalledOnce();
		const callJson = JSON.stringify(messaging.createPush.mock.calls[0]);
		expect(callJson).toContain("prices-chennai");
		expect(callJson).toContain("Chennai rates updated");
		expect(callJson).toContain("Gold ▲ ₹100/g");
	});

	it("sends a notification using yesterday's row when today has no row yet (cross-day fallback)", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		const yesterdayRow: PriceRecord = {
			...existingRow,
			$id: "row-yesterday",
			price_date: "2026-03-28",
			gold_22k_price: 7500,
		};
		db.listRows.mockResolvedValueOnce({ rows: [], total: 0 }); // no row for today
		db.listRows.mockResolvedValueOnce({ rows: [yesterdayRow], total: 1 }); // yesterday's row
		db.createRow.mockResolvedValue({});

		const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7620 };
		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(messaging.createPush).toHaveBeenCalledOnce();
		const callJson = JSON.stringify(messaging.createPush.mock.calls[0]);
		expect(callJson).toContain("Gold ▲ ₹120/g");
	});

	it("does not send a notification when only platinum changed", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValueOnce({ rows: [existingRow], total: 1 });
		db.createRow.mockResolvedValue({});

		const newPrices: PriceInput = { ...basePrices, platinum_price: 3300 };
		await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(messaging.createPush).not.toHaveBeenCalled();
	});

	it("does not throw when the push call fails (DB write still succeeds)", async () => {
		const db = makeDb();
		const messaging = makeMessaging();
		db.listRows.mockResolvedValueOnce({ rows: [existingRow], total: 1 });
		db.createRow.mockResolvedValue({});
		messaging.createPush.mockRejectedValue(new Error("appwrite down"));

		const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7600 };
		await expect(
			updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices),
		).resolves.toBeUndefined();

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(messaging.createPush).toHaveBeenCalledOnce();
	});
});

describe("fetchMostRecentRowBefore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-10T10:00:00+05:30"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the latest row whose price_date is strictly before the given date", async () => {
		const db = makeDb();
		const yesterdayRow: PriceRecord = {
			$id: "row-yesterday",
			city: "bengaluru",
			source: "lalithaa_jewellery",
			gold_22k_price: 13965,
			silver_price: 252,
			platinum_price: 7500,
			price_date: "2026-04-09",
			price_changed_at: "2026-04-09T14:00:00.000Z",
			last_checked_at: "2026-04-09T14:00:00.000Z",
		};
		db.listRows.mockResolvedValue({ rows: [yesterdayRow], total: 1 });

		const result = await fetchMostRecentRowBefore(db as any, "bengaluru", "lalithaa_jewellery", "2026-04-10");

		expect(result).toEqual(yesterdayRow);
		expect(db.listRows).toHaveBeenCalledOnce();
		const queries = db.listRows.mock.calls[0][0].queries;
		// Sanity-check the query shape: must filter by city, source, and price_date < today
		const queriesStr = JSON.stringify(queries);
		expect(queriesStr).toContain("bengaluru");
		expect(queriesStr).toContain("lalithaa_jewellery");
		expect(queriesStr).toContain("2026-04-10");
	});

	it("returns undefined when no prior row exists", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });

		const result = await fetchMostRecentRowBefore(db as any, "bengaluru", "lalithaa_jewellery", "2026-04-10");

		expect(result).toBeUndefined();
	});
});
