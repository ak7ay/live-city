import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LalithaaConfig } from "../../src/config/source-loader.ts";

const MOCK_CONFIG: LalithaaConfig = {
	name: "lalithaa_jewellery",
	api_url: "https://api.example.com/pricings/latest",
	states_api_url: "https://api.example.com/states",
	states: [
		{ state_name: "Karnataka", city: "bengaluru" },
		{ state_name: "Tamilnadu", city: "chennai" },
	],
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
	originalFetch = globalThis.fetch;
	vi.resetModules();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("resolveStateIds", () => {
	it("maps state names to IDs", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				status: "success",
				data: {
					items: [
						{ id: "state-1", name: "Karnataka" },
						{ id: "state-2", name: "Tamilnadu" },
						{ id: "state-3", name: "Kerala" },
					],
				},
			}),
		});

		const { resolveStateIds } = await import("../../src/sources/lalithaa.ts");
		const result = await resolveStateIds(MOCK_CONFIG);

		expect(result.size).toBe(2);
		expect(result.get("bengaluru")).toEqual({ stateId: "state-1", city: "bengaluru" });
		expect(result.get("chennai")).toEqual({ stateId: "state-2", city: "chennai" });
		expect(globalThis.fetch).toHaveBeenCalledWith("https://api.example.com/states?page=1&limit=100");
	});

	it("skips states not found in API response", async () => {
		const { logger } = await import("../../src/config/logger.ts");
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => ({}) as any);

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				status: "success",
				data: {
					items: [{ id: "state-1", name: "Karnataka" }],
				},
			}),
		});

		const { resolveStateIds } = await import("../../src/sources/lalithaa.ts");
		const result = await resolveStateIds(MOCK_CONFIG);

		expect(result.size).toBe(1);
		expect(result.get("bengaluru")).toEqual({ stateId: "state-1", city: "bengaluru" });
		expect(result.has("chennai")).toBe(false);
		expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ state_name: "Tamilnadu" }), expect.any(String));

		warnSpy.mockRestore();
	});

	it("throws on non-200 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		});

		const { resolveStateIds } = await import("../../src/sources/lalithaa.ts");
		await expect(resolveStateIds(MOCK_CONFIG)).rejects.toThrow();
	});
});

describe("fetchPrice", () => {
	it("returns parsed prices", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				status: "success",
				data: {
					prices: {
						gold: { price: 6850, rate_datetime: "2025-03-29T10:00:00Z" },
						silver: { price: 95 },
						platinum: { price: 3200 },
					},
				},
			}),
		});

		const { fetchPrice } = await import("../../src/sources/lalithaa.ts");
		const result = await fetchPrice("https://api.example.com/pricings/latest", "state-1");

		expect(result).toEqual({
			gold_22k_price: 6850,
			silver_price: 95,
			platinum_price: 3200,
			rate_datetime: "2025-03-29T10:00:00Z",
		});
		expect(globalThis.fetch).toHaveBeenCalledWith("https://api.example.com/pricings/latest?state_id=state-1");
	});

	it("throws on non-200 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		const { fetchPrice } = await import("../../src/sources/lalithaa.ts");
		await expect(fetchPrice("https://api.example.com/pricings/latest", "state-1")).rejects.toThrow();
	});
});
