# Bengaluru Phase-1 Defer-Translation + Agent SDK Cache Fix — Design

**Date:** 2026-04-23
**Branch:** feat/chennai (extended — same branch as Chennai work)
**Related specs:**
- [2026-04-22-news-phase1-defer-translation-design.md](./2026-04-22-news-phase1-defer-translation-design.md) (Chennai parent)

## Summary

Two changes land together:

1. **Agent SDK cache fix** — flip `excludeDynamicSections: true` on the Claude Agent SDK session factories so the system prompt (preset + our playbook) becomes static and cacheable across sessions. Observed phase-3 leak on Chennai: ~80K effective tokens per run spent re-creating the same playbook cache entry 8 times. This is documented SDK behavior (per [Anthropic's modifying-system-prompts docs](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts) under "Improve prompt caching across users and machines"); flag requires SDK ≥ v0.2.98.

2. **Bengaluru phase-1 port** — apply the Chennai defer-translation + today+yesterday IST filter pattern to both Bengaluru sources (PublicTV, TV9 Kannada). Adds mirror Python scripts, vitest coverage, updated playbooks. Identical pattern and decisions as the Chennai parent spec.

Both changes share a single verification run (Bengaluru end-to-end) so we measure cache savings and phase-1 token drop on the same run, and A/B the 8 output stories against the morning's pre-change run.

## Non-Goals

- Re-running Chennai. Chennai already verified and shipped.
- Changing the events pipeline (`src/events/agent.ts`). SDK flag benefits it incidentally; no explicit events verification in this spec.
- Changing phase-2 or phase-3 prompts or schema. These were already changed globally in the Chennai PR and apply to both cities.
- 1-hour TTL beta / other cache_control experiments. 5-minute default is sufficient for our ~14-min pipeline if cross-session reuse works.

## Part A — Agent SDK Cache Fix

### Problem

Instrumented Chennai phase-3 (8 sessions, same run):

| rank | source combo | first-call `cache_create` | first-call `cache_read` |
|---|---|---:|---:|
| 1 | DT+Pol cross | 12,975 | 9,035 |
| 2 | DT+Pol cross (same as 1) | 12,962 | 9,035 |
| 3 | polimer single | 8,982 | 9,035 |
| 4 | DT+Pol cross | 10,922 | 9,035 |
| 5 | DT single | 8,917 | 9,035 |
| 6 | polimer single (same as 3) | 8,993 | 9,035 |
| 7 | DT+Pol cross | 10,943 | 9,035 |
| 8 | DT single (same as 5) | 8,926 | 9,035 |

`cache_read` is constant at 9,035 — the SDK's own static preset block. Our playbook sits after the SDK's cache marker, and the SDK injects dynamic sections (cwd, git status, today, memory path, OS version) between its marker and our `append`. Per the Anthropic docs quote:

> "the preset embeds per-session context in the system prompt ahead of your `append` text: the working directory, platform and OS version, current date, git status, and auto-memory paths"

Cache writes only happen at markers (per prompt-caching docs: _"Cache writes happen only at breakpoints"_). Since no marker covers our playbook, no cache entry is written for it, and sessions 2-8 cannot read what session 1 did not write.

### Fix

Set `excludeDynamicSections: true` on both `createPlainSession` and `createBrowserSession`. Per the SDK docs:

> "The per-session context moves into the first user message, leaving only the static preset and your `append` text in the system prompt so identical configurations share a cache entry across users and machines."

> "the working directory, git status, and memory location still reach Claude, but as part of the first user message rather than the system prompt."

No content reaches the LLM is dropped — only repositioned.

### Prerequisite

Upgrade `@anthropic-ai/claude-agent-sdk` from `0.2.97` to `0.2.118` (latest at time of writing; ≥ `0.2.98` required per docs).

### Expected outcome (verified against Bengaluru run)

For phase-3 first API calls (using `excludeDynamicSections`):
- Rank 1 (first occurrence of any source combo): `cache_create ≈ 12-15K` (creates playbook cache entry)
- Rank 2+ (same source combo, within 5 min): `cache_create ≈ 0`, `cache_read ≈ 18-22K` (hits prior write)

Estimated savings: ~75K effective tokens per pipeline run (~25% off the ~304K Chennai total). Applies to both cities going forward.

### Risk assessment

**Correctness risk — LOW.** The flag is documented SDK behavior; content reaches the model via first user message. Tradeoff per docs: "Instructions in the user message carry marginally less weight than the same text in the system prompt" — for our pipeline this is irrelevant since the playbook (still in system prompt) is doing the steering.

**Rollback:** one-line revert.

## Part B — Bengaluru Phase-1 Port

### Scope (by source)

#### PublicTV (`memory/news/bengaluru/playbook-publictv.md`)

- **Source shape:** WordPress REST API, `post.date` is naive IST (verified: difference to `date_gmt` is exactly +5:30).
- **Listing endpoint:** `https://publictv.in/wp-json/wp/v2/posts?categories=255&per_page=20&_fields=id,title,excerpt,link,date` (unchanged).
- **Playbook edit:** add today+yesterday IST window filter in-python inside the listing curl heredoc. Add normalized `DATE: {d.strftime('%Y-%m-%d')}` line (replacing raw timestamp). Keep `EXCERPT` (not BODY — this source already doesn't include full body in listing). Preserve all existing quirk notes unchanged.
- **Article-body path:** unchanged (category-255 article-URL fallback + og:image + entry-content heuristics).

#### TV9 Kannada (`memory/news/bengaluru/playbook-tv9kannada.md`)

- **Source shape:** RSS feed, `<pubDate>` is RFC822 with `+0530` (same as Chennai polimer).
- **Listing endpoint:** `https://tv9kannada.com/karnataka/bengaluru/feed` (unchanged).
- **Playbook edit:** add today+yesterday IST window filter in-python (parse pubDate, compare to window). Add normalized `DATE: {d.strftime('%Y-%m-%d')}` line. Remove the `[:20]` slice — the date filter replaces that cap (observed 60 items in live feed; typical filtered window is ~30). Keep `<content:encoded>` stripping for listing. Preserve all existing quirk notes unchanged.
- **Article-body path:** unchanged (JSON-LD extraction + all quirk handling).

### Mirror scripts (vitest-tested)

- `scripts/news/bengaluru/publictv.py`
- `scripts/news/bengaluru/tv9kannada.py`

Each script reads stdin (the curl response), applies the same filter + field extraction as the playbook heredoc, emits JSON array to stdout. Supports `NEWS_TODAY_OVERRIDE` env var (test-only hook; NOT in playbook heredoc) for pinning `today` to a fixture's date for deterministic tests.

### Fixtures (frozen snapshots)

- `test/fixtures/news/bengaluru/publictv-posts.json` (live capture 2026-04-23, 20 posts across 2026-04-22/2026-04-23)
- `test/fixtures/news/bengaluru/tv9kannada-feed.xml` (live capture 2026-04-23, 60 items across 2026-04-20…2026-04-23)

Distribution ensures both "keeps all", "drops some", and "drops everything" test cases work by varying `NEWS_TODAY_OVERRIDE`.

### Test file

`test/news/bengaluru-scrapers.test.ts` — same shape as `test/news/chennai-scrapers.test.ts` (describe blocks per source, `runScript()` helper already exists in the test file and can be copied).

Coverage (per source):
- Returns at least 10 items in the today/yesterday window
- Every item has title, url, IST YYYY-MM-DD date, thumb (publictv-only: no thumb field in listing; document in Known Limitations instead or extract from excerpt if present)
- Every emitted date is in the pinned `{today, yesterday}` set
- Filter correctly drops out-of-window items (pin TODAY to a date that partitions the fixture)
- Filter produces empty output when TODAY is far ahead of fixture dates

### Playbook edits — constraints

- Do NOT include `NEWS_TODAY_OVERRIDE` in the playbook heredoc. That's a test-only hook; production always uses `datetime.now(IST).date()`.
- Preserve every existing quirk note verbatim. Date filter is purely additive.
- Keep heredocs executable via `python3 -c "..."` with proper `\"` quote-escaping.

### Post-write date validation

Already globally enabled via Chennai's `findStaleDates` in `runPhase1`. Applies to Bengaluru automatically once playbooks emit `**Date:** YYYY-MM-DD`. **Without the playbook updates, Bengaluru phase-1 will fail validation on the next run** — this is the forcing function for the playbook edits to land together with the playbook-dependent agent prompt changes that were shipped with Chennai.

## Verification (single Bengaluru end-to-end run)

### Token quantity (phase-1 drop)

Compare to a baseline Bengaluru run from before Chennai changes. Expected reductions driven by:
- PublicTV: excerpt-only listing (already the case) + date filter → modest gain (source was already efficient like Chennai polimer)
- TV9 Kannada: date filter + removing `[:20]` slice is mostly neutral (already capped). Bigger gain comes from deferred translation in phase-1 system prompt (global change; now Kannada stays Kannada in phase-1 output).

Combined Bengaluru phase-1 target: ≥ 30% drop vs last week's baseline. (Chennai combined hit -46%.)

### Cache savings (SDK flag)

Parse the phase-3 session JSONLs as in the Chennai investigation:
- First API call of each phase-3 session
- Rank 1 `cache_create` ≈ 12-15K (fresh), `cache_read` ≈ 9K (SDK base only)
- Rank 2+ same-combo `cache_create` ≈ 0, `cache_read` ≈ 18-22K (SDK base + playbook)

Success criterion: at least 4 of the 8 phase-3 sessions show `cache_create` dropping from 10K-class to 1K-class.

### Quality (A/B vs this morning)

Pre-change baseline captured at `docs/superpowers/verifications/artifacts/bengaluru-baseline-2026-04-23.json` (8 rows including ranks, headlines, bodies, categories, sources, thumbnails).

Compare new run's 8 selections on:
- Source-mix balance (cross vs single)
- Category sensibility (English enums, not Kannada leakage)
- Fluency of headlines and summaries (no translation artefacts)
- Body length distribution and thumbnail presence
- Any meaning drift or mistranslation on spot-checked stories

Success criterion: no quality regression vs morning's baseline. Ideally equal or improved on cross-source dedup and category English-fluency.

### Decision gates

- **SDK cache flag:** if `cache_create` on rank 2+ doesn't drop materially, revert the flag and leave a TODO; investigate SDK internals / file bug against SDK.
- **Bengaluru phase-1:** if post-write date validation fires even once, treat as a bug; re-evaluate filter logic before shipping.
- **Quality:** if any regression vs baseline, hold the PR and iterate on prompts.

## Future Work

- Events pipeline cache measurement (no change needed; measure incidentally on next events run).
- 1-hour TTL beta evaluation if the 5-min TTL proves insufficient during long events runs.
- Investigate whether `systemPrompt` as a pure custom string would be even more cache-friendly (at the cost of losing CLAUDE.md / SDK tools). Out of scope here.
