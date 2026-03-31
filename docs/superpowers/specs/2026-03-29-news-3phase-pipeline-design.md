# News Scraping: 3-Phase Agent Pipeline

## Overview

Replaces the current single-agent news scraping approach with a 3-phase pipeline. Each phase has a single focused task, improving translation quality, cross-source matching accuracy, and article content quality.

**Total agent calls:** 2 (Phase 1) + 1 (Phase 2) + N (Phase 3) = variable. Story count is config-driven.

## Problem with Current Approach

The single-agent session is overloaded — it fetches, translates, cross-matches, selects, fetches full content, and translates again, all in one session. Result:
- Cross-source matching fails because the agent compares Kannada titles instead of translated English titles
- Translation quality suffers from divided attention
- Sessions are long and expensive; failure means restarting everything

## Architecture

```
Phase 1 (per-source)     Phase 2 (single)       Phase 3 (per-article)
┌──────────────┐         ┌──────────────┐        ┌──────────────┐
│ Fetch source │         │ Read both    │        │ Fetch full   │
│ Translate    │──file──▶│ Match stories│──JSON──▶│ article from │
│ headlines    │         │ Pick top 5   │        │ source, get  │
│ Write .md    │         │ Return JSON  │        │ thumbnail,   │
└──────────────┘         └──────────────┘        │ translate    │
                                                  │ Return JSON  │
                                                  └──────────────┘
```

### Handoff Pattern
- **Phase 1 → Phase 2:** Markdown files in workspace (agent reads agent output)
- **Phase 2 → Code:** JSON response text (code parses selections)
- **Code → Phase 3:** Prompt with playbook + article URL(s)/ID(s)
- **Phase 3 → Code:** JSON response text, Zod validated

## Phase 1: Extract

**Runs:** Once per source (sequential). 2 calls for Bengaluru.

**Input:**
- Full playbook (agent uses relevant source section)
- City name + today's date

**Agent task:**
1. Fetch the listing endpoint for the source (curl)
2. Translate every headline and summary to English
3. Write structured markdown to `stories.md` in workspace

**Output format** (`stories-{source}.md` e.g. `stories-publictv.md`):
```markdown
# PublicTV — Bengaluru Stories (2026-03-29)

## 1. 4-Year-Old Girl Raped and Murdered in Bengaluru
- **Category:** Crime
- **Summary:** A 4-year-old girl from Assam was kidnapped and murdered in Electronic City.
- **URL:** https://publictv.in/4-year-old-girl-raped-and-murdered-in-bengaluru/
- **ID:** 1446930

## 2. Commercial Gas Cylinder Shortage Hits Bengaluru
- **Category:** Business
- **Summary:** Shortage of commercial cooking gas cylinders creating problems for restaurants.
- **URL:** https://publictv.in/commercial-cylinder-shortage-continues-in-bengaluru/
- **ID:** 1447090
```

**Shared workspace:** Phase 1 and Phase 2 share the same temp directory. Phase 1 writes `stories-publictv.md`, `stories-tv9kannada.md` directly. Phase 2 reads them from the same location. No file copying needed.

**ID field:** For PublicTV, this is the WordPress post ID (needed for Phase 3 API call). For TV9 Kannada, this is null (full content is in RSS, re-fetched by URL).

## Phase 2: Select

**Runs:** Once.

**Input:**
- Source markdown files already in shared workspace from Phase 1 (e.g. `stories-publictv.md`, `stories-tv9kannada.md`)

**Agent task:**
1. Read all source files in workspace
2. Cross-source match: compare English headlines/summaries, identify stories appearing on multiple sources
3. Pick top N stories (count passed in prompt): cross-source stories rank higher, then by impact/importance, then category diversity as tiebreaker
4. Return JSON array as response text

**Output format** (JSON response text):
```json
[
  {
    "rank": 1,
    "headline_en": "4-Year-Old Girl Raped and Murdered",
    "summary_en": "A 4-year-old girl was kidnapped and murdered in Electronic City area.",
    "category_en": "Crime",
    "sources": [
      { "name": "PublicTV", "url": "https://publictv.in/...", "source_id": "1446930" },
      { "name": "TV9 Kannada", "url": "https://tv9kannada.com/...", "source_id": null }
    ]
  }
]
```

**Code parses this JSON** to orchestrate Phase 3 calls. `source_count` is derived as `sources.length`.

## Phase 3: Translate

**Runs:** Once per selected article (sequential). N calls matching Phase 2 output count.

**Input:**
- Full playbook (agent uses relevant source section for fetching)
- Article's source(s), URL(s), ID(s) from Phase 2
- Rank number

**Agent task:**
1. Fetch full article content from source(s) using playbook instructions
2. If multiple sources: fetch both, pick the richer content or combine best parts
3. Extract thumbnail URL following playbook instructions
4. Translate everything fresh from source content to English
5. Return JSON object as response text

**Output format** (JSON response text):
```json
{
  "headline": "English headline",
  "summary": "1-2 sentence English summary",
  "content": "Full article body in English markdown",
  "category": "Crime",
  "source": "PublicTV",
  "source_count": 2,
  "original_url": "https://...",
  "thumbnail_url": "https://...",
  "rank": 1
}
```

**Code validates** each article against Zod schema (rank max and array length are config-driven, not hardcoded). On validation failure, sends errors back to same session for retry (up to 3 attempts, same as current).

## Code Changes

### Files modified
- `src/news/agent.ts` — Replace single `fetchNewsViaAgent` with 3 phase functions + orchestration

### Files unchanged
- `src/news/schema.ts` — Zod schema stays as-is
- `src/news/store.ts` — Store stays as-is
- `src/extractor/news-updater.ts` — Calls `fetchNewsViaAgent` same as before
- `memory/news/bengaluru/playbook.md` — No changes needed

### Agent session setup (shared across phases)
- Model: `claude-sonnet-4-6`, thinking: `high`
- Phase 1 + Phase 2 share one temp workspace; Phase 3 gets its own per article
- Each phase gets its own persisted session (`SessionManager.create`)
- Skills override: empty (no skills needed)
- Each phase gets a fresh agent session — no session reuse across phases

### Orchestration flow in `fetchNewsViaAgent`
```
1. Create shared workspace for pipeline
2. For each source in playbook:
   a. Create Phase 1 agent session (shared workspace)
   b. Run extraction prompt
   c. Agent writes stories-{source}.md to workspace
3. Create Phase 2 agent session (same shared workspace)
   a. Run selection prompt (references stories-*.md files)
   b. Capture JSON response, parse selections
3. For each of the 5 selections:
   a. Create Phase 3 agent session
   b. Run translation prompt with article details + playbook
   c. Capture JSON response
   d. Validate against Zod schema (retry up to 3 times)
   e. Collect validated article
4. Return array of NewsArticle objects
```

## Error Handling

- **Phase 1 failure:** Throw — no point continuing without source data
- **Phase 2 failure:** Throw — can't select without Phase 2
- **Phase 3 failure:** Zod validation retry within session (3 attempts). If still fails, throw. Outer `news-updater.ts` retries the entire pipeline (MAX_AGENT_RETRIES = 2).

## Playbook

No changes to `memory/news/bengaluru/playbook.md`. The playbook already has per-source sections with endpoints, field mappings, and content quirks. All three phases receive the full playbook and use the relevant sections.

## What Doesn't Change

- DB schema (`news_articles` table)
- Zod validation schema
- Store logic (delete + insert)
- News updater orchestration (retry logic)
- Scheduler wiring
- Playbook format
