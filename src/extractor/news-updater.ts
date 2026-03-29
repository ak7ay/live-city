import type { TablesDB } from "node-appwrite";
import { logger } from "../config/logger.js";
import { fetchNewsViaAgent } from "../news/agent.js";
import { replaceNewsForCity } from "../news/store.js";

const MAX_AGENT_RETRIES = 2;

export async function updateNewsForCity(db: TablesDB, city: string): Promise<void> {
	const log = logger.child({ module: "news-updater", city });
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= MAX_AGENT_RETRIES; attempt++) {
		try {
			log.info({ attempt }, "Fetching news via agent");
			const articles = await fetchNewsViaAgent(city);
			log.info({ count: articles.length }, "Agent returned articles, storing");
			await replaceNewsForCity(db, city, articles);
			log.info("News update complete");
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			log.error({ attempt, error: lastError.message }, "Agent attempt failed");
		}
	}

	throw lastError;
}
