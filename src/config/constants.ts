export const DB_ID = "live_city";
export const TABLE_METAL_PRICES = "metal_prices";
export const TABLE_NEWS_ARTICLES = "news_articles";
export const TABLE_EVENTS = "events";

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
