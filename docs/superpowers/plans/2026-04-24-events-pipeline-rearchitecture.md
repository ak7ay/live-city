# Events Pipeline Rearchitecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move enrichment from per-source scrape+enrich sessions to a single rank+enrich session so every detail-page visit lands in the final output, split each source's playbook into listing + enrichment halves, and add a detail-page `/nmcms/` image fallback that raises BMS image coverage from ~29% to ≥95%.

**Architecture:** New phase layout — `Phase 1 News` (unchanged plain session) → `Phase 2a BMS listing-only` (browser) → `Phase 2b District listing-only` (browser) → `Phase 3 Rank + enrich` (browser, loads both enrichment playbooks). All static prompt content (steps, reuse policy, output schema) moves from user prompt to system prompt per phase. Validation hooks and a universal "feedback-edit bar" prevent playbook bloat.

**Tech Stack:** TypeScript, Zod v4, vitest, `@anthropic-ai/claude-agent-sdk` (via `src/agent/index.ts`).

**Spec:** `docs/superpowers/specs/2026-04-24-events-pipeline-rearchitecture-design.md`

---

## File Map

New files:
- `memory/events/bookmyshow/listing.md` — BMS listing extraction playbook
- `memory/events/bookmyshow/enrichment.md` — BMS detail-page enrichment playbook (includes `/nmcms/` fallback)
- `memory/events/district/listing.md` — District listing extraction playbook
- `memory/events/district/enrichment.md` — District detail-page enrichment playbook
- `memory/events/tooling-fallback.md` — Chrome 147 CDP fallback, tab-cleanup fix (shared)
- `test/events/listing-candidate-schema.test.ts` — ListingCandidate schema tests
- `test/events/validators.test.ts` — Phase-specific validator tests

Modified:
- `memory/events/playbook-bookmyshow.md` — deleted after split (Task 3)
- `memory/events/playbook-district.md` — deleted after split (Task 4)
- `src/events/schema.ts` — add `ListingCandidate` type + schema
- `src/events/agent.ts` — swap per-source scrape+enrich for listing-only + combined rank+enrich; new prompt builders; new validators; new feedback scopes; delete superseded code

Unchanged:
- `src/events/store.ts`
- `src/extractor/events-updater.ts`
- `src/run-events.ts`
- `src/events/schema.ts` types `RawEvent`, `EnrichedEvent`, `EventArticle` (kept — still used by news carryover path and Appwrite storage)

---

## Task 1: Ship the `/nmcms/` image fallback in the current architecture

**Goal:** Ship visible image-coverage improvement before the rearchitecture. This is the rollout step 1 from the spec — independent and low-risk. The same fallback logic moves to the new `bookmyshow/enrichment.md` in Task 3.

**Files:**
- Modify: `memory/events/playbook-bookmyshow.md`

- [ ] **Step 1: Read the current Step 2 eval in the playbook**

Run: `sed -n '94,125p' memory/events/playbook-bookmyshow.md`

Expected: shows the current `browser-eval` script that returns `{title, url, full_date, range_start, time, duration, venue_full, description}`.

- [ ] **Step 2: Add `banner_image` field to the Step 2 eval**

In `memory/events/playbook-bookmyshow.md`, locate the Step 2 `browser-eval` script (starts with `(function() { var text = document.body.innerText;`). Inside the returned object, add `banner_image` as a new field between `venue_full` and `description`:

```js
banner_image: Array.from(document.querySelectorAll("img")).map(function(i){return i.src;}).find(function(s){return s && s.indexOf("/nmcms/") >= 0 && s.indexOf("/synopsis/") < 0;}) || null,
```

The full updated return expression should be:
```js
return JSON.stringify({
  title: document.querySelector("h1") ? document.querySelector("h1").innerText : null,
  url: window.location.href,
  full_date: info ? info[1] : null,
  range_start: (!info && rangeMatch) ? rangeMatch[1] : null,
  time: info ? info[2] : null,
  duration: info ? info[3] : null,
  venue_full: venue ? venue[1].trim() : null,
  banner_image: Array.from(document.querySelectorAll("img")).map(function(i){return i.src;}).find(function(s){return s && s.indexOf("/nmcms/") >= 0 && s.indexOf("/synopsis/") < 0;}) || null,
  description: desc.slice(0, 500)
}, null, 2);
```

- [ ] **Step 3: Add an image-fallback rule right above Step 2**

In the same file, locate the `## Step 2: Enrich top events from detail pages` heading. Directly **before** it (after the `---` separator that ends Step 1), insert a new subsection:

```markdown
### Image fallback rule

When composing the final event JSON, set `image_url` as follows:

1. If the listing card's `image` was non-null, use it.
2. Otherwise use `banner_image` from the Step 2 eval output (see below).
3. Otherwise `null`.

The listing image is often null for small/recurring events (lazy-loaded placeholder cards), but the detail page carries a banner under `assets-in.bmscdn.com/.../nmcms/…` — the Step 2 eval extracts this as `banner_image`.

---
```

- [ ] **Step 4: Run checks**

Run: `npx biome check --write memory/events/playbook-bookmyshow.md` then `npm run check`

