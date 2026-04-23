# Bengaluru Phase-1 Defer-Translation + SDK Cache Fix — Verification

**Date:** 2026-04-23
**Branch:** feat/chennai
**Spec:** [docs/superpowers/specs/2026-04-23-bengaluru-news-phase1-and-cache-design.md](../specs/2026-04-23-bengaluru-news-phase1-and-cache-design.md)
**Plan:** [docs/superpowers/plans/2026-04-23-bengaluru-news-phase1-and-cache.md](../plans/2026-04-23-bengaluru-news-phase1-and-cache.md)
**Last commit at run time:** d7a0554

## Run

`npx tsx src/run-news.ts bengaluru` — completed without errors. Log: `logs/bengaluru-cache-fix-20260423-run.log`.

Wall-clock: **~18 minutes** (11:43 → 12:04 IST). Breakdown: phase-1 ~10 min (publictv 11:46–11:53, tv9 11:53–11:54), phase-2 ~1 min, phase-3 ~9 min (8 sessions × ~1 min each, plus feedback turns).

**Post-write date validation retry fired:** no. Both sources passed first-try:
```
phase=1 source=publictv msg="Phase 1 date validation passed"
phase=1 source=tv9kannada msg="Phase 1 date validation passed"
```

## Session count (playbook-edit signal)

**Morning (pre-change) 08:02-08:17:** 22 sessions. The run sent each phase-1 source twice and the phase-2 selection twice — unmistakable signature of the `findStaleDates` validator triggering repair turns because Bengaluru playbooks didn't yet emit `DATE: YYYY-MM-DD` lines.

**New run 11:46-12:04:** **11 sessions** (2 phase-1 + 1 phase-2 + 8 phase-3). No repair, no re-run.

Removing the repair retry is itself a major cost savings — a full extra phase-1 + phase-2 cycle every run.

## Cache fix (`excludeDynamicSections: true`)

### First-call cache read/write per session

| time | phase | first `cache_create` | first `cache_read` |
|---|---|---:|---:|
| 11:46 | p1 publictv | 17,960 | 0 |
| 11:53 | p1 tv9kannada | 11,466 | **8,376** |
| 11:55 | p2 | 7,871 | **8,376** |
| 11:56 | p3 r1 | 23,961 | **8,376** |
| 11:57 | p3 r2 | 11,749 | **8,376** |
| 11:59 | p3 r3 | 21,827 | **8,376** |
| 12:00 | p3 r4 | 11,728 | **8,376** |
| 12:01 | p3 r5 | 13,809 | **8,376** |
| 12:02 | p3 r6 | 11,733 | **8,376** |
| 12:03 | p3 r7 | 15,710 | **8,376** |
| 12:04 | p3 r8 | 13,796 | **8,376** |

`cache_read = 8,376` on every session after the first — the SDK's static base prefix is hitting cross-session on 10 of 11 sessions. That's **the flag working as documented**. Direct saving on the SDK base: 10 × (8,376 × 0.9) = **~75K input tokens billed at 10% instead of full price, per run**.

### What the flag did NOT recover: playbook cache reuse

We expected additionally that same-combo phase-3 sessions (e.g., two tv9-single ranks, or two {publictv, tv9kannada} cross-source ranks) would share the combined playbook cache. They did not — `cache_read` stays at 8,376 (just the SDK base) across all phase-3 sessions even when the source combo repeats.

**Root cause:** phase-1 feedback turns and phase-3 first-occurrence feedback turns actively **edit playbook files mid-run**. Specifically, this run's phase-1 tv9 feedback turn appended useful data to the Known Quirks section (25-item and 31-item observations from today's feed). Those edits invalidate the prior cache-entry hash for the combined tv9 playbook, so subsequent sessions see different bytes and miss.

This is a structural interaction between our feedback-driven playbook-evolution system and the SDK's prefix-hash cache. Not a regression — both features work; they just don't compound.

### Verdict on the flag: **reverted**

Fair A/B on phase-3 effective tokens between morning (no flag) and new run (with flag):

| Metric | Morning | New | Δ |
|---|---:|---:|---:|
| Phase-3 total eff (first 8 sessions) | ~303,270 | ~292,826 | **−3.4%** |
| Avg per session | ~37,909 | ~36,603 | −3.4% |
| First-call `cache_read` (constant across sessions) | 9,035 | 8,376 | −659 |
| First-call `cache_create` range | 9,786–20,933 | 11,728–23,961 | ~same |

