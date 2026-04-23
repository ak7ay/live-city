# Live City

A backend service that scrapes daily city information — gold/silver prices, local events, and news (including regional language sources translated to English) — using AI-powered extraction via [pi-coding-agent](https://github.com/badlogic/pi-coding-agent). Stores everything in Appwrite, which the mobile app reads directly. No custom API server needed.

Launches as **Live Bengaluru**, expandable to other cities by adding a YAML config file.

## Tech Stack

- **Extraction:** pi-coding-agent SDK (headless) + browser-tools skill (Chrome DevTools Protocol)
- **LLM Auth:** Claude OAuth subscription (no API keys)
- **Database/API:** Appwrite Cloud (auto REST API, push notifications, storage)
- **Scheduling:** node-cron
- **Language:** TypeScript, Node.js ≥22

## Setup

```bash
npm install
cp .env.example .env  # fill in Appwrite credentials
```

## Run

```bash
npm run dev      # dev mode (watch)
npm run build    # compile
npm start        # run compiled
```

## Project Structure

```
config/cities/   # YAML configs per city (URLs, schedules, schemas)
src/             # extractor service
docs/            # specs and design docs
```

## Mac Mini Wake/Sleep Schedule

Since 2026-04-23, prices run on an Appwrite function (see [functions/price/README.md](functions/price/README.md)). The Mac mini only needs to be awake for news (08:00 IST, 18:00 IST) and events (09:00 IST), so the schedule is split into two short windows:

```
07:50 — Mac wakes (pmset repeat wakeorpoweron)
08:00 — news job fires (node-cron inside npm run dev)
09:00 — events job fires
09:40 — launchd daemon com.livecity.schedule-evening-wake (root) schedules
        a one-shot pmset wake for 17:50 today
09:45 — launchd agent com.livecity.sleep-morning sleeps the mini
17:50 — Mac wakes (one-shot pmset wake)
18:00 — news job fires
18:30 — launchd agent com.livecity.sleep-evening sleeps the mini
```

All times IST. Total awake ≈ 2h 35m/day (down from ~11h).

Three jobs are involved. Two run as the user (sleep jobs, just call `osascript … sleep`) so they live in `~/Library/LaunchAgents/`. The third needs to call `pmset schedule wake`, **which requires root**, so it lives in `/Library/LaunchDaemons/` and is loaded with `sudo`.

**Setup (one-time):**

```bash
# Disable idle sleep (only the two sleep jobs put it to sleep)
sudo pmset -a sleep 0

# Morning wake every day
sudo pmset repeat wakeorpoweron MTWRFSU 07:50:00

# Unload the old single-sleep agent if present
launchctl unload ~/Library/LaunchAgents/com.livecity.sleep.plist 2>/dev/null || true

# Two user-level sleep agents (ownership stays as you)
launchctl load ~/Library/LaunchAgents/com.livecity.sleep-morning.plist
launchctl load ~/Library/LaunchAgents/com.livecity.sleep-evening.plist

# One system-level daemon for the evening-wake scheduler (needs root)
# The plist must be owned root:wheel, mode 644, under /Library/LaunchDaemons/.
sudo launchctl load /Library/LaunchDaemons/com.livecity.schedule-evening-wake.plist
```

**Verify:**

```bash
# Trigger the evening-wake daemon manually (normally fires at 09:40)
sudo launchctl start com.livecity.schedule-evening-wake

pmset -g sched                            # expect 7:50AM repeat + today's 17:50 one-shot
launchctl list | grep livecity            # expect two user-level agents
sudo launchctl list | grep livecity       # expect the daemon (com.livecity.schedule-evening-wake)
```

See [DESIGN.md](DESIGN.md) for architecture, decisions, and deployment details.
