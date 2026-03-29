import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadLalithaaConfig } from "../../src/config/source-loader.ts";

const LALITHAA_YAML = join(import.meta.dirname, "../../config/sources/lalithaa.yaml");

describe("loadLalithaaConfig", () => {
	const tmpDirs: string[] = [];

	afterAll(() => {
		for (const dir of tmpDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads and validates lalithaa.yaml", () => {
		const config = loadLalithaaConfig(LALITHAA_YAML);

		expect(config.name).toBe("lalithaa_jewellery");
		expect(config.api_url).toBe("https://api.lalithaajewellery.com/public/pricings/latest");
		expect(config.states_api_url).toBe("https://api.lalithaajewellery.com/public/states");
		expect(config.states).toHaveLength(5);
		expect(config.states[0]).toEqual({ state_name: "Karnataka", city: "bengaluru" });
	});

	it("throws on missing file", () => {
		expect(() => loadLalithaaConfig("/nonexistent/path.yaml")).toThrow();
	});

	it("throws on invalid yaml (missing name)", () => {
		const dir = mkdtempSync(join(tmpdir(), "source-loader-"));
		tmpDirs.push(dir);
		const filePath = join(dir, "bad.yaml");
		writeFileSync(filePath, "api_url: https://example.com\nstates: []\n");

		expect(() => loadLalithaaConfig(filePath)).toThrow();
	});
});
