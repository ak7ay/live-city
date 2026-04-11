# Price Change Notifications — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the price pipeline detects a gold or silver price change for a city, send a city-scoped push notification via Appwrite Messaging with a delta-only message body (e.g., `Gold ▲ ₹120/g · Silver ▼ ₹3/g — tap to see today's price`).

**Architecture:** A new isolated `price-notifier` module formats the push payload and calls Appwrite Messaging. `metals-updater.ts` calls it inline after a successful DB write, with cross-day comparison so the first poll of each day still produces a notification when the price changed overnight. Push failures are caught and logged so the price-write path is never affected.

**Tech Stack:** TypeScript, Node 22, `node-appwrite` SDK (`Messaging` class), Vitest, `pino` logger (already in tree).

**Spec:** `docs/superpowers/specs/2026-04-10-price-change-notifications-design.md`

**Scope:** **Backend only.** The Android-side push subscription work is a separate sub-project and will be its own plan (different repo `live-city-android`, different toolchain). The manual setup steps (Appwrite topic creation, Firebase project, FCM provider, API key scopes) are listed at the end of this plan as deployment TODOs and are **not** code tasks.

---

## File Structure

**New files:**

- `src/notifications/price-notifier.ts` — pure functions for `buildPriceChangeEvent`, `formatNotificationBody`, plus the side-effecting `sendPriceNotification`. Knows nothing about the price pipeline or the `metal_prices` table.
- `test/notifications/price-notifier.test.ts` — covers the pure formatters with full case matrix; covers `sendPriceNotification` against a stubbed `Messaging` client.

**Modified files:**

- `src/config/constants.ts` — adds `CITY_DISPLAY_NAMES` map and `cityDisplayName(slug)` helper.
- `src/config/appwrite.ts` — adds `createMessaging(client)` factory.
- `src/extractor/metals-updater.ts` — adds `messaging` parameter to `updatePriceForCity`, adds `fetchMostRecentRowBefore` helper, calls `sendPriceNotification` inline after a successful `db.createRow(...)` with cross-day prior-row lookup.
- `test/extractor/price-updater.test.ts` — extends existing tests with the new push call assertions and the cross-day fallback case.
- `src/index.ts` — instantiates `messaging` once and passes it through to `updatePriceForCity` from the cron tick.
- `src/run-price.ts` — same change for the one-shot CLI runner.

**Why this layout:** The notifier is a self-contained unit (one file, one responsibility, fully unit-testable in isolation). The updater file grows by ~30 lines but stays focused on "detect change → write row → notify." Cross-cutting helpers (`createMessaging`, `cityDisplayName`) live in their existing config files alongside their siblings.

---

## Conventions

- **Test framework:** Vitest. Run with `npm test` (full suite) or `npx vitest run path/to/test.ts` (single file). The pre-commit hook runs `npm run check` (Biome + tsc) which is enforced — do not bypass.
- **Test mock pattern:** Mirror `test/extractor/price-updater.test.ts` — top-level `vi.mock("../../src/config/logger.js", ...)` and a `makeDb()` factory returning `vi.fn()` stubs. Use `vi.useFakeTimers()` + `vi.setSystemTime(...)` for any test that touches `getTodayIST()`.
- **Imports:** This project uses ESM with `.js` extensions on relative imports even from `.ts` source. Always import as `from "../../src/notifications/price-notifier.js"`.
- **No `any` types** in production code. Use proper Appwrite SDK types (`TablesDB`, `Messaging`).
- **Commit cadence:** One commit per task (not per step). Each commit message follows the conventional-commits style already in the repo (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).

---

## Task 1 — Add `cityDisplayName` helper

**Files:**
- Modify: `src/config/constants.ts`
- Test: `test/config/constants.test.ts` *(new)*

Self-contained, no dependencies on other tasks. Establishes the display-name lookup that the notifier title uses.

- [ ] **Step 1: Write the failing test**

