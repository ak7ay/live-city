import { describe, expect, it } from "vitest";
import { extractJson } from "../../src/news/agent.js";

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
