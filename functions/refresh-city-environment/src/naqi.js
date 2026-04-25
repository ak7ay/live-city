// India CPCB National Air Quality Index sub-index tables.
// Rows: [Clo, Chi, Ilo, Ihi]
const BREAKPOINTS = {
	pm25: [
		[0, 30, 0, 50],
		[30, 60, 50, 100],
		[60, 90, 100, 200],
		[90, 120, 200, 300],
		[120, 250, 300, 400],
		[250, 500, 400, 500],
	],
	pm10: [
		[0, 50, 0, 50],
		[50, 100, 50, 100],
		[100, 250, 100, 200],
		[250, 350, 200, 300],
		[350, 430, 300, 400],
		[430, 600, 400, 500],
	],
	no2: [
		[0, 40, 0, 50],
		[40, 80, 50, 100],
		[80, 180, 100, 200],
		[180, 280, 200, 300],
		[280, 400, 300, 400],
		[400, 600, 400, 500],
	],
	so2: [
		[0, 40, 0, 50],
		[40, 80, 50, 100],
		[80, 380, 100, 200],
		[380, 800, 200, 300],
		[800, 1600, 300, 400],
		[1600, 2400, 400, 500],
	],
	co: [
		[0, 1.0, 0, 50],
		[1.0, 2.0, 50, 100],
		[2.0, 10, 100, 200],
		[10, 17, 200, 300],
		[17, 34, 300, 400],
		[34, 50, 400, 500],
	],
	o3: [
		[0, 50, 0, 50],
		[50, 100, 50, 100],
		[100, 168, 100, 200],
		[168, 208, 200, 300],
		[208, 748, 300, 400],
		[748, 1000, 400, 500],
	],
};

const DISPLAY_NAMES = {
	pm25: "PM2.5",
	pm10: "PM10",
	no2: "NO2",
	so2: "SO2",
	co: "CO",
	o3: "O3",
};

export function subIndex(pollutant, concentration) {
	const bands = BREAKPOINTS[pollutant];
	if (!bands) throw new Error(`Unknown pollutant: ${pollutant}`);
	if (concentration <= 0) return 0;
	for (const [clo, chi, ilo, ihi] of bands) {
		if (concentration <= chi) {
			return Math.round(((ihi - ilo) / (chi - clo)) * (concentration - clo) + ilo);
		}
	}
	return 500;
}

export function computeNaqi(pollutants) {
	let max = 0;
	let primaryKey = null;
	for (const [key, value] of Object.entries(pollutants)) {
		if (value == null || Number.isNaN(value)) continue;
		const idx = subIndex(key, value);
		if (idx > max) {
			max = idx;
			primaryKey = key;
		}
	}
	return {
		value: Math.min(max, 500),
		primaryPollutant: primaryKey ? DISPLAY_NAMES[primaryKey] : "PM2.5",
	};
}

export function categoryFor(value) {
	if (value <= 50) return "Good";
	if (value <= 100) return "Satisfactory";
	if (value <= 200) return "Moderate";
	if (value <= 300) return "Poor";
	if (value <= 400) return "Very Poor";
	return "Severe";
}