Create `test/config/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cityDisplayName, CITY_DISPLAY_NAMES } from "../../src/config/constants.js";

describe("cityDisplayName", () => {
	it("returns the title-case display name for a known slug", () => {
		expect(cityDisplayName("bengaluru")).toBe("Bengaluru");
		expect(cityDisplayName("chennai")).toBe("Chennai");
		expect(cityDisplayName("hyderabad")).toBe("Hyderabad");
		expect(cityDisplayName("vijayawada")).toBe("Vijayawada");
		expect(cityDisplayName("puducherry")).toBe("Puducherry");
	});

	it("falls back to the slug if the city is not in the map", () => {
		expect(cityDisplayName("mumbai")).toBe("mumbai");
	});

	it("exports the map covering all configured cities", () => {
		expect(Object.keys(CITY_DISPLAY_NAMES).sort()).toEqual(
			["bengaluru", "chennai", "hyderabad", "puducherry", "vijayawada"],
		);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/config/constants.test.ts
```

Expected: FAIL with `cityDisplayName` / `CITY_DISPLAY_NAMES` is not exported.

- [ ] **Step 3: Add the helper to `src/config/constants.ts`**

Append to the existing file:

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

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/config/constants.test.ts
```

Expected: PASS, all 3 tests green.

- [ ] **Step 5: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 6: Commit**

```bash
git add src/config/constants.ts test/config/constants.test.ts
git commit -m "feat(config): add cityDisplayName helper for notifications"
```

---

## Task 2 — Add `createMessaging` factory

**Files:**
- Modify: `src/config/appwrite.ts`
- Test: `test/config/appwrite.test.ts` *(extend existing if present, otherwise create)*

Mirrors the existing `createTablesDB` pattern. Must come before Task 4 (which imports `Messaging` type from `node-appwrite`).

- [ ] **Step 1: Inspect the existing `createTablesDB` factory**

```bash
cat src/config/appwrite.ts
```

Expected: 14 lines, exports `createAppwriteClient` and `createTablesDB`.

- [ ] **Step 2: Inspect any existing test for this file**

```bash
ls test/config/appwrite.test.ts 2>/dev/null && cat test/config/appwrite.test.ts
```

If the file exists, the new test goes inside its `describe` block. If not, create a fresh file in step 3.

- [ ] **Step 3: Write the failing test**

Append to `test/config/appwrite.test.ts` (or create it):

```ts
import { Client, Messaging } from "node-appwrite";
import { describe, expect, it } from "vitest";
import { createMessaging } from "../../src/config/appwrite.js";

describe("createMessaging", () => {
	it("returns a Messaging instance bound to the supplied client", () => {
		const client = new Client()
			.setEndpoint("https://example.appwrite.io/v1")
			.setProject("test-project")
			.setKey("test-key");

		const messaging = createMessaging(client);

		expect(messaging).toBeInstanceOf(Messaging);
	});
});
```

If creating the file fresh, also add the necessary file header — no other imports needed.

- [ ] **Step 4: Run the test to verify it fails**

```bash
npx vitest run test/config/appwrite.test.ts
```

Expected: FAIL with `createMessaging is not a function` (or similar import error).

- [ ] **Step 5: Add the factory to `src/config/appwrite.ts`**

Replace the file contents with:

```ts
import { Client, Messaging, TablesDB } from "node-appwrite";
import type { EnvConfig } from "./env.js";

export function createAppwriteClient(env: EnvConfig): Client {
	return new Client()
		.setEndpoint(env.APPWRITE_ENDPOINT)
		.setProject(env.APPWRITE_PROJECT_ID)
		.setKey(env.APPWRITE_API_KEY);
}

export function createTablesDB(client: Client): TablesDB {
	return new TablesDB(client);
}

