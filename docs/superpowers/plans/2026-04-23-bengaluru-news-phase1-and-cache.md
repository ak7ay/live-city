# Bengaluru Phase-1 Defer-Translation + SDK Cache Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Chennai phase-1 defer-translation + date-filter pattern to both Bengaluru sources, and flip the Claude Agent SDK `excludeDynamicSections` flag for cross-session cache reuse. Verify both on a single Bengaluru end-to-end run with quality A/B against this morning's pre-change baseline.

**Architecture:** Two changes land in one PR since they share a verification run:
1. SDK flag in `src/agent/shared-claude.ts` (one-line change per factory + SDK upgrade).
2. Bengaluru mirror scripts, fixtures, vitest tests, and playbook edits — identical shape to the Chennai port.

**Tech Stack:** TypeScript, Python 3 (no third-party deps), vitest, `@anthropic-ai/claude-agent-sdk` v0.2.118, WordPress REST API (PublicTV), RSS (TV9 Kannada).

**Branch:** `feat/chennai` (extending — same branch as Chennai work; separate PR after merge if we ship Chennai first).

---

## Pre-flight (already done, not part of tasks)

Captured before work began:
- `docs/superpowers/verifications/artifacts/bengaluru-baseline-2026-04-23.json` — 8 Appwrite rows from this morning's pre-change run (A/B baseline)
- `test/fixtures/news/bengaluru/publictv-posts.json` — 20 posts, dates 2026-04-22/2026-04-23
- `test/fixtures/news/bengaluru/tv9kannada-feed.xml` — 60 items, dates 2026-04-20…2026-04-23
- `scripts/dump-bengaluru-news.ts` — capture script (may be kept or removed at PR time)

**Verified:**
- SDK v0.2.97 installed; latest v0.2.118; flag requires ≥ v0.2.98.
- PublicTV `post.date` is naive IST (gmt diff exactly +5:30).
- TV9 `<pubDate>` is RFC822 `+0530`.

---

## Task 1: Upgrade Agent SDK

**Files:**
- Modify: `package.json` (dependency version)
- Regenerate: `package-lock.json`

- [ ] **Step 1: Upgrade SDK**

Run: `npm install @anthropic-ai/claude-agent-sdk@0.2.118`
Expected: package.json updates, no type errors from existing code.

- [ ] **Step 2: Verify SDK type accepts `excludeDynamicSections`**

Run: `grep -n 'excludeDynamicSections' node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
Expected: at least one match in the `systemPrompt` union type.

- [ ] **Step 3: Run full test suite to confirm no regression**

Run: `npx vitest run`
Expected: all existing tests pass (no behavior change yet — just dependency bump).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump claude-agent-sdk to 0.2.118 for excludeDynamicSections"
```

---

## Task 2: Flip `excludeDynamicSections: true` on session factories

**Files:**
- Modify: `src/agent/shared-claude.ts` (lines 56-67 and 71-85)

- [ ] **Step 1: Edit both factories**

Add `excludeDynamicSections: true` to the systemPrompt object in both `createPlainSession` and `createBrowserSession`.

```ts
// createPlainSession
systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: systemSuffix,
    excludeDynamicSections: true,
},
```

Apply identical change to `createBrowserSession`.

- [ ] **Step 2: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/agent/shared-claude.ts
git commit -m "perf(agent): enable excludeDynamicSections for cross-session cache reuse

