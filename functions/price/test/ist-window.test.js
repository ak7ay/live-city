import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinPriceWindow } from "../src/ist-window.js";

// Helper: build a Date at a specific UTC hh:mm. IST is UTC+5:30.
// 04:00 UTC = 09:30 IST; 05:00 UTC = 10:30 IST;
// 09:30 UTC = 15:00 IST; 13:30 UTC = 19:00 IST.
function utcDate(utcHours, utcMinutes) {
	return new Date(Date.UTC(2026, 3, 23, utcHours, utcMinutes, 0));
}

test("inside morning window — 09:30 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(4, 0)), true);
});

test("inside morning window — 10:00 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(4, 30)), true);
});

test("inside morning window — 5-min ticks fire", () => {
	assert.equal(isWithinPriceWindow(utcDate(4, 5)), true); // 09:35 IST
	assert.equal(isWithinPriceWindow(utcDate(4, 25)), true); // 09:55 IST
});

test("boundary morning window — 10:30 IST inclusive", () => {
	assert.equal(isWithinPriceWindow(utcDate(5, 0)), true);
});

test("just outside morning window — 10:31 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(5, 1)), false);
});

test("just before morning window — 09:29 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(3, 59)), false);
});

test("inside afternoon window — 15:00 IST (10-min aligned)", () => {
	assert.equal(isWithinPriceWindow(utcDate(9, 30)), true);
});

test("inside afternoon window — 15:10 IST (10-min aligned)", () => {
	assert.equal(isWithinPriceWindow(utcDate(9, 40)), true);
});

test("afternoon window skips 5-min offset — 15:05 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(9, 35)), false);
});

test("afternoon window skips 5-min offset — 15:55 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(10, 25)), false);
});

test("inside afternoon window — 18:00 IST (10-min aligned)", () => {
	assert.equal(isWithinPriceWindow(utcDate(12, 30)), true);
});

test("boundary afternoon window — 19:00 IST inclusive", () => {
	assert.equal(isWithinPriceWindow(utcDate(13, 30)), true);
});

test("outside afternoon window — 19:10 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(13, 40)), false);
});

test("just before afternoon window — 14:50 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(9, 20)), false);
});

test("dead zone — 12:00 IST", () => {
	assert.equal(isWithinPriceWindow(utcDate(6, 30)), false);
});
