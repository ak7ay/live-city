# Gold Price Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch gold/silver/platinum prices from Lalithaa Jewellery API, store in Appwrite with change-only inserts, scheduled every 10 minutes during market hours.

**Architecture:** YAML config maps states to cities → startup resolves state IDs from API → cron triggers fetch for all cities → compare with DB → insert on change or new day, update `last_checked_at` otherwise. Appwrite schema created via idempotent setup script.

**Tech Stack:** Node 22+, TypeScript 6, node-appwrite 23, node-cron, yaml, zod, pino, vitest

---

### Task 1: Appwrite Project Setup (manual)

These are manual steps in the Appwrite Console. No code.

- [ ] **Step 1: Create Appwrite account and project**

Go to https://cloud.appwrite.io and sign up or log in. Create a new project:
- Name: `live-city`
- Region: Singapore (closest to India)

Copy the **Project ID** from the project settings page.

- [ ] **Step 2: Create an API key**

In the project console: Settings → API keys → Create API key.
- Name: `extractor`
- Scopes: select **databases** (all database permissions — read, write, create, update, delete)
- Expiry: no expiry

Copy the **API key secret** (shown only once).

- [ ] **Step 3: Create `.env` file**

```bash
cp .env.example .env
```

Fill in the values:

```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<your project id>
APPWRITE_API_KEY=<your api key secret>
LOG_LEVEL=info
NODE_ENV=development
```

- [ ] **Step 4: Verify connection**

```bash
npx tsx -e "
import { Client } from 'node-appwrite';
import 'dotenv/config';
const c = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT!)
  .setProject(process.env.APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
console.log('Connected to project:', process.env.APPWRITE_PROJECT_ID);
"
```

Expected: prints `Connected to project: <your id>` with no errors.

---

### Task 2: Appwrite Client Config

**Files:**
- Create: `src/config/appwrite.ts`
- Create: `src/config/env.ts`
- Create: `test/config/appwrite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/config/appwrite.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("env config", () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it("throws if APPWRITE_ENDPOINT is missing", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "");
		vi.stubEnv("APPWRITE_PROJECT_ID", "test-project");
		vi.stubEnv("APPWRITE_API_KEY", "test-key");

		const { loadEnv } = await import("../../src/config/env.ts");
		expect(() => loadEnv()).toThrow("APPWRITE_ENDPOINT");
	});

	it("throws if APPWRITE_PROJECT_ID is missing", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1");
		vi.stubEnv("APPWRITE_PROJECT_ID", "");
		vi.stubEnv("APPWRITE_API_KEY", "test-key");

		const { loadEnv } = await import("../../src/config/env.ts");
		expect(() => loadEnv()).toThrow("APPWRITE_PROJECT_ID");
	});

	it("throws if APPWRITE_API_KEY is missing", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1");
		vi.stubEnv("APPWRITE_PROJECT_ID", "test-project");
		vi.stubEnv("APPWRITE_API_KEY", "");

		const { loadEnv } = await import("../../src/config/env.ts");
		expect(() => loadEnv()).toThrow("APPWRITE_API_KEY");
	});

	it("returns config when all vars are set", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1");
		vi.stubEnv("APPWRITE_PROJECT_ID", "test-project");
		vi.stubEnv("APPWRITE_API_KEY", "test-key");

		const { loadEnv } = await import("../../src/config/env.ts");
		const env = loadEnv();
		expect(env.APPWRITE_ENDPOINT).toBe("https://cloud.appwrite.io/v1");
		expect(env.APPWRITE_PROJECT_ID).toBe("test-project");
		expect(env.APPWRITE_API_KEY).toBe("test-key");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/config/appwrite.test.ts
```

Expected: FAIL — cannot find module `../../src/config/env.ts`

- [ ] **Step 3: Implement env config**

Create `src/config/env.ts`:

```typescript
import "dotenv/config";

export interface EnvConfig {
	APPWRITE_ENDPOINT: string;
	APPWRITE_PROJECT_ID: string;
	APPWRITE_API_KEY: string;
}

export function loadEnv(): EnvConfig {
	const endpoint = process.env.APPWRITE_ENDPOINT;
	const projectId = process.env.APPWRITE_PROJECT_ID;
	const apiKey = process.env.APPWRITE_API_KEY;

	if (!endpoint) throw new Error("Missing required env var: APPWRITE_ENDPOINT");
	if (!projectId) throw new Error("Missing required env var: APPWRITE_PROJECT_ID");
	if (!apiKey) throw new Error("Missing required env var: APPWRITE_API_KEY");

	return {
		APPWRITE_ENDPOINT: endpoint,
		APPWRITE_PROJECT_ID: projectId,
		APPWRITE_API_KEY: apiKey,
	};
}
```

