import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const FIXTURES = resolve(ROOT, "test", "fixtures", "news", "chennai");
const SCRIPTS = resolve(ROOT, "scripts", "news", "chennai");

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

interface ThanthiItem {
	n: number;
	title: string;
	url: string;
	date: string;
	cats: string[];
	thumb: string;
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
	// Fixture stories are all dated 2026-04-18 IST. Pin TODAY=2026-04-19 so
	// they fall in (today, yesterday) = (2026-04-19, 2026-04-18).
	const items = runScript("dailythanthi.py", resolve(FIXTURES, "dailythanthi-stories.rss"), {
		NEWS_TODAY_OVERRIDE: "2026-04-19",
	}) as ThanthiItem[];

	it("returns at least 10 items in the today/yesterday window", () => {
		expect(items.length).toBeGreaterThanOrEqual(10);
	});

	it("never includes /ampstories/ URLs", () => {
		for (const item of items) {
			expect(item.url).not.toContain("/ampstories/");
		}
	});

	it("every item has title, url, IST YYYY-MM-DD date, thumb", () => {
		for (const item of items) {
			expect(item.title.length).toBeGreaterThan(0);
			expect(item.url).toMatch(/^https:\/\/www\.dailythanthi\.com\//);
			expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(item.thumb).toMatch(/^https?:\/\//);
		}
	});

	it("every emitted item has a date in (today, yesterday) IST", () => {
		for (const item of items) {
			expect(["2026-04-19", "2026-04-18"]).toContain(item.date);
		}
	});

	it("date filter excludes everything when TODAY is far enough ahead", () => {
		const empty = runScript("dailythanthi.py", resolve(FIXTURES, "dailythanthi-stories.rss"), {
			NEWS_TODAY_OVERRIDE: "2026-04-25",
		}) as ThanthiItem[];
		expect(empty.length).toBe(0);
	});
});

describe("Chennai scrapers — Polimer listing", () => {
	// Fixture: 35 items @ 2026-04-17 IST + 15 items @ 2026-04-16 IST.
	// TODAY=2026-04-17 keeps both dates in window (today+yesterday).
	const items = runScript("polimer-listing.py", resolve(FIXTURES, "polimer-rss.xml"), {
		NEWS_TODAY_OVERRIDE: "2026-04-17",
	}) as PolimerListingItem[];

	it("returns at least 10 items in the today/yesterday window", () => {
		expect(items.length).toBeGreaterThanOrEqual(10);
	});

	it("every item has title, url, IST YYYY-MM-DD date, thumb", () => {
		for (const item of items) {
			expect(item.title.length).toBeGreaterThan(0);
			expect(item.url).toMatch(/^https:\/\/www\.polimernews\.com\//);
			expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(item.thumb).toMatch(/^https:\/\//);
		}
	});

	it("every item has at least one category tag", () => {
		for (const item of items) {
			expect(item.cats.length).toBeGreaterThan(0);
		}
	});

	it("every emitted item has a date in (today, yesterday) IST", () => {
		for (const item of items) {
			expect(["2026-04-17", "2026-04-16"]).toContain(item.date);
		}
	});

	it("date filter drops items outside the window", () => {
		// TODAY=2026-04-18 → window = {2026-04-18, 2026-04-17} → 35 items kept,
		// 15 items dated 2026-04-16 dropped.
		const filtered = runScript("polimer-listing.py", resolve(FIXTURES, "polimer-rss.xml"), {
			NEWS_TODAY_OVERRIDE: "2026-04-18",
		}) as PolimerListingItem[];
		expect(filtered.length).toBe(35);
		for (const item of filtered) {
			expect(item.date).toBe("2026-04-17");
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
