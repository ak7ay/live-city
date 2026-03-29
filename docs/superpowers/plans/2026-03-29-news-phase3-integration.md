# Phase 3: Integration & Wiring

**Goal:** Wire the news extractor into the app — orchestration layer, scheduler, main entry point. Cleanup POC files. Run E2E smoke test.

**Spec:** `docs/superpowers/specs/2026-03-29-news-extractor-design.md`

**Depends on:** Phase 1 (DB table) + Phase 2 (schema, store, agent modules).

---

## File Structure

```
src/extractor/
└── news-updater.ts           # CREATE — orchestration: agent → validate → store, with retry

src/
├── scheduler.ts              # MODIFY — make generic (accept cron expression param)
└── index.ts                  # MODIFY — register news extractor job

src/
├── poc-news-agent.ts         # DELETE
└── agent-example.ts          # DELETE

test/extractor/
└── news-updater.test.ts      # CREATE — orchestration tests (agent + store mocked)
```

---

### Task 1: News updater orchestration

**Files:** `src/extractor/news-updater.ts`, `test/extractor/news-updater.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/extractor/news-updater.test.ts` with mocked `fetchNewsViaAgent` and `replaceNewsForCity`. Tests for:
- Fetches news via agent and stores in DB on success
- Retries once on agent failure, then throws on second failure
- Succeeds on retry after first agent failure

- [ ] **Step 2: Write implementation**

Create `src/extractor/news-updater.ts`:

```typescript
export async function updateNewsForCity(db: TablesDB, city: string): Promise<void> {
    // Retry loop: max 2 attempts
    // 1. Call fetchNewsViaAgent(city)
    // 2. Call replaceNewsForCity(db, city, articles)
    // If both attempts fail, throw the last error
}
```

- [ ] **Step 3: Verify tests pass, commit**

---

### Task 2: Generic scheduler + wire into index.ts

**Files:** `src/scheduler.ts`, `src/index.ts`

- [ ] **Step 1: Make scheduler accept cron expression**

Change `startScheduler` signature from 2 params to 3:

```typescript
// Before:
export function startScheduler(jobName: string, onTick: () => Promise<void>): void {
    cron.schedule("*/10 9-16 * * *", ...);

// After:
export function startScheduler(jobName: string, cronExpression: string, onTick: () => Promise<void>): void {
    cron.schedule(cronExpression, ...);
```

- [ ] **Step 2: Update index.ts**

1. Update existing `startScheduler` call to pass cron expression: `startScheduler("lalithaa-prices", "*/10 9-16 * * *", priceTick)`
2. Add news extractor:
   ```typescript
   import { updateNewsForCity } from "./extractor/news-updater.js";

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
   ```

- [ ] **Step 3: Verify types compile, run all tests, commit**

---

### Task 3: Cleanup + E2E smoke test

- [ ] **Step 1: Delete POC files**

```bash
rm src/poc-news-agent.ts src/agent-example.ts
```

- [ ] **Step 2: Run all checks**

```bash
npm run check
npm test
```

- [ ] **Step 3: E2E smoke test — run news updater**

```bash
npx tsx -e "
import { createAppwriteClient, createTablesDB } from './src/config/appwrite.js';
import { loadEnv } from './src/config/env.js';
import { updateNewsForCity } from './src/extractor/news-updater.js';

const env = loadEnv();
const client = createAppwriteClient(env);
const db = createTablesDB(client);
await updateNewsForCity(db, 'bengaluru');
console.log('Done');
"
```

Expected: Agent runs, fetches both sources, translates, returns valid JSON, stored in Appwrite.

- [ ] **Step 4: Verify data in Appwrite**

Query the `news_articles` table and confirm 5 articles exist for today with English headlines, categories, and markdown content.

- [ ] **Step 5: Commit and finalize**

```bash
git add -A
git commit -m "feat: wire news extractor into scheduler, cleanup POC"
```
