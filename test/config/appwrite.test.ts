import { beforeEach, describe, expect, it, vi } from "vitest";

describe("loadEnv", () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("throws if APPWRITE_ENDPOINT is missing", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "");
		vi.stubEnv("APPWRITE_PROJECT_ID", "proj-123");
		vi.stubEnv("APPWRITE_API_KEY", "key-abc");

		const { loadEnv } = await import("../../src/config/env.js");
		expect(() => loadEnv()).toThrow("APPWRITE_ENDPOINT");
	});

	it("throws if APPWRITE_PROJECT_ID is missing", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "https://example.com/v1");
		vi.stubEnv("APPWRITE_PROJECT_ID", "");
		vi.stubEnv("APPWRITE_API_KEY", "key-abc");

		const { loadEnv } = await import("../../src/config/env.js");
		expect(() => loadEnv()).toThrow("APPWRITE_PROJECT_ID");
	});

	it("throws if APPWRITE_API_KEY is missing", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "https://example.com/v1");
		vi.stubEnv("APPWRITE_PROJECT_ID", "proj-123");
		vi.stubEnv("APPWRITE_API_KEY", "");

		const { loadEnv } = await import("../../src/config/env.js");
		expect(() => loadEnv()).toThrow("APPWRITE_API_KEY");
	});

	it("returns config when all vars are set", async () => {
		vi.stubEnv("APPWRITE_ENDPOINT", "https://example.com/v1");
		vi.stubEnv("APPWRITE_PROJECT_ID", "proj-123");
		vi.stubEnv("APPWRITE_API_KEY", "key-abc");

		const { loadEnv } = await import("../../src/config/env.js");
		const config = loadEnv();

		expect(config).toEqual({
			APPWRITE_ENDPOINT: "https://example.com/v1",
			APPWRITE_PROJECT_ID: "proj-123",
			APPWRITE_API_KEY: "key-abc",
		});
	});
});
