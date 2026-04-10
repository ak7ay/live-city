# Price Change Notifications — Design

**Status:** Draft
**Date:** 2026-04-10
**Scope:** Backend (`live-city`) and Android (`live-city-android`)

## Goal

When the gold or silver price changes for a city, push a notification to all installed app builds for that city. The notification shows the *delta* (e.g., `Gold ▲ ₹120/g · Silver ▼ ₹3/g`) but never the absolute price, so users have to open the app to see the current rate. Platinum changes are silent. Expected volume: ~2 notifications per city per day.

## Non-goals

- User accounts, login, or per-user preferences
- Per-event watchlists or item-level subscriptions
- In-app notification center / history
- Tap-to-deep-link into a specific screen (current behavior — launching the app to its default screen — is sufficient)
- Notification for first-ever price row (no prior value to diff against)
- Notifications for platinum
- Notifications for News or Events pipelines (separate work if ever needed)

## Architecture

When the price pipeline detects a gold or silver change for a city, the backend publishes a push notification to a city-scoped Appwrite Messaging topic. The Android app, on launch, subscribes to its build flavor's city topic. Appwrite Messaging fans the push out to FCM, which delivers it to all installed devices for that city's app build.

```
┌─────────────────────┐
│ Lalithaa price API  │
└──────────┬──────────┘
           │ poll every 10 min, 9–16 IST (existing cron)
           ▼
┌─────────────────────────────────────┐
│ src/extractor/metals-updater.ts     │
│   detect change → write DB row      │
│   ↓ (new)                           │
│   sendPriceNotification(city, Δ)    │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ src/notifications/price-notifier.ts │
│   build delta message               │
│   call Appwrite Messaging           │
└──────────┬──────────────────────────┘
           │ topic: prices-{city}
           ▼
┌─────────────────────┐
│ Appwrite Messaging  │ ──► FCM ──► Android device
└─────────────────────┘             (Live <City> app)
```

## Components

Five units, each with a single responsibility.

### Backend (`live-city`)

#### B1. `src/notifications/price-notifier.ts` *(new)*

The only file that knows how to send a push.

```ts
export interface PriceDelta {
  metal: "gold" | "silver";
  oldPrice: number;       // ₹/gram
  newPrice: number;       // ₹/gram
  delta: number;          // newPrice - oldPrice
}

export interface PriceChangeEvent {
  city: string;            // "bengaluru" — slug, used in topic name
  cityDisplayName: string; // "Bengaluru" — used in notification title
  deltas: PriceDelta[];    // 1 or 2 entries (gold and/or silver)
}

export async function sendPriceNotification(
  messaging: Messaging,
  event: PriceChangeEvent,
): Promise<void>;
```

Responsibilities:
- Format the title + body from `PriceChangeEvent` (see "Message format" below)
- Call `messaging.createPush({ topics: [\`prices-\${event.city}\`], title, body })`
- Log success/failure via the existing `logger` from `src/config/logger.ts`
- May throw on Appwrite errors — the caller wraps the call in a try/catch and swallows failures so the price-write path is never affected

The notifier knows nothing about the `metal_prices` table or the price pipeline. It is testable in isolation with a stub `messaging` client.

Also exports a pure helper:

```ts
export function buildPriceChangeEvent(
  city: string,
  oldRow: PriceRecord,
  newPrices: PriceInput,
): PriceChangeEvent;
```

This builder is the unit-test seam — it has no side effects and can be exhaustively covered.

#### B2. `src/extractor/metals-updater.ts` *(modified)*

Already detects changes and writes new rows. Changes:

1. The function signature gains a `messaging: Messaging` parameter so the Appwrite Messaging client can be passed in by the orchestrator (no module-level singleton).
2. A new helper `fetchMostRecentRowBefore(db, city, source, today): Promise<PriceRecord | undefined>` queries the latest row for `(city, source)` with `price_date < today`, ordered by `$createdAt` desc, limit 1. Used to find yesterday's last snapshot for cross-day comparison.
3. After the existing `db.createRow(...)` succeeds, determine the **prior row** to diff against:
   - If `existing` is defined (a row from earlier today), use it as `priorRow`.
   - Otherwise (this is the first row of the day for this city), call `fetchMostRecentRowBefore(...)` to get yesterday's last row. If that also returns undefined (first row ever for the city), there is no prior to diff against.
4. If `priorRow` exists, build a `PriceChangeEvent` from `priorRow` → `prices`. If `event.deltas.length > 0`, call `sendPriceNotification(...)` wrapped in try/catch.
5. The push call is **strictly after** the DB write — the DB write must complete first. If the push fails it is logged and swallowed; the function returns normally and the next price tick proceeds as usual.

