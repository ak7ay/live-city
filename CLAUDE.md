# Live City

## Running Pipelines

- Events: `npx tsx src/run-events.ts`
- News: `npx tsx src/run-news.ts`
- Prices: `npx tsx src/run-price.ts`

Each script writes to live Appwrite for the configured city (default `bengaluru`).

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
