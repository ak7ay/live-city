import { OrderBy, type TablesDB, TablesDBIndexType } from "node-appwrite";
import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { DB_ID, TABLE_METAL_PRICES } from "./config/constants.js";
import { loadEnv } from "./config/env.js";

async function createDatabaseIfNotExists(db: TablesDB): Promise<void> {
	try {
		await db.get({ databaseId: DB_ID });
		console.log(`Database "${DB_ID}" already exists, skipping.`);
	} catch {
		await db.create({ databaseId: DB_ID, name: DB_ID });
		console.log(`Database "${DB_ID}" created.`);
	}
}

async function createTableIfNotExists(db: TablesDB): Promise<void> {
	try {
		await db.getTable({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES });
		console.log(`Table "${TABLE_METAL_PRICES}" already exists, skipping.`);
	} catch {
		await db.createTable({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, name: TABLE_METAL_PRICES });
		console.log(`Table "${TABLE_METAL_PRICES}" created.`);
	}
}

async function createColumnIfNotExists(db: TablesDB, createFn: () => Promise<unknown>, name: string): Promise<void> {
	try {
		await db.getColumn({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key: name });
		console.log(`Column "${name}" already exists, skipping.`);
	} catch {
		await createFn();
		console.log(`Column "${name}" created.`);
	}
}

async function createColumns(db: TablesDB): Promise<void> {
	await createColumnIfNotExists(
		db,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "city",
				size: 64,
				required: true,
			}),
		"city",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "source",
				size: 64,
				required: true,
			}),
		"source",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createFloatColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "gold_22k_price",
				required: true,
			}),
		"gold_22k_price",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createFloatColumn({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key: "silver_price", required: true }),
		"silver_price",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createFloatColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "platinum_price",
				required: true,
			}),
		"platinum_price",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "price_date",
				size: 64,
				required: true,
			}),
		"price_date",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createDatetimeColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "price_changed_at",
				required: true,
			}),
		"price_changed_at",
	);

	await createColumnIfNotExists(
		db,
		() =>
			db.createDatetimeColumn({
				databaseId: DB_ID,
				tableId: TABLE_METAL_PRICES,
				key: "last_checked_at",
				required: true,
			}),
		"last_checked_at",
	);
}

async function createIndexIfNotExists(
	db: TablesDB,
	key: string,
	type: TablesDBIndexType,
	columns: string[],
	orders?: OrderBy[],
): Promise<void> {
	try {
		await db.getIndex({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key });
		console.log(`Index "${key}" already exists, skipping.`);
	} catch {
		await db.createIndex({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key, type, columns, orders });
		console.log(`Index "${key}" created.`);
	}
}

async function waitForColumns(db: TablesDB): Promise<void> {
	const maxAttempts = 30;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const { columns } = await db.listColumns({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES });
		const pending = columns.filter((c: any) => c.status !== "available");
		if (pending.length === 0) {
			console.log("All columns are available.");
			return;
		}
		console.log(`Waiting for ${pending.length} column(s) to be ready... (attempt ${attempt}/${maxAttempts})`);
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error("Timed out waiting for columns to become available");
}

async function deleteFailedIndexes(db: TablesDB): Promise<void> {
	const { indexes } = await db.listIndexes({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES });
	for (const index of indexes) {
		if ((index as any).status === "failed") {
			console.log(`Deleting failed index "${index.key}"...`);
			await db.deleteIndex({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key: index.key });
		}
	}
}

async function createIndexes(db: TablesDB): Promise<void> {
	await deleteFailedIndexes(db);
	await createIndexIfNotExists(db, "idx_city_date", TablesDBIndexType.Key, ["city", "price_date"]);
	await createIndexIfNotExists(
		db,
		"idx_city_date_desc",
		TablesDBIndexType.Key,
		["city", "price_date"],
		[OrderBy.Asc, OrderBy.Desc],
	);
}

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const db = createTablesDB(client);

	console.log("Setting up Appwrite database schema...\n");

	await createDatabaseIfNotExists(db);
	await createTableIfNotExists(db);
	await createColumns(db);

	console.log("\nWaiting for columns to be processed...");
	await waitForColumns(db);

	await createIndexes(db);

	console.log("\nSchema setup complete.");
}

main().catch((err) => {
	console.error("Schema setup failed:", err);
	process.exit(1);
});