Expected: PASS (Markdown edits don't affect TS, but the full suite should still be green).

- [ ] **Step 5: Commit**

```bash
git add memory/events/playbook-bookmyshow.md
git commit -m "feat(events): add /nmcms/ detail-page image fallback to BMS playbook

Listing cards render without an <img src> for ~70% of BMS events
(lazy-load placeholder with empty src). The detail page carries a
banner under assets-in.bmscdn.com/.../nmcms/... reliably; add a
Step-2 eval field banner_image that finds it, plus a fallback rule
that uses it when the listing image is null. Expected: BMS image
coverage rises from ~29% to ~100%."
```

---

## Task 2: Add `ListingCandidate` schema + tests

**Files:**
- Modify: `src/events/schema.ts`
- Create: `test/events/listing-candidate-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/events/listing-candidate-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { type ListingCandidate, listingCandidateSchema, listingCandidatesSchema } from "../../src/events/schema.js";

function makeCandidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
	return {
		source: "bookmyshow",
		title: "Kanan Gill Live",
		source_url: "https://in.bookmyshow.com/events/kanan-gill-live/ET00412345",
		image_url: "https://assets-in.bmscdn.com/discovery-catalog/events/tr:/et00412345-portrait.jpg",
		listing_date: "Sat, 25 Apr 2026",
		venue_line: "Phoenix Marketcity: Bengaluru",
		category: "Stand up Comedy",
		price: "₹ 499 onwards",
		...overrides,
	};
}

describe("listingCandidateSchema", () => {
	it("accepts a valid candidate", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate()).success).toBe(true);
	});

	it("accepts district source", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate({ source: "district" })).success).toBe(true);
	});

	it("rejects news source (listings are ticketed-only)", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate({ source: "news" as any })).success).toBe(false);
	});

	it("accepts nullable fields as null", () => {
		const result = listingCandidateSchema.safeParse(
			makeCandidate({
				image_url: null,
				listing_date: null,
				venue_line: null,
				category: null,
				price: null,
			}),
		);
		expect(result.success).toBe(true);
	});

	it("rejects empty title", () => {
		expect(listingCandidateSchema.safeParse(makeCandidate({ title: "" })).success).toBe(false);
	});

	it("rejects missing source_url", () => {
		const c = makeCandidate();
		delete (c as any).source_url;
		expect(listingCandidateSchema.safeParse(c).success).toBe(false);
	});
});

describe("listingCandidatesSchema", () => {
	it("accepts an array of candidates", () => {
		expect(listingCandidatesSchema.safeParse([makeCandidate(), makeCandidate({ title: "Another" })]).success).toBe(true);
	});

	it("accepts an empty array (validation of count lives in validators, not schema)", () => {
		expect(listingCandidatesSchema.safeParse([]).success).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/events/listing-candidate-schema.test.ts`

Expected: FAIL — `listingCandidateSchema` does not exist yet.

- [ ] **Step 3: Add the schema**

In `src/events/schema.ts`, after the `EnrichedEvent` block (around line 42) and before the `EventArticle` block, insert:

```typescript
// ── Listing candidates (Phase 2a/2b output; Phase 3 input) ───────────

export const listingCandidateSchema = z.object({
	source: z.enum(["bookmyshow", "district"]),
	title: z.string().min(1).max(512),
	source_url: z.string().min(1),
	image_url: z.string().nullable(),
	listing_date: z.string().nullable(),
	venue_line: z.string().nullable(),
	category: z.string().nullable(),
	price: z.string().nullable(),
});

export const listingCandidatesSchema = z.array(listingCandidateSchema);

export type ListingCandidate = z.infer<typeof listingCandidateSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/events/listing-candidate-schema.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Run the full check**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/events/schema.ts test/events/listing-candidate-schema.test.ts
git commit -m "feat(events): add ListingCandidate schema for Phase 2a/2b output

Phase 2a (BMS) and 2b (District) will return listing-only candidates
without detail-page enrichment. Phase 3 consumes them and enriches
only the ranker-selected subset."
```

---

## Task 3: Split BMS playbook into listing + enrichment halves

**Goal:** Pure reorganization — no code change. Apply the cleanup rubric from the spec while splitting.

**Files:**
- Create: `memory/events/bookmyshow/listing.md`
- Create: `memory/events/bookmyshow/enrichment.md`
- Create: `memory/events/tooling-fallback.md` (shared with District)
- Delete: `memory/events/playbook-bookmyshow.md`
- Modify: `src/events/agent.ts` — update `readPlaybook` calls to load both halves (transitional; full phase refactor in later tasks)

- [ ] **Step 1: Create `memory/events/bookmyshow/listing.md`**

```markdown
# BookMyShow Events — Listing Playbook

Requires the **browser-tools** skill for browser automation.

## City

The city slug will be provided (e.g., `bengaluru`, `mumbai`, `hyderabad`).

URL pattern: `https://in.bookmyshow.com/explore/events-{city_slug}`

For this-week-only runs, append the daygroup filter:
`https://in.bookmyshow.com/explore/events-{city_slug}?daygroups=today|tomorrow|this-weekend`

The page heading becomes "Events happening This Weekend" and the card set narrows to dates in that window.

---

## Step 1: Extract listing

Navigate to the listing page and wait for content:

```bash
browser-nav "https://in.bookmyshow.com/explore/events-{city_slug}?daygroups=today|tomorrow|this-weekend"
sleep 4
```

Extract all visible event cards in a single call:

```bash
browser-eval '(function() {
  var cards = document.querySelectorAll("a[href*=\"/events/\"][href*=\"/ET\"]");
  var events = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var img = card.querySelector("img");
    var lines = card.innerText.trim().split("\n").filter(function(l) { return l.trim(); });
    var dateStr = null;
    if (img && img.src) {
      var m = img.src.match(/ie-([A-Za-z0-9+/=_%]+)/);
      if (m) {
        try { dateStr = atob(decodeURIComponent(m[1])); } catch(e) {}
      }
    }
    if (lines.length >= 3) {
      events.push({
        title: lines[0],
        venue: lines[1],
        category: lines[2],
        price: lines[3] || null,
        date: dateStr,
        url: card.href,
        image: img && img.src ? img.src : null
      });
    }
  }
  return JSON.stringify(events, null, 2);
})()'
```

**Then scroll to the bottom and re-extract** — scroll can trigger lazy-loading of additional cards. Deduplicate by URL before returning:

```bash
browser-eval 'window.scrollTo(0, document.body.scrollHeight)'
sleep 3
# run the same browser-eval extraction script again
```

Note: scroll does not reliably produce a different set of events. In some runs the second extraction is identical to the first — that's fine, just deduplicate by URL. The listing order can also change between extractions.

**If the scroll re-extract returns `[]`**, the BMS SPA has auto-routed the listing page away. Don't retry the scroll — just proceed with the first extraction.

---

## Quirks (listing-only)

- **Cloudflare blocks curl/fetch** — MUST use browser tools for listing navigation.
- **PROMOTED events appear first** — paid placements but real events. Include them.
- **Listing date is partial** — no year, no time. Use the `ie-` ImageKit decode path as shown; null is acceptable.
- **Many cards render with empty `<img src>`** — a lazy-load placeholder pattern (opacity:0, no data-src, no srcset). Forcing viewport via `scrollIntoView` does not reliably trigger src population. Return `image: null` for those — enrichment.md will recover the image from the detail page `/nmcms/` banner.
- **"X Apr onwards"** in the listing date means a recurring/multi-slot event. Keep the listing as-is; the detail page (in enrichment.md) resolves the next available date.
- **Image URLs (when present) contain ImageKit transforms** with the date baked in via `ie-` base64. Use as-is.

## Tooling fallback

When `browser-eval.js` times out (e.g., Chrome/puppeteer version mismatch), see `memory/events/tooling-fallback.md` for the Python CDP-WebSocket alternative.
```

- [ ] **Step 2: Create `memory/events/bookmyshow/enrichment.md`**

```markdown
# BookMyShow Events — Enrichment Playbook

Requires the **browser-tools** skill for browser automation.

## Image fallback rule

When composing the final event JSON, set `image_url` as follows:

1. If the listing candidate's `image_url` was non-null, use it.
2. Otherwise use `banner_image` from the detail page eval output (see Step 1).
3. Otherwise `null`.

---

## Step 1: Enrich top events from detail pages

For each event you want to include, visit its URL and extract detail fields.

Navigate and extract in a **single chained bash command** — BMS SPA auto-routes to recommended events after ~4–5 seconds. `sleep 1` is sufficient and safer than `sleep 3`.

**CRITICAL: Keep only ONE tab open during all detail visits.** When multiple tabs are open, `browser-eval` runs in an unpredictable tab. Before starting detail visits, close all extras:
```bash
curl -s http://localhost:9222/json | python3 -c "
import json,sys,urllib.request
tabs=[t for t in json.load(sys.stdin) if t.get('type')=='page']
[urllib.request.urlopen(f'http://localhost:9222/json/close/{t[\"id\"]}') for t in tabs[1:]]
print('Kept:', tabs[0]['id'])
"
```

Then for each detail page (single tab only):
```bash
browser-nav "{event_url}" && sleep 1 && browser-eval '...'
```

Always include `title` and `url` in the eval output to verify you landed on the right page. If the URL or title doesn't match, **retry once** with `sleep 1`; on a second redirect, try `sleep 2`. Only skip after two failed attempts. Consecutive retries can redirect to different events — this is normal SPA behavior.

Extract structured data (note: `banner_image` is the `/nmcms/` fallback from the image rule above):
```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
  var ai = text.indexOf("About The Event");
  if (ai >= 0) {
    var sentinels = ["Read More", "See More", "Global Event", "Artists", "Terms & Conditions", "You May Also Like"];
    var end = -1;
    for (var s = 0; s < sentinels.length; s++) {
      var si = text.indexOf(sentinels[s], ai + 15);
      if (si > ai && (end < 0 || si < end)) end = si;
    }
    if (end < 0) end = ai + 1000;
    desc = text.slice(ai + 15, end).replace(/\n{3,}/g, "\n\n").trim();
  }
  var info = text.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4})\n(\d{1,2}:\d{2}\s*[AP]M)\n([\d]+\s+\w+)/);
  var rangeMatch = text.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4})\s*-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4}/);
  var venue = text.match(/(?:Hours?|yrs[+ ]*)\n(?:.*\n){0,3}?([^:\n]+:\s*[^\n]+)\n/);
  return JSON.stringify({
    title: document.querySelector("h1") ? document.querySelector("h1").innerText : null,
    url: window.location.href,
    full_date: info ? info[1] : null,
    range_start: (!info && rangeMatch) ? rangeMatch[1] : null,
    time: info ? info[2] : null,
    duration: info ? info[3] : null,
    venue_full: venue ? venue[1].trim() : null,
    banner_image: Array.from(document.querySelectorAll("img")).map(function(i){return i.src;}).find(function(s){return s && s.indexOf("/nmcms/") >= 0 && s.indexOf("/synopsis/") < 0;}) || null,
    description: desc.slice(0, 500)
  }, null, 2);
})()'
```

---

## Parsing venue

The `venue_full` string is formatted as:
```
Venue Name: City
Venue Name: Area, City
Venue Name, Area: City
```

Split on the LAST `: ` to get:
- **venue_name** — everything before the last `: `
- **venue_area** — everything after

Examples:
- `"NICE Grounds: Bengaluru"` → name: `NICE Grounds`, area: `Bengaluru`
- `"MLR Convention Centre: Whitefield, Bengaluru"` → name: `MLR Convention Centre`, area: `Whitefield, Bengaluru`

Edge cases:
- **Null `venue_full`** — fall back to the listing candidate's `venue_line` (always populated).
- **No colon separator** — `venue_name` = full string, `venue_area` = null.
- **Colon without space** — split on the last bare `:` instead.
- **Trailing period** — strip trailing `.` from both fields after splitting.

---

## Date authority rules

- **Detail page date is authoritative** — listing dates frequently diverge for any recurring event (club nights, DJ nights, workshop series, comedy tours, PROMOTED cards).
- Prefer `full_date`; if null, use `range_start`; if both null and the listing date is a hard date (no "onwards", not null), use the listing date.
- **Recurring weekly events** may return null for both detail-page dates — fall back to the listing date.
- **Multi-batch programme events** embed dates in the description prose (e.g. `"I Batch: April 28 to May 02, 2026"`); fall back to the listing date.
- **`event_date` must be a non-empty string** — if no date resolves, drop the event and substitute the next candidate from the remaining listing pool.
- **Skip out-of-window candidates without visiting the detail** — if the listing shows a hard date (no "onwards") beyond your window, skip the detail visit entirely.

---

## Regex output sanity checks

- **Duration** — `([\d]+\s+\w+)` sometimes matches non-duration text. If `duration` looks implausible (under 30 minutes for a concert or club event), discard it and set to null.
- **Time** — sometimes captures UI clock values. Discard times with implausible non-round minutes (`:02`, `:06`, `:08`, `:09`) for workshop events; set to null.
- **Description bleed** — short descriptions without a "Read More" sentinel may run into boilerplate ("Artists", "Terms & Conditions", "You May Also Like"). The script's sentinel list handles this.

---

## Quirks (enrichment-only)

- **SPA auto-reroute** on detail pages to recommended events after ~4–5 seconds. Chain `nav && sleep 1 && eval`; never run them with `sleep 5+` between.
- **Wrong-page redirects are often timing, not permanent** — retry the same URL once; usually succeeds on the second attempt.
- **External partner redirects** — some events (e.g., Swiftchella) open on `district.in` instead. If `window.location.href` no longer contains `bookmyshow.com`, skip and substitute.

## Tooling fallback

When `browser-eval.js` or `browser-nav.js` times out (puppeteer ↔ Chrome version mismatch), see `memory/events/tooling-fallback.md`.
```

- [ ] **Step 3: Create `memory/events/tooling-fallback.md`**

```markdown
# Browser Tooling Fallback

Shared fallback for both events playbooks when the `browser-tools` skill's Node scripts fail.

## When `browser-eval.js` / `browser-nav.js` time out

Observed with Chrome 147+ where `puppeteer-core` fails to connect. Error looks like: `Could not connect to browser: timeout`.

Fall back to Python + raw Chrome DevTools Protocol over a WebSocket, keeping one connection open across nav + multiple evals for efficiency:

```python
import asyncio, json, urllib.request
import websockets

async def cdp_eval(ws, expr, msg_id):
    await ws.send(json.dumps({"id": msg_id, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    for _ in range(60):
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if msg.get('id') == msg_id:
                return msg.get('result', {}).get('result', {}).get('value')
        except asyncio.TimeoutError:
            break
    return None

async def main():
    tabs = json.loads(urllib.request.urlopen('http://localhost:9222/json').read())
    page = next(t for t in tabs if t.get('type') == 'page')
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=10*1024*1024) as ws:
        await ws.send(json.dumps({"id": 0, "method": "Page.enable"}))
        _ = await asyncio.wait_for(ws.recv(), timeout=5)
        await ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
        await asyncio.sleep(1)
        while True:
            try: await asyncio.wait_for(ws.recv(), timeout=0.3)
            except: break
        result = await cdp_eval(ws, js_code, msg_id=2)

asyncio.run(main())
```

Both `browser-nav.js` and `browser-eval.js` share the same puppeteer connection, so if one times out, both do — switch to Python CDP for the entire session.

## When Chrome has no open page tab

If `browser-nav` fails with `Cannot read properties of undefined (reading 'goto')`, Chrome is running but only has extension background pages. Open a blank tab:

```bash
curl -X PUT http://localhost:9222/json/new
```

Then retry `browser-nav`.
```

- [ ] **Step 4: Delete old BMS playbook**

Run: `git rm memory/events/playbook-bookmyshow.md`

- [ ] **Step 5: Update `readPlaybook` calls in `src/events/agent.ts` (transitional)**

In `src/events/agent.ts`, update the `EVENT_SOURCES` entry for BMS to point at the new files. This keeps the current scrape+enrich flow working until Task 5 replaces it.

Replace the old `EVENT_SOURCES[0].playbookFile = "playbook-bookmyshow.md"` with a function that concatenates both halves. Update the `readPlaybook` helper at line 85 to accept a list:

```ts
function readPlaybook(cwd: string, names: string | string[]): string {
	const list = Array.isArray(names) ? names : [names];
	return list.map((n) => readFileSync(join(cwd, "memory", "events", n), "utf-8")).join("\n\n---\n\n");
}
```

Change `EVENT_SOURCES[0].playbookFile` in the interface + data:
```ts
interface EventSourceDef {
	key: string;
	label: string;
	playbookFiles: string[];
	buildSystemPrompt: (params: SourcePromptParams) => string;
	buildUserPrompt: (params: SourceUserParams) => string;
}

const EVENT_SOURCES: EventSourceDef[] = [
	{
		key: "bms",
		label: "BMS",
		playbookFiles: ["bookmyshow/listing.md", "bookmyshow/enrichment.md"],
		buildSystemPrompt: bmsSystemPrompt,
		buildUserPrompt: bmsUserPrompt,
	},
	{
		key: "district",
		label: "District",
		playbookFiles: ["playbook-district.md"],  // Task 4 splits this
		buildSystemPrompt: districtSystemPrompt,
		buildUserPrompt: districtUserPrompt,
	},
];
```

In `collectSourceEvents`, change `readPlaybook(cwd, source.playbookFile)` to `readPlaybook(cwd, source.playbookFiles)`.

In the feedback turn inside `collectSourceEvents`, the text `File: memory/events/${source.playbookFile}` becomes:
```ts
File(s): ${source.playbookFiles.map((f) => `memory/events/${f}`).join(", ")}
```

- [ ] **Step 6: Run checks**

Run: `npm run check`

Expected: PASS. TypeScript compiles, biome happy.

- [ ] **Step 7: Commit**

```bash
git add -A memory/events/ src/events/agent.ts
git commit -m "refactor(events): split BMS playbook into listing + enrichment halves

Cleanup and reorganization. Listing concerns (URL, card selector,
scroll behaviour, lazy-load note) move to bookmyshow/listing.md.
Detail-page concerns (SPA reroute, date regex, venue parsing, image
fallback, regex sanity) move to bookmyshow/enrichment.md. The Chrome
147 CDP fallback moves to the shared tooling-fallback.md. Duplicate
and one-off quirks are pruned per the spec's cleanup rubric.

agent.ts is updated transitionally: current scrape+enrich flow still
works, loading both halves concatenated. Phase split follows in the
next commit series."
```

---

## Task 4: Split District playbook into listing + enrichment halves

**Files:**
- Create: `memory/events/district/listing.md`
- Create: `memory/events/district/enrichment.md`
- Delete: `memory/events/playbook-district.md`
- Modify: `src/events/agent.ts` — update District `playbookFiles` entry

- [ ] **Step 1: Create `memory/events/district/listing.md`**

```markdown
# District.in Events — Listing Playbook

Requires the **browser-tools** skill for browser automation.

## City Setup

District.in uses a cookie to determine the city. You must set it before navigating.

### City Config

| city_slug | city_name | lat | long |
|-----------|-----------|-----|------|
| bengaluru | Bangalore | 12.9716 | 77.5946 |
| mumbai | Mumbai | 19.0760 | 72.8777 |
| delhi | Delhi | 28.6139 | 77.2090 |
| hyderabad | Hyderabad | 17.3850 | 78.4867 |
| chennai | Chennai | 13.0827 | 80.2707 |
| pune | Pune | 18.5204 | 73.8567 |
| kolkata | Kolkata | 22.5726 | 88.3639 |

---

## Step 1: Set city cookie and navigate

Navigate to district.in to set the cookie domain context:

```bash
browser-nav "https://www.district.in/events/"
```

Then set the location cookie on **both** domains — `www.district.in` often has a stale Gurugram cookie that overrides `.district.in`:

```bash
browser-eval '(function() {
  var loc = JSON.stringify({
    fullname: "{city_name}, India",
    lat: {lat},
    long: {long},
    subtitle: "India",
    city_name: "{city_name}",
    city_url: "{city_slug}"
  });
  var encoded = encodeURIComponent(loc);
  document.cookie = "location=" + encoded + ";path=/;domain=.district.in;max-age=31536000";
  document.cookie = "location=" + encoded + ";path=/;domain=www.district.in;max-age=31536000";
  return "cookies set for {city_name}";
})()'
```

Then navigate to the events page **without `--new`** — opening in a new tab causes immediate redirects to stale detail pages:

```bash
browser-nav "https://www.district.in/events/"
```

**Do not sleep after this navigation.** District.in auto-redirects away from the listing after a few seconds. Chain navigation and extraction in a single `&&` bash command (see Step 2).

Do NOT trust the top-left header alone for city verification; it can stay on Gurugram even when the target city's listing is loaded. Confirm by checking the first extracted venues.

---

## Step 2: Extract listing

**Do not scroll.** Event cards load without scrolling, and any scroll (including `scrollBy`) navigates away to a detail page.

Chain nav and extraction in one bash command — no sleep between them:

```bash
browser-nav "https://www.district.in/events/" && browser-eval '(function() {
  var links = document.querySelectorAll("a[href*=\"/events/\"][href*=\"buy-tickets\"]");
  var events = [];
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var img = a.querySelector("img");
    var lines = a.innerText.trim().split("\n").filter(function(l) { return l.trim() && l.trim() !== "Book tickets"; });
    if (lines.length >= 3) {
      events.push({
        datetime: lines[0],
        title: lines[1],
        venue: lines[2],
        price: lines[3] || null,
        url: a.href,
        image: img ? img.src : null
      });
    }
  }
  return JSON.stringify(events, null, 2);
})()'
```

### Filter by city

District.in may include events from OTHER cities (e.g., IPL matches in Delhi even on the Bangalore page). Only keep events whose `venue` contains the target city name or nearby areas.

### Dedup

Dedup by `title + datetime + venue`. The featured carousel at the top duplicates main-list events with different URLs.

---

## Quirks (listing-only)

- **Cookie MUST be set before navigation** — without it, District.in defaults to Gurugram/Delhi.
- **No scroll, ever** — `scrollTo`, `scrollBy`, even with pointer events disabled, all redirect to a detail page. Cards render without scroll (20+ load).
- **No `--new`** — opening in a new tab causes an immediate redirect to a stale detail page.
- **Listing page auto-redirects to BookMyShow after a few seconds** — any sleep between `browser-nav` and `browser-eval` triggers this. Chain with `&&`.
- **City-slug URL variants 404** (e.g., `https://www.district.in/bengaluru/events/`) — always use `https://www.district.in/events/` and rely on the cookie.
- **Related events in a series** can appear as separate listings with slightly different titles (e.g. `"Not Just a Bar Takeover"` vs `"… EP 02"`). The title+datetime+venue dedup won't catch these; check for near-identical descriptions and keep the more specifically named variant.
- **Images use `media.insider.in` CDN**. No overlays/transforms — clean URLs.
```

- [ ] **Step 2: Create `memory/events/district/enrichment.md`**

```markdown
# District.in Events — Enrichment Playbook

Requires the **browser-tools** skill for browser automation.

## Step 1: Enrich from detail pages

For each selected event, navigate to its URL (do NOT use `--new`) and extract structured data:

```bash
browser-nav "{event_url}"
sleep 4
```

```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
  var ai = text.indexOf("About the Event");
  var offset = 15;
  if (ai < 0) { ai = text.indexOf("About"); offset = 5; }
  if (ai >= 0) {
    var rm = text.indexOf("Read more", ai);
    var end = rm > ai ? rm : text.indexOf("Things to know", ai);
    if (end < 0) end = ai + 1000;
    desc = text.slice(ai + offset, end).replace(/\n{3,}/g, "\n\n").trim();
  }
  var durMatch = text.match(/Duration\s+([^\n]+)/);
  var langMatch = text.match(/Event will be in\s+(.+)/);
  return JSON.stringify({
    url: window.location.href,
    description: desc.slice(0, 500),
    duration: durMatch ? durMatch[1] : null,
    language: langMatch ? langMatch[1] : null
  }, null, 2);
})()'
```

Check the returned `url` against the requested URL to detect redirects (see Quirks).

---

## Parsing venue

District.in venue formats:
```
Phoenix Marketcity, Bengaluru
Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore
Meetup Point: Near Cubbon Metro, Bengaluru
```

Split into `venue_name` and `venue_area`:
- If venue contains `|`: split on `|`, left is `venue_name`, right contains area. Trim any trailing `, {City}` suffix from the area — District appends the city again (may be same-spelling `"Bangalore, Bangalore"` or mixed `"Bangalore, Bengaluru"`).
- Otherwise split on the LAST comma before the city name.

Examples:
- `"Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore"` → name: `Hard Rock Cafe`, area: `St. Marks Road, Bangalore`
- `"Skyye | UB City, Bengaluru"` → name: `Skyye`, area: `UB City`
- `"Phoenix Marketcity, Bengaluru"` → name: `Phoenix Marketcity`, area: `Bengaluru`

---

## Inferring category

District.in does NOT provide explicit categories. Infer from title and description:
- Music/concert keywords → `Music`
- Comedy/standup/funny → `Comedy`
- Food/feast/dinner/brunch → `Food & Drink`
- Workshop/class/learn → `Workshop`
- Sport/IPL/ISL/match → `Sports`
- Meetup/networking/date → `Social`
- Art/exhibition/gallery → `Arts`
- Default → `Events`

---

## Parsing datetime

The listing provides `datetime` as a single string. Parse it into `event_date` and `event_time`:

| Listing format | event_date | event_time |
|---|---|---|
| `"Sat, 11 Apr, 6:30 PM"` | `"Sat, 11 Apr 2026"` | `"6:30 PM"` |
| `"Wed, 22 Apr, Multiple slots"` | `"Wed, 22 Apr 2026"` | `null` |
| `"Daily, Multiple slots"` | `"Daily"` | `null` |
| `"Daily, 12:00 PM onwards"` | `"Daily"` | `"12:00 PM"` |
| `"Every Sun & Sat, 7:00 PM to 10:30 PM"` | `"Every Sun & Sat"` | `"7:00 PM"` |
| `"Fri, 10 Apr – Sun, 19 Apr, 7:00 PM"` | `"Fri, 10 Apr – Sun, 19 Apr 2026"` | `"7:00 PM"` |
| `"Sat, 25 Apr onwards, Multiple Dates"` | `"Sat, 25 Apr 2026"` | `null` |

Add the current year if not present. The detail page may have a more specific date — prefer it when available.

---

## Quirks (enrichment-only)

- **Detail pages occasionally redirect** — verify the returned `url` matches the requested URL slug. The `sleep 4` is already sufficient; no extra sleep before the eval. If it doesn't match, retry once; if it still redirects, skip and substitute. A non-empty description is NOT a reliable redirect check — the wrong event's description populates silently. Redirects tend to be cross-linked between specific events, so the target's data may still be usable if it's in your top list.
- **Recurring events with old URL slugs** (e.g., `jan13-2024`, `aug31-2024`) redirect on both attempts consistently — skip them proactively rather than burning retries. Prefer candidates with current-year slugs.
```

- [ ] **Step 3: Delete old District playbook**

Run: `git rm memory/events/playbook-district.md`

- [ ] **Step 4: Update District entry in `src/events/agent.ts`**

Change the District entry in `EVENT_SOURCES`:

```ts
{
	key: "district",
	label: "District",
	playbookFiles: ["district/listing.md", "district/enrichment.md"],
	buildSystemPrompt: districtSystemPrompt,
	buildUserPrompt: districtUserPrompt,
},
```

- [ ] **Step 5: Run checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A memory/events/ src/events/agent.ts
git commit -m "refactor(events): split District playbook into listing + enrichment halves

Applies the same split + cleanup rubric used for BMS. Cookie setup,
listing extraction, filter-by-city, and scroll-is-forbidden quirks
move to district/listing.md. Detail enrichment, venue parsing,
category inference, datetime parsing, and detail-redirect quirks
move to district/enrichment.md. Duplicates and one-off notes pruned."
```

---

## Task 5: Add validation helpers for listing candidates and rank+enrich output

**Goal:** Pure functions for post-response validation that the new phases can use. Testable without sessions.

**Files:**
- Create: `src/events/validators.ts`
- Create: `test/events/validators.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/events/validators.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { EventArticle } from "../../src/events/schema.js";
import type { ListingCandidate } from "../../src/events/schema.js";
import { findInvalidCandidates, findInvalidFinalEvents } from "../../src/events/validators.js";

function makeCandidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
	return {
		source: "bookmyshow",
		title: "Kanan Gill Live",
		source_url: "https://in.bookmyshow.com/events/kanan-gill/ET00412345",
		image_url: "https://example.com/img.jpg",
		listing_date: "Sat, 25 Apr 2026",
		venue_line: "Phoenix: Bengaluru",
		category: "Comedy",
		price: "₹499",
		...overrides,
	};
}

function makeEventArticle(overrides: Partial<EventArticle> = {}): EventArticle {
	return {
		title: "Kanan Gill Live",
		description: "Stand-up comedy by Kanan Gill.",
		category: "Comedy",
		event_date: "Sat, 25 Apr 2026",
		event_time: "8:00 PM",
		duration: "90 mins",
		venue_name: "Phoenix Marketcity",
		venue_area: "Bengaluru",
		price: "₹499",
		source: "bookmyshow",
		source_url: "https://in.bookmyshow.com/events/kanan-gill/ET00412345",
		image_url: "https://example.com/img.jpg",
		rank: 1,
		...overrides,
	};
}

describe("findInvalidCandidates", () => {
	it("returns empty list when all candidates valid and count >= min", () => {
		const cands = Array.from({ length: 10 }, (_, i) => makeCandidate({ title: `Event ${i}`, source_url: `u${i}` }));
		expect(findInvalidCandidates(cands, 10)).toEqual({ countOk: true, invalid: [] });
	});

	it("flags count below minimum", () => {
		const cands = Array.from({ length: 5 }, (_, i) => makeCandidate({ title: `E${i}`, source_url: `u${i}` }));
		const r = findInvalidCandidates(cands, 10);
		expect(r.countOk).toBe(false);
	});

	it("flags candidates with both listing_date and image_url null (fully blank)", () => {
		const cands = [
			makeCandidate({ title: "Good", source_url: "u1" }),
			makeCandidate({ title: "Bad", source_url: "u2", listing_date: null, image_url: null }),
		];
		const r = findInvalidCandidates(cands, 2);
		expect(r.invalid).toHaveLength(1);
		expect(r.invalid[0].source_url).toBe("u2");
		expect(r.invalid[0].reasons).toContain("both listing_date and image_url are null");
	});

	it("accepts candidate when only one of listing_date or image_url is null", () => {
		const cands = [makeCandidate({ source_url: "u1", image_url: null })];
		expect(findInvalidCandidates(cands, 1).invalid).toEqual([]);
	});

	it("flags missing title", () => {
		const cands = [makeCandidate({ title: "", source_url: "u1" })];
		const r = findInvalidCandidates(cands, 1);
		expect(r.invalid[0].reasons).toContain("title is empty");
	});

	it("flags missing source_url", () => {
		const cands = [makeCandidate({ source_url: "" })];
		const r = findInvalidCandidates(cands, 1);
		expect(r.invalid[0].reasons).toContain("source_url is empty");
	});
});

describe("findInvalidFinalEvents", () => {
	it("accepts valid events at target count", () => {
		const events = [makeEventArticle({ rank: 1 }), makeEventArticle({ source_url: "u2", rank: 2 })];
		expect(findInvalidFinalEvents(events, 2)).toEqual({ countOk: true, invalid: [], duplicates: [] });
	});

	it("flags count != target", () => {
		expect(findInvalidFinalEvents([makeEventArticle()], 2).countOk).toBe(false);
	});

	it("flags empty event_date", () => {
		const r = findInvalidFinalEvents([makeEventArticle({ event_date: "" })], 1);
		expect(r.invalid[0].reasons).toContain("event_date is empty");
	});

	it("flags ticketed event with null image_url", () => {
		const r = findInvalidFinalEvents([makeEventArticle({ image_url: null })], 1);
		expect(r.invalid[0].reasons).toContain("image_url is null (required for ticketed sources)");
	});

	it("exempts news events from image_url requirement", () => {
		const r = findInvalidFinalEvents([makeEventArticle({ source: "news", image_url: null })], 1);
		expect(r.invalid).toEqual([]);
	});

	it("flags duplicate source_urls", () => {
		const events = [
			makeEventArticle({ source_url: "dup", rank: 1 }),
			makeEventArticle({ source_url: "dup", rank: 2 }),
		];
		const r = findInvalidFinalEvents(events, 2);
		expect(r.duplicates).toContain("dup");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/events/validators.test.ts`

Expected: FAIL — `src/events/validators.js` does not exist.

- [ ] **Step 3: Create the validators module**

Create `src/events/validators.ts`:

```typescript
import type { EventArticle, ListingCandidate } from "./schema.js";

export interface InvalidEntry {
	source_url: string;
	reasons: string[];
}

export interface CandidateValidationResult {
	countOk: boolean;
	invalid: InvalidEntry[];
}

/**
 * Validate Phase 2a/2b listing output.
 *
 * - `countOk` is true when `candidates.length >= minCount`.
 * - `invalid` lists candidates missing required fields:
 *     - empty `title`
 *     - empty `source_url`
 *     - both `listing_date` AND `image_url` null (fully blank card — likely
 *       extracted from a loading state)
 *
 * The caller decides what to do on failure (retry in-session, substitute, etc.).
 */
export function findInvalidCandidates(
	candidates: ListingCandidate[],
	minCount: number,
): CandidateValidationResult {
	const invalid: InvalidEntry[] = [];
	for (const c of candidates) {
		const reasons: string[] = [];
		if (!c.title || c.title.trim().length === 0) reasons.push("title is empty");
		if (!c.source_url || c.source_url.trim().length === 0) reasons.push("source_url is empty");
		if (c.listing_date === null && c.image_url === null) {
			reasons.push("both listing_date and image_url are null");
		}
		if (reasons.length > 0) {
			invalid.push({ source_url: c.source_url || "(missing)", reasons });
		}
	}
	return { countOk: candidates.length >= minCount, invalid };
}

export interface FinalValidationResult {
	countOk: boolean;
	invalid: InvalidEntry[];
	duplicates: string[];
}

/**
 * Validate Phase 3 rank+enrich output.
 *
 * - `countOk` is true when the final array length equals the target count.
 * - Every event must have non-empty `event_date`, `source`, `source_url`.
 * - Ticketed sources (`bookmyshow`, `district`) must have non-null `image_url`;
 *   news is exempt (news extraction doesn't produce image URLs today).
 * - `duplicates` lists any `source_url` that appears more than once.
 */
export function findInvalidFinalEvents(
	events: EventArticle[],
	targetCount: number,
): FinalValidationResult {
	const invalid: InvalidEntry[] = [];
	const seen = new Map<string, number>();
	for (const e of events) {
		const reasons: string[] = [];
		if (!e.event_date || e.event_date.trim().length === 0) reasons.push("event_date is empty");
		if (!e.source_url || e.source_url.trim().length === 0) reasons.push("source_url is empty");
		if ((e.source === "bookmyshow" || e.source === "district") && e.image_url === null) {
			reasons.push("image_url is null (required for ticketed sources)");
		}
		if (reasons.length > 0) {
			invalid.push({ source_url: e.source_url || "(missing)", reasons });
		}
		seen.set(e.source_url, (seen.get(e.source_url) ?? 0) + 1);
	}
	const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([url]) => url);
	return {
		countOk: events.length === targetCount,
		invalid,
		duplicates,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/events/validators.test.ts`

Expected: PASS (11 tests).

- [ ] **Step 5: Run the full check**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/events/validators.ts test/events/validators.test.ts
git commit -m "feat(events): add validators for listing candidates and final events

Pure functions used by the new Phase 2a/2b (listing-only) and Phase 3
(rank + enrich) flows to check output before accepting it. News
events are exempt from the image_url requirement since news
extraction does not produce image URLs today."
```

---

## Task 6: Add Phase 2a (BMS listing-only) — prompt builders + collection function

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Add listing-candidate import to agent.ts**

At the top of `src/events/agent.ts`, expand the schema import to include the new listing types:

```ts
import {
	type EnrichedEvent,
	type EventArticle,
	type ListingCandidate,
	enrichedEventsSchema,
	eventArticlesSchema,
	listingCandidatesSchema,
	type RawEvent,
	rawEventsSchema,
} from "./schema.js";
```

Also add:
```ts
import { findInvalidCandidates, findInvalidFinalEvents } from "./validators.js";
```

- [ ] **Step 2: Add `FEEDBACK_EDIT_BAR` constant**

In `src/events/agent.ts`, directly below the `CITY_CONFIG` block (around line 70), add:

```ts
// ── Universal feedback-edit bar ──────────────────────────────────────
//
// Included in every phase's feedback turn. Sets a high bar for what
// counts as a meaningful edit so playbooks don't bloat run-over-run.

const FEEDBACK_EDIT_BAR = `Only edit the playbook if your observation will DEMONSTRABLY help the next run —
i.e., something that would otherwise cause failure, waste tokens, or produce
wrong output if the next run doesn't know about it.

Qualifies:
  - A selector/URL/endpoint that stopped working (page structure changed)
  - A quirk observed MULTIPLE times in this session (not a one-off)
  - A simplification where the playbook's approach was clearly worse than
    what you did, and you can state why

Does NOT qualify — respond "No playbook changes needed":
  - One-off SPA timing glitch that resolved on retry
  - Stylistic rewording of existing instructions
  - Reminders of things already stated
  - Speculative "just in case" notes
  - Minor observations that didn't affect extraction

If editing, prefer delete-or-replace over append. Do not add to "Quirks"
unless the failure class is clearly not already covered.

Default: if unsure, answer "No playbook changes needed." A terse run is better
than a bloated playbook.`;
```

- [ ] **Step 3: Add BMS listing-only prompt builders**

In `src/events/agent.ts`, after the existing `bmsUserPrompt` function, add:

```ts
// ── Phase 2a: BMS listing-only ───────────────────────────────────────

function bmsListingSystemPrompt(city: string, listingPlaybook: string): string {
	return `\
You are a BookMyShow listing extractor for ${city}.

## Scraping Playbook

${listingPlaybook}

## Steps

1. Navigate to the filtered listing URL exactly as written in Step 1 of the playbook (use the daygroups filter URL).
2. Execute Step 1 extraction (eval + scroll + re-extract + dedup by URL).
3. Return ONLY a JSON array of listing candidates — no markdown fences, no detail-page visits.

## Output Format

Each object:
{
  "source": "bookmyshow",
  "title": "string (non-empty)",
  "source_url": "string (the card's href)",
  "image_url": "string from card img.src, or null if the card had no image",
  "listing_date": "string from the listing, or null",
  "venue_line": "string from the card's venue line, or null",
  "category": "string from the card, or null",
  "price": "string from the card, or null"
}

Return at minimum 10 candidates. Include every card you extracted — the ranking phase will filter.`;
}

function bmsListingUserPrompt(city: string, config: (typeof CITY_CONFIG)[string], today: string): string {
	return `\
Extract the BookMyShow listing for ${city}.

City slug: ${config.bms_slug}
Today: ${today}
Target window: this-weekend (today|tomorrow|this-weekend)`;
}
```

- [ ] **Step 4: Add `collectBmsListings` function**

After the existing `collectSourceEvents` function in `src/events/agent.ts`, add:

```ts
async function collectBmsListings(city: string, today: string, cwd: string): Promise<ListingCandidate[]> {
	const log = logger.child({ module: "events-agent", phase: "2a-bms-listing" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const listingPlaybook = readFileSync(join(cwd, "memory", "events", "bookmyshow", "listing.md"), "utf-8");
	log.info("Starting BMS listing-only extraction");

	const session = await createBrowserSession(cwd, bmsListingSystemPrompt(city, listingPlaybook));
	try {
		// ── Prompt 1: extract listing ──
		const capture = captureResponseText(session);
		await session.prompt(bmsListingUserPrompt(city, config, today));
		capture.stop();

		let candidates: ListingCandidate[] = await retryValidation(
			session,
			capture.getText(),
			listingCandidatesSchema,
			log,
		);

		// ── Post-schema validation (count + required-field check) ──
		const check = findInvalidCandidates(candidates, 10);
		if (!check.countOk || check.invalid.length > 0) {
			log.info({ count: candidates.length, invalid: check.invalid }, "Listing validation failed, asking for fixes");
			const msg = [
				check.countOk ? null : `Your output had only ${candidates.length} candidates; we need at least 10.`,
				check.invalid.length > 0
					? `The following candidates are malformed:\n${check.invalid
							.map((i) => `  - ${i.source_url}: ${i.reasons.join(", ")}`)
							.join("\n")}`
					: null,
				"Re-extract the listing (or expand scroll if needed) and return the corrected JSON array only. No markdown fences.",
			]
				.filter(Boolean)
				.join("\n\n");
			const retry = captureResponseText(session);
			await session.prompt(msg);
			retry.stop();
			candidates = await retryValidation(session, retry.getText(), listingCandidatesSchema, log);
		}

		log.info({ count: candidates.length }, "BMS listing candidates collected");

		// ── Prompt 2: Scoped playbook feedback ──
		log.info("Requesting BMS listing playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. You may edit ONLY memory/events/bookmyshow/listing.md.
Do NOT touch memory/events/bookmyshow/enrichment.md — that's Phase 3's concern.

${FEEDBACK_EDIT_BAR}`);
		feedbackCapture.stop();
		log.info("BMS listing feedback complete");

		return candidates;
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 5: Run type check**

Run: `npm run check`

Expected: PASS. The new code compiles; no tests fail.

- [ ] **Step 6: Commit**

```bash
git add src/events/agent.ts
git commit -m "feat(events): add Phase 2a BMS listing-only collection

New prompt builders and collection function that does only listing
extraction — no detail-page visits. Output is ListingCandidate[].
Post-response validation asks for in-session re-extraction when
count or field requirements fail. Feedback turn is scoped to
bookmyshow/listing.md using the universal edit bar. The existing
per-source scrape+enrich path still runs; orchestrator swap comes
in Task 9."
```

---

## Task 7: Add Phase 2b (District listing-only) — prompt builders + collection function

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Add District listing-only prompt builders**

In `src/events/agent.ts`, after the District existing prompt builders, add:

```ts
// ── Phase 2b: District listing-only ──────────────────────────────────

function districtListingSystemPrompt(city: string, listingPlaybook: string): string {
	return `\
You are a District.in listing extractor for ${city}.

## Scraping Playbook

${listingPlaybook}

## Steps

1. Set the city cookie exactly as Step 1 of the playbook instructs.
2. Chain nav + eval with \`&&\` (no sleep) to extract Step 2's listing.
3. Filter by target city per the playbook.
4. Dedup by title+datetime+venue.
5. Return ONLY a JSON array of listing candidates — no markdown fences, no detail-page visits.

## Output Format

Each object:
{
  "source": "district",
  "title": "string (non-empty)",
  "source_url": "string (the card's href)",
  "image_url": "string from img.src, or null",
  "listing_date": "string from the datetime field in the listing, or null",
  "venue_line": "string from the card's venue line, or null",
  "category": null,
  "price": "string from the card, or null"
}

Note: District does not expose category on the listing — set to null; Phase 3 infers it during enrichment.

Return at minimum 10 candidates.`;
}

function districtListingUserPrompt(city: string, config: (typeof CITY_CONFIG)[string], today: string): string {
	return `\
Extract the District.in listing for ${city}.

City config:
- city_slug: ${city}
- city_name: ${config.district_name}
- lat: ${config.district_lat}
- long: ${config.district_long}
Today: ${today}`;
}
```

- [ ] **Step 2: Add `collectDistrictListings` function**

```ts
async function collectDistrictListings(city: string, today: string, cwd: string): Promise<ListingCandidate[]> {
	const log = logger.child({ module: "events-agent", phase: "2b-district-listing" });
	const config = CITY_CONFIG[city];
	if (!config) throw new Error(`No city config for: ${city}`);

	const listingPlaybook = readFileSync(join(cwd, "memory", "events", "district", "listing.md"), "utf-8");
	log.info("Starting District listing-only extraction");

	const session = await createBrowserSession(cwd, districtListingSystemPrompt(city, listingPlaybook));
	try {
		const capture = captureResponseText(session);
		await session.prompt(districtListingUserPrompt(city, config, today));
		capture.stop();

		let candidates: ListingCandidate[] = await retryValidation(
			session,
			capture.getText(),
			listingCandidatesSchema,
			log,
		);

		const check = findInvalidCandidates(candidates, 10);
		if (!check.countOk || check.invalid.length > 0) {
			log.info({ count: candidates.length, invalid: check.invalid }, "Listing validation failed, asking for fixes");
			const msg = [
				check.countOk ? null : `Your output had only ${candidates.length} candidates; we need at least 10.`,
				check.invalid.length > 0
					? `The following candidates are malformed:\n${check.invalid
							.map((i) => `  - ${i.source_url}: ${i.reasons.join(", ")}`)
							.join("\n")}`
					: null,
				"Re-extract the listing and return the corrected JSON array only. No markdown fences.",
			]
				.filter(Boolean)
				.join("\n\n");
			const retry = captureResponseText(session);
			await session.prompt(msg);
			retry.stop();
			candidates = await retryValidation(session, retry.getText(), listingCandidatesSchema, log);
		}

		log.info({ count: candidates.length }, "District listing candidates collected");

		log.info("Requesting District listing playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. You may edit ONLY memory/events/district/listing.md.
Do NOT touch memory/events/district/enrichment.md — that's Phase 3's concern.

${FEEDBACK_EDIT_BAR}`);
		feedbackCapture.stop();
		log.info("District listing feedback complete");

		return candidates;
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 3: Run type check**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/events/agent.ts
git commit -m "feat(events): add Phase 2b District listing-only collection

Mirrors Phase 2a but for District. System prompt carries the listing
playbook + output schema; user prompt carries city config. Same
validate-then-retry pattern, same feedback scope (district/listing.md
only)."
```

---

## Task 8: Add Phase 3 (rank + enrich) — prompt builders + combined function

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Add rank+enrich prompt builders**

Add to `src/events/agent.ts` after `districtListingUserPrompt`:

```ts
// ── Phase 3: Rank + enrich ───────────────────────────────────────────

function rankAndEnrichSystemPrompt(
	city: string,
	today: string,
	maxDate: string,
	bmsEnrichmentPlaybook: string,
	districtEnrichmentPlaybook: string,
): string {
	return `\
You are the events editor for ${city}.

Your job: rank a pool of listing candidates plus news events to a final top ${TOP_TICKETED_COUNT} ticketed events (plus all news events passed through), then enrich each ticketed pick by visiting its detail page.

## Ranking Rules

1. **HARD CUTOFF**: Only include events with event_date between ${today} and ${maxDate} (7-day window).
2. **Time proximity** — events happening sooner rank higher (today is ${today}).
3. **Significance** — big concerts, major sports, large festivals > small bar gigs.
4. **Cross-source boost** — if the same event appears on both BMS and District, pick one (prefer the one with more listing fields populated) and treat it as higher signal.
5. **Image presence as a quality signal** — BMS lists low-priority events with null listing images; treat them as lower confidence.
6. **Category diversity** — avoid clustering same-category picks.
7. **Skip null listing dates** unless you have another reason to include.

## Enrichment Rules

After selecting the top ${TOP_TICKETED_COUNT} ticketed events, visit each one's detail page to enrich fields. The enrichment playbooks below (one per source) describe exactly how.

### Reuse from previous run

If the user provides a \`previous_events_path\` that references a JSON file of previously-enriched events, load it. For any selected candidate whose \`source_url\` matches an entry in that file, **reuse the enriched fields (description, event_date, event_time, duration, venue_name, venue_area, image_url)** instead of visiting the detail page. Only visit detail pages for URLs not in the cache.

### News events

News events are already enriched — pass them through without detail visits. Transform the venue string per the ranking transformation rules (split on comma/colon, or use full string as venue_name with null area).

## BookMyShow enrichment playbook

${bmsEnrichmentPlaybook}

---

## District enrichment playbook

${districtEnrichmentPlaybook}

---

## Output Format

Return ONLY a JSON array (no markdown fences). One object per final event. Must have exactly ${TOP_TICKETED_COUNT} ticketed entries + all news events:

{
  "title": "string",
  "description": "string (1-3 sentences)",
  "category": "string",
  "event_date": "string (non-empty, e.g. Fri, 17 Apr 2026)",
  "event_time": "string or null",
  "duration": "string or null",
  "venue_name": "string or null",
  "venue_area": "string or null",
  "price": "string or null",
  "source": "news | bookmyshow | district",
  "source_url": "string",
  "image_url": "string (non-null for ticketed sources per image fallback) or null (news only)",
  "rank": 1
}

Rank 1 = most important. News events first, then ticketed by rank.`;
}

function rankAndEnrichUserPrompt(
	city: string,
	today: string,
	newsEvents: RawEvent[],
	bmsCandidates: ListingCandidate[],
	districtCandidates: ListingCandidate[],
	previousEvents: EventArticle[],
	previousEventsPath: string,
): string {
	return `\
Rank and enrich events for ${city}. Today: ${today}

## Previous-run cache

previous_events_path: ${previousEventsPath}

(Reuse policy is in the system prompt. Apply only if a selected source_url matches an entry.)

## News events (already enriched — pass through)
${newsEvents.length > 0 ? JSON.stringify(newsEvents, null, 2) : "None found today."}

## BookMyShow listing candidates
${bmsCandidates.length > 0 ? JSON.stringify(bmsCandidates, null, 2) : "None."}

## District.in listing candidates
${districtCandidates.length > 0 ? JSON.stringify(districtCandidates, null, 2) : "None."}

## Previously captured news events (carry-forward candidates)
${previousEvents.length > 0 ? JSON.stringify(previousEvents, null, 2) : "None."}

## Steps

1. Rank candidates per the system prompt's ranking rules.
2. For each selected ticketed event: if its source_url is in the cache file, reuse; otherwise visit the detail page and enrich using the appropriate source's enrichment playbook.
3. Return the final JSON array.`;
}
```

- [ ] **Step 2: Add `rankAndEnrich` function**

Add after the Phase 3 prompt builders:

```ts
async function rankAndEnrich(
	newsEvents: RawEvent[],
	bmsCandidates: ListingCandidate[],
	districtCandidates: ListingCandidate[],
	previousEvents: EventArticle[],
	previousEventsPath: string,
	city: string,
	today: string,
	maxDate: string,
	cwd: string,
): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", phase: "3-rank-enrich" });

	const bmsEnrichmentPlaybook = readFileSync(
		join(cwd, "memory", "events", "bookmyshow", "enrichment.md"),
		"utf-8",
	);
	const districtEnrichmentPlaybook = readFileSync(
		join(cwd, "memory", "events", "district", "enrichment.md"),
		"utf-8",
	);

	log.info(
		{
			news: newsEvents.length,
			bms: bmsCandidates.length,
			district: districtCandidates.length,
			previousCached: previousEvents.length,
		},
		"Starting Phase 3 rank + enrich",
	);

	const session = await createBrowserSession(
		cwd,
		rankAndEnrichSystemPrompt(city, today, maxDate, bmsEnrichmentPlaybook, districtEnrichmentPlaybook),
	);
	try {
		const capture = captureResponseText(session);
		await session.prompt(
			rankAndEnrichUserPrompt(
				city,
				today,
				newsEvents,
				bmsCandidates,
				districtCandidates,
				previousEvents,
				previousEventsPath,
			),
		);
		capture.stop();

		let events: EventArticle[] = await retryValidation(session, capture.getText(), eventArticlesSchema, log);

		// ── Post-schema validation ──
		const targetCount = TOP_TICKETED_COUNT + newsEvents.length + previousEvents.length;
		const check = findInvalidFinalEvents(events, targetCount);
		if (!check.countOk || check.invalid.length > 0 || check.duplicates.length > 0) {
			log.info(
				{ count: events.length, target: targetCount, invalid: check.invalid, duplicates: check.duplicates },
				"Phase 3 validation failed, asking for fixes",
			);
			const msg = [
				check.countOk ? null : `Expected ${targetCount} events; got ${events.length}.`,
				check.invalid.length > 0
					? `Malformed events:\n${check.invalid
							.map((i) => `  - ${i.source_url}: ${i.reasons.join(", ")}`)
							.join("\n")}\n\nFor each malformed ticketed event, either re-enrich it (re-navigate and re-extract) or substitute the next-best candidate from the listing pool.`
					: null,
				check.duplicates.length > 0 ? `Duplicate source_urls: ${check.duplicates.join(", ")} — keep only one.` : null,
				"Return the corrected JSON array only. No markdown fences.",
			]
				.filter(Boolean)
				.join("\n\n");
			const retry = captureResponseText(session);
			await session.prompt(msg);
			retry.stop();
			events = await retryValidation(session, retry.getText(), eventArticlesSchema, log);
		}

		log.info({ count: events.length }, "Phase 3 events finalized");

		// ── Scoped playbook feedback ──
		log.info("Requesting Phase 3 enrichment feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session.

You may edit ONLY the enrichment playbooks:
  - memory/events/bookmyshow/enrichment.md (for BMS issues)
  - memory/events/district/enrichment.md (for District issues)

Do NOT touch either listing playbook — those are Phase 2a/2b's concern.

Before editing, name the specific events where you observed the issue. If the issue appeared on only one event out of the ${TOP_TICKETED_COUNT} you enriched, treat it as a one-off and do not edit.

${FEEDBACK_EDIT_BAR}`);
		feedbackCapture.stop();
		log.info("Phase 3 feedback complete");

		return events;
	} finally {
		session.dispose();
	}
}
```

- [ ] **Step 3: Run type check**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/events/agent.ts
git commit -m "feat(events): add Phase 3 rank+enrich combined function

Single browser session that ranks all candidates + news events, then
enriches only the top N ticketed picks by visiting detail pages.
System prompt carries both sources' enrichment playbooks + ranking
rules + reuse-from-cache policy. User prompt carries the candidate
JSON + cache path. Validation guards against malformed output,
missing image_urls on ticketed events, and duplicate source_urls.
Feedback is scoped to enrichment playbooks only with a one-off
guard so single-event issues don't trigger edits."
```

---

## Task 9: Rewire orchestrator and remove superseded code

**Goal:** Replace the per-source scrape+enrich calls with the new phase layout. Remove now-dead prompt builders and functions.

**Files:**
- Modify: `src/events/agent.ts`

- [ ] **Step 1: Update the orchestrator body**

In `src/events/agent.ts`, replace the entire body of `fetchEventsViaAgent` (the `export async function fetchEventsViaAgent(db: TablesDB, city: string)` block at the bottom of the file) with:

```ts
export async function fetchEventsViaAgent(db: TablesDB, city: string): Promise<EventArticle[]> {
	const log = logger.child({ module: "events-agent", city });
	const cwd = process.cwd();
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
	const maxDateObj = new Date(today);
	maxDateObj.setDate(maxDateObj.getDate() + EVENT_HORIZON_DAYS);
	const maxDate = maxDateObj.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// Fetch previous events for cache reuse + news carry-forward
	log.info("Fetching previous events from DB");
	const allPreviousEvents = await getLiveEventsForCity(db, city);
	log.info({ count: allPreviousEvents.length }, "Previous events fetched");

	// Write combined previous-run cache (both sources) for Phase 3 reuse
	const cacheDir = join(homedir(), ".cache", "events", city);
	mkdirSync(cacheDir, { recursive: true });
	const previousTicketed = allPreviousEvents.filter((e) => e.source === "bookmyshow" || e.source === "district");
	const previousEventsPath = join(cacheDir, "ticketed-previous.json");
	writeFileSync(previousEventsPath, JSON.stringify(previousTicketed, null, 2));
	log.info({ cached: previousTicketed.length, path: previousEventsPath }, "Wrote previous-ticketed cache");

	// Phase 1: news (unchanged plain session)
	log.info("Phase 1: Collecting news events");
	const newsEvents = await collectNewsEvents(city, today, cwd);

	// Phase 2a: BMS listing-only
	log.info("Phase 2a: Collecting BMS listing candidates");
	const bmsCandidates = await collectBmsListings(city, today, cwd);

	// Phase 2b: District listing-only
	log.info("Phase 2b: Collecting District listing candidates");
	const districtCandidates = await collectDistrictListings(city, today, cwd);

	// Phase 3: rank + enrich
	const previousNewsEvents = allPreviousEvents.filter((e) => e.source === "news");
	log.info("Phase 3: Ranking and enriching");
	const events = await rankAndEnrich(
		newsEvents,
		bmsCandidates,
		districtCandidates,
		previousNewsEvents,
		previousEventsPath,
		city,
		today,
		maxDate,
		cwd,
	);

	log.info({ count: events.length }, "All events collected");
	return events;
}
```

- [ ] **Step 2: Remove superseded per-source scrape+enrich code**

Delete the following from `src/events/agent.ts`:

- The entire `validateEnrichedEvents` function (~25 lines starting `async function validateEnrichedEvents`).
- The `bmsSystemPrompt` function.
- The `bmsUserPrompt` function.
- The `districtSystemPrompt` function.
- The `districtUserPrompt` function.
- The `rankingSystemPrompt` function.
- The `rankingUserPrompt` function.
- The `SourcePromptParams` and `SourceUserParams` interfaces.
- The `EventSourceDef` interface.
- The `EVENT_SOURCES` array.
- The `collectSourceEvents` function.
- The `rankEvents` function (the plain-session version — replaced by `rankAndEnrich`).
- The `readPlaybook` helper (no longer used; each new function reads its own files directly).

Keep:
- `findStoryFiles` helper
- `FEEDBACK_EDIT_BAR`
- `CITY_CONFIG`
- `TOP_TICKETED_COUNT` / `EVENT_HORIZON_DAYS` constants
- `newsExtractionSystemPrompt` / `newsExtractionUserPrompt`
- `collectNewsEvents`
- All Phase 2a/2b/3 builders and functions added in Tasks 6–8

- [ ] **Step 3: Clean up imports**

In `src/events/agent.ts`, remove any imports that are no longer used after the deletions. Specifically check:

- `EnrichedEvent`, `enrichedEventsSchema` — still used? (Schema is kept; type may or may not be referenced. Remove if unused.)

If `EnrichedEvent` / `enrichedEventsSchema` imports are now unused, remove them:

```ts
import {
	type EventArticle,
	type ListingCandidate,
	eventArticlesSchema,
	listingCandidatesSchema,
	type RawEvent,
	rawEventsSchema,
} from "./schema.js";
```

Leave `src/events/schema.ts` untouched — `EnrichedEvent` stays in the schema file for possible future use and is exported from the package.

- [ ] **Step 4: Run type check + tests**

Run: `npm run check && npx vitest run`

Expected: PASS. All existing tests pass; TypeScript compiles with no unused-import warnings.

- [ ] **Step 5: Commit**

```bash
git add src/events/agent.ts
git commit -m "refactor(events): rewire orchestrator to new phase layout

fetchEventsViaAgent now drives: Phase 1 news → Phase 2a BMS listing
→ Phase 2b District listing → Phase 3 rank + enrich. Per-source
scrape+enrich code (bmsSystemPrompt, districtSystemPrompt,
collectSourceEvents, rankEvents, EVENT_SOURCES, etc.) is removed.
Phase 3 reuse cache consolidates previous BMS+District events into a
single ticketed-previous.json file since the ranker now sees both
sources at once.

Together with the earlier commits this completes the rearchitecture;
chennai validation run is next."
```

---

## Task 10: Validate on chennai

**Goal:** Verify the pass criteria in the spec before the 8-hour scheduler hits bengaluru.

**Files:**
- None (observational task)

- [ ] **Step 1: Capture chennai historical baseline**

Run the following to record the starting point:

```bash
ls -t ~/.claude/projects/-Users-hanif-Desktop-projects-live-city/*.jsonl | head -20 > /tmp/sessions-before-chennai.txt
```

This records which session files already existed, so the chennai run's new session files are easy to isolate afterward.

- [ ] **Step 2: Run the pipeline for chennai**

Run: `npx tsx src/run-events.ts chennai 2>&1 | tee /tmp/chennai-run-1.log`

Expected: exits with `Done — events inserted into Appwrite for chennai.`

- [ ] **Step 3: Identify this run's session files**

Run:
```bash
comm -13 <(sort /tmp/sessions-before-chennai.txt) <(ls -t ~/.claude/projects/-Users-hanif-Desktop-projects-live-city/*.jsonl | sort) > /tmp/sessions-chennai-run-1.txt
cat /tmp/sessions-chennai-run-1.txt
```

Expected: 4–5 new `.jsonl` files (news, 2a, 2b, 3 — possibly a retry session).

- [ ] **Step 4: Sum tokens for this run**

Run:
```bash
python3 <<'EOF'
import json, os, sys
totals = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
phase_totals = {}
with open("/tmp/sessions-chennai-run-1.txt") as fp:
    files = [l.strip() for l in fp if l.strip().endswith(".jsonl")]
for f in files:
    t = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    with open(f) as fp:
        for line in fp:
            try: obj = json.loads(line)
            except: continue
            if obj.get('type') == 'assistant':
                u = obj.get('message', {}).get('usage', {})
                for k in t: t[k] += u.get(k, 0) or 0
    for k in totals: totals[k] += t[k]
    phase_totals[os.path.basename(f)] = sum(t.values())
    print(f"{os.path.basename(f)}: {sum(t.values()):,}")
print("=" * 40)
print(f"TOTAL: {sum(totals.values()):,}")
print(f"PASS if <= 1,700,000 (target: ~60% reduction from ~4.3M baseline)")
EOF
```

Expected: **Total ≤ 1,700,000**. If higher, the token target didn't land — investigate before proceeding.

- [ ] **Step 5: Check chennai image coverage in Appwrite**

Create `/tmp/check-chennai-images.ts`:
```typescript
import { Client, TablesDB, Query } from "node-appwrite";
import { config } from "dotenv";
config();

async function main() {
	const client = new Client()
		.setEndpoint(process.env.APPWRITE_ENDPOINT!)
		.setProject(process.env.APPWRITE_PROJECT_ID!)
		.setKey(process.env.APPWRITE_API_KEY!);
	const db = new TablesDB(client);
	const res = await db.listRows({
		databaseId: "live_city",
		tableId: "events",
		queries: [Query.equal("city", "chennai"), Query.limit(100)],
	});
	const bySource: Record<string, { total: number; withImg: number }> = {};
	for (const r of res.rows as any[]) {
		const s = r.source;
		bySource[s] ??= { total: 0, withImg: 0 };
		bySource[s].total++;
		if (r.image_url) bySource[s].withImg++;
	}
	console.log("Chennai image coverage:");
	for (const [s, c] of Object.entries(bySource)) {
		console.log(`  ${s}: ${c.withImg}/${c.total} (${Math.round((100 * c.withImg) / c.total)}%)`);
	}
	const ticketed = ["bookmyshow", "district"].reduce(
		(acc, k) => ({ total: acc.total + (bySource[k]?.total ?? 0), withImg: acc.withImg + (bySource[k]?.withImg ?? 0) }),
		{ total: 0, withImg: 0 },
	);
	const pct = ticketed.total > 0 ? Math.round((100 * ticketed.withImg) / ticketed.total) : 0;
	console.log(`  TICKETED: ${ticketed.withImg}/${ticketed.total} (${pct}%)  — PASS if >= 90%`);
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
```

Run: `cp /tmp/check-chennai-images.ts ./check-chennai-images.ts && npx tsx ./check-chennai-images.ts && rm -f ./check-chennai-images.ts`

Expected: **TICKETED ≥ 90%**.

- [ ] **Step 6: Repeat for two more runs**

Run steps 1–5 two more times (3 runs total). Accept the change only if **all three** runs pass the token + image thresholds.

- [ ] **Step 7: Eyeball check**

Open the chennai tab in the app (or query the events rows directly from Appwrite console). Confirm the top events look comparable in content quality to historical chennai runs — no obvious drop in relevance, no duplicates, no obviously-wrong categories.

- [ ] **Step 8: Decide**

- If all three chennai runs pass and the eyeball check looks clean: no code change needed; push the worktree branch and open a PR.
- If any run fails: investigate before wider rollout. Likely suspects:
  - Phase 2a/2b returning < 10 candidates → check playbook scroll / filter URL / card selector.
  - Phase 3 image_url null for ticketed events → check the `/nmcms/` selector in `bookmyshow/enrichment.md`, or verify the reuse-from-cache logic didn't carry a null from a prior run.
  - Token budget blown → inspect the session with the highest token count; if raw CDP fallback is dominating, the tooling-fallback quirk is firing — Chrome 147 compatibility is the root cause.

---

## Self-Review Complete

Spec sections → tasks:
- Goals (image + tokens) → Tasks 1, 6, 7, 8, 10
- Phase layout → Tasks 6, 7, 8, 9
- Playbook split + cleanup → Tasks 3, 4
- Prompt architecture + migration table → Tasks 6, 7, 8
- `/nmcms/` image fix → Tasks 1, 3
- Validation & feedback hooks → Tasks 5, 6, 7, 8
- Universal edit bar → Task 6 (constant), Tasks 6, 7, 8 (usage)
- `ListingCandidate` schema change → Task 2
- Token estimate → Task 10 (validation)
- Rollout → Tasks 1, 3, 4, 9, 10
- Open question: combined vs split Phase 3 → Task 8 implements combined; split is future work if brittleness shows up

No placeholders, no "TBD", no references to undefined types/functions. Function signatures are consistent between tasks (`findInvalidCandidates`, `findInvalidFinalEvents`, `collectBmsListings`, `collectDistrictListings`, `rankAndEnrich`).
