import { z } from "zod/v4";

// ── Raw listing events (from collection phases) ──────────────────────

export const rawEventSchema = z.object({
	title: z.string().min(1),
	category: z.string().nullable(),
	event_date: z.string().nullable(),
	event_time: z.string().nullable(),
	venue: z.string().nullable(),
	price: z.string().nullable(),
	source: z.enum(["news", "bookmyshow", "district"]),
	source_url: z.string(),
	image_url: z.string().nullable(),
	description: z.string().nullable(),
});

export const rawEventsSchema = z.array(rawEventSchema);

export type RawEvent = z.infer<typeof rawEventSchema>;

// ── Enriched events (from per-source collection phases) ──────────────

export const enrichedEventSchema = z.object({
	title: z.string().min(1).max(512),
	description: z.string().min(1),
	category: z.string().min(1).max(64),
	event_date: z.string().min(1),
	event_time: z.string().nullable(),
	duration: z.string().nullable(),
	venue_name: z.string().nullable(),
	venue_area: z.string().nullable(),
	price: z.string().nullable(),
	source: z.enum(["bookmyshow", "district"]),
	source_url: z.string(),
	image_url: z.string().nullable(),
});

export const enrichedEventsSchema = z.array(enrichedEventSchema);

export type EnrichedEvent = z.infer<typeof enrichedEventSchema>;

// ── Listing candidates (Phase 2a/2b output; Phase 3 input) ───────────

export const listingCandidateSchema = z.object({
	source: z.enum(["bookmyshow", "district"]),
	title: z.string().min(1).max(512),
	source_url: z.string().min(1),
	image_url: z.string().nullable(),
	listing_date: z.string().nullable(),
	venue_line: z.string().nullable(),
	category: z.string().nullable(),
	price: z.string().nullable(),
});

export const listingCandidatesSchema = z.array(listingCandidateSchema);

export type ListingCandidate = z.infer<typeof listingCandidateSchema>;

// ── Final enriched events (output) ───────────────────────────────────

export const eventArticleSchema = z.object({
	title: z.string().min(1).max(512),
	description: z.string().min(1),
	category: z.string().min(1).max(64),
	event_date: z.string().min(1),
	event_time: z.string().nullable(),
	duration: z.string().nullable(),
	venue_name: z.string().nullable(),
	venue_area: z.string().nullable(),
	price: z.string().nullable(),
	source: z.enum(["news", "bookmyshow", "district"]),
	source_url: z.string(),
	image_url: z.string().nullable(),
	rank: z.int().min(1),
});

export const eventArticlesSchema = z.array(eventArticleSchema).min(1);

export type EventArticle = z.infer<typeof eventArticleSchema>;
