import { type Databases, DatabasesIndexType, OrderBy } from "node-appwrite";
import { createAppwriteClient, createDatabases } from "./config/appwrite.js";
import { COLLECTION_METAL_PRICES, DB_ID } from "./config/constants.js";
import { loadEnv } from "./config/env.js";

async function createDatabaseIfNotExists(databases: Databases): Promise<void> {
	try {
		await databases.get({ databaseId: DB_ID });
		console.log(`Database "${DB_ID}" already exists, skipping.`);
	} catch {
		await databases.create({ databaseId: DB_ID, name: DB_ID });
		console.log(`Database "${DB_ID}" created.`);
	}
}

async function createCollectionIfNotExists(databases: Databases): Promise<void> {
	try {
		await databases.getCollection({ databaseId: DB_ID, collectionId: COLLECTION_METAL_PRICES });
		console.log(`Collection "${COLLECTION_METAL_PRICES}" already exists, skipping.`);
	} catch {
		await databases.createCollection({
			databaseId: DB_ID,
			collectionId: COLLECTION_METAL_PRICES,
			name: COLLECTION_METAL_PRICES,
		});
		console.log(`Collection "${COLLECTION_METAL_PRICES}" created.`);
	}
}

async function createAttributeIfNotExists(
	databases: Databases,
	createFn: () => Promise<unknown>,
	name: string,
): Promise<void> {
	try {
		await databases.getAttribute({ databaseId: DB_ID, collectionId: COLLECTION_METAL_PRICES, key: name });
		console.log(`Attribute "${name}" already exists, skipping.`);
	} catch {
		await createFn();
		console.log(`Attribute "${name}" created.`);
	}
}

async function createAttributes(databases: Databases): Promise<void> {
	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createStringAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "city",
				size: 64,
				required: true,
			}),
		"city",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createStringAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "source",
				size: 64,
				required: true,
			}),
		"source",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createFloatAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "gold_22k_price",
				required: true,
			}),
		"gold_22k_price",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createFloatAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "silver_price",
				required: true,
			}),
		"silver_price",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createFloatAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "platinum_price",
				required: true,
			}),
		"platinum_price",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createStringAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "price_date",
				size: 64,
				required: true,
			}),
		"price_date",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createDatetimeAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "price_changed_at",
				required: true,
			}),
		"price_changed_at",
	);

	await createAttributeIfNotExists(
		databases,
		() =>
			databases.createDatetimeAttribute({
				databaseId: DB_ID,
				collectionId: COLLECTION_METAL_PRICES,
				key: "last_checked_at",
				required: true,
			}),
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
		await databases.getIndex({ databaseId: DB_ID, collectionId: COLLECTION_METAL_PRICES, key });
		console.log(`Index "${key}" already exists, skipping.`);
	} catch {
		await databases.createIndex({
			databaseId: DB_ID,
			collectionId: COLLECTION_METAL_PRICES,
			key,
			type,
			attributes,
			orders,
		});
		console.log(`Index "${key}" created.`);
	}
}

async function waitForAttributes(databases: Databases): Promise<void> {
	const maxAttempts = 30;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const { attributes } = await databases.listAttributes({
			databaseId: DB_ID,
			collectionId: COLLECTION_METAL_PRICES,
		});
		const pending = attributes.filter((a: any) => a.status !== "available");
		if (pending.length === 0) {
			console.log("All attributes are available.");
			return;
		}
		console.log(`Waiting for ${pending.length} attribute(s) to be ready... (attempt ${attempt}/${maxAttempts})`);
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error("Timed out waiting for attributes to become available");
}

async function deleteFailedIndexes(databases: Databases): Promise<void> {
	const { indexes } = await databases.listIndexes({
		databaseId: DB_ID,
		collectionId: COLLECTION_METAL_PRICES,
	});
	for (const index of indexes) {
		if ((index as any).status === "failed") {
			console.log(`Deleting failed index "${index.key}"...`);
			await databases.deleteIndex({ databaseId: DB_ID, collectionId: COLLECTION_METAL_PRICES, key: index.key });
		}
	}
}

async function createIndexes(databases: Databases): Promise<void> {
	await deleteFailedIndexes(databases);
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

	console.log("\nWaiting for attributes to be processed...");
	await waitForAttributes(databases);

	await createIndexes(databases);

	console.log("\nSchema setup complete.");
}

main().catch((err) => {
	console.error("Schema setup failed:", err);
	process.exit(1);
});
