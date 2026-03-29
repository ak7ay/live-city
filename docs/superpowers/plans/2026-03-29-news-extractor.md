# News Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a scheduled news extractor that uses an LLM agent to fetch, curate, translate, and store top 5 Bengaluru news from Kannada sources.

**Architecture:** A scheduler triggers an LLM agent session (via `@mariozechner/pi-coding-agent` SDK) that reads a city-specific playbook, fetches news from PublicTV API and TV9 RSS via `curl`, curates top 5, translates Kannada→English, and returns JSON. TypeScript code validates the JSON with Zod, replaces today's rows in Appwrite, and handles retries.

**Tech Stack:** TypeScript, `@mariozechner/pi-coding-agent` SDK, `node-appwrite` (TablesDB), `node-cron`, `zod` — all already installed.

**Spec:** `docs/superpowers/specs/2026-03-29-news-extractor-design.md`

**POC reference:** `src/poc-news-agent.ts` — validated working end-to-end. Delete after implementation.

---

## File Structure

```
src/
├── config/
│   └── constants.ts              # MODIFY — add TABLE_NEWS_ARTICLES constant
├── extractor/
│   └── news-updater.ts           # CREATE — agent session + Zod validation + DB write
├── news/
│   ├── agent.ts                  # CREATE — agent session creation, prompt building, response parsing
│   ├── schema.ts                 # CREATE — Zod schema for agent JSON response
│   └── store.ts                  # CREATE — Appwrite delete + insert logic
├── scheduler.ts                  # MODIFY — make generic (accept cron expression)
├── setup-db.ts                   # MODIFY — add news_articles table setup
└── index.ts                      # MODIFY — register news extractor job

memory/news/bengaluru/
└── playbook.md                   # EXISTS — already created during exploration

test/
├── news/
│   ├── schema.test.ts            # CREATE — Zod schema validation tests
│   └── store.test.ts             # CREATE — DB delete + insert logic tests
└── extractor/
    └── news-updater.test.ts      # CREATE — orchestration tests (agent mocked)
```

---

### Task 1: Add news_articles constant and DB setup

**Files:**
- Modify: `src/config/constants.ts`
- Modify: `src/setup-db.ts`

- [ ] **Step 1: Add table constant**

In `src/config/constants.ts`, add:

```typescript
export const TABLE_NEWS_ARTICLES = "news_articles";
```

- [ ] **Step 2: Add news_articles table setup to `setup-db.ts`**

Add the following functions and call them from `main()` in `src/setup-db.ts`. Follow the existing pattern (createTableIfNotExists, createColumnIfNotExists, etc.) but for the `news_articles` table:

```typescript
import { DB_ID, TABLE_METAL_PRICES, TABLE_NEWS_ARTICLES } from "./config/constants.js";

// Add after the existing TABLE_METAL_PRICES constant usage:

async function createNewsTableIfNotExists(db: TablesDB): Promise<void> {
	try {
		await db.getTable({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES });
		console.log(`Table "${TABLE_NEWS_ARTICLES}" already exists, skipping.`);
	} catch {
		await db.createTable({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, name: TABLE_NEWS_ARTICLES });
		console.log(`Table "${TABLE_NEWS_ARTICLES}" created.`);
	}
}

async function createNewsColumns(db: TablesDB): Promise<void> {
	const col = (createFn: () => Promise<unknown>, name: string) =>
		createColumnIfNotExists(db, TABLE_NEWS_ARTICLES, createFn, name);

	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "city", size: 64, required: true }),
		"city",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "headline", size: 512, required: true }),
		"headline",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "summary", size: 2048, required: true }),
		"summary",
	);
	await col(
		() => db.createTextColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "content", required: true }),
		"content",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "category", size: 64, required: true }),
		"category",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "source", size: 64, required: true }),
		"source",
	);
	await col(
		() => db.createIntegerColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "source_count", required: true }),
		"source_count",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "original_url", size: 512, required: false }),
		"original_url",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "thumbnail_url", size: 512, required: false }),
		"thumbnail_url",
	);
	await col(
		() => db.createVarcharColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "news_date", size: 64, required: true }),
		"news_date",
	);
	await col(
		() => db.createIntegerColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "rank", required: true }),
		"rank",
	);
	await col(
		() => db.createDatetimeColumn({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, key: "fetched_at", required: true }),
		"fetched_at",
	);
}

async function createNewsIndexes(db: TablesDB): Promise<void> {
	await deleteFailedIndexes(db, TABLE_NEWS_ARTICLES);
	await createIndexIfNotExists(db, TABLE_NEWS_ARTICLES, "idx_city_date", TablesDBIndexType.Key, ["city", "news_date"]);
	await createIndexIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		"idx_city_date_rank",
		TablesDBIndexType.Key,
		["city", "news_date", "rank"],
	);
}
```

