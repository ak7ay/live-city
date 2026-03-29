import { type Databases, DatabasesIndexType, OrderBy } from "node-appwrite";
import { createAppwriteClient, createDatabases } from "./config/appwrite.js";
import { COLLECTION_METAL_PRICES, DB_ID } from "./config/constants.js";
import { loadEnv } from "./config/env.js";

async function createDatabaseIfNotExists(databases: Databases): Promise<void> {
	try {
		await databases.get(DB_ID);
		console.log(`Database "${DB_ID}" already exists, skipping.`);
	} catch {
		await databases.create(DB_ID, DB_ID);
		console.log(`Database "${DB_ID}" created.`);
	}
}

async function createCollectionIfNotExists(databases: Databases): Promise<void> {
	try {
		await databases.getCollection(DB_ID, COLLECTION_METAL_PRICES);
		console.log(`Collection "${COLLECTION_METAL_PRICES}" already exists, skipping.`);
	} catch {
		await databases.createCollection(DB_ID, COLLECTION_METAL_PRICES, COLLECTION_METAL_PRICES);
		console.log(`Collection "${COLLECTION_METAL_PRICES}" created.`);
	}
}

async function createAttributeIfNotExists(
	databases: Databases,
	createFn: () => Promise<unknown>,
	name: string,
): Promise<void> {
	try {
		await databases.getAttribute(DB_ID, COLLECTION_METAL_PRICES, name);
		console.log(`Attribute "${name}" already exists, skipping.`);
	} catch {
		await createFn();
		console.log(`Attribute "${name}" created.`);
	}
}

async function createAttributes(databases: Databases): Promise<void> {
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
	type: DatabasesIndexType,
	attributes: string[],
	orders?: OrderBy[],
): Promise<void> {
	try {
		await databases.getIndex(DB_ID, COLLECTION_METAL_PRICES, key);
		console.log(`Index "${key}" already exists, skipping.`);
	} catch {
		await databases.createIndex(DB_ID, COLLECTION_METAL_PRICES, key, type, attributes, orders);
		console.log(`Index "${key}" created.`);
	}
}

async function createIndexes(databases: Databases): Promise<void> {
	await createIndexIfNotExists(databases, "idx_city_date", DatabasesIndexType.Key, ["city", "price_date"]);
	await createIndexIfNotExists(
		databases,
		"idx_city_date_desc",
		DatabasesIndexType.Key,
		["city", "price_date"],
		[OrderBy.Asc, OrderBy.Desc],
	);
}

async function main(): Promise<void> {
	const env = loadEnv();
	const client = createAppwriteClient(env);
	const databases = createDatabases(client);

	console.log("Setting up Appwrite database schema...\n");

	await createDatabaseIfNotExists(databases);
	await createCollectionIfNotExists(databases);
	await createAttributes(databases);

	console.log("\nWaiting 3 seconds for attributes to be processed...");
	await new Promise((resolve) => setTimeout(resolve, 3000));

	await createIndexes(databases);

	console.log("\nSchema setup complete.");
}

main().catch((err) => {
	console.error("Schema setup failed:", err);
	process.exit(1);
});
