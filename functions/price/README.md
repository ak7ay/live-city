# price (Appwrite function)

Pulls Lalithaa Jewellery rates for each configured city and writes them into the
`metal_prices` table. Sends at most one push notification per city per day to
`prices-<city>` — gated on the first gold-price change of the day vs. yesterday's
last row. The notification body still includes both gold and silver deltas when
present; a silver-only change (no gold move) does not trigger a push.

## Schedule

Cron (UTC superset): `*/5 4-5,9-13 * * *`

Handler filters to IST `[09:30, 10:30]` every 5 min and `[15:00, 19:00]` every
10 min — the two daily windows Lalithaa's rates actually change. Scheduled
invocations outside those windows exit early with `{ skipped: true, reason:
"outside_ist_window" }`. Manual invocations (HTTP trigger) run unconditionally.

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
  --commands "npm install" \
  --build-specification s-0.5vcpu-512mb \
  --runtime-specification s-0.5vcpu-512mb \
  --schedule '*/5 4-5,9-13 * * *'

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

> The `--commands "npm install"` flag on `functions create` is required — without it, Appwrite builds the deployment without dependencies and every execution fails with `Cannot find package 'node-appwrite' imported from /mnt/code/src/index.js`. If you ever forget it on `create`, recover with:
>
> ```bash
> appwrite functions update --function-id price --commands "npm install" \
>   --runtime node-22 --entrypoint src/index.js --execute users --timeout 60 \
>   --build-specification s-0.5vcpu-512mb --runtime-specification s-0.5vcpu-512mb \
>   --schedule '*/5 4-5,9-13 * * *'
> ```
>
> then redeploy.

## Tests

```bash
cd functions/price
npm test
```