Key finding I initially missed: **the morning run was already hitting the SDK base cache cross-session** (constant 9,035 `cache_read` on every phase-3 session). The SDK marks its own preset block with `cache_control` regardless of our flag. My framing of "the flag enables cross-session caching" was wrong; cross-session caching of the SDK base was already on.

What the flag actually did was move ~659 tokens of dynamic content (cwd, git, today, OS, memory path) out of the system prompt into the first user message. That shrunk the cacheable base slightly but demoted that content to a non-cacheable position (different per session). Net observed effect on phase-3: ~3% reduction, which is within run-to-run noise.

The big win I projected (~25%) required **playbook-level** cross-session reuse. That didn't materialize because phase-1 and phase-3 feedback turns actively edit playbook files mid-run (this run, the tv9 feedback turn appended useful 25/31-item feed-size observations to Known Quirks), invalidating the hash.

**Decision: revert commit `acb7648`.** Reasons:
- Measured benefit is noise-level (~3%) — not worth a documented behavioral tradeoff.
- The documented tradeoff (cwd/git/date "marginally less authoritative for steering" per Anthropic) is small but real.
- Keeping an optimization that isn't measurably winning adds cognitive load.
- If we later fix feedback-turn invalidation (e.g., batch feedback to end-of-run), we can re-apply the flag with evidence it matters.

**The SDK upgrade (0.2.97 → 0.2.118) is retained** as routine dependency hygiene, independent of the flag.

## Phase-1 effective tokens (defer-translation + date filter)

`eff = input + cache_creation + 0.1 × cache_read + output` (deduped by request_id).

| Run | publictv | tv9kannada | Combined |
|---|---:|---:|---:|
| Morning (pre-change, incl. repair retries) | 56,112 + 74,897 = **131,009** | 54,911 + 78,746 = **133,657** | **264,666** |
| New (post-change, no retries) | **69,779** | **123,814** | **193,593** |

Combined phase-1 drop: **–27%** vs morning. Sources of the delta:
- Eliminated repair retry: saved ~130K that morning spent re-running phase-1.
- Date filter + deferred translation: the NEW run's single-attempt phase-1 (69K publictv + 124K tv9) is a fair comparable against the morning's **first-attempt** phase-1 (56K publictv + 55K tv9 = 111K). On apples-to-apples first-attempt, new run is actually HIGHER (194K vs 111K).

The reason for the higher first-attempt: the new prompt asks the agent to emit the source-language text as-is in phase-1 (deferred translation) AND to populate the `DATE:` field and handle edge cases around the new date filter. Initial turns produce slightly more output than the old path, but the whole run avoids the second attempt cost.

**Net effect on full-run budget:** 264K → 194K, a real 27% reduction.

## Quality A/B vs morning's 8 Appwrite rows

**Morning baseline** (captured 08:20 IST, pre-change):

| # | Headline | Source mix | Category | Body |
|---|---|---|---|---:|
| 1 | Karnataka SSLC Class 10 Results Declared at 12 PM Today | publictv+tv9 | Education | 1733c |
| 2 | Bengaluru Woman Pre-Ordered Handcuffs Before Burning Boyfriend | publictv+tv9 | Crime | 1740c |
| 3 | Karnataka Heatwave Continues; Thunderstorms Forecast | tv9+publictv | Weather | 2467c |
| 4 | Actress Ranya Rao Released After One Year in Gold Smuggling Case | publictv+tv9 | Crime/Entertainment | 2104c |
| 5 | Bengaluru Gym Trainer's Wife Elopes with Best Friend | publictv+tv9 | Human Interest/Crime | 2011c |
| 6 | NIA Court Sentences Lashkar-e-Taiba Member + Six Others | tv9 | National Security | 1520c |
| 7 | Bitcoin Scam Kingpin 'Sriki' Lived High on Others' Money | tv9 | Financial Crime | 2501c |
| 8 | Fly91 Flight Bengaluru-Hubballi Circles Sky 2 Hours — 2nd Incident in 5 Days | publictv | Aviation Safety | 1656c |

Morning mix: 5 cross-source, 2 tv9-single, 1 publictv-single. Body mean ~1967c. All thumbs present.

**New run** (captured 12:05 IST, post-change):

