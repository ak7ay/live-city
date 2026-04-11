import { describe, expect, it, vi } from "vitest";
import type { PriceInput, PriceRecord } from "../../src/extractor/metals-updater.js";
import {
	buildPriceChangeEvent,
	formatNotificationBody,
	type PriceChangeEvent,
	sendPriceNotification,
} from "../../src/notifications/price-notifier.js";

vi.mock("../../src/config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const priorRow: PriceRecord = {
	$id: "row-prior",
	city: "bengaluru",
	source: "lalithaa_jewellery",
	gold_22k_price: 13965,
	silver_price: 252,
	platinum_price: 7500,
	price_date: "2026-04-09",
	price_changed_at: "2026-04-09T09:00:00.000Z",
	last_checked_at: "2026-04-09T09:00:00.000Z",
};

describe("buildPriceChangeEvent", () => {
	it("returns gold-only delta when only gold changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event).toEqual({
			city: "bengaluru",
			cityDisplayName: "Bengaluru",
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		});
	});

	it("returns silver-only delta when only silver changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 13965, silver_price: 249, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 }]);
	});

	it("returns gold + silver deltas when both changed (gold first)", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085, silver_price: 249, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([
			{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 },
			{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 },
		]);
	});

	it("returns empty deltas when only platinum changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 13965, silver_price: 252, platinum_price: 7600 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([]);
	});

	it("returns empty deltas when nothing changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 13965, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([]);
	});

	it("uses the slug as display name when the city is unknown", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("mumbai", { ...priorRow, city: "mumbai" }, newPrices);
		expect(event.cityDisplayName).toBe("mumbai");
	});

	it("rounds fractional deltas with Math.round", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085.6, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		// delta is captured raw; the formatter rounds it
		expect(event.deltas[0].delta).toBeCloseTo(120.6);
	});
});

describe("formatNotificationBody", () => {
	const base: PriceChangeEvent = {
		city: "bengaluru",
		cityDisplayName: "Bengaluru",
		deltas: [],
	};

	it("formats gold-only positive delta with ▲", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		});
		expect(body).toBe("Gold ▲ ₹120/g — tap to see today's price");
	});

	it("formats silver-only negative delta with ▼ and absolute value", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 }],
		});
		expect(body).toBe("Silver ▼ ₹3/g — tap to see today's price");
	});

	it("formats combined gold + silver in correct order", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [
				{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 },
				{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 },
			],
		});
		expect(body).toBe("Gold ▲ ₹120/g · Silver ▼ ₹3/g — tap to see today's price");
	});

	it("rounds fractional deltas to integers", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085.6, delta: 120.6 }],
		});
		expect(body).toBe("Gold ▲ ₹121/g — tap to see today's price");
	});
});

describe("sendPriceNotification", () => {
	function makeMessaging() {
		return {
			createPush: vi.fn().mockResolvedValue({}),
		};
	}

	it("sends a push to the city-scoped topic with the formatted body", async () => {
		const messaging = makeMessaging();
		const event: PriceChangeEvent = {
			city: "bengaluru",
			cityDisplayName: "Bengaluru",
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		};

		await sendPriceNotification(messaging as any, event);

		expect(messaging.createPush).toHaveBeenCalledOnce();
		const args = messaging.createPush.mock.calls[0];
		// The call must include the topic, title, and body somewhere in its arguments.
		const flattened = JSON.stringify(args);
		expect(flattened).toContain("prices-bengaluru");
		expect(flattened).toContain("Bengaluru rates updated");
		expect(flattened).toContain("Gold ▲ ₹120/g — tap to see today's price");
	});

	it("propagates errors from the messaging client", async () => {
		const messaging = makeMessaging();
		messaging.createPush.mockRejectedValue(new Error("appwrite down"));

		const event: PriceChangeEvent = {
			city: "bengaluru",
			cityDisplayName: "Bengaluru",
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		};

		await expect(sendPriceNotification(messaging as any, event)).rejects.toThrow("appwrite down");
	});
});
