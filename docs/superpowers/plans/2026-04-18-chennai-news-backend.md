# Chennai News Backend — Implementation Plan

**Spec:** [../specs/2026-04-18-chennai-news-backend-design.md](../specs/2026-04-18-chennai-news-backend-design.md)

## Step 1 — Write Chennai playbooks

**Files (new):**
- `memory/news/chennai/playbook-dailythanthi.md`
- `memory/news/chennai/playbook-polimer.md`

Copy the validated variants at `/tmp/cityresearch/playbooks/thanthi-v1.md` → `playbook-dailythanthi.md` and `/tmp/cityresearch/playbooks/polimer-v1.md` → `playbook-polimer.md`, with these polish passes:

- Rewrite the top-of-file title to match Bengaluru convention (`# Daily Thanthi — Chennai News Scraping Playbook`).
- Remove the V1/V2 label from the heading.
- Drop any research-notes phrasing ("both passes needed" etc.) in favour of terse production tone.

Verification: file exists, opens cleanly, snippet sections present.

## Step 2 — Refactor agent.ts for per-city sources

**File:** `src/news/agent.ts`

At the top of the file, replace the `NEWS_SOURCES` const with:

```ts
const NEWS_SOURCES_BY_CITY: Record<string, NewsSourceDef[]> = {
  bengaluru: [
    { key: "publictv",    playbookFile: "playbook-publictv.md" },
    { key: "tv9kannada",  playbookFile: "playbook-tv9kannada.md" },
  ],
  chennai: [
    { key: "dailythanthi", playbookFile: "playbook-dailythanthi.md" },
    { key: "polimer",      playbookFile: "playbook-polimer.md" },
  ],
};

function sourcesForCity(city: string): NewsSourceDef[] {
  const sources = NEWS_SOURCES_BY_CITY[city];
  if (!sources) throw new Error(`No news sources configured for city: ${city}`);
  return sources;
}
```

Inside `fetchNewsViaAgent`, replace every reference to `NEWS_SOURCES` with `sourcesForCity(city)` (resolve once at the top of the function, reuse).

Verification: `tsc --noEmit` passes; no stray `NEWS_SOURCES` references remain.

## Step 3 — Update ranking criteria prompt

**File:** `src/news/agent.ts` — `selectionSystemPrompt` function

Replace the `## Ranking Criteria` block with:

```
## Ranking Criteria

- Rank by public impact and importance to the city's readers.
- Use category diversity as a tiebreaker — avoid clustering same-category stories.
- If a story appears in multiple sources, include every source entry in the `sources` array (for attribution/deduplication), but source count does not drive the rank.
```

And in `selectionUserPrompt`, replace step 2 from:

```
2. **Cross-source match**: Identify stories that appear in multiple sources (same event, even if worded differently). Mark each story's source_count.
```

to:

```
2. **Identify cross-source overlap**: Note which stories appear in multiple sources so you can attribute them in the `sources` array and avoid listing the same event twice.
```

No schema changes — `source_count` remains.

## Step 4 — Refactor run-news.ts

**File:** `src/run-news.ts`

Replace the hard-coded `"bengaluru"` with:

```ts
const city = process.argv[2] ?? "bengaluru";
```

And the log lines:

```ts
console.log(`Running news pipeline for ${city}...`);
await updateNewsForCity(db, city);
console.log(`Done — news inserted into Appwrite for ${city}.`);
```

Verification: `npx tsx src/run-news.ts chennai` resolves correctly (smoke-run to the point of agent-dispatch before real invocation).

## Step 5 — Capture fixtures + create extraction scripts

**Fixture files (new):**
- `tests/fixtures/news/chennai/dailythanthi-stories.rss` — copy `/tmp/cityresearch/thanthi.xml`
- `tests/fixtures/news/chennai/polimer-rss.xml` — copy `/tmp/cityresearch/polimer-fresh.xml`
- `tests/fixtures/news/chennai/polimer-article.html` — copy `/tmp/cityresearch/polimer-article.html`

**Script files (new):**
- `scripts/news/chennai/dailythanthi.py` — mirrors the playbook's inline snippet. Reads RSS XML from stdin, prints JSON `[{n, title, url, date, cats, thumb, body}]`.
- `scripts/news/chennai/polimer-listing.py` — reads RSS XML from stdin, prints JSON listing.
- `scripts/news/chennai/polimer-body.py` — reads article HTML from stdin, prints JSON `{chars, thumb, body}`.

These mirror the playbook logic exactly — not a new abstraction layer. They exist so tests can exercise the same parsing code the agent uses.

## Step 6 — Write vitest tests

**File (new):** `src/news/__tests__/chennai-scrapers.test.ts`

For each source/script, spawn via `child_process.execFileSync(["python3", script], { input: fixture })` and assert:

**dailythanthi.py:**
- Returns ≥ 10 items.
- Zero items have `/ampstories/` in their URL.
- Every item has non-empty `title`, `url`, `date`.
- For the first non-webstory item, `body` length ≥ 500.

**polimer-listing.py:**
- Returns ≥ 10 items.
- Every item has non-empty `title`, `url`, `date`, `thumb`.

**polimer-body.py:**
- `chars` ≥ 500 for the fixture article.
- `thumb` starts with `https://`.
- `body` contains no `&quot;`, `&amp;quot;`, or `&amp;amp;` substrings (stray-entity guard).

Verification: `npm test` passes.

## Step 7 — CI checks

Run in order:
1. `npm run check` — biome + tsc --noEmit (project convention).
2. `npm test` — vitest.

Fix failures before proceeding.

## Step 8 — Live pipeline run

```
npx tsx src/run-news.ts chennai
```

Expected: agent dispatches phase 1 (×2 sources), phase 2 (selection), phase 3 (×8 translations). Logs to `logs/app.log`. Result: 8 rows written to `news_articles` collection for `city=chennai`, `news_date=<today IST>`.

Time budget: expect 10–20 minutes wall-clock (Bengaluru reference pace).

Run in background, monitor logs until completion.

## Step 9 — Verify in Appwrite

Via CLI:

```
appwrite databases list-rows \
  --database-id live_city \
  --table-id news_articles \
  --queries '["equal(\"city\",\"chennai\")","equal(\"news_date\",\"<today>\")","orderAsc(\"rank\")"]'
```

Assert:
- Exactly 8 rows for today + chennai.
- Ranks 1–8 present, unique.
- Each row has non-empty `headline`, `summary`, `content`, `source`, `category`, `original_url`.
- `thumbnail_url` populated on all 8 rows.
- `source` field contains one of `dailythanthi`, `polimer`, or the comma-joined form (cross-source).

If any assertion fails, investigate logs (`logs/app.log`) and retry the failing phase; don't retry blindly.

## Step 10 — Report + summarise changes

Print a final report listing:
- Files created + modified.
- Test results.
- Pipeline run outcome.
- Appwrite verification results (including a sample row printed readably).

Do NOT create a git commit — user's instructions reserve commits for explicit requests. User decides whether to commit after review.
