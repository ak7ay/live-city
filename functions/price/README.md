# price (Appwrite function)

Pulls Lalithaa Jewellery rates for each configured city and writes them into the
`metal_prices` table. Sends a push notification to `prices-<city>` when a price
changes vs. today's most recent row (or yesterday's last row if this is the first
row of the day).

## Schedule

Cron (UTC superset): `*/5 4-5,9-10 * * *`

Handler filters to IST `[09:30, 10:30] ∪ [15:00, 16:00]` — the two daily windows
Lalithaa's rates actually change. Scheduled invocations outside those windows
exit early with `{ skipped: true, reason: "outside_ist_window" }`. Manual
invocations (HTTP trigger) run unconditionally.

## Environment variables

| Key | Example |
| --- | --- |
| `APPWRITE_ENDPOINT` | `https://sgp.cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | `69c91ed0000423db1d3f` |
| `APPWRITE_API_KEY` | (server key with `databases.*` + `messaging.*`) |
| `LALITHAA_STATES_JSON` | see below |

`LALITHAA_STATES_JSON` mirrors `config/sources/lalithaa.yaml`:

```json
[
  {"state_name": "Karnataka", "city": "bengaluru"},
  {"state_name": "Tamilnadu", "city": "chennai"},
  {"state_name": "Telangana", "city": "hyderabad"},
  {"state_name": "Andhra Pradesh", "city": "vijayawada"},
  {"state_name": "Puducherry", "city": "puducherry"}
]
```

## Deploy

```bash
# One-time: create the function
appwrite functions create \
  --function-id price \
  --name price \
  --runtime node-22 \
  --entrypoint src/index.js \
  --execute users \
  --timeout 60 \
  --specification s-0.5vcpu-512mb \
  --schedule '*/5 4-5,9-10 * * *'

# Set env vars (re-run to update)
appwrite functions create-variable --function-id price --key APPWRITE_ENDPOINT --value "https://sgp.cloud.appwrite.io/v1"
appwrite functions create-variable --function-id price --key APPWRITE_PROJECT_ID --value "69c91ed0000423db1d3f"
appwrite functions create-variable --function-id price --key APPWRITE_API_KEY --value "<api-key>"
appwrite functions create-variable --function-id price --key LALITHAA_STATES_JSON --value "$(cat states.json)"

# Deploy (from functions/price/)
cd functions/price
appwrite functions create-deployment \
  --function-id price \
  --code . \
  --activate true
```

## Tests

```bash
cd functions/price
npm test
```
