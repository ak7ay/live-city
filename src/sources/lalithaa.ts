import { z } from "zod/v4";
import { logger } from "../config/logger.js";
import type { LalithaaConfig } from "../config/source-loader.js";

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
			gold: z.object({
				price: z.number(),
				rate_datetime: z.string(),
			}),
			silver: z.object({
				price: z.number(),
			}),
			platinum: z.object({
				price: z.number(),
			}),
		}),
	}),
});

export async function resolveStateIds(config: LalithaaConfig): Promise<Map<string, ResolvedState>> {
	const response = await fetch(`${config.states_api_url}?page=1&limit=100`);
	if (!response.ok) {
		throw new Error(`States API returned ${response.status} ${response.statusText}`);
	}

	const json = await response.json();
	const parsed = statesResponseSchema.parse(json);

	const apiStatesByName = new Map<string, string>();
	for (const item of parsed.data.items) {
		apiStatesByName.set(item.name, item.id);
	}

	const result = new Map<string, ResolvedState>();
	for (const entry of config.states) {
		const stateId = apiStatesByName.get(entry.state_name);
		if (stateId === undefined) {
			logger.warn({ state_name: entry.state_name, city: entry.city }, "State not found in API response, skipping");
			continue;
		}
		result.set(entry.city, { stateId, city: entry.city });
	}

	return result;
}

export async function fetchPrice(apiUrl: string, stateId: string): Promise<MetalPrices> {
	const response = await fetch(`${apiUrl}?state_id=${stateId}`);
	if (!response.ok) {
		throw new Error(`Price API returned ${response.status} ${response.statusText}`);
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