Moves cwd/git-status/today/OS/memory-path from system prompt to first user
message so the preset+append system block stays byte-identical across
sessions. Addresses phase-3 leak observed on chennai (~80K effective
tokens/run spent re-creating the same playbook cache). Docs:
https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts"
```

---

## Task 3: PublicTV mirror script + test

**Files:**
- Create: `scripts/news/bengaluru/publictv.py`
- Create: `test/news/bengaluru-scrapers.test.ts` (new file; will grow in Task 5)

- [ ] **Step 1: Write failing test for PublicTV**

Create `test/news/bengaluru-scrapers.test.ts` with the `runScript()` helper copied from `test/news/chennai-scrapers.test.ts`, plus describe block for PublicTV:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const FIXTURES = resolve(ROOT, "test", "fixtures", "news", "bengaluru");
const SCRIPTS = resolve(ROOT, "scripts", "news", "bengaluru");

function runScript(scriptName: string, fixturePath: string, env: Record<string, string> = {}): unknown {
    const fixture = readFileSync(fixturePath);
    const stdout = execFileSync("python3", [resolve(SCRIPTS, scriptName)], {
        input: fixture,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ...env },
    });
    return JSON.parse(stdout.toString("utf-8"));
}

interface PublicTVItem {
    n: number;
    title: string;
    url: string;
    date: string;
    excerpt: string;
}

describe("Bengaluru scrapers — PublicTV", () => {
    // Fixture: 5 items @ 2026-04-23 IST + 15 items @ 2026-04-22 IST.
    // TODAY=2026-04-23 keeps both in window.
    const items = runScript("publictv.py", resolve(FIXTURES, "publictv-posts.json"), {
        NEWS_TODAY_OVERRIDE: "2026-04-23",
    }) as PublicTVItem[];

    it("returns all 20 items when window covers fixture dates", () => {
        expect(items.length).toBe(20);
    });

    it("every item has title, url (publictv.in), IST YYYY-MM-DD date, excerpt", () => {
        for (const item of items) {
            expect(item.title.length).toBeGreaterThan(0);
            expect(item.url).toMatch(/^https:\/\/publictv\.in\//);
            expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(item.excerpt.length).toBeGreaterThan(0);
        }
    });

    it("every emitted item has a date in (today, yesterday) IST", () => {
        for (const item of items) {
            expect(["2026-04-23", "2026-04-22"]).toContain(item.date);
        }
    });

    it("date filter drops items outside window", () => {
        const filtered = runScript("publictv.py", resolve(FIXTURES, "publictv-posts.json"), {
            NEWS_TODAY_OVERRIDE: "2026-04-24",
        }) as PublicTVItem[];
        // window = {2026-04-24, 2026-04-23} → only the 5 from 2026-04-23
        expect(filtered.length).toBe(5);
        for (const item of filtered) expect(item.date).toBe("2026-04-23");
    });

    it("date filter returns empty when TODAY is far ahead", () => {
        const empty = runScript("publictv.py", resolve(FIXTURES, "publictv-posts.json"), {
            NEWS_TODAY_OVERRIDE: "2026-04-30",
        }) as PublicTVItem[];
        expect(empty.length).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify FAIL (script doesn't exist yet)**

Run: `npx vitest run test/news/bengaluru-scrapers.test.ts`
Expected: FAIL with Python error (script not found).

- [ ] **Step 3: Implement `scripts/news/bengaluru/publictv.py`**

```python
#!/usr/bin/env python3
"""PublicTV (Bengaluru) listing mirror — 1:1 with memory/news/bengaluru/playbook-publictv.md.

Reads the WordPress REST API JSON response from stdin, filters to today+yesterday
IST, emits a JSON array to stdout. Fields: n, title, url, date (YYYY-MM-DD),
excerpt. Does NOT emit a thumbnail — the listing endpoint doesn't include one;
the playbook extracts og:image from the article URL fallback.

Environment:
  NEWS_TODAY_OVERRIDE  YYYY-MM-DD to pin "today" (test hook; ignored in production
                       where `datetime.now(IST).date()` is used).
"""
import os, sys, json, re, html as htmlmod
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def _today():
    override = os.environ.get("NEWS_TODAY_OVERRIDE")
    if override:
        return datetime.strptime(override, "%Y-%m-%d").date()
    return datetime.now(IST).date()


def clean_html(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s)
    return htmlmod.unescape(s.strip())


def story_date(post):
    # post["date"] is naive IST (verified: diff to date_gmt is exactly +5:30).
    raw = post.get("date", "")
    try:
        return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%S").date()
    except Exception:
        return None


def main():
    today = _today()
    yesterday = today - timedelta(days=1)
    window = {today, yesterday}

    data = json.load(sys.stdin)
    kept = []
    for post in data:
        d = story_date(post)
        if d not in window:
            continue
        kept.append((post, d))

    out = []
    for i, (post, d) in enumerate(kept, 1):
        out.append({
            "n": i,
            "title": clean_html(post["title"]["rendered"]),
            "url": post["link"],
            "date": d.strftime("%Y-%m-%d"),
            "excerpt": clean_html(post["excerpt"]["rendered"])[:300],
        })
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
```

Make executable: `chmod +x scripts/news/bengaluru/publictv.py`

- [ ] **Step 4: Run test to verify PASS**

Run: `npx vitest run test/news/bengaluru-scrapers.test.ts`
Expected: all PublicTV tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/news/bengaluru/publictv.py test/news/bengaluru-scrapers.test.ts test/fixtures/news/bengaluru/publictv-posts.json
git commit -m "feat(news): add bengaluru publictv mirror script + test"
```

