import { Client, Messaging, TablesDB } from "node-appwrite";
import type { EnvConfig } from "./env.js";

export function createAppwriteClient(env: EnvConfig): Client {
	return new Client()
		.setEndpoint(env.APPWRITE_ENDPOINT)
		.setProject(env.APPWRITE_PROJECT_ID)
		.setKey(env.APPWRITE_API_KEY);
}

export function createTablesDB(client: Client): TablesDB {
	return new TablesDB(client);
}

export function createMessaging(client: Client): Messaging {
	return new Messaging(client);
}
