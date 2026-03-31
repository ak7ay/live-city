import { z } from "zod/v4";

// ── Article schemas (Phase 1) ────────────────────────────────────────

export function createNewsArticleSchema(maxRank: number) {
	return z.object({
		headline: z.string().min(1).max(512),
		summary: z.string().min(1).max(2048),
		content: z.string().min(1),
		category: z.string().min(1).max(64),
		source: z.string().min(1).max(64),
		source_count: z.int().min(1),
		original_url: z.url().optional(),
		thumbnail_url: z.url().optional(),
		rank: z.int().min(1).max(maxRank),
	});
}

export function createNewsArticlesSchema(count: number) {
	return z.array(createNewsArticleSchema(count)).length(count);
}

export type NewsArticle = z.infer<ReturnType<typeof createNewsArticleSchema>>;

// ── Selection schemas (Phase 2) ──────────────────────────────────────

const newsSourceSchema = z.object({
	name: z.string().min(1),
	url: z.url(),
	source_id: z.string().nullable(),
});

export function createNewsSelectionsSchema(count: number) {
	return z
		.array(
			z.object({
				rank: z.int().min(1).max(count),
				headline_en: z.string().min(1).max(512),
				summary_en: z.string().min(1).max(2048),
				category_en: z.string().min(1).max(64),
				sources: z.array(newsSourceSchema).min(1),
			}),
		)
		.length(count);
}

export type NewsSelection = z.infer<ReturnType<typeof createNewsSelectionsSchema>>[number];