---

## Task 4: TV9 Kannada mirror script + test

**Files:**
- Create: `scripts/news/bengaluru/tv9kannada.py`
- Modify: `test/news/bengaluru-scrapers.test.ts` (add describe block)

- [ ] **Step 1: Append failing TV9 test**

Append to `test/news/bengaluru-scrapers.test.ts`:

```ts
interface TV9Item {
    n: number;
    title: string;
    url: string;
    date: string;
    cats: string[];
    desc: string;
    thumb: string;
}

describe("Bengaluru scrapers — TV9 Kannada", () => {
    // Fixture distribution: 6 × 2026-04-23 IST + 25 × 2026-04-22 + 27 × 2026-04-21 + 2 × 2026-04-20.
    // TODAY=2026-04-23 → window = {2026-04-23, 2026-04-22} → 31 items kept.
    const items = runScript("tv9kannada.py", resolve(FIXTURES, "tv9kannada-feed.xml"), {
        NEWS_TODAY_OVERRIDE: "2026-04-23",
    }) as TV9Item[];

    it("returns at least 20 items in today+yesterday window", () => {
        expect(items.length).toBeGreaterThanOrEqual(20);
    });

    it("every item has title, url (tv9kannada), IST YYYY-MM-DD date", () => {
        for (const item of items) {
            expect(item.title.length).toBeGreaterThan(0);
            expect(item.url).toMatch(/^https?:\/\/(www\.)?tv9kannada\.com\//);
            expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("every item has at least one category tag", () => {
        for (const item of items) {
            expect(item.cats.length).toBeGreaterThan(0);
        }
    });

    it("every emitted item has a date in (today, yesterday) IST", () => {
        for (const item of items) {
            expect(["2026-04-23", "2026-04-22"]).toContain(item.date);
        }
    });

    it("date filter drops out-of-window items", () => {
        // TODAY=2026-04-21 → window = {2026-04-21, 2026-04-20} → 29 kept
        const filtered = runScript("tv9kannada.py", resolve(FIXTURES, "tv9kannada-feed.xml"), {
            NEWS_TODAY_OVERRIDE: "2026-04-21",
        }) as TV9Item[];
        expect(filtered.length).toBe(29);
        for (const item of filtered) expect(["2026-04-21", "2026-04-20"]).toContain(item.date);
    });

    it("date filter returns empty when TODAY is far ahead", () => {
        const empty = runScript("tv9kannada.py", resolve(FIXTURES, "tv9kannada-feed.xml"), {
            NEWS_TODAY_OVERRIDE: "2026-05-01",
        }) as TV9Item[];
        expect(empty.length).toBe(0);
    });
});
```

- [ ] **Step 2: Run to verify TV9 tests FAIL**

Run: `npx vitest run test/news/bengaluru-scrapers.test.ts`
Expected: PublicTV tests pass (Task 3); TV9 tests fail.

- [ ] **Step 3: Implement `scripts/news/bengaluru/tv9kannada.py`**

```python
#!/usr/bin/env python3
"""TV9 Kannada (Bengaluru) RSS mirror — 1:1 with memory/news/bengaluru/playbook-tv9kannada.md.

Reads the raw RSS feed from stdin, filters to today+yesterday IST, emits a JSON
array to stdout. Fields: n, title, url, date (YYYY-MM-DD), cats, desc, thumb.

Environment:
  NEWS_TODAY_OVERRIDE  YYYY-MM-DD to pin "today" (test hook).
"""
import os, sys, re, json
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def _today():
    override = os.environ.get("NEWS_TODAY_OVERRIDE")
    if override:
        return datetime.strptime(override, "%Y-%m-%d").date()
    return datetime.now(IST).date()


def clean(s):
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s, flags=re.DOTALL)
    s = re.sub(r"<[^>]+>", "", s)
    return s.strip()


def story_date(item):
    m = re.search(r"<pubDate>(.*?)</pubDate>", item, re.DOTALL)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1).strip(), "%a, %d %b %Y %H:%M:%S %z").astimezone(IST).date()
    except Exception:
        return None


def thumb_of(item):
    # Prefer media:content / enclosure; fall back to first <img src=...>.
    m = re.search(r'url="(https?://[^"]+)"', item)
    if m:
        return m.group(1)
    m = re.search(r'<img[^>]+src="(https?://[^"]+)"', item)
    return m.group(1) if m else ""


def main():
    today = _today()
    yesterday = today - timedelta(days=1)
    window = {today, yesterday}

    data = sys.stdin.read()
    # Strip content:encoded first (cuts feed size ~90%).
    data = re.sub(r"<content:encoded>.*?</content:encoded>", "", data, flags=re.DOTALL)
    items = re.findall(r"<item>(.*?)</item>", data, flags=re.DOTALL)
    items = [it for it in items if story_date(it) in window]

    out = []
    for i, item in enumerate(items, 1):
        title = re.search(r"<title>(.*?)</title>", item, re.DOTALL)
        link = re.search(r"<link>(.*?)</link>", item, re.DOTALL)
        desc = re.search(r"<description>(.*?)</description>", item, re.DOTALL)
        cats = re.findall(r"<category><!\[CDATA\[(.*?)\]\]></category>", item)
        d = story_date(item)
        out.append({
            "n": i,
            "title": clean(title.group(1)) if title else "",
            "url": (link.group(1).strip() if link else ""),
            "date": d.strftime("%Y-%m-%d") if d else "",
            "cats": cats,
            "desc": clean(desc.group(1))[:300] if desc else "",
            "thumb": thumb_of(item),
        })
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
```

