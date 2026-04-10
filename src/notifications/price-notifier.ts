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

export function buildPriceChangeEvent(city: string, priorRow: PriceRecord, newPrices: PriceInput): PriceChangeEvent {
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