**Why the cross-day lookup matters:** the Lalithaa source publishes ~2 updates per day. If we only diffed against rows with the same `price_date`, the first poll of every day would silently skip notification (because there's no row yet for "today") and users would miss the morning update. The cross-day fallback ensures the morning update is properly compared against yesterday's last value.

The "platinum-only changed" case naturally falls out: `buildPriceChangeEvent` only adds gold and silver deltas, so `event.deltas.length === 0` and no push is sent.

The "first-ever row for the city" case naturally falls out: both `existing` and `fetchMostRecentRowBefore` return undefined, so no push is attempted.

#### B3. `src/config/appwrite.ts` *(modified)*

Add a `createMessaging(client)` factory next to the existing `createTablesDB(client)`. One line, mirrors the existing pattern. The Appwrite SDK exports `Messaging` from `node-appwrite`.

#### B4. `src/config/constants.ts` *(modified)*

Add a `CITY_DISPLAY_NAMES` map and a `cityDisplayName(slug)` helper:

```ts
export const CITY_DISPLAY_NAMES: Record<string, string> = {
  bengaluru: "Bengaluru",
  chennai: "Chennai",
  hyderabad: "Hyderabad",
  vijayawada: "Vijayawada",
  puducherry: "Puducherry",
};

export function cityDisplayName(slug: string): string {
  return CITY_DISPLAY_NAMES[slug] ?? slug;
}
```

The slug list mirrors `config/sources/lalithaa.yaml`. If a new city is added there, it must also be added here (or the notification falls back to the slug).

#### B5. `src/index.ts` and `src/run-price.ts` *(modified)*

Both call `updatePriceForCity(...)`. Each must instantiate the messaging client once via `createMessaging(client)` and pass it through.

### Android (`live-city-android`)

#### A1. `app/build.gradle.kts` *(modified)*

The Appwrite Android SDK supports push targets but does not bundle the Firebase SDK. Add:

- `com.google.firebase:firebase-messaging-ktx` dependency
- `com.google.gms:google-services` Gradle plugin
- A `google-services.json` file for each flavor under `app/src/<flavor>/`

This is what allows the device to obtain an FCM registration token, which Appwrite then registers as a push target.

#### A2. `app/src/main/java/com/hanif/city/notifications/PriceNotificationService.kt` *(new)*

A `FirebaseMessagingService` subclass with two responsibilities:

1. **`onNewToken(token)`** — performs the Appwrite push registration:
   1. Ensure an Appwrite session exists. The app currently has no login flow, so we use an **anonymous session** via `account.createAnonymousSession()`. If a session already exists, this is a no-op (catch the "already exists" error).
   2. Register the FCM token with Appwrite via `account.createPushTarget(targetId, identifier=token, providerId=<FCM provider id>)`.
   3. Subscribe the resulting target to topic `prices-${BuildConfig.CITY_ID}` via `messaging.createSubscriber(...)`.
   4. All three operations must be **idempotent** — `onNewToken` can fire multiple times across the app's lifetime (token rotation, app reinstall, etc.). The implementation catches "already exists" errors and treats them as success.
2. **`onMessageReceived(message)`** — empty for now. Notification messages from Appwrite/FCM are auto-displayed by the system; we don't need to build the notification ourselves. This method exists only because Android requires it on the service class.

Registered in `AndroidManifest.xml` with the `com.google.firebase.MESSAGING_EVENT` intent filter.

#### A3. `LiveCityApplication` *(modified)*

On app start:

- Request `POST_NOTIFICATIONS` runtime permission (Android 13+)
- Trigger Firebase token initialization (`FirebaseMessaging.getInstance().token`) which fires `onNewToken` if a token exists or is generated
- Ensure an anonymous Appwrite session is created on first launch (so the push target registration in `onNewToken` has something to attach to). This may already happen elsewhere in `AppContainer` setup — check before duplicating.

The application class already manages the `AppContainer` for manual DI; the Appwrite client used by `PriceNotificationService` should be obtained from there.

## Trigger conditions

A push fires when **all** of these are true:

1. The Lalithaa poll for a city returns prices
2. The new row was successfully written to Appwrite (i.e., the price actually changed vs. the existing same-day row, or it's the first row of the day)
3. A **prior row** exists to diff against — either earlier today or yesterday's last row (so this is not the first-ever row for this city)
4. `gold_22k_price` OR `silver_price` in the new row differs from the prior row (platinum-only diffs are silent)

If any one of these is false → no push.

## Message format

**Title (always):** `<CityDisplayName> rates updated`

**Body (depends on which deltas exist):**

| Case | Body |
|---|---|
| Gold only | `Gold ▲ ₹120/g — tap to see today's price` |
| Silver only | `Silver ▼ ₹3/g — tap to see today's price` |
| Both | `Gold ▲ ₹120/g · Silver ▼ ₹3/g — tap to see today's price` |

Formatting rules:
- **Direction symbol:** `▲` for positive delta, `▼` for negative
- **Sign:** the symbol *replaces* the +/- sign — body uses the absolute value of the delta. So `delta: -3` renders as `▼ ₹3/g`.
- **Per-gram unit:** always `/g` suffix. The Lalithaa API returns prices per gram (verified against a live response: gold `13965.0`, silver `252.0`).
- **Currency:** `₹` prefix with no space.
- **No decimals:** values are rounded with `Math.round()` for safety in case the API ever returns fractional values.
- **Order in "both" case:** gold first, then silver.

### Worked examples

| Old → New | Body |
|---|---|
| Gold 13965 → 14085 | `Gold ▲ ₹120/g — tap to see today's price` |
| Silver 252 → 249 | `Silver ▼ ₹3/g — tap to see today's price` |
| Gold 13965 → 14085, Silver 252 → 249 | `Gold ▲ ₹120/g · Silver ▼ ₹3/g — tap to see today's price` |
| Platinum 7500 → 7600 only | (no notification — silent) |

## FCM message type

We send **notification messages** (not data messages):

- Appwrite/FCM auto-builds and displays the system notification using the `title` + `body` you send
- App doesn't need to handle `onMessageReceived`
- Works even when the app is killed
- Tap → opens the app to its default launcher activity

If we later want to deep-link into a specific screen, we can layer a small `data` payload on top (out of scope for this spec).

## Topic naming

Format: `prices-<city_slug>`

Examples: `prices-bengaluru`, `prices-chennai`, `prices-hyderabad`, `prices-vijayawada`, `prices-puducherry`

The `city_slug` matches:
- The keys in `config/sources/lalithaa.yaml` `states[].city`
- `BuildConfig.CITY_ID` in the Android flavor (`app/build.gradle.kts`)
- The `city` column in the `metal_prices` Appwrite table

The same string flows end-to-end with no translation. Adding a new city = add the entry to `lalithaa.yaml`, add the `CITY_DISPLAY_NAMES` entry, create the topic in Appwrite, add a Gradle flavor.

## End-to-end happy path

```
09:48 IST  Lalithaa updates Karnataka gold: 13965 → 14085 (yesterday's last value was 13965)
09:50 IST  Backend cron tick fires
           ├─ fetchPrice() returns { gold: 14085, silver: 252, platinum: 7500 }
           ├─ updatePriceForCity(db, messaging, "bengaluru", "lalithaa_jewellery", prices)
           │  ├─ existing today's row → undefined (first poll of the day)
           │  ├─ db.createRow(...)             ← DB write succeeds
           │  ├─ priorRow = fetchMostRecentRowBefore(...) → yesterday's last row (gold=13965)
           │  ├─ buildPriceChangeEvent(priorRow, prices) → { deltas: [{metal:"gold", delta:+120}] }
           │  └─ try { sendPriceNotification(messaging, event) } catch (logged, swallowed)
           │     └─ messaging.createPush({
           │           topics: ["prices-bengaluru"],
           │           title: "Bengaluru rates updated",
           │           body:  "Gold ▲ ₹120/g — tap to see today's price"
           │         })
           ▼
        Appwrite Messaging → FCM → all "Live Bengaluru" devices subscribed to prices-bengaluru

14:50 IST  Lalithaa updates afternoon gold: 14085 → 14200
           ├─ existing today's row found (gold=14085, from this morning)
           ├─ db.createRow(...) → new row for the afternoon update
           ├─ priorRow = existing (today's morning row)
           └─ Push: "Gold ▲ ₹115/g — tap to see today's price"
```

## Error handling

**Cardinal rule:** push failure must never break the price-write path. The DB write is critical; the push is best-effort.

```ts
// in metals-updater.ts, after db.createRow(...)
if (existing) {
  const event = buildPriceChangeEvent(city, existing, prices);
  if (event.deltas.length > 0) {
    try {
      await sendPriceNotification(messaging, event);
    } catch (err) {
      logger.error({ city, event, err }, "Failed to send price push notification");
      // swallow — DB write already succeeded; do not retry
    }
  }
}
```

**No retries.** If a push fails, it's gone. Reasoning:

- The next real price change (typically a few hours later) will trigger a new push
- Retrying risks duplicate notifications if the first did go through but the response was lost
- "Max ~2/day" is a feature; an extra retry-driven push is worse than a missed one

**Logging.** Every push attempt logs (success or failure) to `logs/app.log` with `{city, deltas, topic}` so the existing log monitoring is sufficient — no separate notification table.

## Edge cases

| Case | Behavior |
|---|---|
| First-ever row for a city (no row anywhere in the table) | DB write only, no push (no prior row to diff against) |
| First poll of a new day, price changed overnight | DB write, **then push** — `fetchMostRecentRowBefore` returns yesterday's last row, delta is computed across the day boundary |
| First poll of a new day, price unchanged from yesterday | DB write (a fresh row with today's `price_date`), then `buildPriceChangeEvent` returns `deltas: []` → no push |
| Only `platinum_price` changed | `event.deltas.length === 0` → no push, DB row still written |
| Both gold and silver changed | One push, combined body |
| Same poll runs twice in the same day | Second poll → `pricesChanged()` against today's row → false → no DB write, no push (idempotent) |
| Lalithaa returns garbage | Out of scope — Zod schema in `src/metals/lalithaa.ts` validates the response |
| Appwrite Messaging is down | Push throws, logged + swallowed, DB write already committed |
| Appwrite topic doesn't exist | First push fails — see "Manual steps" below; topics created once during deploy |
| User has notifications disabled | OS silently drops the push, backend can't tell |
| Two cities update in the same tick | `Promise.allSettled` in `index.ts` already isolates them |
| Silver moves by ₹1 (small noise) | Still triggers a push — no threshold, source is trusted |
| Process restart mid-day | No state to lose; next poll behaves normally |

## Testing

### Backend unit tests — `src/notifications/price-notifier.test.ts` *(new)*

- `buildPriceChangeEvent`: gold-only, silver-only, both, platinum-only (returns empty deltas), no change at all
- Message body formatter: positive delta uses `▲`, negative uses `▼`, absolute value, single-metal vs combined cases
- `sendPriceNotification`: given a stub `Messaging` object, asserts the right `topics`, `title`, `body` are passed. No real network.

### Backend integration test — extending existing tests for `metals-updater.ts`

Stub `db` and `messaging`. Verify:

1. First call (no existing row) → DB write happens, **no push call**
2. Second call (gold changed) → DB write happens, **then exactly one push call**
3. Third call (only platinum changed) → DB write happens, **no push call**
4. Push throws → DB write still happened, error logged, function returns normally

### Android tests — `PriceNotificationServiceTest.kt` *(new)*

- `onNewToken`: verifies the token is registered with Appwrite and subscribed to `prices-${BuildConfig.CITY_ID}`
- Notification permission flow: verifies request happens on first launch (Android 13+)

### Manual end-to-end smoke test

Required before merge. Listed in "Manual steps" below.

## Manual steps required after implementation

These steps are **not code** and must be done by a human after the implementation lands. They are listed here so they can be tracked as a TODO when reviewing the merge.

1. **Appwrite console — Messaging → Topics:** create one push topic per city. Topic names must exactly match `prices-<city_slug>`:
   - `prices-bengaluru`
   - `prices-chennai`
   - `prices-hyderabad`
   - `prices-vijayawada`
   - `prices-puducherry`

2. **Firebase console:** create (or reuse) a Firebase project. Generate a service account JSON with the FCM permissions Appwrite requires.

3. **Appwrite console — Messaging → Providers:** add the FCM provider with the service account JSON from step 2.

4. **Android — `google-services.json`:** download from Firebase and place at `app/src/<flavor>/google-services.json` for each city flavor (currently only `bengaluru` exists). Do **not** commit this file if it contains secrets — add to `.gitignore` if not already.

5. **Backend API key scope:** verify the Appwrite API key the backend uses has `messaging.write` scope. Add it via the Appwrite console if missing.

6. **Smoke test on a real device** (emulators are unreliable for FCM):
   1. `./gradlew installBengaluruDebug`
   2. Launch the app, grant the notification permission prompt
   3. Run a small dev script that calls `sendPriceNotification` with a fake `PriceChangeEvent` for `bengaluru`
   4. Verify the notification appears within ~5 seconds with the correct title and body
   5. Tap the notification — verify the app launches to its default screen

7. **Production rollout:** once smoke test passes on a debug build, ship a release build through the existing Play Store flow.

## Open questions

None at design time. All decisions made during brainstorming:

- City-scoped topics ✓
- One combined notification for gold + silver ✓
- Platinum is silent ✓
- Delta-only message (no absolute price) ✓
- Per-gram unit shown in body ✓
- ▲ / ▼ direction symbols ✓
- No threshold, no dedup window (source is trusted) ✓
- Inline call from `metals-updater.ts` after DB write ✓
- Appwrite Messaging as the transport ✓
- Per-flavor build → `BuildConfig.CITY_ID` drives topic subscription ✓
