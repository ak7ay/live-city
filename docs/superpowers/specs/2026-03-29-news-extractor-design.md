# News Extractor — Design Spec

## Goal

Extract top 5 Bengaluru news daily from Kannada news sources, translate to English, and store in Appwrite. Runs 3 times a day. The LLM agent handles all extraction, curation, and translation. Code only validates and stores.

## Sources

| Source | Method | Listing Endpoint | Full Article |
|---|---|---|---|
| **PublicTV** | WordPress REST API | `GET /wp-json/wp/v2/posts?categories=255&per_page=20&_fields=id,title,excerpt,link,date,featured_media` | `GET /wp-json/wp/v2/posts/{id}?_fields=id,title,content,featured_media` |
| **TV9 Kannada** | RSS Feed | `GET https://tv9kannada.com/karnataka/bengaluru/feed` | `content:encoded` field already in RSS |

### Source Details — PublicTV

- Base: `https://publictv.in`
- WordPress site with REST API exposed at `/wp-json/`
- Bengaluru City category ID: `255`
- Thumbnail: resolve `featured_media` ID via `GET /wp-json/wp/v2/media/{id}?_fields=source_url`
- Multiple image sizes available (full, medium, thumbnail)
- Content in `content.rendered` — HTML with Kannada text
- Content quirks: video player text noise, `ಇದನ್ನೂ ಓದಿ:` ("also read") inline links to strip, YouTube iframe embeds
- Excerpt available in `excerpt.rendered` — good for Phase 1 scanning

### Source Details — TV9 Kannada

- Base: `https://tv9kannada.com`
- Express/Node.js backend (not WordPress), but provides RSS feeds
- Feed URL: `https://tv9kannada.com/karnataka/bengaluru/feed`
- RSS includes: `<title>`, `<link>`, `<description>` (summary), `<content:encoded>` (full article HTML), `<pubDate>`, `<category>` tags, `<dc:creator>`
- Thumbnail: first `<img>` inside `<content:encoded>` (hosted on `images.tv9kannada.com`)
- Kannada category tags available: `ಕ್ರೈಂ ಸುದ್ದಿ` (Crime), `ಶಿಕ್ಷಣ ಸುದ್ದಿ` (Education), `ಬೆಂಗಳೂರು ಸುದ್ದಿ` (Bengaluru), etc.
- Content quirks: `ಇದನ್ನೂ ಓದಿ/ನೋಡಿ` ("also read/watch") links in `<h3>` tags, inline related links
- ~13 articles per feed load

### Cross-Source Observations

- Both sources cover the same major stories (verified: rain story, harassment complaint appeared on both)
- Both provide categories in Kannada — translate to English during extraction, no LLM classification needed
- When a story appears on both sources with different categories, use the more specific one
- When a story appears on both sources, the agent reads both versions and produces the best translation (may combine details from both). The `original_url` points to whichever article had richer content. The `source` field lists both comma-separated.

## Architecture

### Agent Does Everything

One `createAgentSession()` per scrape. The agent receives the playbook (API details, parsing hints) and does all the work:

1. Fetches listings from both APIs (titles + excerpts/descriptions)
2. Reads all ~33 articles' titles and summaries
3. Picks top 5 — stories appearing on both sources rank higher
4. Fetches full article content for only the 5 winners
5. Strips HTML noise (video embeds, "also read" links, ads)
6. Translates Kannada → English (headline, summary, full content as markdown)
7. Translates source category to English
8. Returns structured JSON array of 5 articles

### Code is Dumb

TypeScript code handles only:
- Creating the agent session with playbook injected
- Parsing the agent's JSON response
- Validating with Zod
- Downloading thumbnails → uploading to Appwrite Storage
- Deleting today's existing top 5 from DB
- Inserting new top 5
- Committing any playbook updates from the agent

No orchestration logic in code. If we add a new source, we update the playbook — no code changes.

### Flow

```
Scheduler triggers (8am / 1pm / 7pm IST)
│
├─ 1. Read playbook.md
├─ 2. Create agent session
│     System prompt includes:
│     - Playbook content (API endpoints, parsing hints)
│     - Today's date, city
│     - Instructions: fetch, scan, pick top 5, translate, return JSON
│
├─ 3. Agent does everything:
│     - Uses bash/curl to fetch both APIs
│     - Reads all titles + excerpts (~33 articles)
│     - Picks top 5 (cross-source overlap = higher rank)
│     - Fetches full articles for winners only
│     - Translates Kannada → English
│     - Returns structured JSON
│
├─ 4. Code takes over:
│     - Validate JSON with Zod
│     - Download thumbnails → Appwrite Storage
│     - Delete today's existing top 5
│     - Insert new top 5
│
├─ 5. Agent updates playbook.md if it learned something new
│
└─ Done
```

