# Chennai News Backend — Design

**Date:** 2026-04-18
**Status:** approved autonomously (user stepped out; defaults documented below)

## Motivation

Extend the news pipeline — currently Bengaluru-only with PublicTV + TV9Kannada — to Chennai. The agent code already threads `city` end-to-end; what's missing is a Chennai source pair, their playbooks, and a city-aware way to resolve sources from `src/run-news.ts`.

## Source selection

Four candidates were researched against a single criterion: ease of extraction (listing + full body), with content quality as a tiebreaker.

| Source | Listing | Body | Chennai filter | Items | Lang | Outcome |
|---|---|---|---|---|---|---|
| The Hindu (Chennai) | city-specific RSS | paywall — only 2 preview paragraphs reach HTML | native city feed | 60 | English | dropped — body truncated |
| Daily Thanthi | RSS with `<content:encoded>` — **body in feed** | no extra fetch | URL/body keyword filter (~15/44 mention Chennai) | 44 | Tamil | **selected** |
| Polimer News | RSS | JSON-LD `NewsArticle.articleBody` | tagged `சென்னை` on some items | 50 | Tamil | **selected** |
| Puthiya Thalaimurai | RSS with `<content:encoded>` | body in feed | no filter | 8 | Tamil | dropped — too few items, not city-focused |

### A/B test confirming the extraction strategies

