import { z } from "zod/v4";

const newsArticleSchema = z.object({
	headline: z.string().min(1).max(512),
	summary: z.string().min(1).max(2048),
	content: z.string().min(1),
	category: z.string().min(1).max(64),
	source: z.string().min(1).max(64),
	source_count: z.int().min(1).max(2),
	original_url: z.url().optional(),
	thumbnail_url: z.url().optional(),
	rank: z.int().min(1).max(5),
});

export const newsArticlesSchema = z.array(newsArticleSchema).length(5);
export type NewsArticle = z.infer<typeof newsArticleSchema>;