Note: The existing `createColumnIfNotExists`, `createIndexIfNotExists`, `deleteFailedIndexes`, and `waitForColumns` helpers are currently hardcoded to `TABLE_METAL_PRICES`. Refactor them to accept a `tableId` parameter so they work for both tables. Update all existing call sites to pass `TABLE_METAL_PRICES` explicitly. For example:

```typescript
// Before:
async function createColumnIfNotExists(db: TablesDB, createFn: () => Promise<unknown>, name: string): Promise<void> {
	try {
		await db.getColumn({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key: name });
	// ...

// After:
async function createColumnIfNotExists(db: TablesDB, tableId: string, createFn: () => Promise<unknown>, name: string): Promise<void> {
	try {
		await db.getColumn({ databaseId: DB_ID, tableId, key: name });
	// ...
```

Apply the same pattern to `createIndexIfNotExists(db, tableId, ...)`, `deleteFailedIndexes(db, tableId)`, and `waitForColumns(db, tableId)`.

Then in `main()`, add after the existing metal_prices setup:

```typescript
await createNewsTableIfNotExists(db);
await createNewsColumns(db);
console.log("\nWaiting for news columns to be processed...");
await waitForColumns(db, TABLE_NEWS_ARTICLES);
await createNewsIndexes(db);
```

- [ ] **Step 3: Run setup-db to verify**

```bash
npx tsx src/setup-db.ts
```

Expected: All news_articles columns and indexes created successfully (or "already exists" if re-run).

- [ ] **Step 4: Run existing tests to make sure nothing broke**

```bash
npm test
```

Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/constants.ts src/setup-db.ts
git commit -m "feat: add news_articles table setup to schema"
```

---

### Task 2: Zod schema for agent response

**Files:**
- Create: `src/news/schema.ts`
- Create: `test/news/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/news/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { newsArticlesSchema, type NewsArticle } from "../../src/news/schema.js";

const validArticle: NewsArticle = {
	headline: "BMTC to Add 500 New Buses",
	summary: "BMTC announces procurement of 500 new buses for Bengaluru.",
	content: "## BMTC Fleet Expansion\n\nThe Bangalore Metropolitan Transport Corporation...",
	category: "Transport",
	source: "tv9kannada",
	source_count: 1,
	original_url: "https://tv9kannada.com/karnataka/bengaluru/bmtc-1234.html",
	thumbnail_url: "https://images.tv9kannada.com/wp-content/uploads/2026/03/bmtc.jpg",
	rank: 1,
};