Make executable: `chmod +x scripts/news/bengaluru/tv9kannada.py`

- [ ] **Step 4: Run test to verify PASS**

Run: `npx vitest run test/news/bengaluru-scrapers.test.ts`
Expected: all tests pass (PublicTV + TV9).

- [ ] **Step 5: Commit**

```bash
git add scripts/news/bengaluru/tv9kannada.py test/news/bengaluru-scrapers.test.ts test/fixtures/news/bengaluru/tv9kannada-feed.xml
git commit -m "feat(news): add bengaluru tv9kannada mirror script + test"
```

---

## Task 5: Update PublicTV playbook

**Files:**
- Modify: `memory/news/bengaluru/playbook-publictv.md` (listing snippet only; preserve everything else)

- [ ] **Step 1: Edit the listing heredoc**

Replace the existing listing curl heredoc (lines 5-26) with a version that adds today+yesterday IST window filter and emits `DATE: YYYY-MM-DD`. Keep the `_fields` list identical. Preserve the heading, the "Why" paragraph, and all sections below.

New snippet:

````markdown
**Listing (today + yesterday IST window):**
```
curl -s "https://publictv.in/wp-json/wp/v2/posts?categories=255&per_page=20&_fields=id,title,excerpt,link,date" | python3 -c "
import sys, json, re, html
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()
yesterday = today - timedelta(days=1)
window = {today, yesterday}

def clean_html(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\s+', ' ', s)
    return html.unescape(s.strip())

def story_date(p):
    try: return datetime.strptime(p.get('date',''), '%Y-%m-%dT%H:%M:%S').date()
    except: return None

data = json.load(sys.stdin)
data = [p for p in data if story_date(p) in window]
for i, post in enumerate(data, 1):
    d = story_date(post)
    print(f'=== STORY {i} ===')
    print(f'ID: {post[\"id\"]}')
    print(f'DATE: {d.strftime(\"%Y-%m-%d\")}')
    print(f'LINK: {post[\"link\"]}')
    print(f'TITLE: {clean_html(post[\"title\"][\"rendered\"])}')
    print(f'EXCERPT: {clean_html(post[\"excerpt\"][\"rendered\"])[:300]}')
    print()
"
```
**Why:** The raw JSON response is ~53KB even without `featured_media` and overflows tool buffers (observed 2026-04-10). Pipe through Python immediately — do not fetch and then parse separately. Do NOT include `featured_media` in `_fields`; it inflates further and is not needed at listing stage.

**Why the date filter:** The listing routinely spans into prior days (see Known Quirks), and the agent used to see ~20 items spanning 2-3 days. Filtering to today+yesterday in-python (by parsing `post.date` as naive IST — verified: `date_gmt` is exactly +5:30 from `date`) trims the payload and prevents multi-day noise from drifting into phase-2. The normalized `DATE: YYYY-MM-DD` line lets the phase-1 agent copy the date verbatim into each story's `**Date:**` field.
````

Preserve everything below the snippet (Full article by ID, fallback, content extraction, quirks, Known Quirks) byte-for-byte.

- [ ] **Step 2: Manually verify no unintended changes**

Run: `git diff memory/news/bengaluru/playbook-publictv.md`
Expected: diff is limited to the listing snippet and the new "Why the date filter" paragraph. Confirm no other section was touched.

- [ ] **Step 3: Commit**

