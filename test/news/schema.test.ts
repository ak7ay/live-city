import { describe, expect, it } from "vitest";
import { type NewsArticle, newsArticlesSchema } from "../../src/news/schema.js";

function makeArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
	return {
		headline: "Gold prices surge in Chennai",
		summary: "Gold hit record highs across Tamil Nadu markets today.",
		content:
			"Gold prices surged to new record highs in Chennai today, driven by global demand and a weakening rupee.",
		category: "commodities",
		source: "lalithaa",
		source_count: 1,
		rank: 1,
		...overrides,
	};
}

function makeFiveArticles(overrides: Partial<NewsArticle>[] = []): NewsArticle[] {
	return Array.from({ length: 5 }, (_, i) => makeArticle({ rank: i + 1, ...overrides[i] }));
}

describe("newsArticlesSchema", () => {
	it("accepts valid array of exactly 5 articles", () => {
		const articles = makeFiveArticles();
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(true);
	});

	it("accepts articles with optional fields missing", () => {
		const articles = makeFiveArticles();
		// Ensure optional fields are absent
		for (const a of articles) {
			delete (a as any).original_url;
			delete (a as any).thumbnail_url;
		}
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(true);
	});

	it("accepts articles with optional URL fields present", () => {
		const articles = makeFiveArticles([
			{ original_url: "https://example.com/article1", thumbnail_url: "https://example.com/thumb1.jpg" },
		]);
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(true);
	});

	it("rejects array with fewer than 5 articles", () => {
		const articles = makeFiveArticles().slice(0, 4);
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects array with more than 5 articles", () => {
		const articles = [...makeFiveArticles(), makeArticle({ rank: 1 })];
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: headline", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).headline;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: summary", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).summary;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: content", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).content;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: category", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).category;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: source", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).source;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: source_count", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).source_count;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field: rank", () => {
		const articles = makeFiveArticles();
		delete (articles[0] as any).rank;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with rank 0", () => {
		const articles = makeFiveArticles();
		(articles[0] as any).rank = 0;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with rank 6", () => {
		const articles = makeFiveArticles();
		(articles[0] as any).rank = 6;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with negative rank", () => {
		const articles = makeFiveArticles();
		(articles[0] as any).rank = -1;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with source_count 0", () => {
		const articles = makeFiveArticles();
		(articles[0] as any).source_count = 0;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with source_count 3", () => {
		const articles = makeFiveArticles();
		(articles[0] as any).source_count = 3;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects non-URL string for original_url", () => {
		const articles = makeFiveArticles([{ original_url: "not-a-url" }]);
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects non-URL string for thumbnail_url", () => {
		const articles = makeFiveArticles([{ thumbnail_url: "not-a-url" }]);
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});
});
