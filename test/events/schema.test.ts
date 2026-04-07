import { describe, expect, it } from "vitest";
import { type EnrichedEvent, enrichedEventSchema, enrichedEventsSchema } from "../../src/events/schema.js";

function makeEnrichedEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
	return {
		title: "Arijit Singh Live",
		description: "A live concert by Arijit Singh at NICE Grounds.",
		category: "Music",
		event_date: "Sat, 12 Apr 2026",
		event_time: "7:00 PM",
		duration: "3 hours",
		venue_name: "NICE Grounds",
		venue_area: "Bengaluru",
		price: "₹999 onwards",
		source: "bookmyshow",
		source_url: "https://in.bookmyshow.com/events/arijit-singh/ET00123",
		image_url: "https://example.com/img.jpg",
		...overrides,
	};
}

describe("enrichedEventSchema", () => {
	it("accepts a valid enriched event", () => {
		const result = enrichedEventSchema.safeParse(makeEnrichedEvent());
		expect(result.success).toBe(true);
	});

	it("accepts nullable fields as null", () => {
		const result = enrichedEventSchema.safeParse(
			makeEnrichedEvent({
				event_time: null,
				duration: null,
				venue_name: null,
				venue_area: null,
				price: null,
				image_url: null,
			}),
		);
		expect(result.success).toBe(true);
	});

	it("rejects missing title", () => {
		const event = makeEnrichedEvent();
		delete (event as any).title;
		expect(enrichedEventSchema.safeParse(event).success).toBe(false);
	});

	it("rejects empty description", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ description: "" })).success).toBe(false);
	});

	it("rejects empty category", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ category: "" })).success).toBe(false);
	});

	it("rejects empty event_date", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ event_date: "" })).success).toBe(false);
	});

	it("rejects null event_date", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ event_date: null })).success).toBe(false);
	});

	it("only accepts bookmyshow or district as source", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ source: "bookmyshow" })).success).toBe(true);
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ source: "district" })).success).toBe(true);
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ source: "news" as any })).success).toBe(false);
	});

	it("rejects title over 512 chars", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ title: "a".repeat(513) })).success).toBe(false);
	});

	it("rejects category over 64 chars", () => {
		expect(enrichedEventSchema.safeParse(makeEnrichedEvent({ category: "a".repeat(65) })).success).toBe(false);
	});
});

describe("enrichedEventsSchema", () => {
	it("accepts an array of enriched events", () => {
		const events = [makeEnrichedEvent(), makeEnrichedEvent({ title: "Comedy Night" })];
		expect(enrichedEventsSchema.safeParse(events).success).toBe(true);
	});

	it("accepts empty array", () => {
		expect(enrichedEventsSchema.safeParse([]).success).toBe(true);
	});

	it("rejects array with invalid event", () => {
		const events = [makeEnrichedEvent(), { title: "" }];
		expect(enrichedEventsSchema.safeParse(events).success).toBe(false);
	});
});
