# Pi SDK Hello World Integration

## Goal

Prove the pi-coding-agent SDK works inside live-city. A one-shot script that creates an agent session, sends "hi", prints the streamed response, and exits.

## Design

Replace the placeholder `src/index.ts` with a script that:

1. Gets the `claude-opus-4-6` model via `getModel("anthropic", "claude-opus-4-6")`
2. Creates an in-memory `AgentSession` with `thinkingLevel: "medium"`
3. Subscribes to `message_update` events, prints `text_delta` to stdout
4. Calls `session.prompt("hi")`, waits for completion
5. Disposes the session and exits

No tools, skills, extensions, or custom system prompt. Auth uses existing `~/.pi/agent/auth.json` via SDK defaults.

## Details

- **Model:** `claude-opus-4-6` (Anthropic), thinking level `medium`
- **Session:** `SessionManager.inMemory()` — no persistence
- **Auth:** SDK default (`AuthStorage.create()` internally, reads `~/.pi/agent/auth.json`)
- **Output:** Streamed text deltas to stdout, newline at end
- **Error handling:** Wrap in try/catch, log errors, exit with code 1 on failure
- **No `.env` needed** for this step — auth comes from pi's existing credentials

## Future Direction

- Switch to `ANTHROPIC_API_KEY` environment variable (via `authStorage.setRuntimeApiKey()` or env var auto-detection)
- Add custom system prompt for extraction tasks
- Add browser-tools skill for web scraping
- Add scheduled jobs via node-cron

## Success Criteria

Run `npm run dev` (or `npx tsx src/index.ts`), see the agent respond to "hi", process exits cleanly.
