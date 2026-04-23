import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const FIXTURES = resolve(ROOT, "test", "fixtures", "news", "bengaluru");
const SCRIPTS = resolve(ROOT, "scripts", "news", "bengaluru");

function runScript(scriptName: string, fixturePath: string, env: Record<string, string> = {}): unknown {
	const fixture = readFileSync(fixturePath);
	const stdout = execFileSync("python3", [resolve(SCRIPTS, scriptName)], {
		input: fixture,
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 10 * 1024 * 1024,
		env: { ...process.env, ...env },
	});
	return JSON.parse(stdout.toString("utf-8"));
}

interface PublicTVItem {
	n: number;
	title: string;
	url: string;
	date: string;
	excerpt: string;
}

describe("Bengaluru scrapers — PublicTV", () => {
	// Fixture: 5 items @ 2026-04-23 IST + 15 items @ 2026-04-22 IST.
	// TODAY=2026-04-23 → window = {2026-04-23, 2026-04-22} → all 20 pass.
	const items = runScript("publictv.py", resolve(FIXTURES, "publictv-posts.json"), {
		NEWS_TODAY_OVERRIDE: "2026-04-23",
	}) as PublicTVItem[];

	it("returns all 20 items when window covers fixture dates", () => {
		expect(items.length).toBe(20);
	});

	it("every item has title, url (publictv.in), IST YYYY-MM-DD date, excerpt", () => {
		for (const item of items) {
			expect(item.title.length).toBeGreaterThan(0);
			expect(item.url).toMatch(/^https:\/\/publictv\.in\//);
			expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(item.excerpt.length).toBeGreaterThan(0);
		}
	});

	it("every emitted item has a date in (today, yesterday) IST", () => {
		for (const item of items) {
			expect(["2026-04-23", "2026-04-22"]).toContain(item.date);
		}
	});

	it("date filter drops items outside window", () => {
		// TODAY=2026-04-24 → window = {2026-04-24, 2026-04-23} → only 5 kept.
		const filtered = runScript("publictv.py", resolve(FIXTURES, "publictv-posts.json"), {
			NEWS_TODAY_OVERRIDE: "2026-04-24",
		}) as PublicTVItem[];
		expect(filtered.length).toBe(5);
		for (const item of filtered) expect(item.date).toBe("2026-04-23");
	});

	it("date filter returns empty when TODAY is far ahead", () => {
		const empty = runScript("publictv.py", resolve(FIXTURES, "publictv-posts.json"), {
			NEWS_TODAY_OVERRIDE: "2026-04-30",
		}) as PublicTVItem[];
		expect(empty.length).toBe(0);
	});
});

interface TV9Item {
	n: number;
	title: string;
	url: string;
	date: string;
	cats: string[];
	desc: string;
}

describe("Bengaluru scrapers — TV9 Kannada", () => {
	// Fixture distribution: 6 × 2026-04-23 IST + 25 × 2026-04-22 + 27 × 2026-04-21 + 2 × 2026-04-20.
	// TODAY=2026-04-23 → window = {2026-04-23, 2026-04-22} → 31 items kept.
	const items = runScript("tv9kannada.py", resolve(FIXTURES, "tv9kannada-feed.xml"), {
		NEWS_TODAY_OVERRIDE: "2026-04-23",
	}) as TV9Item[];

	it("returns at least 20 items in today+yesterday window", () => {
		expect(items.length).toBeGreaterThanOrEqual(20);
	});

	it("every item has title, url (tv9kannada), IST YYYY-MM-DD date", () => {
		for (const item of items) {
			expect(item.title.length).toBeGreaterThan(0);
			expect(item.url).toMatch(/^https?:\/\/(www\.)?tv9kannada\.com\//);
			expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	it("every item has at least one category tag", () => {
		for (const item of items) {
			expect(item.cats.length).toBeGreaterThan(0);
		}
	});

	it("every emitted item has a date in (today, yesterday) IST", () => {
		for (const item of items) {
			expect(["2026-04-23", "2026-04-22"]).toContain(item.date);
		}
	});

	it("date filter drops out-of-window items", () => {
		// TODAY=2026-04-21 → window = {2026-04-21, 2026-04-20} → 29 kept (27 + 2).
		const filtered = runScript("tv9kannada.py", resolve(FIXTURES, "tv9kannada-feed.xml"), {
			NEWS_TODAY_OVERRIDE: "2026-04-21",
		}) as TV9Item[];
		expect(filtered.length).toBe(29);
		for (const item of filtered) expect(["2026-04-21", "2026-04-20"]).toContain(item.date);
	});

	it("date filter returns empty when TODAY is far ahead", () => {
		const empty = runScript("tv9kannada.py", resolve(FIXTURES, "tv9kannada-feed.xml"), {
			NEWS_TODAY_OVERRIDE: "2026-05-01",
		}) as TV9Item[];
		expect(empty.length).toBe(0);
	});
});
