import { Client, Databases } from "node-appwrite";
import type { EnvConfig } from "./env.js";

export function createAppwriteClient(env: EnvConfig): Client {
	return new Client()
		.setEndpoint(env.APPWRITE_ENDPOINT)
		.setProject(env.APPWRITE_PROJECT_ID)
		.setKey(env.APPWRITE_API_KEY);
}

export function createDatabases(client: Client): Databases {
	return new Databases(client);
}