- [ ] **Step 4: Implement Appwrite client factory**

Create `src/config/appwrite.ts`:

```typescript
import { Client, Databases } from "node-appwrite";
import type { EnvConfig } from "./env.ts";

export function createAppwriteClient(env: EnvConfig): Client {
	return new Client()
		.setEndpoint(env.APPWRITE_ENDPOINT)
		.setProject(env.APPWRITE_PROJECT_ID)
		.setKey(env.APPWRITE_API_KEY);
}

export function createDatabases(client: Client): Databases {
	return new Databases(client);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/config/appwrite.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/config/appwrite.ts test/config/appwrite.test.ts
git commit -m "feat: add env config and appwrite client factory"
```

---

### Task 3: Appwrite Schema Setup Script

**Files:**
- Create: `src/setup-db.ts`
- Create: `src/config/constants.ts`

- [ ] **Step 1: Create constants file**

Create `src/config/constants.ts`:

```typescript
export const DB_ID = "live_city";
export const COLLECTION_METAL_PRICES = "metal_prices";
```

- [ ] **Step 2: Create the setup script**

Create `src/setup-db.ts`:

```typescript
import { Client, Databases, IndexType } from "node-appwrite";
import { loadEnv } from "./config/env.ts";
import { createAppwriteClient, createDatabases } from "./config/appwrite.ts";
import { DB_ID, COLLECTION_METAL_PRICES } from "./config/constants.ts";

async function createDatabaseIfNotExists(databases: Databases): Promise<void> {
	try {
		await databases.get(DB_ID);
		console.log(`Database '${DB_ID}' already exists, skipping.`);
	} catch {
		await databases.create(DB_ID, DB_ID);
		console.log(`Database '${DB_ID}' created.`);
	}
}

async function createCollectionIfNotExists(databases: Databases): Promise<void> {
	try {
		await databases.getCollection(DB_ID, COLLECTION_METAL_PRICES);
		console.log(`Collection '${COLLECTION_METAL_PRICES}' already exists, skipping.`);
	} catch {
		await databases.createCollection(DB_ID, COLLECTION_METAL_PRICES, COLLECTION_METAL_PRICES);
		console.log(`Collection '${COLLECTION_METAL_PRICES}' created.`);
	}
}

async function createAttributeIfNotExists(
	databases: Databases,
	createFn: () => Promise<unknown>,
	name: string,
): Promise<void> {
	try {
		await databases.getAttribute(DB_ID, COLLECTION_METAL_PRICES, name);
		console.log(`  Attribute '${name}' already exists, skipping.`);
	} catch {
		await createFn();
		console.log(`  Attribute '${name}' created.`);
	}
}

async function createAttributes(databases: Databases): Promise<void> {
	console.log("Creating attributes...");

	await createAttributeIfNotExists(
		databases,
		() => databases.createStringAttribute(DB_ID, COLLECTION_METAL_PRICES, "city", 64, true),
		"city",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createStringAttribute(DB_ID, COLLECTION_METAL_PRICES, "source", 64, true),
		"source",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createFloatAttribute(DB_ID, COLLECTION_METAL_PRICES, "gold_22k_price", true),
		"gold_22k_price",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createFloatAttribute(DB_ID, COLLECTION_METAL_PRICES, "silver_price", true),
		"silver_price",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createFloatAttribute(DB_ID, COLLECTION_METAL_PRICES, "platinum_price", true),
		"platinum_price",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createStringAttribute(DB_ID, COLLECTION_METAL_PRICES, "price_date", 10, true),
		"price_date",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createDatetimeAttribute(DB_ID, COLLECTION_METAL_PRICES, "price_changed_at", true),
		"price_changed_at",
	);
	await createAttributeIfNotExists(
		databases,
		() => databases.createDatetimeAttribute(DB_ID, COLLECTION_METAL_PRICES, "last_checked_at", true),
		"last_checked_at",
	);
}

async function createIndexIfNotExists(
	databases: Databases,
	key: string,
	type: IndexType,
	attributes: string[],
	orders?: string[],
): Promise<void> {
	try {
		await databases.getIndex(DB_ID, COLLECTION_METAL_PRICES, key);
		console.log(`  Index '${key}' already exists, skipping.`);
	} catch {
		await databases.createIndex(DB_ID, COLLECTION_METAL_PRICES, key, type, attributes, orders);
		console.log(`  Index '${key}' created.`);
	}
}

async function createIndexes(databases: Databases): Promise<void> {
	console.log("Creating indexes...");

	await createIndexIfNotExists(databases, "idx_city_date", IndexType.Key, ["city", "price_date"]);
	await createIndexIfNotExists(databases, "idx_city_date_desc", IndexType.Key, ["city", "price_date"], [
		"ASC",
		"DESC",
	]);
}

async function main(): Promise<void> {
	console.log("Setting up Appwrite database...\n");

	const env = loadEnv();
	const client = createAppwriteClient(env);
	const databases = createDatabases(client);

	await createDatabaseIfNotExists(databases);
	await createCollectionIfNotExists(databases);
	await createAttributes(databases);

	// Wait for attributes to be ready before creating indexes
	console.log("Waiting for attributes to be available...");
	await new Promise((resolve) => setTimeout(resolve, 3000));

	await createIndexes(databases);

	console.log("\nSetup complete.");
}

main().catch((error) => {
	console.error("Setup failed:", error);
	process.exit(1);
});
```

