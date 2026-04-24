# Live City

## Running Pipelines

- Events: `npx tsx src/run-events.ts`
- News: `npx tsx src/run-news.ts`
- Prices: `npx tsx src/run-price.ts`

Each script writes to live Appwrite for the configured city (default `bengaluru`).

## Appwrite

- **Host:** Appwrite Cloud, Singapore region — `https://sgp.cloud.appwrite.io/v1`
- **Project ID:** `69c91ed0000423db1d3f` (pinned in [appwrite.config.json](appwrite.config.json) and `.env`)
- **CLI profile:** the current CLI session is configured for this project (endpoint + key set via `appwrite client …`). Use `appwrite functions list`, `appwrite functions get --function-id <id>`, etc. directly — no per-command `--endpoint`/`--project-id` flags needed.
- **Login state:** API-key session only (no `appwrite login` cookie). If `appwrite login` is ever needed, credentials are in `~/.appwrite/prefs.json`.

### Functions

One deployed function today: `refresh_city_environment` (weather + AQI, hourly). Use it as the reference template for any new function.

Convention:
- Runtime: `node-22`, entrypoint `src/index.js`, size `s-0.5vcpu-512mb`, timeout 60s.
- Env vars: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_DATABASE_ID`, plus any function-specific config (e.g. `CITY_COORDINATES_JSON`).
- Deployed via `appwrite` CLI (`type: cli` on deployments). No local `functions/` directory exists yet — source is pushed directly.
- Logs are the function's stdout; keep them one-line per execution (e.g. `Updated bengaluru: 28.3°C, AQI 100`).

### Schedules & timezones

Appwrite function `schedule` is a standard 5-field cron in **UTC** (one expression per function, no timezone field). IST (+5:30) never aligns cleanly to UTC hour boundaries, so for IST-bounded windows the cleanest pattern is: trigger a superset window in UTC cron, then filter by current IST time inside the function.

Example — prices should run every 5 min during 09:30–10:30 IST (04:00–05:00 UTC) and every 10 min during 15:00–19:00 IST (09:30–13:30 UTC):
- Cron (UTC superset): `*/5 4-5,9-13 * * *`
- Inside handler: compute IST `hh:mm` and return early if outside `[09:30, 10:30]` ∪ `[15:00, 19:00]`; within the afternoon window, also skip 5-min offset ticks to achieve the 10-min cadence.

## Agent Runtime

The default agent backend is the **Claude Agent SDK** (`claude-sonnet-4-6`). The legacy pi-coding-agent backend is still in the tree as a fallback — opt in with `AGENT_RUNTIME=pi`.

```bash
# default — uses Claude Agent SDK
npx tsx src/run-events.ts

# fallback — uses @mariozechner/pi-coding-agent
AGENT_RUNTIME=pi npx tsx src/run-events.ts
```

The runtime switch lives at `src/agent/index.ts`. Both backends export the same surface (`createPlainSession`, `createBrowserSession`, `captureResponseText`, `retryValidation`, …); callers in `src/events/agent.ts` and `src/news/agent.ts` import from `../agent/index.js` and don't care which backend is active.

### Auth

- **Claude (default):** OAuth creds in macOS keychain (entry: `Claude Code-credentials`). Refresh tokens are long-lived and rotate on use, so an actively-running daemon stays authenticated indefinitely. If creds expire, run `claude` once interactively to re-login.
- **Pi (fallback):** `~/.pi/agent/auth.json`.

### One-time setup for Claude browser sessions

The browser-tools skill is loaded as an isolated Claude Agent SDK plugin from `~/.live-city/agent/`. Build it once:

```bash
./scripts/install-browser-skills.sh
```

This copies `~/.pi/agent/skills/browser-tools/` into the plugin layout, substitutes the `{baseDir}` template placeholders, and runs `npm install` for the script deps.

## Monitoring Agent Sessions

### Claude Agent SDK (default)

Session files: `~/.claude/projects/-Users-hanif-Desktop-projects-live-city/<uuid>.jsonl`

Most recent sessions:
```bash
ls -t ~/.claude/projects/-Users-hanif-Desktop-projects-live-city/*.jsonl | head -5
```

Parse session thinking + tool calls:
```bash
cat ~/.claude/projects/-Users-hanif-Desktop-projects-live-city/<session>.jsonl | python3 -c "
import json, sys
for i, line in enumerate(sys.stdin, 1):
    obj = json.loads(line)
    if obj.get('type') not in ('user', 'assistant'): continue
    if obj.get('isSidechain'): continue
    msg = obj.get('message', {})
    role = msg.get('role')
    content = msg.get('content', [])
    if isinstance(content, str):
        print(f'L{i} [{role}] text: {content[:300]}')
        continue
    for c in content:
        ct = c.get('type')
        if ct == 'thinking' and c.get('thinking','').strip():
            print(f'L{i} [{role}] thinking: {c[\"thinking\"][:300]}')
        elif ct == 'text' and c.get('text','').strip():
            print(f'L{i} [{role}] text: {c[\"text\"][:300]}')
        elif ct == 'tool_use':
            print(f'L{i} [{role}] tool: {c.get(\"name\")} | keys={list(c.get(\"input\",{}).keys())}')
        elif ct == 'tool_result':
            out = c.get('content', '')
            if isinstance(out, list):
                out = ' '.join(b.get('text','') for b in out if b.get('type')=='text')
            print(f'L{i} [{role}] tool_result: {str(out)[:200]}')
"
```

### Pi Agent (legacy, `AGENT_RUNTIME=pi`)

Session files: `~/.pi/agent/sessions/--Users-hanif-Desktop-projects-live-city--/`

Most recent: `ls -t ~/.pi/agent/sessions/--Users-hanif-Desktop-projects-live-city--/ | head -5`

Parse session thinking + tool calls:
```bash
cat ~/.pi/agent/sessions/--Users-hanif-Desktop-projects-live-city--/<session-file>.jsonl | python3 -c "
import json, sys
for i, line in enumerate(sys.stdin, 1):
    obj = json.loads(line)
    if obj.get('type') != 'message': continue
    msg = obj['message']
    role = msg.get('role')
    for c in msg.get('content', []):
        ct = c.get('type')
        if ct == 'thinking' and c.get('thinking','').strip():
            print(f'L{i} [{role}] thinking: {c[\"thinking\"][:300]}')
        elif ct == 'text' and c.get('text','').strip():
            print(f'L{i} [{role}] text: {c[\"text\"][:300]}')
        elif ct == 'tool_use':
            print(f'L{i} [{role}] tool: {c.get(\"name\")} | keys={list(c.get(\"input\",{}).keys())}')
"
```

## Key Paths

- Pipeline logs: `logs/` (`app.log`, `events-run.log`)
- Events cache: `~/.cache/events/{city}/` (previous events JSON per source)
- News cache: `~/.cache/news/{city}/{date}/`
- Browser cache: `~/.cache/browser-tools/`
- Browser skills plugin (Claude): `~/.live-city/agent/`
