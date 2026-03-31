import { describe, expect, it } from "vitest";
import {
	createNewsArticleSchema,
	createNewsArticlesSchema,
	createNewsSelectionsSchema,
	type NewsArticle,
	type NewsSelection,
} from "../../src/news/schema.js";

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

function makeSelection(overrides: Partial<NewsSelection> = {}): NewsSelection {
	return {
		rank: 1,
		headline_en: "Gold prices surge in Chennai",
		summary_en: "Gold hit record highs across Tamil Nadu markets today.",
		category_en: "commodities",
		sources: [{ name: "The Hindu", url: "https://thehindu.com/article1", source_id: null }],
		...overrides,
	};
}

function makeSelections(count: number, overrides: Partial<NewsSelection>[] = []): NewsSelection[] {
	return Array.from({ length: count }, (_, i) => makeSelection({ rank: i + 1, ...overrides[i] }));
}

// ── Existing tests (updated to use factory) ──────────────────────────

describe("createNewsArticlesSchema", () => {
	const newsArticlesSchema = createNewsArticlesSchema(5);

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

	it("accepts article with source_count 3 (no upper bound)", () => {
		const articles = makeFiveArticles();
		(articles[0] as any).source_count = 3;
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(true);
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

	it("accepts valid array matching a different count", () => {
		const schema = createNewsArticlesSchema(3);
		const articles = Array.from({ length: 3 }, (_, i) => makeArticle({ rank: i + 1 }));
		const result = schema.safeParse(articles);
		expect(result.success).toBe(true);
	});

	it("rejects wrong count for a different count schema", () => {
		const schema = createNewsArticlesSchema(3);
		const articles = makeFiveArticles();
		const result = schema.safeParse(articles);
		expect(result.success).toBe(false);
	});
});

// ── New: createNewsArticleSchema tests ───────────────────────────────

describe("createNewsArticleSchema", () => {
	it("accepts a valid single article", () => {
		const schema = createNewsArticleSchema(5);
		const result = schema.safeParse(makeArticle({ rank: 3 }));
		expect(result.success).toBe(true);
	});

	it("rejects rank exceeding maxRank", () => {
		const schema = createNewsArticleSchema(3);
		const result = schema.safeParse(makeArticle({ rank: 4 }));
		expect(result.success).toBe(false);
	});

	it("rejects empty content", () => {
		const schema = createNewsArticleSchema(5);
		const result = schema.safeParse(makeArticle({ content: "" }));
		expect(result.success).toBe(false);
	});
});

// ── New: createNewsSelectionsSchema tests ─────────────────────────────

describe("createNewsSelectionsSchema", () => {
	it("accepts valid array of selections", () => {
		const schema = createNewsSelectionsSchema(5);
		const selections = makeSelections(5);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("accepts selection with multiple sources", () => {
		const schema = createNewsSelectionsSchema(3);
		const selections = makeSelections(3, [
			{
				sources: [
					{ name: "The Hindu", url: "https://thehindu.com/a", source_id: "abc123" },
					{ name: "Times of India", url: "https://toi.com/b", source_id: null },
				],
			},
		]);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("accepts null source_id", () => {
		const schema = createNewsSelectionsSchema(1);
		const selections = makeSelections(1, [
			{ sources: [{ name: "Source", url: "https://example.com", source_id: null }] },
		]);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("accepts string source_id", () => {
		const schema = createNewsSelectionsSchema(1);
		const selections = makeSelections(1, [
			{ sources: [{ name: "Source", url: "https://example.com", source_id: "doc-42" }] },
		]);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("rejects wrong count", () => {
		const schema = createNewsSelectionsSchema(5);
		const selections = makeSelections(3);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(false);
	});

	it("rejects empty sources array", () => {
		const schema = createNewsSelectionsSchema(1);
		const selections = makeSelections(1, [{ sources: [] }]);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(false);
	});

	it("rejects empty headline_en", () => {
		const schema = createNewsSelectionsSchema(1);
		const selections = makeSelections(1, [{ headline_en: "" }]);
		const result = schema.safeParse(selections);
		expect(result.success).toBe(false);
	});

	it("rejects rank exceeding count", () => {
		const schema = createNewsSelectionsSchema(3);
		const selections = makeSelections(3);
		(selections[0] as any).rank = 4;
		const result = schema.safeParse(selections);
		expect(result.success).toBe(false);
	});
});