```bash
git add memory/news/bengaluru/playbook-publictv.md
git commit -m "feat(news): add today+yesterday IST filter to publictv playbook"
```

---

## Task 6: Update TV9 Kannada playbook

**Files:**
- Modify: `memory/news/bengaluru/playbook-tv9kannada.md` (listing snippet only; preserve everything else)

- [ ] **Step 1: Edit the listing heredoc**

Replace the listing heredoc (lines 5-31). Key changes:
- Add today+yesterday IST window filter (parse pubDate, compare).
- Remove `[:20]` slice (filter replaces cap).
- Emit `DATE: {d.strftime('%Y-%m-%d')}` (normalized) instead of raw RFC822.
- Preserve `<content:encoded>` stripping and all field extractions.

New snippet:

````markdown
**Listing (today + yesterday IST window):**
```
curl -s "https://tv9kannada.com/karnataka/bengaluru/feed" | python3 -c "
import sys, re
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()
yesterday = today - timedelta(days=1)
window = {today, yesterday}

def clean(s):
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return s.strip()

def story_date(it):
    m = re.search(r'<pubDate>(.*?)</pubDate>', it, re.DOTALL)
    if not m: return None
    try: return datetime.strptime(m.group(1).strip(), '%a, %d %b %Y %H:%M:%S %z').astimezone(IST).date()
    except: return None

data = sys.stdin.read()
data = re.sub(r'<content:encoded>.*?</content:encoded>', '', data, flags=re.DOTALL)
items_raw = re.findall(r'<item>(.*?)</item>', data, flags=re.DOTALL)
items_raw = [it for it in items_raw if story_date(it) in window]

for i, item in enumerate(items_raw, 1):
    title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
    link  = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    desc  = re.search(r'<description>(.*?)</description>', item, re.DOTALL)
    cats  = re.findall(r'<category><!\[CDATA\[(.*?)\]\]></category>', item)
    d = story_date(item)
    print(f'=== STORY {i} ===')
    print(f'TITLE: {clean(title.group(1)) if title else \"\"}')
    print(f'LINK:  {link.group(1).strip() if link else \"\"}')
    print(f'DATE:  {d.strftime(\"%Y-%m-%d\") if d else \"\"}')
    print(f'CATS:  {\" | \".join(cats)}')
    print(f'DESC:  {clean(desc.group(1))[:300] if desc else \"\"}')
    print()
"
```
**Why:** Printing the cleaned XML is still ~39KB and overflows tool buffers. Extract fields directly in the same Python pass instead.

**Why the date filter:** The feed routinely spans previous days (see Known Quirks — up to 16 items from a prior day observed 2026-04-22). Filtering to today+yesterday in-python trims noise before it reaches phase-2. The normalized `DATE: YYYY-MM-DD` line lets the phase-1 agent copy the date verbatim into each story's `**Date:**` field. The former `[:20]` slice is removed — the date filter is the correct cap.
````

Preserve everything below (Note on HTML entities, Full article content section, Content extraction, fallbacks, RSS fields, Thumbnail, Video articles, Content quirks, Known Quirks) byte-for-byte.

- [ ] **Step 2: Manually verify no unintended changes**

Run: `git diff memory/news/bengaluru/playbook-tv9kannada.md`
Expected: diff limited to listing snippet + the new "Why the date filter" paragraph.

- [ ] **Step 3: Commit**

```bash
git add memory/news/bengaluru/playbook-tv9kannada.md
git commit -m "feat(news): add today+yesterday IST filter to tv9kannada playbook"
```

---

## Task 7: End-to-end verification

**Files:**
- Create: `docs/superpowers/verifications/2026-04-23-bengaluru-cache-and-phase1.md`

- [ ] **Step 1: Clear any stale cache for today**

Run: `rm -rf ~/.cache/news/bengaluru/2026-04-23/` (a fresh cache dir forces a clean run).

- [ ] **Step 2: Start Bengaluru pipeline, logging to a named file**

Run (background, long-running):
```bash
npx tsx src/run-news.ts bengaluru > logs/bengaluru-cache-fix-20260423-run.log 2>&1 &
```
Tail the log via Monitor or a small Bash `tail -f` until "Phase 3 complete".

- [ ] **Step 3: Identify session JSONLs for this run**

Session dir: `~/.claude/projects/-Users-hanif--cache-news-bengaluru-2026-04-23/`
Run: `ls -lt` and note the 11 new files (2 phase-1 + 1 phase-2 + 8 phase-3), ordered by mtime.