- [ ] **Step 3: Add npm script**

In `package.json`, add to `"scripts"`:

```json
"setup-db": "tsx src/setup-db.ts"
```

- [ ] **Step 4: Run the setup script against Appwrite**

```bash
npm run setup-db
```

Expected output:
```
Setting up Appwrite database...

Database 'live_city' created.
Collection 'metal_prices' created.
Creating attributes...
  Attribute 'city' created.
  Attribute 'source' created.
  Attribute 'gold_22k_price' created.
  Attribute 'silver_price' created.
  Attribute 'platinum_price' created.
  Attribute 'price_date' created.
  Attribute 'price_changed_at' created.
  Attribute 'last_checked_at' created.
Waiting for attributes to be available...
Creating indexes...
  Index 'idx_city_date' created.
  Index 'idx_city_date_desc' created.

Setup complete.
```

- [ ] **Step 5: Run it again to verify idempotency**

```bash
npm run setup-db
```

Expected: all lines say "already exists, skipping."

- [ ] **Step 6: Commit**

```bash
git add src/setup-db.ts src/config/constants.ts package.json
git commit -m "feat: add idempotent appwrite schema setup script"
```

---

### Task 4: Source Config (YAML)

**Files:**
- Create: `config/sources/lalithaa.yaml`
- Create: `src/config/source-loader.ts`
- Create: `test/config/source-loader.test.ts`

- [ ] **Step 1: Create the YAML config file**

Create `config/sources/lalithaa.yaml`:

```yaml
name: lalithaa_jewellery
api_url: https://api.lalithaajewellery.com/public/pricings/latest
states_api_url: https://api.lalithaajewellery.com/public/states
states:
  - state_name: Karnataka
    city: bengaluru
  - state_name: Tamilnadu
    city: chennai
  - state_name: Telangana
    city: hyderabad
  - state_name: Andhra Pradesh
    city: vijayawada
  - state_name: Puducherry
    city: puducherry
```

- [ ] **Step 2: Write the failing test**

Create `test/config/source-loader.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { loadLalithaaConfig, type LalithaaConfig } from "../../src/config/source-loader.ts";
import { join } from "node:path";

describe("loadLalithaaConfig", () => {
	it("loads and validates lalithaa.yaml", () => {
		const configPath = join(import.meta.dirname, "../../config/sources/lalithaa.yaml");
		const config = loadLalithaaConfig(configPath);

		expect(config.name).toBe("lalithaa_jewellery");
		expect(config.api_url).toBe("https://api.lalithaajewellery.com/public/pricings/latest");
		expect(config.states_api_url).toBe("https://api.lalithaajewellery.com/public/states");
		expect(config.states).toHaveLength(5);
		expect(config.states[0]).toEqual({ state_name: "Karnataka", city: "bengaluru" });
	});

	it("throws on missing file", () => {
		expect(() => loadLalithaaConfig("/nonexistent/path.yaml")).toThrow();
	});

	it("throws on invalid yaml (missing name)", () => {
		// Write a temp file with invalid content
		const { writeFileSync, mkdtempSync } = require("node:fs");
		const { join } = require("node:path");
		const tmpDir = mkdtempSync(join(require("node:os").tmpdir(), "test-"));
		const tmpFile = join(tmpDir, "bad.yaml");
		writeFileSync(tmpFile, "api_url: https://example.com\nstates: []");

		expect(() => loadLalithaaConfig(tmpFile)).toThrow();
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run test/config/source-loader.test.ts
```

