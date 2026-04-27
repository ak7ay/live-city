import type { EventArticle, ListingCandidate } from "./schema.js";

export interface InvalidEntry {
	source_url: string;
	reasons: string[];
}

export interface CandidateValidationResult {
	countOk: boolean;
	invalid: InvalidEntry[];
}

/**
 * Validate Phase 2a/2b listing output.
 *
 * - `countOk` is true when `candidates.length >= minCount`.
 * - `invalid` lists candidates with structural parse failures:
 *     - empty `title`
 *     - empty `source_url`
 *
 * Quality concerns (null listing_date, null image_url) are NOT flagged here.
 * BMS legitimately lazy-loads images and recurring events have no single
 * listing_date — the ranker deprioritizes those via the "image presence as
 * quality signal" rule, and the enrichment phase resolves them via detail
 * pages.
 *
 * The caller decides what to do on failure (retry in-session, substitute, etc.).
 */
export function findInvalidCandidates(candidates: ListingCandidate[], minCount: number): CandidateValidationResult {
	const invalid: InvalidEntry[] = [];
	for (const c of candidates) {
		const reasons: string[] = [];
		if (!c.title || c.title.trim().length === 0) reasons.push("title is empty");
		if (!c.source_url || c.source_url.trim().length === 0) reasons.push("source_url is empty");
		if (reasons.length > 0) {
			invalid.push({ source_url: c.source_url || "(missing)", reasons });
		}
	}
	return { countOk: candidates.length >= minCount, invalid };
}

export interface FinalValidationResult {
	countOk: boolean;
	ticketedCount: number;
	countIssues: string[];
	invalid: InvalidEntry[];
	duplicates: string[];
}

/**
 * Validate Phase 3 rank+enrich output.
 *
 * - `countOk` is true when the ticketed-event count (i.e. source !== "news")
 *   falls within `[bounds.minTicketed, bounds.maxTicketed]`. News events are
 *   not counted toward the cap — they pass through with their own carry-forward
 *   rules and a variable count.
 * - Every event must have non-empty `event_date`, `source`, `source_url`.
 * - Ticketed sources (`bookmyshow`, `district`) must have non-null `image_url`;
 *   news is exempt (news extraction doesn't produce image URLs today).
 * - `duplicates` lists any `source_url` that appears more than once.
 */
export function findInvalidFinalEvents(
	events: EventArticle[],
	bounds: { minTicketed: number; maxTicketed: number },
): FinalValidationResult {
	const invalid: InvalidEntry[] = [];
	const seen = new Map<string, number>();
	for (const e of events) {
		const reasons: string[] = [];
		if (!e.event_date || e.event_date.trim().length === 0) reasons.push("event_date is empty");
		if (!e.source_url || e.source_url.trim().length === 0) reasons.push("source_url is empty");
		if ((e.source === "bookmyshow" || e.source === "district") && e.image_url === null) {
			reasons.push("image_url is null (required for ticketed sources)");
		}
		if (reasons.length > 0) {
			invalid.push({ source_url: e.source_url || "(missing)", reasons });
		}
		seen.set(e.source_url, (seen.get(e.source_url) ?? 0) + 1);
	}
	const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([url]) => url);
	const ticketedCount = events.filter((e) => e.source !== "news").length;
	const countIssues: string[] = [];
	if (ticketedCount < bounds.minTicketed) {
		countIssues.push(`ticketed: ${ticketedCount} (need ≥ ${bounds.minTicketed})`);
	}
	if (ticketedCount > bounds.maxTicketed) {
		countIssues.push(`ticketed: ${ticketedCount} (cap is ${bounds.maxTicketed})`);
	}
	return {
		countOk: countIssues.length === 0,
		ticketedCount,
		countIssues,
		invalid,
		duplicates,
	};
}
