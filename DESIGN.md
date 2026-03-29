# Live City — Design Document

## The Product

A mobile app that displays daily city information:
- Gold and silver prices
- Events happening in the city
- Local news (including regional language sources translated to English)

Launches as **Live Bengaluru**. Same codebase expands to other cities (Live Chennai, Live Mumbai, etc.) by adding config files.

## The Problem

Data needs to be scraped from various websites daily. Instead of writing fragile per-site scrapers that break on layout changes, use AI to extract structured data from any page — give it a URL, let it figure out the extraction.

## Constraints

- No direct LLM API payments — uses Claude subscription (OAuth), not API keys
- Multi-provider — don't tie to a single LLM vendor
- Minimal custom code — leverage existing tools and frameworks
- Headless backend service — no CLI or TUI needed

## Options Evaluated

| Option | Why rejected |
|---|---|
| **Direct Anthropic/OpenAI API** | Requires API key with direct billing. Single provider. |
| **Claude Agent SDK (Python)** | Single provider (Anthropic). Requires API key. |
| **Codex SDK (`@openai/codex-sdk`)** | Single provider (OpenAI). No custom tools. No browser support. Coding-focused, not extraction-focused. Only advantage: built-in web search. |
| **ACP (Agent Communication Protocol)** | Right pattern for decoupled architecture, but ecosystem is immature. Adds protocol overhead without clear benefit at this scale. |
| **MCP (Model Context Protocol)** | Useful for reusing community tools, but adds protocol complexity for simple extraction tasks. |
| **pi-ai + pi-agent-core (lightweight)** | Works, but requires writing custom browser tools (~80 lines). No skill system. |
| **pi-coding-agent (full SDK)** | **Selected.** See below. |

## Why pi-coding-agent

`@mariozechner/pi-coding-agent` (npm, v0.63.1) provides:

