import { describe, expect, it } from "vitest";
import { extractJson } from "../../src/agent/shared.js";

describe("extractJson", () => {
	it("extracts a JSON object from plain text", () => {
		const text = 'Here is the result: {"rank": 1, "headline": "Test"}';
		expect(extractJson(text)).toBe('{"rank": 1, "headline": "Test"}');
	});

	it("extracts a JSON array from plain text", () => {
		const text = 'Here are the results: [{"rank": 1}, {"rank": 2}]';
		expect(extractJson(text)).toBe('[{"rank": 1}, {"rank": 2}]');
	});

	it("returns null for text with no JSON", () => {
		expect(extractJson("No JSON here at all")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractJson("")).toBeNull();
	});

	it("handles text with incidental brackets before actual JSON", () => {
		const text = 'I read [2 files] and here is the result: [{"rank":1}]';
		const result = extractJson(text);
		expect(result).not.toBeNull();
		expect(JSON.parse(result!)).toEqual([{ rank: 1 }]);
	});

	it("handles text with incidental braces before actual JSON", () => {
		const text = 'The format is {key: value} style. {"rank": 1, "headline": "Test"}';
		const result = extractJson(text);
		expect(result).not.toBeNull();
		const parsed = JSON.parse(result!);
		expect(parsed).toHaveProperty("rank", 1);
	});

	it("prefers the longest valid JSON when multiple candidates exist", () => {
		const text = '{"a":1} and then {"a":1,"b":2,"c":3}';
		const result = extractJson(text);
		expect(result).toBe('{"a":1,"b":2,"c":3}');
	});

	it("extracts JSON with nested objects", () => {
		const text = 'Result: {"sources": [{"name": "publictv"}, {"name": "tv9"}]}';
		const result = extractJson(text);
		expect(result).not.toBeNull();
		const parsed = JSON.parse(result!);
		expect(parsed.sources).toHaveLength(2);
	});

	it("handles JSON with escaped quotes in strings", () => {
		const text = '{"headline": "He said \\"hello\\" to them"}';
		const result = extractJson(text);
		expect(result).not.toBeNull();
		expect(JSON.parse(result!).headline).toBe('He said "hello" to them');
	});

	it("skips invalid JSON fragments and finds the valid one", () => {
		const text = "[broken, not json] then [1, 2, 3]";
		const result = extractJson(text);
		expect(result).toBe("[1, 2, 3]");
	});

	it("handles multiline JSON", () => {
		const text = `Here is the output:
{
  "rank": 1,
  "headline": "Test headline"
}`;
		const result = extractJson(text);
		expect(result).not.toBeNull();
		expect(JSON.parse(result!).rank).toBe(1);
	});
});

import { findStaleDates } from "../../src/news/agent.js";

describe("findStaleDates", () => {
	const TODAY = "2026-04-23";
	const YESTERDAY = "2026-04-22";

	it("returns empty when all stories are in the today/yesterday window", () => {
		const md = `# polimer — chennai (2026-04-23)

## 1. தலைப்பு ஒன்று
- **Date:** 2026-04-23
- **Category:** தமிழ்நாடு
- **Summary:** சுருக்கம்
- **URL:** https://example.com/a
- **ID:** none

## 2. தலைப்பு இரண்டு
- **Date:** 2026-04-22
- **Category:** சென்னை
- **Summary:** சுருக்கம்
- **URL:** https://example.com/b
- **ID:** none
`;
		expect(findStaleDates(md, TODAY, YESTERDAY)).toEqual([]);
	});

	it("flags a story dated before yesterday", () => {
		const md = `## 1. ok
- **Date:** 2026-04-23
- **URL:** https://example.com/a

## 2. stale
- **Date:** 2026-04-15
- **URL:** https://example.com/b
`;
		const stale = findStaleDates(md, TODAY, YESTERDAY);
		expect(stale).toHaveLength(1);
		expect(stale[0]).toMatchObject({ num: 2, headline: "stale", date: "2026-04-15" });
	});

	it("flags a story with a missing Date field", () => {
		const md = `## 1. headline-without-date
- **Category:** foo
- **URL:** https://example.com/a
`;
		const stale = findStaleDates(md, TODAY, YESTERDAY);
		expect(stale).toHaveLength(1);
		expect(stale[0]).toMatchObject({ num: 1, headline: "headline-without-date", date: "(missing)" });
	});

	it("flags a story dated after today (future-leak)", () => {
		const md = `## 1. tomorrow
- **Date:** 2026-04-24
- **URL:** https://example.com/a
`;
		const stale = findStaleDates(md, TODAY, YESTERDAY);
		expect(stale).toHaveLength(1);
		expect(stale[0].date).toBe("2026-04-24");
	});

	it("returns empty for an empty file", () => {
		expect(findStaleDates("", TODAY, YESTERDAY)).toEqual([]);
	});

	it("handles many stories in one file", () => {
		const blocks = Array.from(
			{ length: 12 },
			(_, i) => `## ${i + 1}. h${i + 1}
- **Date:** ${i % 3 === 0 ? "2026-04-15" : "2026-04-23"}
- **URL:** https://example.com/${i + 1}
`,
		).join("\n");
		const stale = findStaleDates(blocks, TODAY, YESTERDAY);
		// 12 stories; indices 0,3,6,9 → 4 stale (story numbers 1,4,7,10)
		expect(stale.map((s) => s.num)).toEqual([1, 4, 7, 10]);
	});
});

import { getDateWindow } from "../../src/news/agent.js";

describe("getDateWindow", () => {
	it("returns today and yesterday for a given UTC instant", () => {
		// 2026-04-23T20:00:00Z = 2026-04-24 01:30 IST
		const { today, yesterday } = getDateWindow(new Date("2026-04-23T20:00:00Z"));
		expect(today).toBe("2026-04-24");
		expect(yesterday).toBe("2026-04-23");
	});

	it("handles month/year rollover", () => {
		const { today, yesterday } = getDateWindow(new Date("2026-05-01T05:00:00Z"));
		// 05:00 UTC = 10:30 IST → today = 2026-05-01, yesterday = 2026-04-30
		expect(today).toBe("2026-05-01");
		expect(yesterday).toBe("2026-04-30");
	});

	it("accepts a pinned today string and derives yesterday from it", () => {
		const { today, yesterday } = getDateWindow("2026-04-23");
		expect(today).toBe("2026-04-23");
		expect(yesterday).toBe("2026-04-22");
	});

	it("string input handles month rollover", () => {
		const { today, yesterday } = getDateWindow("2026-03-01");
		expect(today).toBe("2026-03-01");
		expect(yesterday).toBe("2026-02-28");
	});
});
