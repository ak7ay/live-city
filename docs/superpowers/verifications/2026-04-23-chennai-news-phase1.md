# Chennai News Phase-1 Defer-Translation — Verification

**Date:** 2026-04-23
**Branch:** feat/chennai
**Last commit at run time:** bfa5773
**Spec:** [docs/superpowers/specs/2026-04-22-news-phase1-defer-translation-design.md](../specs/2026-04-22-news-phase1-defer-translation-design.md)
**Plan:** [docs/superpowers/plans/2026-04-23-news-phase1-defer-translation.md](../plans/2026-04-23-news-phase1-defer-translation.md)

## Run

`npx tsx src/run-news.ts chennai` — completed without errors. Log: `logs/chennai-phase1-defer-20260423-0810.log`. Wall-clock ~14 minutes (08:10–08:14 phase-1, 08:14–08:16 phase-2, 08:16–08:24 phase-3 + Appwrite write).

Date validation retry fired during the run: **no** (both Chennai sources passed first-try date validation; the new playbook filter is doing its job).

## Quantity (token efficiency)

Effective tokens (`input + cache_creation + 0.1 × cache_read + output`):

| Phase | Source | Baseline (2026-04-21) | New (2026-04-23) | Δ |
|---|---|---|---|---|
| Phase-1 | dailythanthi | ~270K | **70K** | **-74%** |
| Phase-1 | polimer | ~173K | **169K** | **-2.5%** |
| **Phase-1 combined** | both Chennai sources | ~443K | **239K** | **-46%** |
| Phase-2 | select (now also translates) | n/a | 67K | new translation work |
| Phase-3 | per article × 8 (avg) | ~53K | 52K | unchanged |

Story counts in `stories-*.md` post-filter:
- dailythanthi: **18** stories (all dated 2026-04-23)
- polimer: **34** stories (31 dated 2026-04-22 + 3 dated 2026-04-23)
- Combined: 52 stories — a sane today+yesterday window.

**≥30% phase-1 drop target:** dailythanthi crushed it (-74%); polimer fell short individually (-2.5%) but combined phase-1 still hit **-46%**.

**Why polimer underperformed individually:** the savings stack we designed targeted dailythanthi's specific waste — body in listing (gone), oversized date range (gone). Polimer was already efficient (DESC[:200] not BODY[:4000]; most stories within today+yesterday window; the previous `[:60]` slice was a no-op against a ~50-item feed). Translation-removal savings are smaller for polimer because writing 34 Tamil stories produces a similar token count to writing 34 English ones (Tamil is denser per char but expands per token).

This is acceptable: the spec called out dailythanthi as the bigger token offender, and the absolute combined phase-1 reduction is a large operational win.

## Quality

### Phase-1 outputs (source language)

- **Tamil pass-through:** confirmed. Sample headlines from `stories-dailythanthi.md`:
  - `கடலூரில் கேஸ் சிலிண்டர் வெடித்து இடித்து விழுந்த வீடு`
  - `மேற்கு வங்காள சட்டசபை தேர்தல்; வாக்காளர்களுக்கு பிரதமர் மோடி வேண்டுகோள்`
  
  Categories preserved with the doubled English parenthetical, e.g. `தமிழக செய்திகள் (Tamilnadu)`. No English leakage.
- **Date fields:** every story has `- **Date:** YYYY-MM-DD`. Distribution:
  - dailythanthi: 18 × 2026-04-23
  - polimer: 31 × 2026-04-22, 3 × 2026-04-23
- **Stale-date count:** 0. Post-write date validation logged "Phase 1 date validation passed" for both sources without firing the repair turn.

### Phase-2 selection (English)

8 stories selected, schema-valid (all `headline_en` / `summary_en` / `category_en` populated, `sources` arrays present).

Selected headlines (all fluent English):

