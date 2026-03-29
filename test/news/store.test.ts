import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsArticle } from "../../src/news/schema.js";
import { replaceNewsForCity } from "../../src/news/store.js";

vi.mock("../../src/config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeDb() {
	return {
		listRows: vi.fn(),
		createRow: vi.fn(),
		deleteRow: vi.fn(),
	};
}

function makeArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
	return {
		headline: "Test headline",
		summary: "Test summary of the article",
		content: "Full content of the test article goes here.",
		category: "politics",
		source: "The Hindu",
		source_count: 1,
		rank: 1,
		...overrides,
	};
}

function makeArticles(count = 5): NewsArticle[] {
	return Array.from({ length: count }, (_, i) =>
		makeArticle({ headline: `Headline ${i + 1}`, rank: (i + 1) as 1 | 2 | 3 | 4 | 5 }),
	);
}

describe("replaceNewsForCity", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-29T10:00:00+05:30"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("deletes existing rows for (city, news_date=today) then inserts 5 new articles", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({
			rows: [{ $id: "old-1" }, { $id: "old-2" }, { $id: "old-3" }],
			total: 3,
		});
		db.deleteRow.mockResolvedValue({});
		db.createRow.mockResolvedValue({});

		const articles = makeArticles(5);
		await replaceNewsForCity(db as any, "chennai", articles);

		// Should query for existing rows
		expect(db.listRows).toHaveBeenCalledOnce();
		const listCall = db.listRows.mock.calls[0][0];
		expect(listCall.databaseId).toBe("live_city");
		expect(listCall.tableId).toBe("news_articles");

		// Should delete all 3 existing rows
		expect(db.deleteRow).toHaveBeenCalledTimes(3);
		expect(db.deleteRow).toHaveBeenCalledWith(
			expect.objectContaining({ databaseId: "live_city", tableId: "news_articles", rowId: "old-1" }),
		);
		expect(db.deleteRow).toHaveBeenCalledWith(
			expect.objectContaining({ databaseId: "live_city", tableId: "news_articles", rowId: "old-2" }),
		);
		expect(db.deleteRow).toHaveBeenCalledWith(
			expect.objectContaining({ databaseId: "live_city", tableId: "news_articles", rowId: "old-3" }),
		);

		// Should insert 5 new articles
		expect(db.createRow).toHaveBeenCalledTimes(5);
	});

	it("inserts articles when no existing rows to delete", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		const articles = makeArticles(5);
		await replaceNewsForCity(db as any, "chennai", articles);

		expect(db.deleteRow).not.toHaveBeenCalled();
		expect(db.createRow).toHaveBeenCalledTimes(5);
	});

	it("handles optional fields (original_url, thumbnail_url) being undefined", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		const article = makeArticle(); // no original_url or thumbnail_url
		await replaceNewsForCity(db as any, "chennai", [article]);

		expect(db.createRow).toHaveBeenCalledOnce();
		const data = db.createRow.mock.calls[0][0].data;
		expect(data.original_url).toBeUndefined();
		expect(data.thumbnail_url).toBeUndefined();
	});

	it("verifies inserted data shape matches expected schema", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		const article = makeArticle({
			headline: "Breaking news",
			summary: "Summary here",
			content: "Full content here",
			category: "technology",
			source: "Times of India",
			source_count: 2,
			rank: 3,
			original_url: "https://example.com/article",
			thumbnail_url: "https://example.com/thumb.jpg",
		});

		await replaceNewsForCity(db as any, "chennai", [article]);

		expect(db.createRow).toHaveBeenCalledOnce();
		const call = db.createRow.mock.calls[0][0];
		expect(call.databaseId).toBe("live_city");
		expect(call.tableId).toBe("news_articles");
		expect(call.rowId).toBeDefined();

		const data = call.data;
		expect(data).toEqual({
			city: "chennai",
			headline: "Breaking news",
			summary: "Summary here",
			content: "Full content here",
			category: "technology",
			source: "Times of India",
			source_count: 2,
			original_url: "https://example.com/article",
			thumbnail_url: "https://example.com/thumb.jpg",
			news_date: "2026-03-29",
			rank: 3,
			fetched_at: "2026-03-29T04:30:00.000Z",
		});
	});
});
