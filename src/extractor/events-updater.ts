import type { TablesDB } from "node-appwrite";
import { logger } from "../config/logger.js";
import { fetchEventsViaAgent } from "../events/agent.js";
import { replaceEventsForCity } from "../events/store.js";

const MAX_AGENT_RETRIES = 2;

export async function updateEventsForCity(db: TablesDB, city: string): Promise<void> {
	const log = logger.child({ module: "events-updater", city });
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= MAX_AGENT_RETRIES; attempt++) {
		try {
			log.info({ attempt }, "Fetching events via agent");
			const events = await fetchEventsViaAgent(db, city);
			log.info({ count: events.length }, "Agent returned events, storing");
			await replaceEventsForCity(db, city, events);
			log.info("Events update complete");
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			log.error({ attempt, error: lastError.message }, "Agent attempt failed");
		}
	}

	throw lastError;
}