describe("newsArticlesSchema", () => {
	it("accepts a valid array of 5 articles", () => {
		const articles = Array.from({ length: 5 }, (_, i) => ({
			...validArticle,
			rank: i + 1,
			headline: `Article ${i + 1}`,
		}));
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(true);
	});

	it("accepts articles with optional fields missing", () => {
		const articles = Array.from({ length: 5 }, (_, i) => {
			const { original_url, thumbnail_url, ...rest } = validArticle;
			return { ...rest, rank: i + 1 };
		});
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(true);
	});

	it("rejects array with fewer than 5 articles", () => {
		const articles = [{ ...validArticle, rank: 1 }];
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects array with more than 5 articles", () => {
		const articles = Array.from({ length: 6 }, (_, i) => ({
			...validArticle,
			rank: i + 1,
		}));
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with missing required field", () => {
		const { headline, ...rest } = validArticle;
		const articles = Array.from({ length: 5 }, (_, i) => ({
			...rest,
			rank: i + 1,
		}));
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with invalid rank (0)", () => {
		const articles = Array.from({ length: 5 }, (_, i) => ({
			...validArticle,
			rank: i, // 0-4 instead of 1-5
		}));
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects article with invalid source_count", () => {
		const articles = Array.from({ length: 5 }, (_, i) => ({
			...validArticle,
			rank: i + 1,
			source_count: 3,
		}));
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});

	it("rejects non-URL strings for original_url", () => {
		const articles = Array.from({ length: 5 }, (_, i) => ({
			...validArticle,
			rank: i + 1,
			original_url: "not-a-url",
		}));
		const result = newsArticlesSchema.safeParse(articles);
		expect(result.success).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run test/news/schema.test.ts
```

Expected: FAIL — module `../../src/news/schema.js` not found.

- [ ] **Step 3: Write implementation**

Create `src/news/schema.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest --run test/news/schema.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/news/schema.ts test/news/schema.test.ts
git commit -m "feat: add Zod schema for news agent response"
```

---

### Task 3: Appwrite store — delete + insert

**Files:**
- Create: `src/news/store.ts`
- Create: `test/news/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/news/store.test.ts`:

```typescript
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

const articles: NewsArticle[] = Array.from({ length: 5 }, (_, i) => ({
	headline: `Article ${i + 1}`,
	summary: `Summary ${i + 1}`,
	content: `Content ${i + 1}`,
	category: "Crime",
	source: "tv9kannada",
	source_count: 1,
	original_url: `https://tv9kannada.com/article-${i + 1}`,
	thumbnail_url: `https://images.tv9kannada.com/img-${i + 1}.jpg`,
	rank: i + 1,
}));

describe("replaceNewsForCity", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-29T14:00:00+05:30"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("deletes existing rows then inserts 5 new articles", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({
			rows: [{ $id: "old-1" }, { $id: "old-2" }],
			total: 2,
		});
		db.deleteRow.mockResolvedValue({});
		db.createRow.mockResolvedValue({});

		await replaceNewsForCity(db as any, "bengaluru", articles);

		expect(db.listRows).toHaveBeenCalledOnce();
		expect(db.deleteRow).toHaveBeenCalledTimes(2);
		expect(db.createRow).toHaveBeenCalledTimes(5);

		// Verify first inserted article
		const firstCall = db.createRow.mock.calls[0][0];
		expect(firstCall.data.city).toBe("bengaluru");
		expect(firstCall.data.headline).toBe("Article 1");
		expect(firstCall.data.rank).toBe(1);
		expect(firstCall.data.news_date).toBe("2026-03-29");
		expect(firstCall.data.fetched_at).toBe("2026-03-29T08:30:00.000Z");
	});

	it("inserts articles when no existing rows", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		await replaceNewsForCity(db as any, "bengaluru", articles);

		expect(db.deleteRow).not.toHaveBeenCalled();
		expect(db.createRow).toHaveBeenCalledTimes(5);
	});

	it("handles optional fields being undefined", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });
		db.createRow.mockResolvedValue({});

		const noOptionals = articles.map(({ original_url, thumbnail_url, ...rest }) => rest) as NewsArticle[];
		await replaceNewsForCity(db as any, "bengaluru", noOptionals);

		const firstCall = db.createRow.mock.calls[0][0];
		expect(firstCall.data.original_url).toBeUndefined();
		expect(firstCall.data.thumbnail_url).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run test/news/store.test.ts
