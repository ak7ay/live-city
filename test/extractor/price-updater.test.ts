import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PriceInput, type PriceRecord, updatePriceForCity } from "../../src/extractor/metals-updater.js";

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
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		await updatePriceForCity(db as any, "chennai", "lalithaa", basePrices);

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
		db.listRows.mockResolvedValue({ rows: [existingRow], total: 1 });
		db.createRow.mockResolvedValue({});

		const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7600 };
		await updatePriceForCity(db as any, "chennai", "lalithaa", newPrices);

		expect(db.createRow).toHaveBeenCalledOnce();
		expect(db.updateRow).not.toHaveBeenCalled();

		const call = db.createRow.mock.calls[0][0];
		expect(call.data.gold_22k_price).toBe(7600);
	});

	it("updates last_checked_at when prices are the same", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [existingRow], total: 1 });
		db.updateRow.mockResolvedValue({});

		await updatePriceForCity(db as any, "chennai", "lalithaa", basePrices);

		expect(db.updateRow).toHaveBeenCalledOnce();
		expect(db.createRow).not.toHaveBeenCalled();

		const call = db.updateRow.mock.calls[0][0];
		expect(call.rowId).toBe("row-123");
		expect(call.data).toEqual({ last_checked_at: "2026-03-29T04:30:00.000Z" });
	});
});
