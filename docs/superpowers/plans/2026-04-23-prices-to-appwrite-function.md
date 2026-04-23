# Prices to Appwrite Function — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move gold/silver/platinum price fetching from the local scheduler to an Appwrite Cloud function so the Mac mini no longer has to stay awake from 07:30–18:30. The mini wakes only for news (08:00 IST, 18:00 IST) and events (09:00 IST) — schedules come from [src/index.ts](src/index.ts) on `main`: `"0 8,18 * * *"` for `${city}-news` and `"0 9 * * *"` for `${city}-events`.

**Push notifications:** the existing "prices updated" push (topic `prices-<city>`, sent when gold or silver changes vs. the most recent prior row) is preserved end-to-end — the notifier logic is ported plain-JS into the function and called from the same spot in the pipeline (Tasks 5 and 6).

**Architecture:** Create a `functions/price/` directory (new local convention) deployed via `appwrite` CLI in the style of the existing `refresh_city_environment` function — runtime `node-22`, entrypoint `src/index.js`, size `s-0.5vcpu-512mb`, timeout 60s. The function runs every 5 min across a UTC cron superset (`*/5 4-5,9-10 * * *`) and early-returns unless the current IST time is in `[09:30, 10:30]` or `[15:00, 16:00]`. Shared pricing logic is ported to plain JS inside the function (matching the weather function); the original TypeScript files (`src/metals/*`, `src/extractor/metals-updater.ts`, `src/notifications/price-notifier.ts`, `src/run-price.ts`) remain in the tree so `npx tsx src/run-price.ts` still works for manual backfills. **The Appwrite function runs in parallel with the local scheduler through at least one full IST window (Task 9) before the local scheduler is disabled** — `updatePriceForCity` is idempotent on unchanged prices, so parallel runs are safe. Only after verification does Task 10 comment out the local block. Mac mini wake/sleep splits into a morning window (07:50–09:45) and an evening window (17:50–18:30) using one `pmset repeat wakeorpoweron`, one one-shot `pmset schedule wake` refreshed each morning by a launchd agent, and two sleep launchd agents.

**Tech Stack:** Node 22 (plain JS in the function, TypeScript in the main repo), `node-appwrite`, `zod`, Appwrite CLI, macOS `pmset` + `launchd`, Node 22's built-in `node --test` runner for function tests.

---

## File Structure

### Created
- `functions/price/package.json` — minimal package manifest (`node-appwrite`, `zod` only)
- `functions/price/src/index.js` — function entrypoint (`export default async ({ req, res, log, error }) => …`)
- `functions/price/src/lalithaa.js` — port of [src/metals/lalithaa.ts](src/metals/lalithaa.ts) (`fetchPrice`, `resolveStateIds`, zod schemas)
- `functions/price/src/prices-updater.js` — port of [src/extractor/metals-updater.ts](src/extractor/metals-updater.ts) (`updatePriceForCity`, `fetchMostRecentRowBefore`, `pricesChanged`)
- `functions/price/src/price-notifier.js` — port of [src/notifications/price-notifier.ts](src/notifications/price-notifier.ts) (`buildPriceChangeEvent`, `formatNotificationBody`, `sendPriceNotification`)
- `functions/price/src/ist-window.js` — pure helper: `isWithinPriceWindow(date)` returns true if IST time is in `[09:30, 10:30]` ∪ `[15:00, 16:00]`
- `functions/price/test/ist-window.test.js` — unit tests for the IST window filter
- `functions/price/test/prices-updater.test.js` — unit test for `pricesChanged`
- `functions/price/.gitignore` — `node_modules`
- `functions/price/README.md` — deploy commands + env var list
- `~/Library/LaunchAgents/com.livecity.schedule-evening-wake.plist` — daily 09:20 IST job that calls `pmset schedule wake "MM/dd/yyyy 17:50:00"` for today
- `~/Library/LaunchAgents/com.livecity.sleep-morning.plist` — daily 09:45 IST job that calls `pmset sleepnow`

### Modified
- `src/index.ts` — comment out `startScheduler("lalithaa-prices", …)` block (lines 46 area). Leave imports in place so the block can be uncommented to roll back.
- `README.md` — replace the "Mac Mini Wake/Sleep Schedule" section with the new split-window schedule.
- `~/Library/LaunchAgents/com.livecity.sleep.plist` — rename to `com.livecity.sleep-evening.plist` for clarity (same 18:30 trigger, same content, new `Label`).
- `CLAUDE.md` — already updated in this worktree (Appwrite section + Schedules & timezones). No further change.

### Untouched (intentional)
- `src/metals/*`, `src/extractor/metals-updater.ts`, `src/notifications/price-notifier.ts`, `src/run-price.ts`, `test/extractor/price-updater.test.ts`, `test/notifications/price-notifier.test.ts` — kept so the TS pipeline still works for manual backfill and so the existing unit tests keep passing.

---

## Task 1: Scaffold the function directory

**Files:**
- Create: `functions/price/package.json`
- Create: `functions/price/.gitignore`
- Create: `functions/price/src/index.js`

- [ ] **Step 1: Create `functions/price/.gitignore`**

```
node_modules
```

- [ ] **Step 2: Create `functions/price/package.json`**