```

Expected: FAIL — module `../../src/news/store.js` not found.

- [ ] **Step 3: Write implementation**

Create `src/news/store.ts`:

```typescript
import { ID, Query, type TablesDB } from "node-appwrite";
import { DB_ID, TABLE_NEWS_ARTICLES } from "../config/constants.js";
import { logger } from "../config/logger.js";
import type { NewsArticle } from "./schema.js";

function getTodayIST(): string {
	return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getNowISO(): string {
	return new Date().toISOString();
}

export async function replaceNewsForCity(
	db: TablesDB,
	city: string,
	articles: NewsArticle[],
): Promise<void> {
	const today = getTodayIST();
	const now = getNowISO();

	// Delete existing rows for today
	const existing = await db.listRows({
		databaseId: DB_ID,
		tableId: TABLE_NEWS_ARTICLES,
		queries: [
			Query.equal("city", city),
			Query.equal("news_date", today),
			Query.limit(25),
		],
	});

	for (const row of existing.rows) {
		await db.deleteRow({
			databaseId: DB_ID,
			tableId: TABLE_NEWS_ARTICLES,
			rowId: (row as any).$id,
		});
	}

	if (existing.rows.length > 0) {
		logger.info({ city, deleted: existing.rows.length }, "Deleted existing news rows");
	}

	// Insert new articles
	for (const article of articles) {
		await db.createRow({
			databaseId: DB_ID,
			tableId: TABLE_NEWS_ARTICLES,
			rowId: ID.unique(),
			data: {
				city,
				headline: article.headline,
				summary: article.summary,
				content: article.content,
				category: article.category,
				source: article.source,
				source_count: article.source_count,
				original_url: article.original_url,
				thumbnail_url: article.thumbnail_url,
				news_date: today,
				rank: article.rank,
				fetched_at: now,
			},
		});
	}

	logger.info({ city, count: articles.length, date: today }, "Inserted news articles");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest --run test/news/store.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/news/store.ts test/news/store.test.ts
git commit -m "feat: add news store with delete + insert replacement"
```

---

### Task 4: Agent session — prompt building and response parsing

**Files:**
- Create: `src/news/agent.ts`

- [ ] **Step 1: Create agent module**

Create `src/news/agent.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { logger } from "../config/logger.js";
import { type NewsArticle, newsArticlesSchema } from "./schema.js";

const MAX_VALIDATION_RETRIES = 3;

function buildUserPrompt(playbook: string, city: string, today: string): string {
	return `Fetch today's top 5 ${city} news stories from Kannada sources, translate them to English, and return structured JSON.

## Playbook — How to fetch the data
${playbook}

## Steps

1. Use bash tool to run curl commands to fetch listings from BOTH sources described in the playbook
2. Read all titles and excerpts/descriptions from both sources
3. Pick the top 5 most newsworthy ${city} stories. Stories appearing on BOTH sources rank higher.
4. For each of the 5 winners, ensure you have the full article content:
   - PublicTV: fetch full article by ID if needed
   - TV9: content:encoded is already in the RSS
5. Strip HTML noise (video embeds, "also read" links, footer links)
6. Translate everything from Kannada to English
7. Translate the source category tags to English too

## Output

Your FINAL message must be ONLY a JSON array with exactly 5 objects, no markdown fences, no explanation:

[
  {
    "headline": "English headline",
    "summary": "1-2 sentence English summary",
    "content": "Full article body in English markdown format",
    "category": "English category translated from source",
    "source": "tv9kannada or publictv or tv9kannada,publictv if on both",
    "source_count": 1,
    "original_url": "https://...",
    "thumbnail_url": "https://...",
    "rank": 1
  }
]

Today's date: ${today}
City: ${city}

Start by fetching both sources now.`;
}

function extractJson(text: string): unknown | null {
	const match = text.match(/\[[\s\S]*\]/);
	if (!match) return null;
	try {
		return JSON.parse(match[0]);
	} catch {
		return null;
	}
}

export async function fetchNewsViaAgent(city: string): Promise<NewsArticle[]> {
	const playbookPath = join(import.meta.dirname, "../../memory/news", city, "playbook.md");
	const playbook = readFileSync(playbookPath, "utf-8");
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	const model = getModel("anthropic", "claude-sonnet-4-20250514");
	if (!model) {
		throw new Error("Model claude-sonnet-4-20250514 not found");
	}

	const loader = new DefaultResourceLoader({
		skillsOverride: () => ({ skills: [], diagnostics: [] }),
		appendSystemPrompt:
			"You are a news curator. You have a bash tool — use it to run curl commands to fetch data from external APIs and RSS feeds. You CAN access the internet via curl.",
	});
	await loader.reload();

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "medium",
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	try {
		let fullResponse = "";
		session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				fullResponse += event.assistantMessageEvent.delta;
			}
		});

		// Initial prompt
		logger.info({ city }, "Starting news agent session");
		await session.prompt(buildUserPrompt(playbook, city, today));

		// Validate + retry loop
		for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
			const parsed = extractJson(fullResponse);
			if (!parsed) {
				if (attempt === MAX_VALIDATION_RETRIES) {
					throw new Error(`No JSON array found in agent response after ${attempt} attempts`);
				}
				logger.warn({ city, attempt }, "No JSON found in response, asking agent to fix");
				fullResponse = "";
				await session.prompt(
					"Your response did not contain a valid JSON array. Please return ONLY a JSON array of exactly 5 news article objects. No markdown fences, no explanation — just the JSON array.",
				);
				continue;
			}

			const result = newsArticlesSchema.safeParse(parsed);
			if (result.success) {
				logger.info({ city, attempt }, "Agent returned valid news articles");
				return result.data;
			}

			if (attempt === MAX_VALIDATION_RETRIES) {
				throw new Error(
					`Zod validation failed after ${attempt} attempts: ${JSON.stringify(result.error.issues)}`,
				);
			}

			logger.warn({ city, attempt, issues: result.error.issues }, "Validation failed, asking agent to fix");
			fullResponse = "";
			await session.prompt(
				`Your JSON had validation errors:\n${JSON.stringify(result.error.issues, null, 2)}\n\nPlease fix and return ONLY the corrected JSON array.`,
			);
		}

		throw new Error("Unreachable");
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/news/agent.ts
git commit -m "feat: add news agent session with prompt building and validation retry"
```

---

### Task 5: News updater — orchestration

**Files:**
- Create: `src/extractor/news-updater.ts`
- Create: `test/extractor/news-updater.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/extractor/news-updater.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetchNewsViaAgent = vi.fn();
vi.mock("../../src/news/agent.js", () => ({
	fetchNewsViaAgent: mockFetchNewsViaAgent,
}));

