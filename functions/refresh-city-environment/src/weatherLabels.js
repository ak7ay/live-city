// Human-readable labels for Open-Meteo WMO weather codes.
// Source: https://open-meteo.com/en/docs (Weather variable documentation)
const LABELS = {
	0: "Clear",
	1: "Mostly clear",
	2: "Partly cloudy",
	3: "Cloudy",
	45: "Fog",
	48: "Freezing fog",
	51: "Light drizzle",
	53: "Drizzle",
	55: "Heavy drizzle",
	56: "Freezing drizzle",
	57: "Heavy freezing drizzle",
	61: "Light rain",
	63: "Rain",
	65: "Heavy rain",
	66: "Freezing rain",
	67: "Heavy freezing rain",
	71: "Light snow",
	73: "Snow",
	75: "Heavy snow",
	77: "Snow grains",
	80: "Rain showers",
	81: "Heavy rain showers",
	82: "Violent rain showers",
	85: "Snow showers",
	86: "Heavy snow showers",
	95: "Thunderstorm",
	96: "Thunderstorm with hail",
	99: "Severe thunderstorm with hail",
};

const THUNDERSTORM_CODES = new Set([95, 96, 99]);

export function labelForWmoCode(code) {
	return LABELS[code] ?? "Unknown";
}

// Open-Meteo's `best_match` model flips weather_code to 95 (Thunderstorm) for
// tropical grid cells whenever atmospheric instability (CAPE) is high, even
// when there is no precipitation and cloud cover is near zero. We override the
// label only when the storm code definitionally contradicts the raw signals:
// no rain in the rolling preceding hour AND no rain in the previous hourly
// bucket. The numeric `weatherCode` itself is left untouched upstream so the
// raw model signal is preserved for debugging.
export function resolveWeatherLabel({ weatherCode, precipitationMm, previousHourPrecipitationMm, cloudCover }) {
	if (!THUNDERSTORM_CODES.has(weatherCode)) return labelForWmoCode(weatherCode);
	if (precipitationMm == null || previousHourPrecipitationMm == null) {
		return labelForWmoCode(weatherCode);
	}
	if (precipitationMm > 0 || previousHourPrecipitationMm > 0) {
		return labelForWmoCode(weatherCode);
	}
	if (typeof cloudCover === "number" && cloudCover < 25) return "Mostly clear";
	return "Partly cloudy";
}
