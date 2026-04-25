import { describe, expect, it } from "vitest";
import type { EventArticle, ListingCandidate } from "../../src/events/schema.js";
import { findInvalidCandidates, findInvalidFinalEvents } from "../../src/events/validators.js";

function makeCandidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
	return {
		source: "bookmyshow",
		title: "Kanan Gill Live",
		source_url: "https://in.bookmyshow.com/events/kanan-gill/ET00412345",
		image_url: "https://example.com/img.jpg",
		listing_date: "Sat, 25 Apr 2026",
		venue_line: "Phoenix: Bengaluru",
		category: "Comedy",
		price: "₹499",
		...overrides,
	};
}

function makeEventArticle(overrides: Partial<EventArticle> = {}): EventArticle {
	return {
		title: "Kanan Gill Live",
		description: "Stand-up comedy by Kanan Gill.",
		category: "Comedy",
		event_date: "Sat, 25 Apr 2026",
		event_time: "8:00 PM",
		duration: "90 mins",
		venue_name: "Phoenix Marketcity",
		venue_area: "Bengaluru",
		price: "₹499",
		source: "bookmyshow",
		source_url: "https://in.bookmyshow.com/events/kanan-gill/ET00412345",
		image_url: "https://example.com/img.jpg",
		rank: 1,
		...overrides,
	};
}

describe("findInvalidCandidates", () => {
	it("returns empty list when all candidates valid and count >= min", () => {
		const cands = Array.from({ length: 10 }, (_, i) => makeCandidate({ title: `Event ${i}`, source_url: `u${i}` }));
		expect(findInvalidCandidates(cands, 10)).toEqual({ countOk: true, invalid: [] });
	});

	it("flags count below minimum", () => {
		const cands = Array.from({ length: 5 }, (_, i) => makeCandidate({ title: `E${i}`, source_url: `u${i}` }));
		const r = findInvalidCandidates(cands, 10);
		expect(r.countOk).toBe(false);
	});

	it("flags candidates with both listing_date and image_url null (fully blank)", () => {
		const cands = [
			makeCandidate({ title: "Good", source_url: "u1" }),
			makeCandidate({ title: "Bad", source_url: "u2", listing_date: null, image_url: null }),
		];
		const r = findInvalidCandidates(cands, 2);
		expect(r.invalid).toHaveLength(1);
		expect(r.invalid[0].source_url).toBe("u2");
		expect(r.invalid[0].reasons).toContain("both listing_date and image_url are null");
	});

	it("accepts candidate when only one of listing_date or image_url is null", () => {
		const cands = [makeCandidate({ source_url: "u1", image_url: null })];
		expect(findInvalidCandidates(cands, 1).invalid).toEqual([]);
	});

	it("flags missing title", () => {
		const cands = [makeCandidate({ title: "", source_url: "u1" })];
		const r = findInvalidCandidates(cands, 1);
		expect(r.invalid[0].reasons).toContain("title is empty");
	});

	it("flags missing source_url", () => {
		const cands = [makeCandidate({ source_url: "" })];
		const r = findInvalidCandidates(cands, 1);
		expect(r.invalid[0].reasons).toContain("source_url is empty");
	});
});

describe("findInvalidFinalEvents", () => {
	it("accepts valid events at target count", () => {
		const events = [makeEventArticle({ rank: 1 }), makeEventArticle({ source_url: "u2", rank: 2 })];
		expect(findInvalidFinalEvents(events, 2)).toEqual({ countOk: true, invalid: [], duplicates: [] });
	});

	it("flags count != target", () => {
		expect(findInvalidFinalEvents([makeEventArticle()], 2).countOk).toBe(false);
	});

	it("flags empty event_date", () => {
		const r = findInvalidFinalEvents([makeEventArticle({ event_date: "" })], 1);
		expect(r.invalid[0].reasons).toContain("event_date is empty");
	});

	it("flags ticketed event with null image_url", () => {
		const r = findInvalidFinalEvents([makeEventArticle({ image_url: null })], 1);
		expect(r.invalid[0].reasons).toContain("image_url is null (required for ticketed sources)");
	});

	it("exempts news events from image_url requirement", () => {
		const r = findInvalidFinalEvents([makeEventArticle({ source: "news", image_url: null })], 1);
		expect(r.invalid).toEqual([]);
	});

	it("flags duplicate source_urls", () => {
		const events = [
			makeEventArticle({ source_url: "dup", rank: 1 }),
			makeEventArticle({ source_url: "dup", rank: 2 }),
		];
		const r = findInvalidFinalEvents(events, 2);
		expect(r.duplicates).toContain("dup");
	});
});
