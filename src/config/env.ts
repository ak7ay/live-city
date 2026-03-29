import "dotenv/config";

export interface EnvConfig {
	APPWRITE_ENDPOINT: string;
	APPWRITE_PROJECT_ID: string;
	APPWRITE_API_KEY: string;
}

const REQUIRED_KEYS: ReadonlyArray<keyof EnvConfig> = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"];

export function loadEnv(): EnvConfig {
	for (const key of REQUIRED_KEYS) {
		const value = process.env[key];
		if (!value) {
			throw new Error(`Missing required environment variable: ${key}`);
		}
	}

	return {
		APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT!,
		APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID!,
		APPWRITE_API_KEY: process.env.APPWRITE_API_KEY!,
	};
}
