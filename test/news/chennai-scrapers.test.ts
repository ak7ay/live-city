import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const FIXTURES = resolve(ROOT, "test", "fixtures", "news", "chennai");
const SCRIPTS = resolve(ROOT, "scripts", "news", "chennai");

function runScript(scriptName: string, fixturePath: string): unknown {
	const fixture = readFileSync(fixturePath);
	const stdout = execFileSync("python3", [resolve(SCRIPTS, scriptName)], {
		input: fixture,
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 10 * 1024 * 1024,
	});
	return JSON.parse(stdout.toString("utf-8"));
}

interface ThanthiItem {
	n: number;
	title: string;
	url: string;
	date: string;
	cats: string[];
	thumb: string;
	body: string;
}

interface PolimerListingItem {
	n: number;
	title: string;
	url: string;
	date: string;
	cats: string[];
	desc: string;
	thumb: string;
}

interface PolimerBody {
	chars: number;
	thumb: string;
	body: string;
}

describe("Chennai scrapers — Daily Thanthi", () => {
	const items = runScript("dailythanthi.py", resolve(FIXTURES, "dailythanthi-stories.rss")) as ThanthiItem[];

	it("returns at least 10 items", () => {
		expect(items.length).toBeGreaterThanOrEqual(10);
	});

	it("never includes /ampstories/ URLs", () => {
		for (const item of items) {
			expect(item.url).not.toContain("/ampstories/");
		}
	});

	it("every item has title, url, date, thumb", () => {
		for (const item of items) {
			expect(item.title.length).toBeGreaterThan(0);
			expect(item.url).toMatch(/^https:\/\/www\.dailythanthi\.com\//);
			expect(item.date.length).toBeGreaterThan(0);
			expect(item.thumb).toMatch(/^https?:\/\//);
		}
	});

	it("the first item has a substantial body (≥ 500 chars)", () => {
		expect(items[0].body.length).toBeGreaterThanOrEqual(500);
	});
});

describe("Chennai scrapers — Polimer listing", () => {
	const items = runScript("polimer-listing.py", resolve(FIXTURES, "polimer-rss.xml")) as PolimerListingItem[];

	it("returns at least 10 items", () => {
		expect(items.length).toBeGreaterThanOrEqual(10);
	});

	it("every item has title, url, date, thumb", () => {
		for (const item of items) {
			expect(item.title.length).toBeGreaterThan(0);
			expect(item.url).toMatch(/^https:\/\/www\.polimernews\.com\//);
			expect(item.date.length).toBeGreaterThan(0);
			expect(item.thumb).toMatch(/^https?:\/\//);
		}
	});

	it("every item has at least one category tag", () => {
		for (const item of items) {
			expect(item.cats.length).toBeGreaterThan(0);
		}
	});
});

describe("Chennai scrapers — Polimer article body", () => {
	const body = runScript("polimer-body.py", resolve(FIXTURES, "polimer-article.html")) as PolimerBody;

	it("extracts a body of at least 500 chars", () => {
		expect(body.chars).toBeGreaterThanOrEqual(500);
		expect(body.body.length).toBe(body.chars);
	});

	it("thumbnail is an HTTPS URL", () => {
		expect(body.thumb).toMatch(/^https:\/\//);
	});

	it("body has no stray HTML entities (fixed-point unescape worked)", () => {
		// Polimer's articleBody is over-escaped; the playbook's fixed-point loop
		// must fully decode it. A regression here means a pass count was hard-coded.
		expect(body.body).not.toContain("&quot;");
		expect(body.body).not.toContain("&amp;quot;");
		expect(body.body).not.toContain("&amp;amp;");
	});
});