- **OAuth authentication** for Claude subscription, GitHub Copilot, Google Gemini CLI, Antigravity — all free or subscription-based, no API keys needed
- **Multi-provider with fallback** — if Claude is down, fall back to Gemini or Copilot
- **Skill system** — browser-tools skill (from [pi-skills](https://github.com/badlogic/pi-skills/tree/main/browser-tools)) works out of the box via built-in bash and read tools
- **Agent loop** — automatic tool calling, error retry, no manual implementation needed
- **System prompt control** — configurable for extraction tasks
- **Headless SDK mode** — `createAgentSession()` with in-memory sessions, no TUI

Trade-offs accepted:
- Heavier dependency (includes TUI, session management, extensions we don't use) — doesn't matter for a backend service
- More LLM round-trips per extraction (skill uses bash calls) — doesn't matter on subscription billing
- Unused features present in the package — they don't interfere

## Why Browser-Based Extraction

Tested plain HTTP fetch, defuddle, readability, and browser-tools against target sites:

| Site | Plain fetch | Defuddle | Readability | Browser tools |
|---|---|---|---|---|
| goodreturns.in (gold prices) | Cloudflare blocked | Empty | Cloudflare blocked | Works — sees prices |
| tv9kannada.com (Kannada news) | Messy text | Empty | Noisy output | Works — clean page |
| BookMyShow (events) | Empty React shell | Empty | Empty | Works — full listings |

Browser tools (Chrome via DevTools Protocol) solve: Cloudflare blocking, JS-rendered SPAs, complex layouts. The LLM can use screenshots (vision) to read pages exactly as a human would, including Kannada and other local languages.

## High-Level Architecture

Extractor writes to Appwrite. Mobile app (and future website) reads directly via Appwrite SDK. No custom API server needed.

```
┌─────────────────────────────────────────────────────┐
│         live-city-extractor (runs on Mac)            │
│                                                      │
│  Config (YAML per city)                             │
│  ├── bengaluru.yaml  (URLs, schedules, schemas)     │
│  └── chennai.yaml                                   │
│                                                      │
│  Scheduler (node-cron)                              │
│  └── Triggers extraction jobs per city per source   │
│                                                      │
│  Extractor (pi-coding-agent SDK)                    │
│  ├── createAgentSession() — headless, in-memory     │
│  ├── browser-tools skill — navigate, screenshot,    │
│  │   extract content via real Chrome browser         │
│  ├── OAuth auth — Claude subscription, free provs   │
│  └── Provider fallback — Claude → Gemini → Copilot  │
│                                                      │
│  Validator                                          │
│  └── Schema checks on extracted JSON                │
│                                                      │
│  Writes to ──────────┐                              │
└──────────────────────┼──────────────────────────────┘
                       │
              ┌────────▼──────────┐
              │     Appwrite      │
              │  (Education Pro)   │
              │  Singapore region  │
              │                    │
              │  Database + REST   │
              │  + Storage (150GB) │
              │  + Push notifs     │
              └────────┬──────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼───┐   ┌─────▼────┐  ┌────▼────┐
    │ Mobile │   │ Website  │  │ Admin   │
    │  App   │   │ (future) │  │Dashboard│
    │        │   │          │  │(Appwrite│
    │Appwrite│   │ Appwrite │  │built-in)│
    │  SDK   │   │   SDK    │  │         │
    └────────┘   └──────────┘  └─────────┘
```

### Why This Architecture

- **No custom API server** — Appwrite auto-generates REST API from collections
- **No DigitalOcean** — mobile app and website read directly from Appwrite, no backend to host
- **Extractor on Mac** — residential IP (websites don't block), Chrome already installed, no VM cost
- **Education Pro plan** — free for 2 years via GitHub Student Developer Pack (worth $160/month)
- **Singapore region** — closest to India
- **150GB storage** — generous space for event posters, news thumbnails, etc.
- **Push notifications** — built-in, useful for breaking news or price alerts
- **Built-in dashboard** — view/edit data in Appwrite console
- **After 2 years** — downgrade to free tier (2GB storage, 1 DB per project) or pay $15/month

### Database Alternatives Considered

| Option | Why not selected |
|---|---|
| **Supabase** (free tier) | Mumbai region (lower latency), direct Postgres access, but 500MB DB + 1GB storage. No push notifications. Pauses after 1 week inactivity. |
| **MongoDB Atlas** (free + $50 Education credit) | No auto REST API — still needs a custom backend server for mobile app access. |
| **Neon + DigitalOcean** | Works, but requires writing and hosting a custom API server ($4-6/month). |

## Adding a New City

Add a YAML config file. Zero code changes.

```yaml
# config/chennai.yaml
city: chennai
display_name: "Live Chennai"
sources:
  - name: gold-price
    url: https://www.goodreturns.in/gold-rates/chennai.html
    type: PRICE
    schedule: "0 8 * * *"
  - name: events
    url: https://in.bookmyshow.com/explore/events-chennai
    type: EVENT
    schedule: "0 7 * * *"
  - name: news
    url: https://www.ndtv.com/chennai-news
    type: NEWS
    schedule: "0 */4 * * *"
```

## Deployment

**Extractor (Mac, local):**
- Runs via `node dist/index.js` or pm2
- Chrome already installed for browser-tools
- Writes to Appwrite via `appwrite` Node.js SDK

**Database + API + Storage (Appwrite Cloud):**
- Education Pro: 150GB storage, unlimited DBs, 200K MAU, no pausing
- Singapore region — closest available to India
- Auto REST API — no server to maintain
- Push notifications available for mobile

**Estimated cost:** $0 (Education Pro) + $0 (LLM subscription)

## Key Dependencies

| Package | Purpose |
|---|---|
| `@mariozechner/pi-coding-agent` | Agent SDK with OAuth, skills, tools |
| `node-appwrite` | Database, storage, auto REST API (server SDK) |
| `appwrite` | Client SDK for mobile app and website |
| `node-cron` | Scheduled extraction jobs |
| `yaml` | City config loading |
| browser-tools skill (pi-skills) | Chrome browser automation |
