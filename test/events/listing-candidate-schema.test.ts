import { describe, expect, it } from "vitest";
import { type ListingCandidate, listingCandidateSchema, listingCandidatesSchema } from "../../src/events/schema.js";

function makeCandidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
	return {
		source: "bookmyshow",
		title: "Kanan Gill Live",
		source_url: "https://in.bookmyshow.com/events/kanan-gill-live/ET00412345",
		image_url: "https://assets-in.bmscdn.com/discovery-catalog/events/tr:/et00412345-portrait.jpg",
		listing_date: "Sat, 25 Apr 2026",
		venue_line: "Phoenix Marketcity: Bengaluru",
		category: "Stand up Comedy",
		price: "₹ 499 onwards",
		...overrides,
	};
}

describe("listingCandidateSchema", () => {
	it("accepts a valid candidate", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate()).success).toBe(true);
	});

	it("accepts district source", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate({ source: "district" })).success).toBe(true);
	});

	it("rejects news source (listings are ticketed-only)", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate({ source: "news" as any })).success).toBe(false);
	});

	it("accepts nullable fields as null", () => {
		const result = listingCandidateSchema.safeParse(
			makeCandidate({
				image_url: null,
				listing_date: null,
				venue_line: null,
				category: null,
				price: null,
			}),
		);
		expect(result.success).toBe(true);
	});

	it("rejects empty title", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate({ title: "" })).success).toBe(false);
	});

	it("rejects missing source_url", () => {
		const c = makeCandidate();
		delete (c as any).source_url;
		expect(listingCandidateSchema.safeParse(c).success).toBe(false);
	});
});

describe("listingCandidatesSchema", () => {
	it("accepts an array of candidates", () => {
		expect(listingCandidatesSchema.safeParse([makeCandidate(), makeCandidate({ title: "Another" })]).success).toBe(
			true,
		);
	});

	it("accepts an empty array (validation of count lives in validators, not schema)", () => {
		expect(listingCandidatesSchema.safeParse([]).success).toBe(true);
	});
});
