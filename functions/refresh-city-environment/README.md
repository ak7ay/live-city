# refresh-city-environment (Appwrite function)

Hourly Appwrite Function that fetches weather + air quality from Open-Meteo and
upserts the result into the `city_environment` collection (one document per
city, `$id = citySlug`).

## Schedule

`0 * * * *` — top of every hour, UTC.

## Weather-label sanity check

Open-Meteo's default `best_match` model returns `weather_code = 95`
("Thunderstorm") for tropical/coastal grid cells whenever atmospheric
instability (CAPE) is high — even with **zero precipitation and near-zero
cloud cover**. Observed for Chennai (grid `13.111, 80.246`) on 2026-04-25:
nearly every daytime hour was tagged code 95 despite 0 mm precipitation and
cloud cover as low as 1%.

To avoid surfacing "Thunderstorm" when nothing is precipitating, the function
overrides the human-readable `weatherLabel` (only) when the storm code
definitionally contradicts the raw signals:

```
weatherCode ∈ {95, 96, 99}
AND current.precipitation == 0           (rolling preceding hour)
AND previous_hour.precipitation == 0     (the hourly bucket before that)
```

The override picks a conservative label from cloud cover:

| cloud_cover | label |
| --- | --- |
| `< 25%` | `Mostly clear` |
| `≥ 25%` (or missing) | `Partly cloudy` |

The numeric `weatherCode` field is **left untouched** so downstream consumers
and debugging still see the raw Open-Meteo signal. Only `weatherLabel` is
adjusted. If precipitation data is missing from the upstream response, no
override fires.

Live precipitation (any value `> 0`) bypasses the override entirely, so real
thunderstorms still surface as `Thunderstorm`.

See `src/weatherLabels.js` (`resolveWeatherLabel`) for the implementation and
`test/weather-labels.test.js` for the truth table.

## Environment variables

| Key | Example |
| --- | --- |
| `APPWRITE_ENDPOINT` | `https://sgp.cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | `69c91ed0000423db1d3f` |
| `APPWRITE_API_KEY` | (server key with `databases.write` scope) |
| `APPWRITE_DATABASE_ID` | `live_city` |
| `CITY_COORDINATES_JSON` | see below |

`CITY_COORDINATES_JSON` is a JSON array, one entry per city:

```json
[
  {"slug": "bengaluru", "lat": 12.9716, "lon": 77.5946},
  {"slug": "chennai",   "lat": 13.0827, "lon": 80.2707}
]
```

## Deploy

```bash
# One-time: create the function
appwrite functions create \
  --function-id refresh_city_environment \
  --name refresh-city-environment \
  --runtime node-22 \
  --entrypoint src/index.js \
  --execute users \
  --timeout 60 \
  --commands "npm install" \
  --build-specification s-0.5vcpu-512mb \
  --runtime-specification s-0.5vcpu-512mb \
  --schedule '0 * * * *'

# Set env vars (re-run to update)
appwrite functions create-variable --function-id refresh_city_environment --key APPWRITE_ENDPOINT --value "https://sgp.cloud.appwrite.io/v1"
appwrite functions create-variable --function-id refresh_city_environment --key APPWRITE_PROJECT_ID --value "69c91ed0000423db1d3f"
appwrite functions create-variable --function-id refresh_city_environment --key APPWRITE_API_KEY --value "<api-key>"
appwrite functions create-variable --function-id refresh_city_environment --key APPWRITE_DATABASE_ID --value "live_city"
appwrite functions create-variable --function-id refresh_city_environment --key CITY_COORDINATES_JSON --value "$(cat coordinates.json)"

# Deploy (from functions/refresh-city-environment/)
cd functions/refresh-city-environment
appwrite functions create-deployment \
  --function-id refresh_city_environment \
  --code . \
  --activate true
```

> The `--commands "npm install"` flag on `functions create` is required —
> without it Appwrite builds the deployment without dependencies and every
> execution fails with `Cannot find package 'node-appwrite'`. If you forget it
> on `create`, recover with:
>
> ```bash
> appwrite functions update --function-id refresh_city_environment --commands "npm install" \
>   --runtime node-22 --entrypoint src/index.js --execute users --timeout 60 \
>   --build-specification s-0.5vcpu-512mb --runtime-specification s-0.5vcpu-512mb \
>   --schedule '0 * * * *'
> ```
>
> then redeploy.

## Tests

```bash
cd functions/refresh-city-environment
npm install
npm test
```