Expected: FAIL — cannot find module `../../src/config/source-loader.ts`

- [ ] **Step 4: Implement source loader**

Create `src/config/source-loader.ts`:

```typescript
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod/v4";

const stateEntrySchema = z.object({
	state_name: z.string(),
	city: z.string(),
});

const lalithaaConfigSchema = z.object({
	name: z.string(),
	api_url: z.url(),
	states_api_url: z.url(),
	states: z.array(stateEntrySchema).min(1),
});

export type LalithaaConfig = z.infer<typeof lalithaaConfigSchema>;

export function loadLalithaaConfig(filePath: string): LalithaaConfig {
	const raw = readFileSync(filePath, "utf-8");
	const parsed = parse(raw);
	return lalithaaConfigSchema.parse(parsed);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/config/source-loader.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add config/sources/lalithaa.yaml src/config/source-loader.ts test/config/source-loader.test.ts
git commit -m "feat: add lalithaa source config with yaml loader and validation"
```

---

### Task 5: Lalithaa Price Fetcher

**Files:**
- Create: `src/sources/lalithaa.ts`
- Create: `test/sources/lalithaa.test.ts`

- [ ] **Step 1: Write the failing test for resolveStateIds**

Create `test/sources/lalithaa.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { LalithaaConfig } from "../../src/config/source-loader.ts";

const MOCK_CONFIG: LalithaaConfig = {
	name: "lalithaa_jewellery",
	api_url: "https://api.lalithaajewellery.com/public/pricings/latest",
	states_api_url: "https://api.lalithaajewellery.com/public/states",
	states: [
		{ state_name: "Karnataka", city: "bengaluru" },
		{ state_name: "Tamilnadu", city: "chennai" },
	],
};

const MOCK_STATES_RESPONSE = {
	status: "success",
	data: {
		items: [
			{ id: "state-ka-id", name: "Karnataka", slug: "karnataka", code: "KA", sort_order: 1 },
			{ id: "state-tn-id", name: "Tamilnadu", slug: "tamilnadu", code: "TN", sort_order: 2 },
			{ id: "state-ap-id", name: "Andhra Pradesh", slug: "andhra-pradesh", code: "AP", sort_order: 3 },
		],
	},
};

const MOCK_PRICE_RESPONSE = {
	status: "success",
	data: {
		state_id: "state-ka-id",
		state_name: "Karnataka",
		prices: {
			gold: { metal_type: "Gold", price: 13575.0, rate_datetime: "2026-03-28T09:37:00" },
			silver: { metal_type: "Silver", price: 237.0, rate_datetime: "2026-03-28T09:37:00" },
			platinum: { metal_type: "Platinum", price: 7006.0, rate_datetime: "2026-03-28T09:37:00" },
		},
		rate_updated_time: "2026-03-28T09:37:00",
	},
};

describe("resolveStateIds", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("maps state names to IDs", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(MOCK_STATES_RESPONSE),
		});

		const { resolveStateIds } = await import("../../src/sources/lalithaa.ts");
		const result = await resolveStateIds(MOCK_CONFIG);

		expect(result.size).toBe(2);
		expect(result.get("bengaluru")).toEqual({ stateId: "state-ka-id", city: "bengaluru" });
		expect(result.get("chennai")).toEqual({ stateId: "state-tn-id", city: "chennai" });
	});

	it("skips states not found in API response", async () => {
		const configWithUnknown: LalithaaConfig = {
			...MOCK_CONFIG,
			states: [
				{ state_name: "Karnataka", city: "bengaluru" },
				{ state_name: "NonExistent", city: "nowhere" },
			],
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(MOCK_STATES_RESPONSE),
		});

		const { resolveStateIds } = await import("../../src/sources/lalithaa.ts");
		const result = await resolveStateIds(configWithUnknown);

		expect(result.size).toBe(1);
		expect(result.has("bengaluru")).toBe(true);
		expect(result.has("nowhere")).toBe(false);
	});

	it("throws on non-200 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		});

		const { resolveStateIds } = await import("../../src/sources/lalithaa.ts");
		await expect(resolveStateIds(MOCK_CONFIG)).rejects.toThrow();
	});
});

describe("fetchPrice", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns parsed prices", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(MOCK_PRICE_RESPONSE),
		});

		const { fetchPrice } = await import("../../src/sources/lalithaa.ts");
		const result = await fetchPrice("https://api.example.com/pricings/latest", "state-ka-id");

		expect(result).toEqual({
			gold_22k_price: 13575.0,
			silver_price: 237.0,
			platinum_price: 7006.0,
			rate_datetime: "2026-03-28T09:37:00",
		});
	});

	it("throws on non-200 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
		});

		const { fetchPrice } = await import("../../src/sources/lalithaa.ts");
		await expect(fetchPrice("https://api.example.com/pricings/latest", "state-ka-id")).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/sources/lalithaa.test.ts
```

