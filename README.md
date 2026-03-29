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

See [DESIGN.md](DESIGN.md) for architecture, decisions, and deployment details.
