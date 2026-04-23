import assert from "node:assert/strict";
import { test } from "node:test";
import { pricesChanged } from "../src/prices-updater.js";

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
