# Live City

A backend service that scrapes daily city information — gold/silver prices, local events, and news (including regional language sources translated to English) — using AI-powered extraction via [pi-coding-agent](https://github.com/badlogic/pi-coding-agent). Stores everything in Appwrite, which the mobile app reads directly. No custom API server needed.

Launches as **Live Bengaluru**, expandable to other cities by adding a YAML config file.

## Tech Stack

- **Extraction:** pi-coding-agent SDK (headless) + browser-tools skill (Chrome DevTools Protocol)
- **LLM Auth:** Claude OAuth subscription (no API keys)
- **Database/API:** Appwrite Cloud (auto REST API, push notifications, storage)
- **Scheduling:** croner
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
09:40 — launchd *daemon* com.livecity.schedule-evening-wake schedules a
        one-shot pmset wake for 16:50 today (must be a system LaunchDaemon,
        not a user LaunchAgent — `pmset schedule` requires root)
09:45 — launchd agent com.livecity.sleep-morning sleeps the mini
16:50 — Mac wakes (one-shot pmset wake)
17:00 — news job fires
18:00 — launchd agent com.livecity.sleep-evening sleeps the mini
```

All times IST. Total awake ≈ 3h 5m/day (down from ~11h).

**Setup (one-time):**

```bash
# Disable idle sleep (only the two sleep jobs put it to sleep)
sudo pmset -a sleep 0

# Morning wake every day
sudo pmset repeat wakeorpoweron MTWRFSU 07:50:00

# User LaunchAgents (run as $USER) — sleep jobs only
launchctl unload ~/Library/LaunchAgents/com.livecity.sleep.plist 2>/dev/null || true
launchctl load   ~/Library/LaunchAgents/com.livecity.sleep-morning.plist
launchctl load   ~/Library/LaunchAgents/com.livecity.sleep-evening.plist

# System LaunchDaemon (runs as root) — schedules the evening pmset wake.
# This plist MUST live in /Library/LaunchDaemons/ with root:wheel ownership.
# Do NOT put it in ~/Library/LaunchAgents/: `pmset schedule wake` exits with
# "This operation must be run as root" when invoked from a user agent, and
# the daemon will silently fail every day at 09:40.
sudo chown root:wheel /Library/LaunchDaemons/com.livecity.schedule-evening-wake.plist
sudo launchctl load   /Library/LaunchDaemons/com.livecity.schedule-evening-wake.plist
```

**Verify:**

```bash
pmset -g sched                                          # expect morning repeat + today's 16:50 one-shot
launchctl list | grep livecity                          # expect 2 user agents (sleep-morning, sleep-evening)
sudo launchctl print system | grep livecity             # expect schedule-evening-wake daemon
```

See [DESIGN.md](DESIGN.md) for architecture, decisions, and deployment details.
