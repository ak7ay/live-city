import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsArticle } from "../../src/news/schema.js";

vi.mock("../../src/news/agent.js", () => ({ fetchNewsViaAgent: vi.fn() }));
vi.mock("../../src/news/store.js", () => ({ replaceNewsForCity: vi.fn() }));
vi.mock("../../src/config/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
	},
}));

import { updateNewsForCity } from "../../src/extractor/news-updater.js";
import { fetchNewsViaAgent } from "../../src/news/agent.js";
import { replaceNewsForCity } from "../../src/news/store.js";

const mockFetch = vi.mocked(fetchNewsViaAgent);
const mockReplace = vi.mocked(replaceNewsForCity);

function makeDb() {
	return {} as any;
}

const fakeArticles: NewsArticle[] = Array.from({ length: 5 }, (_, i) => ({
	headline: `Headline ${i + 1}`,
	summary: `Summary ${i + 1}`,
	content: `Content ${i + 1}`,
	category: "local",
	source: "test-source",
	source_count: 1,
	rank: (i + 1) as 1 | 2 | 3 | 4 | 5,
}));

describe("updateNewsForCity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches news via agent and stores in DB on success", async () => {
		const db = makeDb();
		mockFetch.mockResolvedValue(fakeArticles);
		mockReplace.mockResolvedValue(undefined);

		await updateNewsForCity(db, "chennai");

		expect(mockFetch).toHaveBeenCalledOnce();
		expect(mockFetch).toHaveBeenCalledWith("chennai");
		expect(mockReplace).toHaveBeenCalledOnce();
		expect(mockReplace).toHaveBeenCalledWith(db, "chennai", fakeArticles);
	});

	it("retries once on agent failure, then succeeds on second attempt", async () => {
		const db = makeDb();
		mockFetch.mockRejectedValueOnce(new Error("agent timeout")).mockResolvedValueOnce(fakeArticles);
		mockReplace.mockResolvedValue(undefined);

		await updateNewsForCity(db, "chennai");

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockReplace).toHaveBeenCalledOnce();
		expect(mockReplace).toHaveBeenCalledWith(db, "chennai", fakeArticles);
	});

	it("throws after both attempts fail (MAX_AGENT_RETRIES = 2)", async () => {
		const db = makeDb();
		mockFetch.mockRejectedValueOnce(new Error("fail 1")).mockRejectedValueOnce(new Error("fail 2"));

		await expect(updateNewsForCity(db, "chennai")).rejects.toThrow("fail 2");

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockReplace).not.toHaveBeenCalled();
	});
});