## Data Model

### `news_articles` table (Appwrite, `live_city` database)

| Column | Type | Size | Required | Notes |
|---|---|---|---|---|
| `city` | varchar | 64 | yes | `bengaluru` |
| `headline` | varchar | 512 | yes | English, translated from Kannada |
| `summary` | varchar | 2048 | yes | 1-2 sentence English summary |
| `content` | text | — | yes | Full article body in English markdown |
| `category` | varchar | 64 | yes | Translated from source category |
| `source` | varchar | 64 | yes | `tv9kannada` / `publictv` / `tv9kannada,publictv` (comma-separated if both) |
| `source_count` | integer | — | yes | How many sources carried this story (1 or 2) |
| `original_url` | varchar | 512 | no | Internal reference, not shown to users |
| `thumbnail_url` | varchar | 512 | no | Direct URL to source CDN image |
| `news_date` | varchar | 64 | yes | `2026-03-29` (IST date) |
| `rank` | integer | — | yes | 1-5 position in today's top 5 |
| `fetched_at` | datetime | — | yes | When this scrape ran |

### Indexes

- `idx_city_date` — `(city, news_date)` for fetching today's news for a city
- `idx_city_date_rank` — `(city, news_date, rank)` for ordered retrieval

### Replacement Strategy

Each scrape **replaces** the day's top 5: delete existing rows for `(city, news_date)` → insert new 5. The latest scrape is always the definitive view. No append/accumulate.

## Agent JSON Response Schema

The agent returns this JSON, which code validates with Zod:

```json
[
  {
    "headline": "BMTC to Add 500 New Buses to Bengaluru Fleet",
    "summary": "BMTC announces procurement of 500 new buses to improve public transport coverage in Bengaluru, with routes planned for underserved areas.",
    "content": "## BMTC Fleet Expansion\n\nThe Bangalore Metropolitan Transport Corporation...",
    "category": "Infrastructure",
    "source": "tv9kannada",
    "source_count": 2,
    "original_url": "https://tv9kannada.com/karnataka/bengaluru/bmtc-new-buses-1234.html",
    "thumbnail_url": "https://images.tv9kannada.com/wp-content/uploads/2026/03/bmtc.jpg",
    "rank": 1
  }
]
```

## Memory System

### `memory/news/playbook.md`

Single file. The agent's instruction manual — read before each scrape, updated by the agent if something changes.

Contains:
- API endpoints and request formats for each source
- Response parsing guidance (how to extract titles, excerpts, content, images)
- Content cleaning rules (what to strip: video embeds, "also read" links, etc.)
- Curation rules (cross-source weighting, what makes a story important)
- Any learned quirks (e.g. "PublicTV sometimes returns non-Bengaluru articles in category 255")

Starts with known findings from exploration. Evolves over time as the agent encounters new patterns.

## Thumbnail Handling

Hotlink directly from source CDNs — no download/upload step.

1. Agent extracts thumbnail URL from each source
2. Code stores the URL as-is in `thumbnail_url`
3. App loads images directly from source CDN

Image source per site:
- **PublicTV**: `GET /wp-json/wp/v2/media/{featured_media_id}?_fields=source_url` → full-size image URL
- **TV9**: first `<img src="...">` in `content:encoded` → `images.tv9kannada.com/...`

> **Future fallback:** If source CDNs start blocking hotlinking or deleting old images, switch to download → upload to Appwrite Storage. Change `thumbnail_url` to `thumbnail_id` (Appwrite file ID) and add a storage bucket `news_thumbnails`.

## Schedule

Cron: `0 8,13,19 * * *` (Asia/Kolkata timezone)

- **8:00 AM IST** — overnight and early morning stories
- **1:00 PM IST** — midday developments
- **7:00 PM IST** — end-of-day, most complete picture

Each scrape replaces the day's top 5. The 7pm scrape produces the final daily snapshot.

## Error Handling

- If agent session fails → retry once, then log error and skip this scrape
- If one source API is down → agent proceeds with the other source, picks top 5 from what's available
- If thumbnail download fails → store article without thumbnail (`thumbnail_id` is optional)
- If Zod validation fails → log the raw agent response, skip this scrape

## Future Extensibility

- **New source**: update playbook.md with the new API/RSS details — no code changes
- **New city**: add a new playbook section for that city's news sources
- **Browser fallback**: if APIs are blocked, update playbook to describe browser scraping approach — agent uses browser-tools skill instead of curl
- **More than 5**: change the number in the agent prompt

## Key Dependencies

No new dependencies. Uses existing:
- `@mariozechner/pi-coding-agent` — agent SDK (already installed)
- `node-appwrite` — database + storage (already installed)
- `node-cron` — scheduling (already installed)
- `zod` — validation (already installed)