export function createMessaging(client: Client): Messaging {
	return new Messaging(client);
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run test/config/appwrite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 8: Commit**

```bash
git add src/config/appwrite.ts test/config/appwrite.test.ts
git commit -m "feat(config): add createMessaging factory"
```

---

## Task 3 — Notifier: pure helpers (`buildPriceChangeEvent`, `formatNotificationBody`)

**Files:**
- Create: `src/notifications/price-notifier.ts`
- Create: `test/notifications/price-notifier.test.ts`

This task adds the **pure** parts of the notifier — no Appwrite calls. The side-effecting `sendPriceNotification` is added in Task 4. Splitting them lets us TDD the formatting matrix exhaustively without mocking.

- [ ] **Step 1: Write the failing tests**

Create `test/notifications/price-notifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildPriceChangeEvent,
	formatNotificationBody,
	type PriceChangeEvent,
} from "../../src/notifications/price-notifier.js";
import type { PriceInput, PriceRecord } from "../../src/extractor/metals-updater.js";

const priorRow: PriceRecord = {
	$id: "row-prior",
	city: "bengaluru",
	source: "lalithaa_jewellery",
	gold_22k_price: 13965,
	silver_price: 252,
	platinum_price: 7500,
	price_date: "2026-04-09",
	price_changed_at: "2026-04-09T09:00:00.000Z",
	last_checked_at: "2026-04-09T09:00:00.000Z",
};

describe("buildPriceChangeEvent", () => {
	it("returns gold-only delta when only gold changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event).toEqual({
			city: "bengaluru",
			cityDisplayName: "Bengaluru",
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		});
	});

	it("returns silver-only delta when only silver changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 13965, silver_price: 249, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([
			{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 },
		]);
	});

	it("returns gold + silver deltas when both changed (gold first)", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085, silver_price: 249, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([
			{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 },
			{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 },
		]);
	});

	it("returns empty deltas when only platinum changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 13965, silver_price: 252, platinum_price: 7600 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([]);
	});

	it("returns empty deltas when nothing changed", () => {
		const newPrices: PriceInput = { gold_22k_price: 13965, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		expect(event.deltas).toEqual([]);
	});

	it("uses the slug as display name when the city is unknown", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("mumbai", { ...priorRow, city: "mumbai" }, newPrices);
		expect(event.cityDisplayName).toBe("mumbai");
	});

	it("rounds fractional deltas with Math.round", () => {
		const newPrices: PriceInput = { gold_22k_price: 14085.6, silver_price: 252, platinum_price: 7500 };
		const event = buildPriceChangeEvent("bengaluru", priorRow, newPrices);
		// delta is captured raw; the formatter rounds it
		expect(event.deltas[0].delta).toBeCloseTo(120.6);
	});
});

describe("formatNotificationBody", () => {
	const base: PriceChangeEvent = {
		city: "bengaluru",
		cityDisplayName: "Bengaluru",
		deltas: [],
	};

	it("formats gold-only positive delta with ▲", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		});
		expect(body).toBe("Gold ▲ ₹120/g — tap to see today's price");
	});

	it("formats silver-only negative delta with ▼ and absolute value", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 }],
		});
		expect(body).toBe("Silver ▼ ₹3/g — tap to see today's price");
	});

	it("formats combined gold + silver in correct order", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [
				{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 },
				{ metal: "silver", oldPrice: 252, newPrice: 249, delta: -3 },
			],
		});
		expect(body).toBe("Gold ▲ ₹120/g · Silver ▼ ₹3/g — tap to see today's price");
	});

	it("rounds fractional deltas to integers", () => {
		const body = formatNotificationBody({
			...base,
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085.6, delta: 120.6 }],
		});
		expect(body).toBe("Gold ▲ ₹121/g — tap to see today's price");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/notifications/price-notifier.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the notifier file with the pure helpers**

Create `src/notifications/price-notifier.ts`:

```ts
import { cityDisplayName } from "../config/constants.js";
import type { PriceInput, PriceRecord } from "../extractor/metals-updater.js";

export interface PriceDelta {
	metal: "gold" | "silver";
	oldPrice: number;
	newPrice: number;
	delta: number;
}

export interface PriceChangeEvent {
	city: string;
	cityDisplayName: string;
	deltas: PriceDelta[];
}

export function buildPriceChangeEvent(
	city: string,
	priorRow: PriceRecord,
	newPrices: PriceInput,
): PriceChangeEvent {
	const deltas: PriceDelta[] = [];

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

function formatDelta(delta: PriceDelta): string {
	const symbol = delta.delta >= 0 ? "▲" : "▼";
	const magnitude = Math.round(Math.abs(delta.delta));
	const label = delta.metal === "gold" ? "Gold" : "Silver";
	return `${label} ${symbol} ₹${magnitude}/g`;
}

export function formatNotificationBody(event: PriceChangeEvent): string {
	const parts = event.deltas.map(formatDelta).join(" · ");
	return `${parts} — tap to see today's price`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/notifications/price-notifier.test.ts
```

Expected: PASS, all 11 tests green.

- [ ] **Step 5: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 6: Commit**

```bash
git add src/notifications/price-notifier.ts test/notifications/price-notifier.test.ts
git commit -m "feat(notifications): add price-notifier pure helpers"
```

---

## Task 4 — Notifier: `sendPriceNotification` (Appwrite Messaging call)

**Files:**
- Modify: `src/notifications/price-notifier.ts`
- Modify: `test/notifications/price-notifier.test.ts`

Adds the side-effecting function that calls `messaging.createPush(...)`. Tested against a stubbed Messaging client.

- [ ] **Step 1: Verify the `Messaging.createPush` API surface**

Run a quick exploration to confirm the parameter names:

```bash
grep -rn "createPush" node_modules/node-appwrite/dist/services/messaging.d.ts | head
```

Expected: a method signature like `createPush(messageId, title, body, topics, ...)`. Confirm the parameter order before writing the test. The exact signature for the version in `package.json` (`node-appwrite@^23.0.0`) is what the implementation must match.

Note for the implementer: if the SDK version takes a single object argument instead of positional args, adapt steps 3 + 4 accordingly. The shape you pass must include at minimum `messageId`, `title`, `body`, and `topics: [<topic>]`. Use `node-appwrite`'s `ID.unique()` helper for `messageId`.

- [ ] **Step 2: Add the failing test**

Append to `test/notifications/price-notifier.test.ts`:

```ts
import { sendPriceNotification } from "../../src/notifications/price-notifier.js";

describe("sendPriceNotification", () => {
	function makeMessaging() {
		return {
			createPush: vi.fn().mockResolvedValue({}),
		};
	}

	it("sends a push to the city-scoped topic with the formatted body", async () => {
		const messaging = makeMessaging();
		const event: PriceChangeEvent = {
			city: "bengaluru",
			cityDisplayName: "Bengaluru",
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		};

		await sendPriceNotification(messaging as any, event);

		expect(messaging.createPush).toHaveBeenCalledOnce();
		const args = messaging.createPush.mock.calls[0];
		// The call must include the topic, title, and body somewhere in its arguments.
		const flattened = JSON.stringify(args);
		expect(flattened).toContain("prices-bengaluru");
		expect(flattened).toContain("Bengaluru rates updated");
		expect(flattened).toContain("Gold ▲ ₹120/g — tap to see today's price");
	});

	it("propagates errors from the messaging client", async () => {
		const messaging = makeMessaging();
		messaging.createPush.mockRejectedValue(new Error("appwrite down"));

		const event: PriceChangeEvent = {
			city: "bengaluru",
			cityDisplayName: "Bengaluru",
			deltas: [{ metal: "gold", oldPrice: 13965, newPrice: 14085, delta: 120 }],
		};

		await expect(sendPriceNotification(messaging as any, event)).rejects.toThrow("appwrite down");
	});
});
```

You will also need to add `vi` to the existing top-of-file import: change `import { describe, expect, it } from "vitest";` to `import { describe, expect, it, vi } from "vitest";`.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run test/notifications/price-notifier.test.ts
```

Expected: FAIL with `sendPriceNotification is not exported`.

- [ ] **Step 4: Implement `sendPriceNotification`**

Add to `src/notifications/price-notifier.ts`. First update the imports at the top of the file:

```ts
import { ID, type Messaging } from "node-appwrite";
import { logger } from "../config/logger.js";
import { cityDisplayName } from "../config/constants.js";
import type { PriceInput, PriceRecord } from "../extractor/metals-updater.js";
```

Then append at the bottom of the file:

```ts
export async function sendPriceNotification(
	messaging: Messaging,
	event: PriceChangeEvent,
): Promise<void> {
	const topic = `prices-${event.city}`;
	const title = `${event.cityDisplayName} rates updated`;
	const body = formatNotificationBody(event);

	try {
		await messaging.createPush({
			messageId: ID.unique(),
			title,
			body,
			topics: [topic],
		});
		logger.info({ city: event.city, topic, deltas: event.deltas }, "Sent price push notification");
	} catch (err) {
		logger.error({ city: event.city, topic, deltas: event.deltas, err }, "Failed to send price push notification");
		throw err;
	}
}
```

**If the installed `node-appwrite@23` version of `createPush` uses positional arguments** instead of an object, swap the call to match — for example:

```ts
await messaging.createPush(
	ID.unique(),
	title,
	body,
	[topic], // topics
);
```

Whichever shape the SDK expects, the test in step 2 only asserts that the topic, title, and body all appear *somewhere* in the call args, so it stays valid either way.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run test/notifications/price-notifier.test.ts
```

Expected: PASS, all 13 tests green.

- [ ] **Step 6: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

If `tsc` complains about the `createPush` argument shape, fix the call to match the actual SDK signature (the test is shape-agnostic).

- [ ] **Step 7: Commit**

```bash
git add src/notifications/price-notifier.ts test/notifications/price-notifier.test.ts
git commit -m "feat(notifications): add sendPriceNotification via Appwrite Messaging"
```

---

## Task 5 — `metals-updater.ts`: cross-day prior-row helper

**Files:**
- Modify: `src/extractor/metals-updater.ts`
- Modify: `test/extractor/price-updater.test.ts`

Adds `fetchMostRecentRowBefore` so the first poll of a new day can still compare against yesterday's last value. Pure DB-query logic, no notification yet — that comes in Task 6.

- [ ] **Step 1: Add the failing test**

First, update the existing top-of-file import to also bring in `fetchMostRecentRowBefore`:

```ts
import {
	fetchMostRecentRowBefore,
	type PriceInput,
	type PriceRecord,
	updatePriceForCity,
} from "../../src/extractor/metals-updater.js";
```

Then append a new sibling `describe` block to the file (outside the existing `describe("updatePriceForCity", ...)`):

```ts
describe("fetchMostRecentRowBefore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-10T10:00:00+05:30"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the latest row whose price_date is strictly before the given date", async () => {
		const db = makeDb();
		const yesterdayRow: PriceRecord = {
			$id: "row-yesterday",
			city: "bengaluru",
			source: "lalithaa_jewellery",
			gold_22k_price: 13965,
			silver_price: 252,
			platinum_price: 7500,
			price_date: "2026-04-09",
			price_changed_at: "2026-04-09T14:00:00.000Z",
			last_checked_at: "2026-04-09T14:00:00.000Z",
		};
		db.listRows.mockResolvedValue({ rows: [yesterdayRow], total: 1 });

		const result = await fetchMostRecentRowBefore(db as any, "bengaluru", "lalithaa_jewellery", "2026-04-10");

		expect(result).toEqual(yesterdayRow);
		expect(db.listRows).toHaveBeenCalledOnce();
		const queries = db.listRows.mock.calls[0][0].queries;
		// Sanity-check the query shape: must filter by city, source, and price_date < today
		const queriesStr = JSON.stringify(queries);
		expect(queriesStr).toContain("bengaluru");
		expect(queriesStr).toContain("lalithaa_jewellery");
		expect(queriesStr).toContain("2026-04-10");
	});

	it("returns undefined when no prior row exists", async () => {
		const db = makeDb();
		db.listRows.mockResolvedValue({ rows: [], total: 0 });

		const result = await fetchMostRecentRowBefore(db as any, "bengaluru", "lalithaa_jewellery", "2026-04-10");

		expect(result).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/extractor/price-updater.test.ts
```

Expected: FAIL with `fetchMostRecentRowBefore is not exported`.

- [ ] **Step 3: Add `fetchMostRecentRowBefore` to `src/extractor/metals-updater.ts`**

Add the new exported function. Place it right before the existing `updatePriceForCity` function so the file reads top-down:

```ts
export async function fetchMostRecentRowBefore(
	db: TablesDB,
	city: string,
	source: string,
	beforeDate: string,
): Promise<PriceRecord | undefined> {
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

	return result.rows[0] as unknown as PriceRecord | undefined;
}
```

Note: ordering by `price_date` desc first, then `$createdAt` desc, picks the latest row from the latest prior date (in case there are multiple rows for that date).

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/extractor/price-updater.test.ts
```

Expected: PASS — both new tests green; all pre-existing tests still passing.

- [ ] **Step 5: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 6: Commit**

```bash
git add src/extractor/metals-updater.ts test/extractor/price-updater.test.ts
git commit -m "feat(metals-updater): add fetchMostRecentRowBefore for cross-day diffs"
```

---

## Task 6 — `metals-updater.ts`: wire push notification call

**Files:**
- Modify: `src/extractor/metals-updater.ts`
- Modify: `test/extractor/price-updater.test.ts`

Adds the `messaging` parameter to `updatePriceForCity` and calls `sendPriceNotification` after a successful DB write, with the cross-day fallback. This is the **largest task** — read carefully.

- [ ] **Step 1: Update the existing tests to pass a stub `messaging`**

The existing tests in `test/extractor/price-updater.test.ts` call `updatePriceForCity(db as any, "chennai", "lalithaa", basePrices)` — three positional args. After this task, the signature is `(db, messaging, city, source, prices)`. Every existing call site in the test file must be updated.

Add a `makeMessaging()` factory near `makeDb()`:

```ts
function makeMessaging() {
	return {
		createPush: vi.fn().mockResolvedValue({}),
	};
}
```

Then update every existing `updatePriceForCity(...)` call in the file to pass `messaging`:

```ts
const db = makeDb();
const messaging = makeMessaging();
// ...
await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", basePrices);
```

- [ ] **Step 2: Add new tests for the notification call**

Inside `describe("updatePriceForCity", ...)`, add these tests after the existing ones:

```ts
it("does not send a notification when this is the first row ever for the city", async () => {
	const db = makeDb();
	const messaging = makeMessaging();
	db.listRows.mockResolvedValueOnce({ rows: [], total: 0 }); // no row for today
	db.listRows.mockResolvedValueOnce({ rows: [], total: 0 }); // no prior row before today
	db.createRow.mockResolvedValue({});

	await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", basePrices);

	expect(db.createRow).toHaveBeenCalledOnce();
	expect(messaging.createPush).not.toHaveBeenCalled();
});

it("sends a notification when an earlier-today row exists and gold changed", async () => {
	const db = makeDb();
	const messaging = makeMessaging();
	db.listRows.mockResolvedValueOnce({ rows: [existingRow], total: 1 });
	db.createRow.mockResolvedValue({});

	const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7600 };
	await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

	expect(db.createRow).toHaveBeenCalledOnce();
	expect(messaging.createPush).toHaveBeenCalledOnce();
	const callJson = JSON.stringify(messaging.createPush.mock.calls[0]);
	expect(callJson).toContain("prices-chennai");
	expect(callJson).toContain("Chennai rates updated");
	expect(callJson).toContain("Gold ▲ ₹100/g");
});

it("sends a notification using yesterday's row when today has no row yet (cross-day fallback)", async () => {
	const db = makeDb();
	const messaging = makeMessaging();
	const yesterdayRow: PriceRecord = {
		...existingRow,
		$id: "row-yesterday",
		price_date: "2026-03-28",
		gold_22k_price: 7500,
	};
	db.listRows.mockResolvedValueOnce({ rows: [], total: 0 });            // no row for today
	db.listRows.mockResolvedValueOnce({ rows: [yesterdayRow], total: 1 }); // yesterday's row
	db.createRow.mockResolvedValue({});

	const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7620 };
	await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

	expect(db.createRow).toHaveBeenCalledOnce();
	expect(messaging.createPush).toHaveBeenCalledOnce();
	const callJson = JSON.stringify(messaging.createPush.mock.calls[0]);
	expect(callJson).toContain("Gold ▲ ₹120/g");
});

it("does not send a notification when only platinum changed", async () => {
	const db = makeDb();
	const messaging = makeMessaging();
	db.listRows.mockResolvedValueOnce({ rows: [existingRow], total: 1 });
	db.createRow.mockResolvedValue({});

	const newPrices: PriceInput = { ...basePrices, platinum_price: 3300 };
	await updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices);

	expect(db.createRow).toHaveBeenCalledOnce();
	expect(messaging.createPush).not.toHaveBeenCalled();
});

it("does not throw when the push call fails (DB write still succeeds)", async () => {
	const db = makeDb();
	const messaging = makeMessaging();
	db.listRows.mockResolvedValueOnce({ rows: [existingRow], total: 1 });
	db.createRow.mockResolvedValue({});
	messaging.createPush.mockRejectedValue(new Error("appwrite down"));

	const newPrices: PriceInput = { ...basePrices, gold_22k_price: 7600 };
	await expect(
		updatePriceForCity(db as any, messaging as any, "chennai", "lalithaa", newPrices),
	).resolves.toBeUndefined();

	expect(db.createRow).toHaveBeenCalledOnce();
	expect(messaging.createPush).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run test/extractor/price-updater.test.ts
```

Expected: FAIL — most likely with TypeScript errors about argument count mismatch, or runtime errors because `updatePriceForCity` doesn't yet receive `messaging`.

- [ ] **Step 4: Update `updatePriceForCity` in `src/extractor/metals-updater.ts`**

Add the import at the top:

```ts
import type { Messaging } from "node-appwrite";
import { buildPriceChangeEvent, sendPriceNotification } from "../notifications/price-notifier.js";
```

Update the function signature and body. Replace the entire `updatePriceForCity` function with:

```ts
export async function updatePriceForCity(
	db: TablesDB,
	messaging: Messaging,
	city: string,
	source: string,
	prices: PriceInput,
): Promise<void> {
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

	const existing = result.rows[0] as unknown as PriceRecord | undefined;

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
		logger.info({ city, source, prices, action: existing ? "price_changed" : "new_row" }, "Created new price row");

		// Determine prior row for delta computation: today's earlier row, or yesterday's last row.
		const priorRow = existing ?? (await fetchMostRecentRowBefore(db, city, source, today));

		if (priorRow) {
			const event = buildPriceChangeEvent(city, priorRow, prices);
			if (event.deltas.length > 0) {
				try {
					await sendPriceNotification(messaging, event);
				} catch {
					// sendPriceNotification already logged the error; swallow so the price-write
					// path is never affected by push failures.
				}
			}
		}
	} else {
		await db.updateRow({
			databaseId: DB_ID,
			tableId: TABLE_METAL_PRICES,
			rowId: existing.$id,
			data: { last_checked_at: now },
		});
		logger.info({ city, source, action: "checked" }, "Prices unchanged, updated last_checked_at");
	}
}
```

- [ ] **Step 5: Run the full test file to verify everything passes**

```bash
npx vitest run test/extractor/price-updater.test.ts
```

Expected: all tests green — old ones (with the new `messaging` arg threaded through) plus the 5 new ones plus the 2 from Task 5.

- [ ] **Step 6: Run the full test suite to catch any other broken callers**

```bash
npm test
```

Expected: every test in the repo passes. If any other test stubs `updatePriceForCity` or imports from `metals-updater.ts`, it may need the new `messaging` arg added too — fix as needed.

- [ ] **Step 7: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 8: Commit**

```bash
git add src/extractor/metals-updater.ts test/extractor/price-updater.test.ts
git commit -m "feat(metals-updater): send push notification on price change"
```

---

## Task 7 — Wire `messaging` through `src/index.ts`

**Files:**
- Modify: `src/index.ts`

The cron-driven daemon must instantiate the messaging client once and pass it to every `updatePriceForCity` call.

- [ ] **Step 1: Read the current `src/index.ts`**

```bash
cat src/index.ts
```

Locate the `updatePriceForCity(db, city, config.name, prices)` call inside the `onTick` closure (around line 33).

- [ ] **Step 2: Update the imports and instantiate `messaging`**

Change the import line:

```ts
import { createAppwriteClient, createMessaging, createTablesDB } from "./config/appwrite.js";
```

Inside `main()`, after `const db = createTablesDB(client);`, add:

```ts
const messaging = createMessaging(client);
```

- [ ] **Step 3: Pass `messaging` into the `updatePriceForCity` call**

Replace:

```ts
await updatePriceForCity(db, city, config.name, prices);
```

with:

```ts
await updatePriceForCity(db, messaging, city, config.name, prices);
```

- [ ] **Step 4: Run lint + types to verify everything still compiles**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!` — the new arg satisfies the new signature.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire messaging client through to price updater"
```

---

## Task 8 — Wire `messaging` through `src/run-price.ts`

**Files:**
- Modify: `src/run-price.ts`

Same change for the one-shot CLI runner (the file in `git status` as untracked).

- [ ] **Step 1: Read the current `src/run-price.ts`**

```bash
cat src/run-price.ts
```

Locate the existing `updatePriceForCity(db, city, config.name, prices)` call.

- [ ] **Step 2: Update the imports and instantiate `messaging`**

Change the import line to include `createMessaging`:

```ts
import { createAppwriteClient, createMessaging, createTablesDB } from "./config/appwrite.js";
```

Inside `main()`, after `const db = createTablesDB(client);`, add:

```ts
const messaging = createMessaging(client);
```

- [ ] **Step 3: Pass `messaging` into the `updatePriceForCity` call**

Replace:

```ts
await updatePriceForCity(db, city, config.name, prices);
```

with:

```ts
await updatePriceForCity(db, messaging, city, config.name, prices);
```

- [ ] **Step 4: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/run-price.ts
git commit -m "feat(run-price): wire messaging client through to price updater"
```

---

## Task 9 — Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite once more**

```bash
npm test
```

Expected: every test passes.

- [ ] **Step 2: Run lint + types**

```bash
npm run check
```

Expected: `✅ All pre-commit checks passed!`

- [ ] **Step 3: Verify no lingering uncommitted changes from the implementation**

```bash
git status
```

Expected: only the pre-existing untracked files from before this work started should remain untracked. No modified-but-uncommitted files from the tasks above.

- [ ] **Step 4: Show the commit log for the branch**

```bash
git log --oneline main..HEAD
```

Expected: 8 new commits (one per task 1–8) on top of `main`.

---

## Manual deployment steps (NOT code tasks)

The following steps must be done by a human after the code lands. They are **not** part of this plan's automated execution. Track them as a TODO when reviewing the merge.

1. **Appwrite console — Messaging → Topics:** create one push topic per city. Names must match exactly:
   - `prices-bengaluru`
   - `prices-chennai`
   - `prices-hyderabad`
   - `prices-vijayawada`
   - `prices-puducherry`
2. **Firebase console:** create (or reuse) a Firebase project. Generate a service account JSON with FCM permissions.
3. **Appwrite console — Messaging → Providers:** add the FCM provider with the service account JSON from step 2.
4. **Backend API key scope:** verify the Appwrite API key the backend uses has `messaging.write` scope. Add it via the Appwrite console if missing. Without this scope, every push call from `sendPriceNotification` will fail with a 401 — and because the catch block swallows errors, the failure will be visible only in `logs/app.log`. After deployment, tail the log and grep for `"Failed to send price push notification"` to confirm the scope is correct.
5. **Android app work:** subscription / push target registration is in a separate plan (`docs/superpowers/plans/<TBD>-price-notifications-android.md` — not yet written). Until that plan ships, no devices will be subscribed to the topics, so backend pushes will succeed at the Appwrite layer but reach zero devices.
6. **Smoke test:** once the Android plan also ships and at least one debug build is installed, trigger a real price change (or run a small dev script that calls `sendPriceNotification` with a fake event for `bengaluru`) and verify the notification appears on the device within ~5 seconds.