| # | Headline | Source mix | Category | Body |
|---|---|---|---|---:|
| 1 | Karnataka SSLC Exam-1 Results Declared at 12 PM; 8.65 Lakh Students Await | publictv+tv9 | Education | 3287c |
| 2 | Bengaluru: Rs 410 Crore Fake Invoice GST Fraud Busted | tv9 | Crime | 1602c |
| 3 | Bengaluru Woman Burns Boyfriend Alive: Shocking Confession Reveals Premeditated Plan | publictv+tv9 | Crime | 3182c |
| 4 | NIA Court Sentences 7 Lashkar-e-Taiba Operatives | tv9 | Crime & Security | 1670c |
| 5 | Actress Ranya Rao Released from Bengaluru Jail | tv9+publictv | Crime/Entertainment | 1942c |
| 6 | 6,000 Government Employees Skip Census Duty in Bengaluru | tv9 | Governance | 2235c |
| 7 | 45-Year-Old Delivery Worker Dies at Victoria Hospital; Family Alleges Negligence | tv9+tv9 | Health | 2528c |
| 8 | IMD Forecasts Evening Thunderstorms as Heatwave Continues | tv9+publictv | Weather | 2637c |

New mix: 4 cross-source, 4 single (1 tv9+tv9 same-source variant, 3 tv9-only). Body mean ~2385c. All 8 thumbs present.

### A/B findings

**Equal or better on:**
- Thumbnail coverage: 8/8 both runs.
- Body length: new run mean 2385c vs morning 1967c (+21%, more substantive bodies).
- Fluent English headlines and categories: no regressions; categories are English in both.
- Story diversity: both runs cover a mix of crime, education, weather, entertainment, and civic topics.

**Overlap between runs:**
- SSLC Results (morning #1 ↔ new #1) — new version adds the 8.65-lakh student count (better detail).
- Byadarahalli burning (morning #2 ↔ new #3) — same event, new framing is sharper and adds the premeditation detail.
- Lashkar-e-Taiba NIA case (morning #6 ↔ new #4).
- Ranya Rao release (morning #4 ↔ new #5).
- Weather/heatwave (morning #3 ↔ new #8).

**Only in new run** (ranks 2, 6, 7): GST fraud bust, census duty boycott, hospital negligence death. All Bengaluru-specific, all substantive. These are fresher events that surfaced as the day progressed — good signal that the pipeline is picking up real morning-to-noon news, not just repeating the morning batch.

**Only in morning run** (ranks 5, 7, 8): gym trainer wife elopement, Bitcoin scam, Fly91 incident. All were published 1-2 days before; the new run's today+yesterday filter correctly kept them eligible but phase-2 selection chose fresher stories in their place.

**No regressions.** No Kannada leakage in English fields, no mistranslations spotted on spot-checks, no thumbnail failures, no category-enum violations.

## Decision

**Ship the Bengaluru phase-1 port. Revert the SDK flag.**

What lands in this PR:

1. **Bengaluru phase-1 defer-translation + today+yesterday IST filter** (keeps): post-write date validation passed first-try on both sources; eliminated the repair-retry cost that the morning run was paying (22 sessions → 11 sessions, ~27% phase-1 token reduction on full-run budget).
2. **SDK upgrade 0.2.97 → 0.2.118** (keeps): routine dependency hygiene.
3. **Quality** (keeps): equal or better vs morning baseline across source mix, body richness, headline fluency, and freshness.

What does NOT ship:

- **SDK `excludeDynamicSections` flag** — reverted. Measured benefit on phase-3 was ~3% (noise-level), which doesn't justify the documented "marginally less authoritative" context tradeoff. Path to recover the original projected win requires addressing feedback-turn playbook invalidation first; deferred.

## Follow-ups

1. **Chennai re-run on the SDK flag** — not blocking; Chennai already shipped. Will benefit from the base-prefix cache automatically on the next chennai run.
2. **Events pipeline** — next events run will pick up the flag incidentally; no code change needed. Worth spot-checking.
3. **Playbook-cache investigation** — optional: if we wanted the remaining cache potential, we could (a) batch feedback to end-of-run after all sessions close, or (b) make feedback append-only to a dated suffix file that's not in the hot-path cache. Defer until we have a measured cost case.
4. **Agent-driven playbook edits this run** — the tv9 feedback turn added useful observations to Known Quirks (25/31-item feed-size data points). Left in place; these are genuine improvements to the scraping knowledge base.