Expected: FAIL — cannot find module `../../src/sources/lalithaa.ts`

- [ ] **Step 3: Implement the price fetcher**

Create `src/sources/lalithaa.ts`:

```typescript
import { z } from "zod/v4";
import type { LalithaaConfig } from "../config/source-loader.ts";

const statesResponseSchema = z.object({
	status: z.literal("success"),
	data: z.object({
		items: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
			}),
		),
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

export interface ResolvedState {
	stateId: string;
	city: string;
}

export interface MetalPrices {
	gold_22k_price: number;
	silver_price: number;
	platinum_price: number;
	rate_datetime: string;
}

export async function resolveStateIds(config: LalithaaConfig): Promise<Map<string, ResolvedState>> {
	const url = `${config.states_api_url}?page=1&limit=100`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`States API failed: ${response.status} ${response.statusText}`);
	}

	const json = await response.json();
	const parsed = statesResponseSchema.parse(json);

	const apiStates = new Map(parsed.data.items.map((s) => [s.name, s.id]));
	const result = new Map<string, ResolvedState>();

	for (const entry of config.states) {
		const stateId = apiStates.get(entry.state_name);
		if (!stateId) {
			console.warn(`State '${entry.state_name}' not found in API, skipping city '${entry.city}'`);
			continue;
		}
		result.set(entry.city, { stateId, city: entry.city });
	}

	return result;
}

export async function fetchPrice(apiUrl: string, stateId: string): Promise<MetalPrices> {
	const url = `${apiUrl}?state_id=${stateId}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Price API failed: ${response.status} ${response.statusText}`);
	}

	const json = await response.json();
	const parsed = priceResponseSchema.parse(json);

	return {
		gold_22k_price: parsed.data.prices.gold.price,
		silver_price: parsed.data.prices.silver.price,
		platinum_price: parsed.data.prices.platinum.price,
		rate_datetime: parsed.data.prices.gold.rate_datetime,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/sources/lalithaa.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/sources/lalithaa.ts test/sources/lalithaa.test.ts
git commit -m "feat: add lalithaa price fetcher with state ID resolution"
```

---

### Task 6: Logger Setup

**Files:**
- Create: `src/config/logger.ts`

- [ ] **Step 1: Create the logger**

Create `src/config/logger.ts`:

```typescript
import pino from "pino";

export const logger = pino({
	level: process.env.LOG_LEVEL || "info",
	transport:
		process.env.NODE_ENV === "development"
			? { target: "pino-logfmt" }
			: undefined,
});
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/config/logger.ts
git commit -m "feat: add pino logger with logfmt transport"
```

---

### Task 7: Price Updater (Insert/Update Logic)

