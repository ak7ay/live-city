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