```json
{
  "name": "live-city-price-function",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "node-appwrite": "^23.0.0",
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 3: Create placeholder `functions/price/src/index.js`**

```js
export default async ({ req, res, log, error }) => {
  return res.text("not implemented");
};
```

- [ ] **Step 4: Install deps**

Run: `cd functions/price && npm install`
Expected: `added N packages` with no vulnerabilities. `node_modules/` appears.

- [ ] **Step 5: Commit**

```bash
git add functions/price/package.json functions/price/.gitignore functions/price/src/index.js functions/price/package-lock.json
git commit -m "feat(functions/price): scaffold Appwrite function directory"
```

---

## Task 2: Port the IST window helper with TDD

**Files:**
- Create: `functions/price/src/ist-window.js`
- Test: `functions/price/test/ist-window.test.js`

- [ ] **Step 1: Write the failing tests**

Create `functions/price/test/ist-window.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinPriceWindow } from "../src/ist-window.js";

// Helper: build a Date at a specific IST hh:mm. IST is UTC+5:30.
// 04:00 UTC = 09:30 IST; 04:30 UTC = 10:00 IST; 05:00 UTC = 10:30 IST;
// 09:30 UTC = 15:00 IST; 10:30 UTC = 16:00 IST.
function istDate(utcHours, utcMinutes) {
  return new Date(Date.UTC(2026, 3, 23, utcHours, utcMinutes, 0));
}

test("inside morning window — 09:30 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(4, 0)), true);
});

test("inside morning window — 10:00 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(4, 30)), true);
});

test("boundary morning window — 10:30 IST inclusive", () => {
  assert.equal(isWithinPriceWindow(istDate(5, 0)), true);
});

test("just outside morning window — 10:31 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(5, 1)), false);
});

test("just before morning window — 09:29 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(3, 59)), false);
});

test("inside afternoon window — 15:00 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(9, 30)), true);
});

test("inside afternoon window — 15:45 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(10, 15)), true);
});

test("boundary afternoon window — 16:00 IST inclusive", () => {
  assert.equal(isWithinPriceWindow(istDate(10, 30)), true);
});

test("outside afternoon window — 16:01 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(10, 31)), false);
});

