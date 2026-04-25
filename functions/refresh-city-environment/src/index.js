import { Client, Databases, Query } from "node-appwrite";
import { categoryFor, computeNaqi } from "./naqi.js";
import { fetchAirQuality, fetchWeather } from "./openMeteo.js";
import { resolveWeatherLabel } from "./weatherLabels.js";

const COLLECTION_ID = "city_environment";

export default async ({ res, log, error }) => {
	const endpoint = process.env.APPWRITE_ENDPOINT;
	const projectId = process.env.APPWRITE_PROJECT_ID;
	const apiKey = process.env.APPWRITE_API_KEY;
	const databaseId = process.env.APPWRITE_DATABASE_ID;
	const coordinatesJson = process.env.CITY_COORDINATES_JSON;

	if (!endpoint || !projectId || !apiKey || !databaseId || !coordinatesJson) {
		error("Missing required env vars");
		return res.json({ ok: false, reason: "missing-env" }, 500);
	}

	let cities;
	try {
		cities = JSON.parse(coordinatesJson);
		if (!Array.isArray(cities) || cities.length === 0) throw new Error("empty");
	} catch (e) {
		error(`CITY_COORDINATES_JSON invalid: ${e.message}`);
		return res.json({ ok: false, reason: "bad-json" }, 500);
	}

	const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
	const databases = new Databases(client);

	const results = [];

	for (const city of cities) {
		try {
			const [weather, air] = await Promise.all([
				fetchWeather(city.lat, city.lon),
				fetchAirQuality(city.lat, city.lon),
			]);
			const naqi = computeNaqi(air);
			const weatherLabel = resolveWeatherLabel(weather);
			const doc = {
				citySlug: city.slug,
				fetchedAt: new Date().toISOString(),
				tempC: weather.tempC,
				feelsLikeC: weather.feelsLikeC,
				humidity: weather.humidity,
				windKph: weather.windKph,
				weatherCode: weather.weatherCode,
				weatherLabel,
				aqiValue: naqi.value,
				aqiCategory: categoryFor(naqi.value),
				primaryPollutant: naqi.primaryPollutant,
				pm25: air.pm25,
				pm10: air.pm10,
				no2: air.no2,
				so2: air.so2,
				o3: air.o3,
				co: air.co,
			};

			// Upsert: look up by citySlug, update if exists, else create with slug as $id.
			const existing = await databases.listDocuments(databaseId, COLLECTION_ID, [
				Query.equal("citySlug", city.slug),
				Query.limit(1),
			]);
			if (existing.documents.length > 0) {
				await databases.updateDocument(databaseId, COLLECTION_ID, existing.documents[0].$id, doc);
				log(`Updated ${city.slug}: ${weather.tempC}°C, AQI ${naqi.value}, ${weatherLabel}`);
			} else {
				await databases.createDocument(databaseId, COLLECTION_ID, city.slug, doc);
				log(`Created ${city.slug}: ${weather.tempC}°C, AQI ${naqi.value}, ${weatherLabel}`);
			}
			results.push({ slug: city.slug, ok: true });
		} catch (e) {
			error(`Failed ${city.slug}: ${e.message}`);
			results.push({ slug: city.slug, ok: false, error: e.message });
		}
	}

	return res.json({ ok: true, results });
};