- [ ] **Step 4: Run the cache-impact parser**

Adapt the Chennai parser to dump first-call `cache_create` / `cache_read` per phase-3 session:

```bash
python3 << 'PY'
import json, os, glob
from datetime import datetime

DIR = f"{os.path.expanduser('~')}/.claude/projects/-Users-hanif--cache-news-bengaluru-2026-04-23"
# Filter to today's run window (skip yesterday's sessions):
import time
cutoff = time.time() - 3600  # last hour
files = [p for p in sorted(glob.glob(f'{DIR}/*.jsonl'), key=lambda p: os.path.getmtime(p)) if os.path.getmtime(p) > cutoff]

for p in files:
    mt = datetime.fromtimestamp(os.path.getmtime(p)).strftime('%H:%M:%S')
    for line in open(p):
        try: obj = json.loads(line)
        except: continue
        if obj.get('type') != 'assistant': continue
        usage = obj.get('message', {}).get('usage', {})
        if not usage: continue
        cc = usage.get('cache_creation_input_tokens', 0)
        cr = usage.get('cache_read_input_tokens', 0)
        print(f"{mt}  {os.path.basename(p)[:8]}  cache_create={cc:6d}  cache_read={cr:6d}")
        break
PY
```

**Success criterion:** at least 4 of the 8 phase-3 sessions show `cache_create` ≤ 2000 AND `cache_read` ≥ 18000 (meaning the playbook is being read from cache, not re-created).

- [ ] **Step 5: Compute phase-1 effective token totals**

Parse the two phase-1 JSONLs; compute `eff = input + cache_creation + 0.1 * cache_read + output` deduped by request_id. Document vs pre-change baseline.

**Success criterion:** combined phase-1 effective tokens show ≥30% reduction vs the most recent pre-change Bengaluru baseline (use the morning's session JSONLs from `~/.claude/projects/-Users-hanif--cache-news-bengaluru-2026-04-23/` filtered to this morning's window if still present, or from the equivalent directory for the run).

- [ ] **Step 6: A/B quality vs morning baseline**

Dump new run's rows:
```bash
npx tsx scripts/dump-bengaluru-news.ts > /tmp/bengaluru-new.json
```

Compare side-by-side with `docs/superpowers/verifications/artifacts/bengaluru-baseline-2026-04-23.json`:
- Source-mix balance (cross vs single)
- Headline English fluency (no Kannada leakage)
- Category sensibility (English enums)
- Body length distribution, thumbnail coverage
- Any story meaning-drift

**Success criterion:** no regression; ideally equal or improved vs baseline.

- [ ] **Step 7: Confirm post-write date validation didn't fire**

Run: `grep -i "phase 1 date validation" logs/bengaluru-cache-fix-20260423-run.log`
Expected: "Phase 1 date validation passed" for both sources; zero "Phase 1 repair turn" or similar retry markers.

- [ ] **Step 8: Write verification note**

Create `docs/superpowers/verifications/2026-04-23-bengaluru-cache-and-phase1.md` mirroring the Chennai verification-note structure, with the actual numbers and A/B notes.

- [ ] **Step 9: Commit verification**

```bash
git add docs/superpowers/verifications/2026-04-23-bengaluru-cache-and-phase1.md
git commit -m "docs: bengaluru phase-1 + cache-fix verification"
```

---

## Self-Review Checklist

After completing all tasks:

1. **Spec coverage:** Every section of the design spec (Part A SDK, Part B Bengaluru, Verification) has at least one task that implements it. ✓
2. **Placeholder scan:** grep the plan for "TBD", "TODO", "similar to Task", "add appropriate" — none present. ✓
3. **Type consistency:** `excludeDynamicSections` spelled identically in all mentions; playbook heading "Listing (today + yesterday IST window):" identical across both Bengaluru files; both mirror scripts emit `date` (string, YYYY-MM-DD) field; test helper `runScript` signature matches the Chennai file.
4. **Decision gates honored:** Task 7 explicitly states success criteria and references the spec's decision gates. Failure modes (cache regression, validation firing, quality regression) are explicitly called out.

## Execution Notes

- Prefer **subagent-driven-development**: fresh subagent per task + two-stage review (spec compliance + code quality).
- Task 7 (verification) must stay in the main session — the pipeline run is long-running, and the cache-impact parser needs live state.
- The `feat/chennai` branch is shared with the Chennai work; after this lands, open a new branch `feat/bengaluru-cache` for the PR OR fold into the Chennai PR depending on review size.
