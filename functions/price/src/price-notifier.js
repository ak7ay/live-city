import { ID } from "node-appwrite";

const CITY_DISPLAY_NAMES = {
	bengaluru: "Bengaluru",
	chennai: "Chennai",
	hyderabad: "Hyderabad",
	vijayawada: "Vijayawada",
	puducherry: "Puducherry",
};

function cityDisplayName(slug) {
	return CITY_DISPLAY_NAMES[slug] ?? slug;
}

export function buildPriceChangeEvent(city, priorRow, newPrices) {
	const deltas = [];

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

function formatDelta(delta) {
	const symbol = delta.delta >= 0 ? "▲" : "▼";
	const magnitude = Math.round(Math.abs(delta.delta));
	const label = delta.metal === "gold" ? "Gold" : "Silver";
	return `${label} ${symbol} ₹${magnitude}/g`;
}

export function formatNotificationBody(event) {
	return `${event.deltas.map(formatDelta).join(" · ")} — tap to see today's price`;
}

export async function sendPriceNotification(messaging, event) {
	await messaging.createPush({
		messageId: ID.unique(),
		title: `${event.cityDisplayName} rates updated`,
		body: formatNotificationBody(event),
		topics: [`prices-${event.city}`],
		data: { OPEN_TAB: "home" },
	});
}