**Files:**
- Create: `src/extractor/price-updater.ts`
- Create: `test/extractor/price-updater.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/extractor/price-updater.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { updatePriceForCity, type PriceRecord } from "../../src/extractor/price-updater.ts";

function mockDatabases(existingDocs: PriceRecord[] = []) {
	return {
		listDocuments: vi.fn().mockResolvedValue({ documents: existingDocs, total: existingDocs.length }),
		createDocument: vi.fn().mockResolvedValue({ $id: "new-doc-id" }),
		updateDocument: vi.fn().mockResolvedValue({ $id: "existing-doc-id" }),
	};
}

const PRICES = {
	gold_22k_price: 13575.0,
	silver_price: 237.0,
	platinum_price: 7006.0,
};

describe("updatePriceForCity", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-29T10:00:00+05:30"));
	});

	it("inserts new row when no row exists for today", async () => {
		const db = mockDatabases([]);

		await updatePriceForCity(db as any, "bengaluru", "lalithaa_jewellery", PRICES);

		expect(db.createDocument).toHaveBeenCalledOnce();
		expect(db.updateDocument).not.toHaveBeenCalled();

		const createArgs = db.createDocument.mock.calls[0];
		const data = createArgs[3];
		expect(data.city).toBe("bengaluru");
		expect(data.source).toBe("lalithaa_jewellery");
		expect(data.gold_22k_price).toBe(13575.0);
		expect(data.silver_price).toBe(237.0);
		expect(data.platinum_price).toBe(7006.0);
		expect(data.price_date).toBe("2026-03-29");
	});

	it("inserts new row when prices differ", async () => {
		const existing: PriceRecord = {
			$id: "existing-doc-id",
			city: "bengaluru",
			source: "lalithaa_jewellery",
			gold_22k_price: 13500.0,
			silver_price: 237.0,
			platinum_price: 7006.0,
			price_date: "2026-03-29",
			price_changed_at: "2026-03-29T09:00:00.000+00:00",
			last_checked_at: "2026-03-29T09:00:00.000+00:00",
		};
		const db = mockDatabases([existing]);

		await updatePriceForCity(db as any, "bengaluru", "lalithaa_jewellery", PRICES);

		expect(db.createDocument).toHaveBeenCalledOnce();
		expect(db.updateDocument).not.toHaveBeenCalled();
	});

	it("updates last_checked_at when prices are the same", async () => {
		const existing: PriceRecord = {
			$id: "existing-doc-id",
			city: "bengaluru",
			source: "lalithaa_jewellery",
			gold_22k_price: 13575.0,
			silver_price: 237.0,
			platinum_price: 7006.0,
			price_date: "2026-03-29",
			price_changed_at: "2026-03-29T09:00:00.000+00:00",
			last_checked_at: "2026-03-29T09:00:00.000+00:00",
		};
		const db = mockDatabases([existing]);

		await updatePriceForCity(db as any, "bengaluru", "lalithaa_jewellery", PRICES);

		expect(db.createDocument).not.toHaveBeenCalled();
		expect(db.updateDocument).toHaveBeenCalledOnce();

		const updateArgs = db.updateDocument.mock.calls[0];
		const data = updateArgs[3];
		expect(data.last_checked_at).toBeDefined();
		expect(data.gold_22k_price).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/extractor/price-updater.test.ts
```

Expected: FAIL — cannot find module `../../src/extractor/price-updater.ts`

- [ ] **Step 3: Implement price updater**

Create `src/extractor/price-updater.ts`:

```typescript
import { type Databases, ID, Query } from "node-appwrite";
import { DB_ID, COLLECTION_METAL_PRICES } from "../config/constants.ts";
import { logger } from "../config/logger.ts";

export interface PriceRecord {
	$id: string;
	city: string;
	source: string;
	gold_22k_price: number;
	silver_price: number;
	platinum_price: number;
	price_date: string;
	price_changed_at: string;
	last_checked_at: string;
}

export interface PriceInput {
	gold_22k_price: number;
	silver_price: number;
	platinum_price: number;
}

function getTodayIST(): string {
	return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getNowISO(): string {
	return new Date().toISOString();
}

function pricesChanged(existing: PriceRecord, incoming: PriceInput): boolean {
	return (
		existing.gold_22k_price !== incoming.gold_22k_price ||
		existing.silver_price !== incoming.silver_price ||
		existing.platinum_price !== incoming.platinum_price
	);
}

export async function updatePriceForCity(
	databases: Databases,
	city: string,
	source: string,
	prices: PriceInput,
): Promise<void> {
	const today = getTodayIST();
	const now = getNowISO();

	const { documents } = await databases.listDocuments(DB_ID, COLLECTION_METAL_PRICES, [
		Query.equal("city", city),
		Query.equal("price_date", today),
		Query.orderDesc("$createdAt"),
		Query.limit(1),
	]);

	const existing = documents[0] as PriceRecord | undefined;

	if (!existing || pricesChanged(existing, prices)) {
		const action = existing ? "changed" : "new day";
		await databases.createDocument(DB_ID, COLLECTION_METAL_PRICES, ID.unique(), {
			city,
			source,
			gold_22k_price: prices.gold_22k_price,
			silver_price: prices.silver_price,
			platinum_price: prices.platinum_price,
			price_date: today,
			price_changed_at: now,
			last_checked_at: now,
		});
		logger.info({ city, action, prices }, "Price row inserted");
	} else {
		await databases.updateDocument(DB_ID, COLLECTION_METAL_PRICES, existing.$id, {
			last_checked_at: now,
		});
		logger.debug({ city }, "Prices unchanged, updated last_checked_at");
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/extractor/price-updater.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extractor/price-updater.ts test/extractor/price-updater.test.ts
git commit -m "feat: add price updater with change detection logic"
```

