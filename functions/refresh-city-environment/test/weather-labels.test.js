import assert from "node:assert/strict";
import { test } from "node:test";
import { labelForWmoCode, resolveWeatherLabel } from "../src/weatherLabels.js";

test("labelForWmoCode maps known codes", () => {
	assert.equal(labelForWmoCode(0), "Clear");
	assert.equal(labelForWmoCode(95), "Thunderstorm");
	assert.equal(labelForWmoCode(96), "Thunderstorm with hail");
});

test("labelForWmoCode falls back to Unknown for unmapped codes", () => {
	assert.equal(labelForWmoCode(123), "Unknown");
});

test("resolveWeatherLabel passes through non-thunderstorm codes", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 0, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 5 }),
		"Clear",
	);
	assert.equal(
		resolveWeatherLabel({ weatherCode: 3, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 90 }),
		"Cloudy",
	);
});

test("resolveWeatherLabel keeps Thunderstorm when current precipitation > 0", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0.4, previousHourPrecipitationMm: 0, cloudCover: 80 }),
		"Thunderstorm",
	);
});

test("resolveWeatherLabel keeps Thunderstorm when previous hour had precipitation", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0, previousHourPrecipitationMm: 0.6, cloudCover: 80 }),
		"Thunderstorm",
	);
});

test("resolveWeatherLabel overrides to 'Mostly clear' when no precip and clear sky", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 9 }),
		"Mostly clear",
	);
});

test("resolveWeatherLabel overrides to 'Partly cloudy' when no precip and partial clouds", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 50 }),
		"Partly cloudy",
	);
});

test("resolveWeatherLabel overrides to 'Partly cloudy' (conservative) when overcast", () => {
	// Even with cloud=94% and 0mm precip, we don't claim sunshine — but we also
	// don't claim a storm that isn't precipitating. "Partly cloudy" is the safe
	// middle label until the model produces actual precip.
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 94 }),
		"Partly cloudy",
	);
});

test("resolveWeatherLabel does NOT override when precipitation data is missing", () => {
	// If we lack evidence (null fields), keep the raw model code rather than guess.
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: null, previousHourPrecipitationMm: 0, cloudCover: 5 }),
		"Thunderstorm",
	);
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0, previousHourPrecipitationMm: null, cloudCover: 5 }),
		"Thunderstorm",
	);
});

test("resolveWeatherLabel handles 96 and 99 (hail variants) the same way", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 96, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 10 }),
		"Mostly clear",
	);
	assert.equal(
		resolveWeatherLabel({ weatherCode: 99, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: 50 }),
		"Partly cloudy",
	);
});

test("resolveWeatherLabel falls back to 'Partly cloudy' when cloud cover is missing", () => {
	assert.equal(
		resolveWeatherLabel({ weatherCode: 95, precipitationMm: 0, previousHourPrecipitationMm: 0, cloudCover: null }),
		"Partly cloudy",
	);
});