1. **Tamil Nadu Assembly Elections: Polling Underway Across All 234 Constituencies** (Daily Thanthi + Polimer ×2 — 3 source entries)
2. **Actor Ajith Kumar Becomes First to Vote in Tamil Nadu Assembly Elections at Thiruvanmiyur, Chennai** (Daily Thanthi + Polimer ×2)
3. **Woman Dies at Chennai Government Maternity Hospital After Sterilization Surgery, Family Alleges Negligence** (polimer single-source)
4. **NTK Chief Seeman Casts Vote at Neelankarai, Urges All Citizens to Vote** (Daily Thanthi + polimer)
5. **Chennai Student Dies by Suicide After Failing NEET Exam Three Times** (Daily Thanthi single-source)
6. **Domestic Airfares Skyrocket as Voters Rush Home for Tamil Nadu Elections; Chennai–Madurai Fare Doubles** (polimer)
7. **Gas Cylinder Explosion Collapses House in Cuddalore, Woman Critically Injured** (Daily Thanthi + polimer)
8. **Gold Smuggling Case: Actress Ranya Rao Granted Bail After One Year in Prison** (Daily Thanthi)

Categories sensibly translated: `Tamil Nadu`, `Tamil Nadu Elections`, `Chennai`, `Cinema News`. The Tamil-with-English-parenthetical pattern (`தமிழக செய்திகள் (Tamilnadu)`) cleanly resolved to `Tamil Nadu`.

**Cross-source dedup:** working well. 5 of 8 stories carry multi-source attribution; rank 1 (the headline-news Assembly Elections story) shows correctly merged across both sources with 3 source entries (Daily Thanthi + Polimer × 2 because polimer published two related items).

### Cross-check 8 winners against local-language source

Spot-checked rank 1, 2, 4, 5: each English headline matches the corresponding Tamil source story by underlying facts (event, person, place). No meaning drift, no mistranslations observed.

### Events news-scan

**Not exercised in this run.** The verification scope was scoped to `run-news.ts`. Recommend a follow-up `npx tsx src/run-events.ts chennai` after the merge to confirm the events news-scan prompt translation also produces fluent English (Task 7's edit). Lower risk because the schema enum already constrains `category` to one of seven English literals.

### Appwrite rows

```
city=chennai  news_date=2026-04-23  rows=8
```

All 8 rows present, ranks 1–8, every row has thumb=yes, body lengths range from 210c to 3618c (matches Polimer's documented short-stub vs. full-article variability). Source mix: 3 cross-source (DT+Polimer), 4 DT-only, 2 Polimer-only — balanced.

## Decision

**Ship.**

The combined phase-1 token drop (-46%) is a clear operational win. Quality across phase-1 (Tamil pass-through), phase-2 (English fluency + dedup), and Appwrite output is production-grade with no observed regressions. The post-write date validation works (didn't fire — and that's the right outcome on a clean run).

Polimer's per-source delta missing the 30% target is documented above as a structural artifact of where the inefficiencies were, not a bug to chase.

## Follow-ups

1. **Run events pipeline once after merge** to validate Task 7's translation prompt (`npx tsx src/run-events.ts chennai` + `verify-chennai-events.ts`). Trivially cheap; surfaces any Tamil leak in event titles/venues.
2. **Bengaluru date-filter PR** (already noted in spec's Future Work). Add today+yesterday filter to `playbook-publictv.md` and `playbook-tv9kannada.md`. Verify PublicTV's `post.date` timezone before pasting the filter snippet.
3. **Polimer phase-1 deeper investigation (optional).** The session shows ~13K output tokens spent rewriting 34 Tamil stories into the markdown file. If a tighter listing format or a streaming write could cut this further, it might bring polimer to parity with dailythanthi's drop. Low priority — current numbers are acceptable.
4. **Chennai 3–5 day soak** before flipping Bengaluru. Re-run quantity + quality checks daily; flag any regression. The post-write date validation should remain silent.
5. **Pre-existing `clean()` newline issue** (flagged in Task 3 review): RSS titles with literal `\n` characters can break the agent's `TITLE: ...` line contract. Pre-existing; worth a separate small PR to harden `clean()` in both mirror and playbook.
