# Phase 1: News Articles DB Setup

**Goal:** Add the `news_articles` table to Appwrite with all columns and indexes, following the existing `metal_prices` pattern.

**Spec:** `docs/superpowers/specs/2026-03-29-news-extractor-design.md` (Data Model section)

**Depends on:** Nothing — fully independent.

---

## File Structure

```
src/config/
└── constants.ts              # MODIFY — add TABLE_NEWS_ARTICLES constant

src/
└── setup-db.ts               # MODIFY — refactor helpers to accept tableId, add news_articles setup
```

---

### Task 1: Add constant and refactor setup-db helpers

**Files:** `src/config/constants.ts`, `src/setup-db.ts`

- [ ] **Step 1: Add table constant**

In `src/config/constants.ts`, add:

```typescript
export const TABLE_NEWS_ARTICLES = "news_articles";
```

- [ ] **Step 2: Refactor existing helpers to accept `tableId` parameter**

The following helpers in `src/setup-db.ts` are currently hardcoded to `TABLE_METAL_PRICES`. Refactor each to accept a `tableId` parameter:

1. `createColumnIfNotExists(db, createFn, name)` → `createColumnIfNotExists(db, tableId, createFn, name)`
2. `createIndexIfNotExists(db, key, type, columns, orders?)` → `createIndexIfNotExists(db, tableId, key, type, columns, orders?)`
3. `deleteFailedIndexes(db)` → `deleteFailedIndexes(db, tableId)`
4. `waitForColumns(db)` → `waitForColumns(db, tableId)`

Update all existing call sites (in `createColumns`, `createIndexes`, and `main`) to pass `TABLE_METAL_PRICES` explicitly.

- [ ] **Step 3: Add news_articles table creation**

Add these functions to `src/setup-db.ts`:

```typescript
async function createNewsTableIfNotExists(db: TablesDB): Promise<void> {
    // Same pattern as createTableIfNotExists but for TABLE_NEWS_ARTICLES
}

async function createNewsColumns(db: TablesDB): Promise<void> {
    // Columns per spec Data Model:
    // city: varchar(64), required
    // headline: varchar(512), required
    // summary: varchar(2048), required
    // content: text, required (use createTextColumn — note: no size param)
    // category: varchar(64), required
    // source: varchar(64), required
    // source_count: integer, required (use createIntegerColumn)
    // original_url: varchar(512), NOT required
    // thumbnail_url: varchar(512), NOT required
    // news_date: varchar(64), required
    // rank: integer, required
    // fetched_at: datetime, required
}

async function createNewsIndexes(db: TablesDB): Promise<void> {
    // idx_city_date: Key index on [city, news_date]
    // idx_city_date_rank: Key index on [city, news_date, rank]
}
```

Then in `main()`, add after the existing metal_prices setup:

```typescript
await createNewsTableIfNotExists(db);
await createNewsColumns(db);
console.log("\nWaiting for news columns to be processed...");
await waitForColumns(db, TABLE_NEWS_ARTICLES);
await createNewsIndexes(db);
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Run existing tests to ensure nothing broke**

```bash
npm test
```

All existing tests must still pass — the refactoring to add `tableId` params is internal only.

- [ ] **Step 6: Run setup-db to verify table creation**

```bash
npx tsx src/setup-db.ts
```

Expected: All `news_articles` columns and indexes created (or "already exists" if re-run). Existing `metal_prices` setup still works.

- [ ] **Step 7: Commit**

```bash
git add src/config/constants.ts src/setup-db.ts
git commit -m "feat: add news_articles table setup to Appwrite schema"
```