---

### Task 8: Scheduler

**Files:**
- Create: `src/scheduler.ts`

- [ ] **Step 1: Implement scheduler**

Create `src/scheduler.ts`:

```typescript
import cron from "node-cron";
import { logger } from "./config/logger.ts";

export function startScheduler(jobName: string, onTick: () => Promise<void>): void {
	// Every 10 minutes from 9:00 to 15:59 IST
	cron.schedule(
		"*/10 9-15 * * *",
		async () => {
			logger.info({ job: jobName }, "Scheduled tick started");
			try {
				await onTick();
			} catch (error) {
				logger.error({ job: jobName, error }, "Scheduled tick failed");
			}
		},
		{ timezone: "Asia/Kolkata" },
	);

	// Final check at 16:00 IST
	cron.schedule(
		"0 16 * * *",
		async () => {
			logger.info({ job: jobName }, "Final tick started (16:00 IST)");
			try {
				await onTick();
			} catch (error) {
				logger.error({ job: jobName, error }, "Final tick failed");
			}
		},
		{ timezone: "Asia/Kolkata" },
	);

	logger.info({ job: jobName }, "Scheduler started: every 10min, 9:00-16:00 IST");
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat: add cron scheduler for IST market hours"
```

---

### Task 9: Wire Everything in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace index.ts with the entry point**

Replace the entire contents of `src/index.ts`:

```typescript
import { join } from "node:path";
import { loadEnv } from "./config/env.ts";
import { createAppwriteClient, createDatabases } from "./config/appwrite.ts";
import { loadLalithaaConfig } from "./config/source-loader.ts";
import { resolveStateIds, fetchPrice } from "./sources/lalithaa.ts";
import { updatePriceForCity } from "./extractor/price-updater.ts";
import { startScheduler } from "./scheduler.ts";
import { logger } from "./config/logger.ts";

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const databases = createDatabases(client);

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
				await updatePriceForCity(databases, city, config.name, prices);
			}),
		);

		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				const city = [...stateMap.keys()][i];
				logger.error({ city, error: result.reason }, "Failed to update price");
			}
		}
	};

	// Run once immediately on startup
	logger.info("Running initial price fetch...");
	await onTick();

	startScheduler("lalithaa-prices", onTick);
	logger.info("Price extractor running. Press Ctrl+C to stop.");
}

main().catch((error) => {
	logger.error({ error }, "Fatal error");
	process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Run lint and typecheck**

```bash
npm run check
```

Expected: no errors

- [ ] **Step 5: Test the full flow manually**

```bash
npx tsx src/index.ts
```

Expected: resolves state IDs, fetches prices for all cities, inserts rows into Appwrite, then prints scheduler started message. Ctrl+C to stop.

Verify in Appwrite console that `metal_prices` collection has rows for each city.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up price extractor entry point with scheduler"
```

---

### Task 10: Cleanup and Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 2: Run lint + typecheck**

```bash
npm run check
```

Expected: no errors

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: `dist/` created with no errors

- [ ] **Step 4: Run from built output**

```bash
node dist/index.js
```

Expected: same behavior as `npx tsx src/index.ts` — fetches prices, starts scheduler.

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for gold price extractor"
```
