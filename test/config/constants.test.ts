import { describe, expect, it } from "vitest";
import { CITY_DISPLAY_NAMES, cityDisplayName } from "../../src/config/constants.js";

describe("cityDisplayName", () => {
	it("returns the title-case display name for a known slug", () => {
		expect(cityDisplayName("bengaluru")).toBe("Bengaluru");
		expect(cityDisplayName("chennai")).toBe("Chennai");
		expect(cityDisplayName("hyderabad")).toBe("Hyderabad");
		expect(cityDisplayName("vijayawada")).toBe("Vijayawada");
		expect(cityDisplayName("puducherry")).toBe("Puducherry");
	});

	it("falls back to the slug if the city is not in the map", () => {
		expect(cityDisplayName("mumbai")).toBe("mumbai");
	});

	it("exports the map covering all configured cities", () => {
		expect(Object.keys(CITY_DISPLAY_NAMES).sort()).toEqual([
			"bengaluru",
			"chennai",
			"hyderabad",
			"puducherry",
			"vijayawada",
		]);
	});
});
