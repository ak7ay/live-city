const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

async function getJson(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Open-Meteo ${response.status}: ${url}`);
	}
	return response.json();
}

export async function fetchWeather(lat, lon) {
	const params = new URLSearchParams({
		latitude: String(lat),
		longitude: String(lon),
		current:
			"temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,cloud_cover",
		hourly: "precipitation",
		past_hours: "2",
		forecast_hours: "1",
		timezone: "auto",
		wind_speed_unit: "kmh",
	});
	const data = await getJson(`${FORECAST_URL}?${params}`);
	const c = data.current;
	const previousHourPrecipitationMm = previousHourPrecipitation(data.hourly, c.time);
	return {
		tempC: c.temperature_2m,
		feelsLikeC: c.apparent_temperature,
		humidity: Math.round(c.relative_humidity_2m),
		windKph: c.wind_speed_10m,
		weatherCode: c.weather_code,
		precipitationMm: c.precipitation,
		cloudCover: c.cloud_cover,
		previousHourPrecipitationMm,
	};
}

// Pick the precipitation bucket immediately preceding `currentTime` (the latest
// hourly entry strictly before it). Returns null when the response shape is
// unexpected so the sanity check upstream can fall back to "no override".
function previousHourPrecipitation(hourly, currentTime) {
	if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation)) {
		return null;
	}
	let pick = null;
	for (let i = 0; i < hourly.time.length; i++) {
		if (hourly.time[i] < currentTime) pick = hourly.precipitation[i];
	}
	return pick;
}

export async function fetchAirQuality(lat, lon) {
	const params = new URLSearchParams({
		latitude: String(lat),
		longitude: String(lon),
		current: "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
		timezone: "auto",
	});
	const data = await getJson(`${AQ_URL}?${params}`);
	const c = data.current;
	// Open-Meteo returns CO in μg/m³; NAQI expects mg/m³.
	const coMg = c.carbon_monoxide != null ? c.carbon_monoxide / 1000 : null;
	return {
		pm25: c.pm2_5,
		pm10: c.pm10,
		no2: c.nitrogen_dioxide,
		so2: c.sulphur_dioxide,
		o3: c.ozone,
		co: coMg,
	};
}
