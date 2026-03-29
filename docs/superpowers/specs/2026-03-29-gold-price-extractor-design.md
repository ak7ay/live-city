# Gold Price Extractor — Design Spec

## Goal

Fetch gold, silver, and platinum prices from Lalithaa Jewellery's public API every 10 minutes during market hours (9 AM–4 PM IST), store in Appwrite, and only insert new rows when prices actually change or a new day begins.

## Data Source

**API:** `https://api.lalithaajewellery.com/public/pricings/latest?state_id={state_id}`

No auth required. Returns JSON with `gold`, `silver`, `platinum` prices per gram.

**Karnataka state_id:** `fbe51d69-c3ef-466f-a8f4-7c382759e35f`

No browser or AI agent needed — plain HTTP fetch.

## Appwrite Setup

### Project Setup (manual, one-time)

1. Sign up / log in at https://cloud.appwrite.io
2. Create project (name: `live-city`, region: Singapore)
3. Generate API key with Database read/write permissions
4. Add credentials to `.env`

### Programmatic Schema Setup (`src/setup-db.ts`)

A script that creates the database and collection via `node-appwrite` SDK. Idempotent — safe to run multiple times (skips if already exists).

**Database:** `live_city`

**Collection:** `metal_prices`

**Attributes:**

| Field | Type | Required | Description |
|---|---|---|---|
| `city` | string (64) | yes | `"bengaluru"` |
| `source` | string (64) | yes | `"lalithaa_jewellery"` |
| `gold_22k_price` | float | yes | per gram in ₹ |
| `silver_price` | float | yes | per gram in ₹ |
| `platinum_price` | float | yes | per gram in ₹ |
| `price_date` | string (10) | yes | IST date `"2026-03-29"` |
| `price_changed_at` | datetime | yes | when any price last changed |
| `last_checked_at` | datetime | yes | when we last polled the API |

**Indexes:**

| Name | Type | Fields | Purpose |
|---|---|---|---|
| `idx_city_date` | key | `[city, price_date]` | Lookup today's row for a city |
| `idx_city_date_desc` | key | `[city, price_date DESC]` | Get latest price for a city |

## Price Fetcher (`src/sources/lalithaa.ts`)

A plain function — no agent, no browser.

```typescript
async function fetchLalithaaPrice(stateId: string): Promise<{
  gold_22k_price: number;
  silver_price: number;
  platinum_price: number;
  rate_datetime: string;
}>
```

- Uses native `fetch()` (Node 22+)
- Validates response with zod
- Throws on non-200 or unexpected shape

## Scheduler (`src/scheduler.ts`)

Uses `node-cron` to run every 10 minutes between 9 AM and 4 PM IST.

Cron expression: `*/10 9-15 * * *` (timezone: `Asia/Kolkata`)

Note: `9-15` covers 9:00–15:59 IST. The 4 PM (16:00) final check is handled by adding `0 16 * * *` as a separate cron job.

## Insert/Update Logic (`src/extractor/price-updater.ts`)

On each scheduled tick:

1. Fetch prices from Lalithaa API
2. Query Appwrite for the latest row matching `city` + today's `price_date`
3. **No row for today** → insert new row (`price_changed_at` = now, `last_checked_at` = now)
4. **Row exists, prices differ** → insert new row (`price_changed_at` = now, `last_checked_at` = now)
5. **Row exists, prices same** → update existing row's `last_checked_at` = now

"Prices differ" means any of `gold_22k_price`, `silver_price`, or `platinum_price` changed.

## File Structure

```
src/
├── index.ts              # Entry point — starts scheduler
├── setup-db.ts           # One-time Appwrite schema setup (run manually)
├── config/
│   └── appwrite.ts       # Appwrite client init from env vars
├── sources/
│   └── lalithaa.ts       # Fetch prices from Lalithaa API
├── extractor/
│   └── price-updater.ts  # Compare + insert/update logic
└── scheduler.ts          # Cron job setup
```

## Environment Variables

```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<from console>
APPWRITE_API_KEY=<from console>
```

## Error Handling

- API fetch failure → log error, skip this tick, retry next tick
- Appwrite write failure → log error, skip this tick
- All errors logged via `pino`
- No crash on transient failures — scheduler keeps running

## What This Does NOT Cover

- Mobile app / frontend (reads from Appwrite directly via client SDK)
- Other data sources (news, events) — separate extractors later
- AI agent extraction — not needed for this structured API
- Gold 24K — not available from this source