test("dead zone — 12:00 IST", () => {
  assert.equal(isWithinPriceWindow(istDate(6, 30)), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions/price && npm test`
Expected: All tests FAIL with error `Cannot find module '../src/ist-window.js'`.

- [ ] **Step 3: Implement `ist-window.js`**

Create `functions/price/src/ist-window.js`:

```js
// Returns true if `date` (a JS Date) falls inside one of the two daily
// IST windows where Lalithaa Jewellery's published rates actually change:
// 09:30–10:30 IST and 15:00–16:00 IST (both inclusive of endpoints).
export function isWithinPriceWindow(date) {
  const istMinutes = istMinutesOfDay(date);
  const morningStart = 9 * 60 + 30;   // 09:30
  const morningEnd = 10 * 60 + 30;    // 10:30
  const afternoonStart = 15 * 60;     // 15:00
  const afternoonEnd = 16 * 60;       // 16:00

  return (
    (istMinutes >= morningStart && istMinutes <= morningEnd) ||
    (istMinutes >= afternoonStart && istMinutes <= afternoonEnd)
  );
}

function istMinutesOfDay(date) {
  // IST is a fixed +5:30 offset (no DST), so we can derive IST minutes
  // from UTC without needing a tz database.
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const istTotal = utcMinutes + 5 * 60 + 30;
  return ((istTotal % (24 * 60)) + 24 * 60) % (24 * 60);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions/price && npm test`
Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/price/src/ist-window.js functions/price/test/ist-window.test.js
git commit -m "feat(functions/price): add IST price-window filter"
```

---

## Task 3: Port `lalithaa.js` (fetch + state resolution)

**Files:**
- Create: `functions/price/src/lalithaa.js`

This is a near-verbatim port of [src/metals/lalithaa.ts](src/metals/lalithaa.ts) to plain JS. The function takes its states list from an env var (`LALITHAA_STATES_JSON`) — matching the `CITY_COORDINATES_JSON` pattern the weather function uses.

- [ ] **Step 1: Write `functions/price/src/lalithaa.js`**

```js
import { z } from "zod/v4";

const statesResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    items: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

const priceResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    prices: z.object({
      gold: z.object({ price: z.number(), rate_datetime: z.string() }),
      silver: z.object({ price: z.number() }),
      platinum: z.object({ price: z.number() }),
    }),
  }),
});

// Returns Map<city, { stateId, city }>.
// `statesConfig` shape: [{ state_name, city }, …]
export async function resolveStateIds(statesApiUrl, statesConfig) {
  const response = await fetch(`${statesApiUrl}?page=1&limit=100`);
  if (!response.ok) {
    throw new Error(`States API returned ${response.status} ${response.statusText}`);
  }
  const parsed = statesResponseSchema.parse(await response.json());

  const apiStatesByName = new Map();
  for (const item of parsed.data.items) {
    apiStatesByName.set(item.name, item.id);
  }

  const result = new Map();
  for (const entry of statesConfig) {
    const stateId = apiStatesByName.get(entry.state_name);
    if (stateId === undefined) continue;
    result.set(entry.city, { stateId, city: entry.city });
  }
  return result;
}

export async function fetchPrice(apiUrl, stateId) {
  const response = await fetch(`${apiUrl}?state_id=${stateId}`);
  if (!response.ok) {
    throw new Error(`Price API returned ${response.status} ${response.statusText}`);
  }
  const parsed = priceResponseSchema.parse(await response.json());
  return {
    gold_22k_price: parsed.data.prices.gold.price,
    silver_price: parsed.data.prices.silver.price,
    platinum_price: parsed.data.prices.platinum.price,
    rate_datetime: parsed.data.prices.gold.rate_datetime,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/price/src/lalithaa.js
git commit -m "feat(functions/price): port Lalithaa fetch + state resolution"
```

---

## Task 4: Port `prices-updater.js` with TDD on `pricesChanged`

**Files:**
- Create: `functions/price/src/prices-updater.js`
- Test: `functions/price/test/prices-updater.test.js`

- [ ] **Step 1: Write the failing test for `pricesChanged`**

Create `functions/price/test/prices-updater.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pricesChanged } from "../src/prices-updater.js";

const existing = {
  gold_22k_price: 7500,
  silver_price: 95,
  platinum_price: 3200,
};

test("unchanged returns false", () => {
  assert.equal(pricesChanged(existing, { ...existing }), false);
});

test("gold change returns true", () => {
  assert.equal(pricesChanged(existing, { ...existing, gold_22k_price: 7510 }), true);
});

test("silver change returns true", () => {
  assert.equal(pricesChanged(existing, { ...existing, silver_price: 96 }), true);
});

test("platinum change returns true", () => {
  assert.equal(pricesChanged(existing, { ...existing, platinum_price: 3300 }), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions/price && npm test`
Expected: Tests FAIL with `Cannot find module '../src/prices-updater.js'`.

- [ ] **Step 3: Implement `prices-updater.js`**

Create `functions/price/src/prices-updater.js`:

```js
import { ID, Query } from "node-appwrite";

export const DB_ID = "live_city";
export const TABLE_METAL_PRICES = "metal_prices";

export function pricesChanged(existing, incoming) {
  return (
    existing.gold_22k_price !== incoming.gold_22k_price ||
    existing.silver_price !== incoming.silver_price ||
    existing.platinum_price !== incoming.platinum_price
  );
}

function getTodayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getNowISO() {
  return new Date().toISOString();
}

export async function fetchMostRecentRowBefore(db, city, source, beforeDate) {
  const result = await db.listRows({
    databaseId: DB_ID,
    tableId: TABLE_METAL_PRICES,
    queries: [
      Query.equal("city", city),
      Query.equal("source", source),
      Query.lessThan("price_date", beforeDate),
      Query.orderDesc("price_date"),
      Query.orderDesc("$createdAt"),
      Query.limit(1),
    ],
  });
  return result.rows[0];
}

// Returns { action: "new_row" | "price_changed" | "checked", priorRow }
export async function updatePriceForCity(db, city, source, prices) {
  const today = getTodayIST();
  const now = getNowISO();

  const result = await db.listRows({
    databaseId: DB_ID,
    tableId: TABLE_METAL_PRICES,
    queries: [
      Query.equal("city", city),
      Query.equal("source", source),
      Query.equal("price_date", today),
      Query.orderDesc("$createdAt"),
      Query.limit(1),
    ],
  });

  const existing = result.rows[0];

  if (!existing || pricesChanged(existing, prices)) {
    await db.createRow({
      databaseId: DB_ID,
      tableId: TABLE_METAL_PRICES,
      rowId: ID.unique(),
      data: {
        city,
        source,
        gold_22k_price: prices.gold_22k_price,
        silver_price: prices.silver_price,
        platinum_price: prices.platinum_price,
        price_date: today,
        price_changed_at: now,
        last_checked_at: now,
      },
    });
    const priorRow = existing ?? (await fetchMostRecentRowBefore(db, city, source, today));
    return {
      action: existing ? "price_changed" : "new_row",
      priorRow,
    };
  }

  await db.updateRow({
    databaseId: DB_ID,
    tableId: TABLE_METAL_PRICES,
    rowId: existing.$id,
    data: { last_checked_at: now },
  });
  return { action: "checked", priorRow: undefined };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions/price && npm test`
Expected: All tests (IST + prices-updater) PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/price/src/prices-updater.js functions/price/test/prices-updater.test.js
git commit -m "feat(functions/price): port prices-updater with pricesChanged tests"
```

---

## Task 5: Port `price-notifier.js`

**Files:**
- Create: `functions/price/src/price-notifier.js`

- [ ] **Step 1: Write `functions/price/src/price-notifier.js`**

```js
import { ID } from "node-appwrite";

const CITY_DISPLAY_NAMES = {
  bengaluru: "Bengaluru",
  chennai: "Chennai",
  hyderabad: "Hyderabad",
  vijayawada: "Vijayawada",
  puducherry: "Puducherry",
};

function cityDisplayName(slug) {
  return CITY_DISPLAY_NAMES[slug] ?? slug;
}

export function buildPriceChangeEvent(city, priorRow, newPrices) {
  const deltas = [];

  if (newPrices.gold_22k_price !== priorRow.gold_22k_price) {
    deltas.push({
      metal: "gold",
      oldPrice: priorRow.gold_22k_price,
      newPrice: newPrices.gold_22k_price,
      delta: newPrices.gold_22k_price - priorRow.gold_22k_price,
    });
  }
  if (newPrices.silver_price !== priorRow.silver_price) {
    deltas.push({
      metal: "silver",
      oldPrice: priorRow.silver_price,
      newPrice: newPrices.silver_price,
      delta: newPrices.silver_price - priorRow.silver_price,
    });
  }

  return {
    city,
    cityDisplayName: cityDisplayName(city),
    deltas,
  };
}

function formatDelta(delta) {
  const symbol = delta.delta >= 0 ? "▲" : "▼";
  const magnitude = Math.round(Math.abs(delta.delta));
  const label = delta.metal === "gold" ? "Gold" : "Silver";
  return `${label} ${symbol} ₹${magnitude}/g`;
}

export function formatNotificationBody(event) {
  return `${event.deltas.map(formatDelta).join(" · ")} — tap to see today's price`;
}

export async function sendPriceNotification(messaging, event) {
  await messaging.createPush({
    messageId: ID.unique(),
    title: `${event.cityDisplayName} rates updated`,
    body: formatNotificationBody(event),
    topics: [`prices-${event.city}`],
    data: { OPEN_TAB: "home" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/price/src/price-notifier.js
git commit -m "feat(functions/price): port price-notifier"
```

---

## Task 6: Wire up the function handler

**Files:**
- Modify: `functions/price/src/index.js`

- [ ] **Step 1: Replace `functions/price/src/index.js` with the full handler**

```js
import { Client, Messaging, TablesDB } from "node-appwrite";
import { isWithinPriceWindow } from "./ist-window.js";
import { fetchPrice, resolveStateIds } from "./lalithaa.js";
import { updatePriceForCity } from "./prices-updater.js";
import { buildPriceChangeEvent, sendPriceNotification } from "./price-notifier.js";

const LALITHAA_SOURCE = "lalithaa_jewellery";
const STATES_API_URL = "https://api.lalithaajewellery.com/public/states";
const PRICES_API_URL = "https://api.lalithaajewellery.com/public/pricings/latest";

export default async ({ req, res, log, error }) => {
  const now = new Date();

  // Cron superset is `*/5 4-5,9-10 * * *` UTC — filter to the exact IST windows inside.
  const scheduledTrigger = req.headers["x-appwrite-trigger"] === "schedule";
  if (scheduledTrigger && !isWithinPriceWindow(now)) {
    log(`Outside IST price window (now=${now.toISOString()}), skipping.`);
    return res.json({ skipped: true, reason: "outside_ist_window" });
  }

  const statesConfig = JSON.parse(process.env.LALITHAA_STATES_JSON);

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  const db = new TablesDB(client);
  const messaging = new Messaging(client);

  const stateMap = await resolveStateIds(STATES_API_URL, statesConfig);

  const summary = [];
  for (const [city, { stateId }] of stateMap) {
    try {
      const prices = await fetchPrice(PRICES_API_URL, stateId);
      const { action, priorRow } = await updatePriceForCity(db, city, LALITHAA_SOURCE, prices);

      if (action !== "checked" && priorRow) {
        const event = buildPriceChangeEvent(city, priorRow, prices);
        if (event.deltas.length > 0) {
          try {
            await sendPriceNotification(messaging, event);
          } catch (notifyErr) {
            error(`Push failed for ${city}: ${notifyErr.message}`);
          }
        }
      }

      log(`${action} ${city}: gold=${prices.gold_22k_price} silver=${prices.silver_price}`);
      summary.push({ city, action });
    } catch (cityErr) {
      error(`Failed ${city}: ${cityErr.message}`);
      summary.push({ city, action: "error", error: cityErr.message });
    }
  }

  return res.json({ now: now.toISOString(), summary });
};
```

- [ ] **Step 2: Smoke-test the module graph loads without errors**

Run: `cd functions/price && node -e "import('./src/index.js').then(() => console.log('ok')).catch(e => { console.error(e); process.exit(1); })"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add functions/price/src/index.js
git commit -m "feat(functions/price): implement handler with IST window guard"
```

---

## Task 7: Document the function

**Files:**
- Create: `functions/price/README.md`

- [ ] **Step 1: Create `functions/price/README.md`**

```markdown
# price (Appwrite function)

Pulls Lalithaa Jewellery rates for each configured city and writes them into the
`metal_prices` table. Sends a push notification to `prices-<city>` when a price
changes vs. today's most recent row (or yesterday's last row if this is the first
row of the day).

## Schedule

Cron (UTC superset): `*/5 4-5,9-10 * * *`

Handler filters to IST `[09:30, 10:30] ∪ [15:00, 16:00]` — the two daily windows
Lalithaa's rates actually change. Scheduled invocations outside those windows
exit early with `{ skipped: true, reason: "outside_ist_window" }`. Manual
invocations (HTTP trigger) run unconditionally.

## Environment variables

| Key | Example |
| --- | --- |
| `APPWRITE_ENDPOINT` | `https://sgp.cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | `69c91ed0000423db1d3f` |
| `APPWRITE_API_KEY` | (server key with `databases.*` + `messaging.*`) |
| `LALITHAA_STATES_JSON` | see below |

`LALITHAA_STATES_JSON` mirrors `config/sources/lalithaa.yaml`:

```json
[
  {"state_name": "Karnataka", "city": "bengaluru"},
  {"state_name": "Tamilnadu", "city": "chennai"},
  {"state_name": "Telangana", "city": "hyderabad"},
  {"state_name": "Andhra Pradesh", "city": "vijayawada"},
  {"state_name": "Puducherry", "city": "puducherry"}
]
```

## Deploy

```bash
# One-time: create the function
appwrite functions create \
  --function-id price \
  --name price \
  --runtime node-22 \
  --entrypoint src/index.js \
  --execute users \
  --timeout 60 \
  --specification s-0.5vcpu-512mb \
  --schedule '*/5 4-5,9-10 * * *'

# Set env vars (re-run to update)
appwrite functions create-variable --function-id price --key APPWRITE_ENDPOINT --value "https://sgp.cloud.appwrite.io/v1"
appwrite functions create-variable --function-id price --key APPWRITE_PROJECT_ID --value "69c91ed0000423db1d3f"
appwrite functions create-variable --function-id price --key APPWRITE_API_KEY --value "<api-key>"
appwrite functions create-variable --function-id price --key LALITHAA_STATES_JSON --value "$(cat states.json)"

# Deploy (from functions/price/)
cd functions/price
appwrite functions create-deployment \
  --function-id price \
  --code . \
  --activate true
```

## Tests

```bash
cd functions/price
npm test
```
```

- [ ] **Step 2: Commit**

```bash
git add functions/price/README.md
git commit -m "docs(functions/price): add deploy + env docs"
```

---

## Task 8: Deploy the function to Appwrite Cloud

All commands run from repo root unless stated. The Appwrite CLI is already configured for this project (see [CLAUDE.md](CLAUDE.md) → Appwrite).

- [ ] **Step 1: Verify CLI session is still live**

Run: `appwrite functions list`
Expected: Output includes `refresh_city_environment`. If the command errors with "Session not found", re-run the `appwrite client --endpoint ... --project-id ... --key ...` command from CLAUDE.md.

- [ ] **Step 2: Create the function**

Run:

```bash
appwrite functions create \
  --function-id price \
  --name price \
  --runtime node-22 \
  --entrypoint src/index.js \
  --execute users \
  --timeout 60 \
  --specification s-0.5vcpu-512mb \
  --schedule '*/5 4-5,9-10 * * *'
```

Expected: `✓ Success` and function `$id : price`.

- [ ] **Step 3: Set environment variables**

Use the same `APPWRITE_API_KEY` as the weather function (can be copied from Appwrite Console if not at hand). `LALITHAA_STATES_JSON` comes from `config/sources/lalithaa.yaml` converted to the JSON array from the function's README.

```bash
appwrite functions create-variable --function-id price --key APPWRITE_ENDPOINT    --value "https://sgp.cloud.appwrite.io/v1"
appwrite functions create-variable --function-id price --key APPWRITE_PROJECT_ID  --value "69c91ed0000423db1d3f"
appwrite functions create-variable --function-id price --key APPWRITE_API_KEY     --value "<paste-server-api-key>"
appwrite functions create-variable --function-id price --key LALITHAA_STATES_JSON --value '[{"state_name":"Karnataka","city":"bengaluru"},{"state_name":"Tamilnadu","city":"chennai"},{"state_name":"Telangana","city":"hyderabad"},{"state_name":"Andhra Pradesh","city":"vijayawada"},{"state_name":"Puducherry","city":"puducherry"}]'
```

Expected: Four `✓ Success: Creating variable` lines.

- [ ] **Step 4: Deploy code**

```bash
cd functions/price
appwrite functions create-deployment \
  --function-id price \
  --code . \
  --activate true
cd -
```

Expected: `✓ Success` with a deployment ID; `latestDeploymentStatus` becomes `ready` within ~15s.

- [ ] **Step 5: Smoke-test with a manual HTTP execution**

```bash
appwrite functions create-execution --function-id price --method GET
```

Expected: `status : completed`, `responseStatusCode : 200`, and logs include `new_row bengaluru: gold=… silver=…` (first run — no row yet today) or `checked bengaluru: …` (if the local scheduler already wrote today's row).

- [ ] **Step 6: Verify scheduled execution inside the IST window**

Wait until the next IST price window (next `:05` boundary inside 09:30–10:30 or 15:00–16:00 IST) and run:

```bash
appwrite functions list-executions --function-id price
```

Expected: A `trigger : schedule` entry within the last 5 min, `status : completed`. If the invocation was outside the window, logs will show `Outside IST price window …, skipping.` — that's the expected shape when the UTC cron fires at, say, 04:55 UTC (= 10:25 IST, inside window) vs 05:55 UTC (= 11:25 IST, outside window).

- [ ] **Step 7: Commit (nothing new in git — this is a deploy step)**

No commit; the deployment lives in Appwrite.

---

## Task 9: Verify the function in production (parallel run)

**Purpose:** Prove the Appwrite function is fetching, writing, and notifying correctly **before** the local scheduler is disabled. Both systems run in parallel for at least one full IST price window. This is the last gate before Task 10.

**Safety:** `updatePriceForCity` is idempotent on unchanged prices (updates `last_checked_at` only), so parallel execution can only cause one kind of duplication: if the local daemon and the Appwrite function both observe a *new* price at essentially the same instant, two rows for that (city, minute) may land. The rate publisher updates slowly enough that this is very rare in practice, and duplicate detection in the mobile app reads the most recent row per day, so the risk is acceptable for a one-window eval.

No code changes here — this is observation only.

- [ ] **Step 1: Snapshot DB state before the first observation window**

Pick the next IST price window (next occurrence of 09:30–10:30 or 15:00–16:00 IST). Before it starts, capture the current day's rows for all 5 cities:

```bash
appwrite databases list-rows \
  --database-id live_city \
  --table-id metal_prices \
  --queries '["equal(\"price_date\", \"'"$(TZ=Asia/Kolkata date +%Y-%m-%d)"'\")"]' \
  --queries '["orderDesc(\"$createdAt\")"]' \
  --queries '["limit(50)"]' \
  > /tmp/price-before.json
```

Expected: a JSON with ~5–50 rows for today. Note the `total` count.

- [ ] **Step 2: Tail the local daemon's log in one terminal**

On the Mac mini (or wherever `npm run dev` is running):

```bash
tail -f logs/app.log | grep -E 'lalithaa-prices|new_row|price_changed|checked|Sent price push'
```

Expected: one tick every 10 min inside the 9–16 UTC-hour band (already-running behaviour).

- [ ] **Step 3: Watch function executions in another terminal**

```bash
watch -n 30 "appwrite functions list-executions --function-id price 2>&1 | head -40"
```

Expected once inside the window: a fresh execution every 5 min with `status : completed`, `responseStatusCode : 200`.

- [ ] **Step 4: Observe through the full window**

Let both systems run for the entire window (≥1 hour). Do not touch anything.

During the window, verify:

- ≥12 function executions with `trigger : schedule` and `status : completed` (13 ticks at 5-min intervals over 60 min, allowing for boundary timing).
- Function logs (via `appwrite functions list-executions` or the console) include lines like `new_row bengaluru: gold=… silver=…` or `checked bengaluru: …` for all 5 cities. Zero `Failed <city>` lines.
- Local daemon log shows its usual `Created new price row` / `Prices unchanged` lines, unchanged in frequency.
- If a gold or silver price actually changed during the window: the mobile app receives a push notification with the "Bengaluru rates updated — Gold ▲ ₹N/g …" format. Only one push per (city, change) — the function and local daemon each send their own, so expect at most 2 notifications per change during the parallel phase. This is the only parallel-run wart and resolves itself once Task 10 disables the local scheduler.

- [ ] **Step 5: Snapshot DB state after the window**

```bash
appwrite databases list-rows \
  --database-id live_city \
  --table-id metal_prices \
  --queries '["equal(\"price_date\", \"'"$(TZ=Asia/Kolkata date +%Y-%m-%d)"'\")"]' \
  --queries '["orderDesc(\"$createdAt\")"]' \
  --queries '["limit(50)"]' \
  > /tmp/price-after.json
```

Compare `/tmp/price-before.json` and `/tmp/price-after.json`:

```bash
diff <(jq -r '.rows[] | "\(.city) \(.gold_22k_price) \(.price_changed_at)"' /tmp/price-before.json | sort) \
     <(jq -r '.rows[] | "\(.city) \(.gold_22k_price) \(.price_changed_at)"' /tmp/price-after.json | sort)
```

Expected: only *additions* (new rows for cities where prices changed) or no change. No deletions. No rows with garbage / missing fields.

- [ ] **Step 6: Check the outside-window no-op path**

After the window ends (e.g. 10:35 IST), wait ~10 min, then:

```bash
appwrite functions list-executions --function-id price | head -40
```

Expected: the last 1–2 executions show `Outside IST price window …, skipping` in logs and return `{ skipped: true, reason: "outside_ist_window" }` — confirms the handler guard works.

- [ ] **Step 7: Go/no-go decision**

**Go** if all checks above pass. Proceed to Task 10.

**No-go** if any of these are true:
- Any function execution with `status : failed` (read its logs — common failures: bad env var, API key missing permission, Lalithaa API down)
- `Outside IST price window` logs appearing *inside* the window (IST math is wrong — recheck `ist-window.js`)
- DB rows missing a city or with null price fields (schema mismatch — compare to the local scheduler's rows in `/tmp/price-before.json`)

On no-go: disable the function (`appwrite functions update --function-id price --enabled false`), diagnose, redeploy, re-run Task 9. Do NOT proceed to Task 10 until this gate passes.

- [ ] **Step 8: No commit**

This is observational. Nothing to commit.

---

## Task 10: Disable the local price scheduler

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Comment out the entire price block**

The news/events schedulers don't use `config`, `stateMap`, or `messaging` — those are price-only. Wrap lines 18–46 (configPath load, state resolution, onTick, startScheduler) in one block comment so rollback is a single-comment revert. Delete `messaging` from line 16 since nothing else consumes it.

> **Note on line numbers:** the line numbers below match the worktree where the plan was written. On `main` the news/events schedulers around this block may be per-city (`${city}-news`, `${city}-events`) — that does not affect this task. Locate the three markers that are stable across branches: the `messaging` assignment, the `resolveStateIds(config)` call, and the `startScheduler("lalithaa-prices", "*/10 9-16 * * *", onTick)` line. Wrap everything between them (and including the `messaging` line's RHS) as shown.

Before (`src/index.ts` lines 14–46):

```ts
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);
	const messaging = createMessaging(client);

	const configPath = join(import.meta.dirname, "../config/sources/lalithaa.yaml");
	const config = loadLalithaaConfig(configPath);

	logger.info("Resolving state IDs from Lalithaa API...");
	const stateMap = await resolveStateIds(config);
	logger.info({ cities: [...stateMap.keys()] }, `Resolved ${stateMap.size} cities`);

	if (stateMap.size === 0) {
		logger.error("No cities resolved, exiting");
		process.exit(1);
	}

	const onTick = async () => {
		const results = await Promise.allSettled(
			[...stateMap.entries()].map(async ([city, { stateId }]) => {
				const prices = await fetchPrice(config.api_url, stateId);
				await updatePriceForCity(db, messaging, city, config.name, prices);
			}),
		);

		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				const city = [...stateMap.keys()][i];
				logger.error({ city, error: result.reason }, "Failed to update price");
			}
		}
	};

	startScheduler("lalithaa-prices", "*/10 9-16 * * *", onTick);
```

After:

```ts
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	// NOTE: Price fetching moved to the Appwrite `price` function on 2026-04-23
	// (see functions/price/README.md). The block below is kept (commented) so
	// rollback is a single-comment revert. Manual backfill via
	// `npx tsx src/run-price.ts` still works — its own imports are independent.
	/*
	const messaging = createMessaging(client);

	const configPath = join(import.meta.dirname, "../config/sources/lalithaa.yaml");
	const config = loadLalithaaConfig(configPath);

	logger.info("Resolving state IDs from Lalithaa API...");
	const stateMap = await resolveStateIds(config);
	logger.info({ cities: [...stateMap.keys()] }, `Resolved ${stateMap.size} cities`);

	if (stateMap.size === 0) {
		logger.error("No cities resolved, exiting");
		process.exit(1);
	}

	const onTick = async () => {
		const results = await Promise.allSettled(
			[...stateMap.entries()].map(async ([city, { stateId }]) => {
				const prices = await fetchPrice(config.api_url, stateId);
				await updatePriceForCity(db, messaging, city, config.name, prices);
			}),
		);

		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				const city = [...stateMap.keys()][i];
				logger.error({ city, error: result.reason }, "Failed to update price");
			}
		}
	};

	startScheduler("lalithaa-prices", "*/10 9-16 * * *", onTick);
	*/
```

- [ ] **Step 2: Remove now-unused imports**

With the block commented, these imports at the top of `src/index.ts` are unused: `createMessaging`, `join`, `loadLalithaaConfig`, `fetchPrice`, `resolveStateIds`, `updatePriceForCity`. Biome will flag them. Delete those six imports. Keep everything else.

Expected top of file after edit:

```ts
import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { loadEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { updateEventsForCity } from "./extractor/events-updater.js";
import { updateNewsForCity } from "./extractor/news-updater.js";
import { startScheduler } from "./scheduler.js";
```

- [ ] **Step 3: Verify typecheck + lint pass**

Run: `npm run check`
Expected: `biome` + `tsc --noEmit` both pass with zero warnings. If any warning remains, read it — the only expected class of error is a leftover unused import; remove it.

- [ ] **Step 4: Dry-run `npm run dev` for 10 seconds**

Run:

```bash
timeout 10 npm run dev || true
```

Expected: Logs show `Scheduler started` for `news-all-cities` and `events-all-cities` only — no `lalithaa-prices` line. Process exits after 10s (expected; `timeout` sent SIGTERM).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "chore: disable local lalithaa-prices scheduler (moved to Appwrite function)"
```

---

## Task 11: Update README Mac mini wake/sleep schedule

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the "Mac Mini Wake/Sleep Schedule" section**

Find the block starting `## Mac Mini Wake/Sleep Schedule` in `README.md` (lines 38–62) and replace with:

```markdown
## Mac Mini Wake/Sleep Schedule

Since 2026-04-23, prices run on an Appwrite function (see [functions/price/README.md](functions/price/README.md)). The Mac mini only needs to be awake for news (08:00 IST, 18:00 IST) and events (09:00 IST), so the schedule is split into two short windows:

```
07:50 — Mac wakes (pmset repeat wakeorpoweron)
08:00 — news job fires (node-cron inside npm run dev)
09:00 — events job fires
09:40 — launchd agent com.livecity.schedule-evening-wake schedules a
        one-shot pmset wake for 17:50 today
09:45 — launchd agent com.livecity.sleep-morning sleeps the mini
17:50 — Mac wakes (one-shot pmset wake)
18:00 — news job fires
18:30 — launchd agent com.livecity.sleep-evening sleeps the mini
```

All times IST. Total awake ≈ 2h 35m/day (down from ~11h).

**Setup (one-time):**

```bash
# Disable idle sleep (only the two sleep jobs put it to sleep)
sudo pmset -a sleep 0

# Morning wake every day
sudo pmset repeat wakeorpoweron MTWRFSU 07:50:00

# Launchd agents
launchctl unload ~/Library/LaunchAgents/com.livecity.sleep.plist 2>/dev/null || true
launchctl load   ~/Library/LaunchAgents/com.livecity.sleep-morning.plist
launchctl load   ~/Library/LaunchAgents/com.livecity.schedule-evening-wake.plist
launchctl load   ~/Library/LaunchAgents/com.livecity.sleep-evening.plist
```

**Verify:**

```bash
pmset -g sched                            # expect morning repeat + today's 17:50 one-shot
launchctl list | grep livecity            # expect three com.livecity.* entries
```

See [DESIGN.md](DESIGN.md) for architecture, decisions, and deployment details.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): split mac mini wake/sleep into morning + evening windows"
```

---

## Task 12: Create / rename the launchd agents

These are machine-local files — they aren't checked into git, but the plan has to get them into the right state so the new README instructions work. Run on the Mac mini itself (ssh or in person).

**Files:**
- Create: `~/Library/LaunchAgents/com.livecity.sleep-morning.plist`
- Create: `~/Library/LaunchAgents/com.livecity.schedule-evening-wake.plist`
- Rename: `~/Library/LaunchAgents/com.livecity.sleep.plist` → `com.livecity.sleep-evening.plist`

- [ ] **Step 1: Unload the old sleep agent**

Run: `launchctl unload ~/Library/LaunchAgents/com.livecity.sleep.plist`
Expected: No output, exit 0.

- [ ] **Step 2: Rename and edit the label inside**

```bash
mv ~/Library/LaunchAgents/com.livecity.sleep.plist \
   ~/Library/LaunchAgents/com.livecity.sleep-evening.plist
```

Edit the new file and change `<string>com.livecity.sleep</string>` to `<string>com.livecity.sleep-evening</string>`. Content should otherwise be identical (18:30 trigger, `osascript … sleep`).

- [ ] **Step 3: Create `com.livecity.sleep-morning.plist`**

Write `~/Library/LaunchAgents/com.livecity.sleep-morning.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.livecity.sleep-morning</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/osascript</string>
		<string>-e</string>
		<string>tell application "System Events" to sleep</string>
	</array>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>9</integer>
		<key>Minute</key>
		<integer>45</integer>
	</dict>
</dict>
</plist>
```

- [ ] **Step 4: Create `com.livecity.schedule-evening-wake.plist`**

Write `~/Library/LaunchAgents/com.livecity.schedule-evening-wake.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.livecity.schedule-evening-wake</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/sh</string>
		<string>-c</string>
		<string>/usr/bin/pmset schedule wake "$(date '+%m/%d/%Y') 17:50:00"</string>
	</array>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>9</integer>
		<key>Minute</key>
		<integer>40</integer>
	</dict>
</dict>
</plist>
```

- [ ] **Step 5: Load the agents**

```bash
launchctl load ~/Library/LaunchAgents/com.livecity.sleep-morning.plist
launchctl load ~/Library/LaunchAgents/com.livecity.schedule-evening-wake.plist
launchctl load ~/Library/LaunchAgents/com.livecity.sleep-evening.plist
```

Expected: No output, exit 0 for each.

- [ ] **Step 6: Verify the loaded set**

Run: `launchctl list | grep livecity`
Expected: Three entries — `com.livecity.sleep-morning`, `com.livecity.schedule-evening-wake`, `com.livecity.sleep-evening`.

- [ ] **Step 7: Update the morning `pmset repeat`**

Run: `sudo pmset repeat wakeorpoweron MTWRFSU 07:50:00`
Expected: No output. `pmset -g sched` shows `wakepoweron at 7:50AM every day`.

- [ ] **Step 8: Smoke-test the evening wake scheduler by running it manually**

Run: `launchctl start com.livecity.schedule-evening-wake`
Then: `pmset -g sched`
Expected: A one-shot `wake at MM/DD/YYYY 17:50:00` entry appears for today. If today's 17:50 has already passed, that entry will just be in the past — this is only a smoke test.

- [ ] **Step 9: No commit (these live on the Mac mini, not in git)**

---

## Task 13: Two-day evaluation checklist

Not code — observational. Leave these boxes unchecked until they've been verified in production.

- [ ] **Day 1, ~10:30 IST:** `appwrite functions list-executions --function-id price` shows ≥10 `completed` entries since 09:30 IST. Logs show `new_row` or `checked` for all 5 cities. Push notifications arrive in the mobile app when gold/silver moves.
- [ ] **Day 1, ~11:00 IST:** Logs from 10:35 IST onward show `Outside IST price window …, skipping` (the UTC cron keeps firing but the handler no-ops).
- [ ] **Day 1, ~16:00 IST:** Afternoon window executions look the same as morning.
- [ ] **Day 1, 18:31 IST:** Mac mini is asleep (`ping` from another host fails).
- [ ] **Day 2, 07:55 IST:** Mac mini is awake (ssh responds).
- [ ] **Day 2, 09:50 IST:** Mac mini is asleep. `pmset -g sched` (captured on day 1 before sleep) showed a 17:50 wake for day 2.
- [ ] **Day 2, 17:52 IST:** Mac mini is awake, news job logs a successful run at 18:00 IST.
- [ ] **Day 2, 18:31 IST:** Mac mini is asleep.

If all boxes check: the rollback block in `src/index.ts` can be deleted, the old `src/metals/*` + `src/extractor/metals-updater.ts` + `src/notifications/price-notifier.ts` + `src/run-price.ts` + their tests become candidates for deletion (a separate PR).

---

## Rollback

If anything goes sideways during the 2-day eval:

1. Disable the Appwrite function: `appwrite functions update --function-id price --enabled false` (keeps the deployment, just stops scheduling).
2. In `src/index.ts`, uncomment the `lalithaa-prices` block and restore the six deleted imports (Task 10 wraps the block in a single `/* … */` comment for easy revert).
3. Restart the local daemon: `npm run dev` resumes the 10-min local schedule.
4. Restore the Mac mini's old schedule: `launchctl unload` the two new agents, re-create/re-load `~/Library/LaunchAgents/com.livecity.sleep.plist` (18:30), and set `sudo pmset repeat wakeorpoweron MTWRFSU 07:30:00`.

---

## Self-review summary

- ✅ Spec coverage: Appwrite function, scheduler disable, Mac mini reschedule all have tasks.
- ✅ No placeholders — every code step has complete code.
- ✅ Type consistency: `pricesChanged`, `updatePriceForCity`, `fetchPrice`, `resolveStateIds`, `isWithinPriceWindow`, `buildPriceChangeEvent`, `sendPriceNotification` signatures match across tasks (updater returns `{ action, priorRow }`; handler destructures exactly that).
- ✅ Commits are small and revertible; Tasks 8 and 11 touch external systems and are separated from code commits.
