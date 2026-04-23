import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinPriceWindow } from "../src/ist-window.js";

// Helper: build a Date at a specific IST hh:mm. IST is UTC+5:30.
// 04:00 UTC = 09:30 IST; 04:30 UTC = 10:00 IST; 05:00 UTC = 10:30 IST;
// 09:30 UTC = 15:00 IST; 10:30 UTC = 16:00 IST.
function istDate(utcHours, utcMinutes) {
	return new Date(Date.UTC(2026, 3, 23, utcHours, utcMinutes, 0));
}

test("inside morning window — 09:30 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(4, 0)), true);
});

test("inside morning window — 10:00 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(4, 30)), true);
});

test("boundary morning window — 10:30 IST inclusive", () => {
	assert.equal(isWithinPriceWindow(istDate(5, 0)), true);
});

test("just outside morning window — 10:31 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(5, 1)), false);
});

test("just before morning window — 09:29 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(3, 59)), false);
});

test("inside afternoon window — 15:00 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(9, 30)), true);
});

test("inside afternoon window — 15:45 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(10, 15)), true);
});

test("boundary afternoon window — 16:00 IST inclusive", () => {
	assert.equal(isWithinPriceWindow(istDate(10, 30)), true);
});

test("outside afternoon window — 16:01 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(10, 31)), false);
});

test("dead zone — 12:00 IST", () => {
	assert.equal(isWithinPriceWindow(istDate(6, 30)), false);
});
