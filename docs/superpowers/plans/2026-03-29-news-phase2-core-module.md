# Phase 2: Core News Module

**Goal:** Build the news extraction core — Zod schema, Appwrite store (delete+insert), and agent session (prompt, JSON extraction, validation retry).

**Spec:** `docs/superpowers/specs/2026-03-29-news-extractor-design.md`

**Depends on:** Phase 1 (DB table exists) for the store to work at runtime, but code can be written independently.

---

## File Structure

```
src/news/
├── schema.ts                 # CREATE — Zod schema for agent JSON response
├── store.ts                  # CREATE — Appwrite delete + insert logic
└── agent.ts                  # CREATE — agent session creation, prompt building, response parsing

test/news/
├── schema.test.ts            # CREATE — Zod schema validation tests
└── store.test.ts             # CREATE — DB delete + insert logic tests (mocked)
```

---

### Task 1: Zod schema for agent response

**Files:** `src/news/schema.ts`, `test/news/schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/news/schema.test.ts` with tests for:
- Accepts valid array of exactly 5 articles
- Accepts articles with optional fields (`original_url`, `thumbnail_url`) missing
- Rejects array with fewer than 5 articles
- Rejects array with more than 5 articles
- Rejects article with missing required field (headline, summary, content, category, source, source_count, rank)
- Rejects article with invalid rank (0, 6, negative)
- Rejects article with invalid source_count (0, 3)
- Rejects non-URL strings for original_url and thumbnail_url

- [ ] **Step 2: Write implementation**

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

- [ ] **Step 3: Verify all tests pass, commit**

---

### Task 2: Appwrite store — delete + insert

**Files:** `src/news/store.ts`, `test/news/store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/news/store.test.ts` with mocked `TablesDB`. Tests for:
- Deletes existing rows for `(city, news_date=today)` then inserts 5 new articles
- Inserts articles when no existing rows to delete
- Handles optional fields (`original_url`, `thumbnail_url`) being undefined
- Verifies inserted data shape matches schema (city, headline, summary, content, category, source, source_count, original_url, thumbnail_url, news_date, rank, fetched_at)

Mock the logger (same pattern as `test/extractor/price-updater.test.ts`).

- [ ] **Step 2: Write implementation**

Create `src/news/store.ts`:

```typescript
import { ID, Query, type TablesDB } from "node-appwrite";
import { DB_ID, TABLE_NEWS_ARTICLES } from "../config/constants.js";
import { logger } from "../config/logger.js";
import type { NewsArticle } from "./schema.js";

export async function replaceNewsForCity(
    db: TablesDB,
    city: string,
    articles: NewsArticle[],
): Promise<void> {
    // 1. Get today's date in IST (YYYY-MM-DD)
    // 2. List existing rows for (city, news_date=today)
    // 3. Delete each existing row
    // 4. Insert each article with city, news_date=today, fetched_at=now
}
```

- [ ] **Step 3: Verify all tests pass, commit**

---

### Task 3: Agent session — prompt building and response parsing

**Files:** `src/news/agent.ts`

No unit tests for this task — it wraps the pi-coding-agent SDK which requires real OAuth. Verified via E2E in Phase 3.

- [ ] **Step 1: Create agent module**

Create `src/news/agent.ts` with:

1. `fetchNewsViaAgent(city: string): Promise<NewsArticle[]>` — the public function
2. Reads playbook from `memory/news/{city}/playbook.md`
3. Creates agent session using proven POC pattern:
   ```typescript
   const model = getModel("anthropic", "claude-sonnet-4-20250514");
   const loader = new DefaultResourceLoader({
       skillsOverride: () => ({ skills: [], diagnostics: [] }),
       appendSystemPrompt: "You are a news curator. You have a bash tool — use it to run curl commands...",
   });
   await loader.reload();
   const { session } = await createAgentSession({
       model, thinkingLevel: "medium",
       resourceLoader: loader,
       sessionManager: SessionManager.inMemory(),
   });
   ```
4. Builds user prompt with playbook content, city, today's date
5. Subscribes to `message_update` events to capture full response text
6. Extracts JSON array from response (regex `\[[\s\S]*\]`)
7. Validates with `newsArticlesSchema.safeParse()`
8. On validation failure: sends errors back to same session, retries up to 3 times
9. Disposes session in `finally` block

Reference: `src/poc-news-agent.ts` for working SDK patterns.

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**
