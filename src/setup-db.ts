import { OrderBy, type TablesDB, TablesDBIndexType } from "node-appwrite";
import { createAppwriteClient, createTablesDB } from "./config/appwrite.js";
import { DB_ID, TABLE_METAL_PRICES, TABLE_NEWS_ARTICLES } from "./config/constants.js";
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

async function createColumnIfNotExists(
	db: TablesDB,
	tableId: string,
	createFn: () => Promise<unknown>,
	name: string,
): Promise<void> {
	try {
		await db.getColumn({ databaseId: DB_ID, tableId, key: name });
		console.log(`Column "${name}" already exists, skipping.`);
	} catch {
		await createFn();
		console.log(`Column "${name}" created.`);
	}
}

async function createColumns(db: TablesDB): Promise<void> {
	await createColumnIfNotExists(
		db,
		TABLE_METAL_PRICES,
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
		TABLE_METAL_PRICES,
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
		TABLE_METAL_PRICES,
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
		TABLE_METAL_PRICES,
		() =>
			db.createFloatColumn({ databaseId: DB_ID, tableId: TABLE_METAL_PRICES, key: "silver_price", required: true }),
		"silver_price",
	);

	await createColumnIfNotExists(
		db,
		TABLE_METAL_PRICES,
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
		TABLE_METAL_PRICES,
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
		TABLE_METAL_PRICES,
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
		TABLE_METAL_PRICES,
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
	tableId: string,
	key: string,
	type: TablesDBIndexType,
	columns: string[],
	orders?: OrderBy[],
): Promise<void> {
	try {
		await db.getIndex({ databaseId: DB_ID, tableId, key });
		console.log(`Index "${key}" already exists, skipping.`);
	} catch {
		await db.createIndex({ databaseId: DB_ID, tableId, key, type, columns, orders });
		console.log(`Index "${key}" created.`);
	}
}

async function waitForColumns(db: TablesDB, tableId: string): Promise<void> {
	const maxAttempts = 30;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const { columns } = await db.listColumns({ databaseId: DB_ID, tableId });
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

async function deleteFailedIndexes(db: TablesDB, tableId: string): Promise<void> {
	const { indexes } = await db.listIndexes({ databaseId: DB_ID, tableId });
	for (const index of indexes) {
		if ((index as any).status === "failed") {
			console.log(`Deleting failed index "${index.key}"...`);
			await db.deleteIndex({ databaseId: DB_ID, tableId, key: index.key });
		}
	}
}

async function createIndexes(db: TablesDB): Promise<void> {
	await deleteFailedIndexes(db, TABLE_METAL_PRICES);
	await createIndexIfNotExists(db, TABLE_METAL_PRICES, "idx_city_date", TablesDBIndexType.Key, ["city", "price_date"]);
	await createIndexIfNotExists(
		db,
		TABLE_METAL_PRICES,
		"idx_city_date_desc",
		TablesDBIndexType.Key,
		["city", "price_date"],
		[OrderBy.Asc, OrderBy.Desc],
	);
}

async function createNewsTableIfNotExists(db: TablesDB): Promise<void> {
	try {
		await db.getTable({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES });
		console.log(`Table "${TABLE_NEWS_ARTICLES}" already exists, skipping.`);
	} catch {
		await db.createTable({ databaseId: DB_ID, tableId: TABLE_NEWS_ARTICLES, name: TABLE_NEWS_ARTICLES });
		console.log(`Table "${TABLE_NEWS_ARTICLES}" created.`);
	}
}

async function createNewsColumns(db: TablesDB): Promise<void> {
	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "city",
				size: 64,
				required: true,
			}),
		"city",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "headline",
				size: 512,
				required: true,
			}),
		"headline",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "summary",
				size: 2048,
				required: true,
			}),
		"summary",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createTextColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "content",
				required: true,
			}),
		"content",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "category",
				size: 64,
				required: true,
			}),
		"category",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "source",
				size: 64,
				required: true,
			}),
		"source",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createIntegerColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "source_count",
				required: true,
			}),
		"source_count",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "original_url",
				size: 512,
				required: false,
			}),
		"original_url",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "thumbnail_url",
				size: 512,
				required: false,
			}),
		"thumbnail_url",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createVarcharColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "news_date",
				size: 64,
				required: true,
			}),
		"news_date",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createIntegerColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "rank",
				required: true,
			}),
		"rank",
	);

	await createColumnIfNotExists(
		db,
		TABLE_NEWS_ARTICLES,
		() =>
			db.createDatetimeColumn({
				databaseId: DB_ID,
				tableId: TABLE_NEWS_ARTICLES,
				key: "fetched_at",
				required: true,
			}),
		"fetched_at",
	);
}

async function createNewsIndexes(db: TablesDB): Promise<void> {
	await deleteFailedIndexes(db, TABLE_NEWS_ARTICLES);
	await createIndexIfNotExists(db, TABLE_NEWS_ARTICLES, "idx_city_date", TablesDBIndexType.Key, ["city", "news_date"]);
	await createIndexIfNotExists(db, TABLE_NEWS_ARTICLES, "idx_city_date_rank", TablesDBIndexType.Key, [
		"city",
		"news_date",
		"rank",
	]);
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
	await waitForColumns(db, TABLE_METAL_PRICES);

	await createIndexes(db);

	await createNewsTableIfNotExists(db);
	await createNewsColumns(db);
	console.log("\nWaiting for news columns to be processed...");
	await waitForColumns(db, TABLE_NEWS_ARTICLES);
	await createNewsIndexes(db);

	console.log("\nSchema setup complete.");
}

main().catch((err) => {
	console.error("Schema setup failed:", err);
	process.exit(1);
});
