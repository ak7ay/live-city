import assert from "node:assert/strict";
import { test } from "node:test";
import { isFirstGoldChangeOfDay, pricesChanged } from "../src/prices-updater.js";

const existing = {
	gold_22k_price: 7500,
	silver_price: 95,
	platinum_price: 3200,
};

test("unchanged returns false", () => {
	assert.equal(pricesChanged(existing, { ...existing }), false);
});

test("gold change returns true", () => {
	assert.equal(pricesChanged(existing, { ...existing, gold_22k_price: 7510 }), true);
});

test("silver change returns true", () => {
	assert.equal(pricesChanged(existing, { ...existing, silver_price: 96 }), true);
});

test("platinum change returns true", () => {
	assert.equal(pricesChanged(existing, { ...existing, platinum_price: 3300 }), true);
});

const yesterdayRef = { gold_22k_price: 7500, silver_price: 95 };

test("isFirstGoldChangeOfDay — no yesterday reference", () => {
	assert.equal(isFirstGoldChangeOfDay([{ gold_22k_price: 7510 }], null), false);
	assert.equal(isFirstGoldChangeOfDay([{ gold_22k_price: 7510 }], undefined), false);
});

test("isFirstGoldChangeOfDay — no rows today", () => {
	assert.equal(isFirstGoldChangeOfDay([], yesterdayRef), false);
});

test("isFirstGoldChangeOfDay — only row equals yesterday (no change)", () => {
	assert.equal(isFirstGoldChangeOfDay([{ gold_22k_price: 7500 }], yesterdayRef), false);
});

test("isFirstGoldChangeOfDay — only row differs from yesterday (first change)", () => {
	assert.equal(isFirstGoldChangeOfDay([{ gold_22k_price: 7510 }], yesterdayRef), true);
});

test("isFirstGoldChangeOfDay — 09:30 matches yesterday, 10:00 diverges (first change later)", () => {
	const rows = [{ gold_22k_price: 7500 }, { gold_22k_price: 7510 }];
	assert.equal(isFirstGoldChangeOfDay(rows, yesterdayRef), true);
});

test("isFirstGoldChangeOfDay — two divergent rows today (already notified)", () => {
	const rows = [{ gold_22k_price: 7510 }, { gold_22k_price: 7520 }];
	assert.equal(isFirstGoldChangeOfDay(rows, yesterdayRef), false);
});

test("isFirstGoldChangeOfDay — silver-only change does not count", () => {
	const rows = [
		{ gold_22k_price: 7500, silver_price: 96 },
		{ gold_22k_price: 7500, silver_price: 97 },
	];
	assert.equal(isFirstGoldChangeOfDay(rows, yesterdayRef), false);
});