const mockReplaceNewsForCity = vi.fn();
vi.mock("../../src/news/store.js", () => ({
	replaceNewsForCity: mockReplaceNewsForCity,
}));

// Import after mocks
const { updateNewsForCity } = await import("../../src/extractor/news-updater.js");

function makeDb() {
	return {} as any;
}

const fakeArticles = Array.from({ length: 5 }, (_, i) => ({
	headline: `Article ${i + 1}`,
	summary: `Summary ${i + 1}`,
	content: `Content ${i + 1}`,
	category: "Crime",
	source: "tv9kannada",
	source_count: 1,
	rank: i + 1,
}));

describe("updateNewsForCity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches news and stores in DB", async () => {
		mockFetchNewsViaAgent.mockResolvedValue(fakeArticles);
		mockReplaceNewsForCity.mockResolvedValue(undefined);

		await updateNewsForCity(makeDb(), "bengaluru");

		expect(mockFetchNewsViaAgent).toHaveBeenCalledWith("bengaluru");
		expect(mockReplaceNewsForCity).toHaveBeenCalledWith(expect.anything(), "bengaluru", fakeArticles);
	});

	it("retries once on agent failure, then throws", async () => {
		mockFetchNewsViaAgent.mockRejectedValue(new Error("Agent failed"));

		await expect(updateNewsForCity(makeDb(), "bengaluru")).rejects.toThrow("Agent failed");

		expect(mockFetchNewsViaAgent).toHaveBeenCalledTimes(2);
		expect(mockReplaceNewsForCity).not.toHaveBeenCalled();
	});

	it("succeeds on retry after first agent failure", async () => {
		mockFetchNewsViaAgent.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce(fakeArticles);
		mockReplaceNewsForCity.mockResolvedValue(undefined);

		await updateNewsForCity(makeDb(), "bengaluru");

		expect(mockFetchNewsViaAgent).toHaveBeenCalledTimes(2);
		expect(mockReplaceNewsForCity).toHaveBeenCalledOnce();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run test/extractor/news-updater.test.ts
```

Expected: FAIL — module `../../src/extractor/news-updater.js` not found.

- [ ] **Step 3: Write implementation**

Create `src/extractor/news-updater.ts`:

```typescript
import type { TablesDB } from "node-appwrite";
import { logger } from "../config/logger.js";
import { fetchNewsViaAgent } from "../news/agent.js";
import { replaceNewsForCity } from "../news/store.js";

const MAX_AGENT_RETRIES = 2;

export async function updateNewsForCity(db: TablesDB, city: string): Promise<void> {
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= MAX_AGENT_RETRIES; attempt++) {
		try {
			logger.info({ city, attempt }, "Fetching news via agent");
			const articles = await fetchNewsViaAgent(city);
			await replaceNewsForCity(db, city, articles);
			logger.info({ city }, "News update complete");
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			logger.error({ city, attempt, error: lastError.message }, "News agent attempt failed");
		}
	}

	throw lastError!;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest --run test/extractor/news-updater.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/extractor/news-updater.ts test/extractor/news-updater.test.ts
git commit -m "feat: add news updater orchestration with agent retry"
```

---

### Task 6: Make scheduler generic + wire into index.ts

**Files:**
- Modify: `src/scheduler.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Make scheduler accept cron expression**

Replace `src/scheduler.ts` entirely:

```typescript
import cron from "node-cron";
import { logger } from "./config/logger.js";

export function startScheduler(
	jobName: string,
	cronExpression: string,
	onTick: () => Promise<void>,
): void {
	cron.schedule(
		cronExpression,
		async () => {
			logger.info({ job: jobName }, "Scheduled tick started");
			try {
				await onTick();
			} catch (error) {
				logger.error({ job: jobName, error }, "Scheduled tick failed");
			}
		},
		{ timezone: "Asia/Kolkata" },
	);

	logger.info({ job: jobName, cron: cronExpression }, "Scheduler started");
}
```

- [ ] **Step 2: Update `src/index.ts` to pass cron expression and add news job**

Update `src/index.ts`:

```typescript
import { join } from "node:path";
import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { loadLalithaaConfig } from "./config/source-loader.js";
import { updateNewsForCity } from "./extractor/news-updater.js";
import { updatePriceForCity } from "./extractor/price-updater.js";
import { startScheduler } from "./scheduler.js";
import { fetchPrice, resolveStateIds } from "./sources/lalithaa.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	// --- Lalithaa Gold Prices ---
	const configPath = join(import.meta.dirname, "../config/sources/lalithaa.yaml");
	const config = loadLalithaaConfig(configPath);

	logger.info("Resolving state IDs from Lalithaa API...");
	const stateMap = await resolveStateIds(config);
	logger.info({ cities: [...stateMap.keys()] }, `Resolved ${stateMap.size} cities`);

	if (stateMap.size === 0) {
		logger.error("No cities resolved, exiting");
		process.exit(1);
	}

	const priceTick = async () => {
		const results = await Promise.allSettled(
			[...stateMap.entries()].map(async ([city, { stateId }]) => {
				const prices = await fetchPrice(config.api_url, stateId);
				await updatePriceForCity(db, city, config.name, prices);
			}),
		);

		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				const city = [...stateMap.keys()][i];
				logger.error({ city, error: result.reason }, "Failed to update price");
			}
		}
	};

	logger.info("Running initial price fetch...");
	await priceTick();
	startScheduler("lalithaa-prices", "*/10 9-16 * * *", priceTick);

	// --- News Extractor ---
	const newsTick = async () => {
		try {
			await updateNewsForCity(db, "bengaluru");
		} catch (error) {
			logger.error({ error }, "News update failed for bengaluru");
		}
	};

	logger.info("Running initial news fetch...");
	await newsTick();
	startScheduler("bengaluru-news", "0 8,13,19 * * *", newsTick);

	logger.info("All extractors running. Press Ctrl+C to stop.");
}

main().catch((error) => {
	logger.error({ error }, "Fatal error");
	process.exit(1);
});
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests pass. The existing scheduler test (if any) may need the call site updated since `startScheduler` now takes 3 args instead of 2.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts src/index.ts
git commit -m "feat: generic scheduler + wire news extractor into main"
```

---

### Task 7: Cleanup

**Files:**
- Delete: `src/poc-news-agent.ts`
- Delete: `src/agent-example.ts`

- [ ] **Step 1: Remove POC and example files**

```bash
rm src/poc-news-agent.ts src/agent-example.ts
```

- [ ] **Step 2: Run all checks**

```bash
npm run check
npm test
```

Expected: Lint, types, and all tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove POC and agent-example files"
```

---

### Task 8: End-to-end smoke test

- [ ] **Step 1: Run the DB setup to create the news table**

```bash
npx tsx src/setup-db.ts
```

Expected: `news_articles` table, columns, and indexes created.

- [ ] **Step 2: Run the news updater directly to verify full flow**

```bash
npx tsx -e "
import { createAppwriteClient, createTablesDB } from './src/config/appwrite.js';
import { loadEnv } from './src/config/env.js';
import { updateNewsForCity } from './src/extractor/news-updater.js';

const env = loadEnv();
const client = createAppwriteClient(env);
const db = createTablesDB(client);
await updateNewsForCity(db, 'bengaluru');
console.log('✅ Done');
"
```

Expected: Agent runs, fetches news, translates, returns JSON, validated by Zod, stored in Appwrite. No errors.

- [ ] **Step 3: Verify data in Appwrite**

Check the Appwrite console or run:

```bash
npx tsx -e "
import { Query } from 'node-appwrite';
import { createAppwriteClient, createTablesDB } from './src/config/appwrite.js';
import { loadEnv } from './src/config/env.js';
import { DB_ID, TABLE_NEWS_ARTICLES } from './src/config/constants.js';

const env = loadEnv();
const client = createAppwriteClient(env);
const db = createTablesDB(client);

const result = await db.listRows({
  databaseId: DB_ID,
  tableId: TABLE_NEWS_ARTICLES,
  queries: [Query.equal('city', 'bengaluru'), Query.orderAsc('rank'), Query.limit(5)],
});

for (const row of result.rows) {
  const r = row as any;
  console.log(\`#\${r.rank} [\${r.source}] \${r.headline}\`);
  console.log(\`   Category: \${r.category}\`);
  console.log(\`   Summary: \${r.summary.slice(0, 80)}...\`);
  console.log();
}
"
```

Expected: 5 articles printed with English headlines, categories, and summaries.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: verified end-to-end news extraction"
```