Four subagents, one per (source × strategy), ran the playbook end-to-end (listing + bodies for items #1 and #2). Authoritative token/tool counts pulled from session jsonl:

| Variant | Tools | Tokens | Time | Body #1 | Body #2 | Outcome |
|---|---|---|---|---|---|---|
| **thanthi-v1** RSS-only (`content:encoded` in feed) | **5** | **28,685** | 54s | 776* | 3833 | ✅ works |
| thanthi-v2 article-page (story-element-text) | 8 | 31,523 | 82s | 0 | 0 | ❌ regex fails on nested divs |
| **polimer-v1** JSON-LD `articleBody` | **7** | **33,203** | 68s | 3244 | 3655 | ✅ works |
| polimer-v2 HTML-class (`post-content`) | 9 | 33,378 | 90s | 0 | 0 | ❌ body is client-hydrated — no inline `<p>` |

*Item #1 was an `/ampstories/` webstory — a defect fixed in the final playbook.

**Winners: V1 strategies.** V2s were both slower *and* the only variants that produced zero body chars. V1 strictly dominates.

### Two defects surfaced by the test — baked into the final playbooks

1. **Daily Thanthi**: feed interleaves `/ampstories/` webstories (~700 chars of stock credit lines) with real news. Listing filters them by URL substring.
2. **Polimer**: `articleBody` has varying escape depth — some quotes are 2x-escaped (`&amp;quot;`), others 3x. A fixed pass count leaves stray `&quot;` in the body. Final playbook uses a fixed-point `html.unescape()` loop until the string stabilises.

Coverage asymmetry — **accepted as a feature, not a bug**:

| | Thanthi | Polimer |
|---|---|---|
| TN politics | ✅ | ✅ (heavier) |
| Chennai-local | keyword filter | ✅ tagged `சென்னை` |
| Cricket / IPL | ✅ 7/44 items | ❌ 0/50 items |
| Entertainment | ✅ | ✅ |

Cross-source overlap will be low for sports and Chennai-tagged items. This is addressed in the ranking change below.

## Ranking change

[src/news/agent.ts:72-81](src/news/agent.ts:72) currently weights cross-source presence as a hard ranking signal:

```
- Cross-source stories (appearing in 2+ sources) rank HIGHER than single-source stories
```

That rule was tuned for sources with heavy editorial overlap (the Bengaluru pair). It breaks here because the Chennai pair has complementary focuses. Rewording:

```
- Rank by public impact and importance to the city's readers.
- Use category diversity as a tiebreaker — avoid clustering same-category stories.
- If a story appears in multiple sources, include every source entry in the `sources` array (for attribution/deduplication), but source count does not drive the rank.
```

Step 2 in the user prompt changes from "Mark each story's source_count" to "Identify which stories appear in multiple sources so you can attribute them in the `sources` array and avoid listing the same event twice."

`source_count` stays in the schema — still useful provenance metadata for downstream consumers.

**Blast radius:** affects Bengaluru too. Expected impact is minor — the impact-based rule isn't worse than the old one, just less emphatic about overlap. Accepting this.

## Per-city source resolution

[src/news/agent.ts:17](src/news/agent.ts:17) hard-codes:

```ts
const NEWS_SOURCES: NewsSourceDef[] = [
  { key: "publictv", playbookFile: "playbook-publictv.md" },
  { key: "tv9kannada", playbookFile: "playbook-tv9kannada.md" },
];
```

Replace with a map keyed by city:

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

Replace every reference to the const `NEWS_SOURCES` inside `fetchNewsViaAgent` with `sourcesForCity(city)`.

[src/run-news.ts:11](src/run-news.ts:11) hard-codes the city. Change to read from `process.argv`:

```ts
const city = process.argv[2] ?? "bengaluru";
```

Usage becomes `npx tsx src/run-news.ts chennai` (already aligned with the CLAUDE.md section).

## Playbooks

Two new files under `memory/news/chennai/`:

- `playbook-dailythanthi.md` — method: RSS-only (body from `<content:encoded>` in the feed); includes `/ampstories/` filter; Chennai relevance via URL/body keyword.
- `playbook-polimer.md` — method: RSS for listing, article-page JSON-LD `articleBody` for body; fixed-point `html.unescape()` loop; thumbnails from JSON-LD `image.url` → og:image fallback.

Both written to match the structure of the Bengaluru playbooks in style and tone: command-heavy, with inline curl+python snippets the agent copy-pastes. The full working versions live at `/tmp/cityresearch/playbooks/{thanthi,polimer}-v1.md` and will be moved into place (with a small rename-and-polish pass).

## Tests — TDD angle

**Goal:** catch playbook rot automatically, without coupling tests to live sites.

**Approach (decided autonomously):** fixture-backed integration tests for the extraction snippets.

- Fixtures captured today during the A/B run, committed at `tests/fixtures/news/chennai/`:
  - `dailythanthi/stories.rss` (240 KB) — covers the feed-native body path, ampstories filtering, category parsing, thumbnail.
  - `polimer/rss.xml` (258 KB) + `polimer/article.html` (228 KB) — covers listing parse, JSON-LD body extraction, fixed-point unescape, thumbnail fallback chain.
- Extraction logic, mirrored from the playbook snippets, lives at `scripts/news/chennai/{dailythanthi,polimer}.py`. The playbook snippets remain authoritative for the agent loop (parity with Bengaluru); the Python scripts are a testable reflection of the same logic.
- Vitest tests at `src/news/__tests__/chennai-scrapers.test.ts` spawn the scripts via `child_process.execFileSync` with the fixture as stdin, parse the JSON output, and assert:
  - Thanthi listing: ≥ 10 items; zero URLs contain `/ampstories/`; each item has non-empty title, url, date; body text length ≥ 500 chars for non-webstory items.
  - Polimer listing: ≥ 10 items; each item has non-empty title, url, date, thumb.
  - Polimer body: length ≥ 500 chars; zero matches for `&quot;` / `&amp;quot;` / `&amp;amp;` in the body (stray-entity guard); thumb is an HTTPS URL.

**Scope guard:** not touching the Bengaluru playbooks or their (absent) tests. Future work — not in this spec.

## Out of scope

- Adding a third Chennai source (e.g., swapping in a cricket-heavy source).
- Migrating Bengaluru playbooks to the external-script + tests structure.
- UI / Appwrite schema changes. The existing schema is already city-aware.
- Scheduler changes. `src/scheduler.ts` can continue to invoke per-city jobs; Chennai wiring there is follow-up work.

## Decisions flagged for later review

1. **Cricket gap on Polimer.** Accepted the asymmetry. If over time the ranking consistently drops important Chennai stories in favour of shallow overlapping ones, revisit by swapping in News18 Tamil or Dinamalar.
2. **Fixture refresh cadence.** Fixtures were captured 2026-04-18. Playbooks may drift when the sources change markup. Default: refresh when a test fails against a real run, not on a schedule.
3. **External scripts vs inline-only playbooks.** Chose external scripts to enable tests. Bengaluru stays inline for now. Consolidation is future work if the test pattern proves valuable.
