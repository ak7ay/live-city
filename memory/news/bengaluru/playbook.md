# Bengaluru News — Scraping Playbook

## Sources

### 1. PublicTV (publictv.in)

**Method:** WordPress REST API

**Listing (titles + excerpts only):**
```
GET https://publictv.in/wp-json/wp/v2/posts?categories=255&per_page=20&_fields=id,title,excerpt,link,date,featured_media
```

**Full article by ID:**
```
GET https://publictv.in/wp-json/wp/v2/posts/{id}?_fields=id,title,content,featured_media
```

**Thumbnail URL from featured_media ID:**
```
GET https://publictv.in/wp-json/wp/v2/media/{featured_media_id}?_fields=source_url
```

**Content quirks:**
- Video player text noise mixed in content — strip it
- `ಇದನ್ನೂ ಓದಿ:` ("Also read:") inline links — strip these
- YouTube iframe embeds — strip
- Content is in `content.rendered` (HTML with Kannada Unicode text)
- Excerpt is in `excerpt.rendered`

---

### 2. TV9 Kannada (tv9kannada.com)

**Method:** RSS Feed

**Listing + full content in one request:**
```
GET https://tv9kannada.com/karnataka/bengaluru/feed
```

**RSS fields:**
- `<title>` — Kannada headline
- `<link>` — article URL
- `<description>` — Kannada summary/excerpt
- `<content:encoded>` — full article HTML (Kannada)
- `<pubDate>` — publish date
- `<category>` — Kannada category tags (e.g. `ಕ್ರೈಂ ಸುದ್ದಿ` = Crime News)

**Thumbnail:** Extract the first `<img src="...">` from `<content:encoded>`. Images hosted on `images.tv9kannada.com`.

**Content quirks:**
- `ಇದನ್ನೂ ಓದಿ/ನೋಡಿ` ("Also read/watch") links inside `<h3>` tags — strip these
- Inline related article links — strip
- `<h3>` with "ಕರ್ನಾಟಕದ ಮತ್ತಷ್ಟು ಸುದ್ದಿಗಾಗಿ" ("For more Karnataka news") footer links — strip

---

## Curation Rules

### Step 1: Fetch both sources
Fetch listings from **both** PublicTV API and TV9 RSS feed.

### Step 2: Build a cross-source match table
Before picking any winners, compare ALL titles/excerpts from both sources and identify which stories appear on both. Two articles match if they cover the same event, even if worded differently. Write out a match table listing every cross-source match found and every single-source-only story, with source references and source_count for each.

### Step 3: Pick the top 5
- **Cross-source stories (source_count: 2) MUST rank above single-source stories (source_count: 1).** If there are 4 cross-source matches, at least 4 of the top 5 must be cross-source.
- Among stories of equal source_count, prefer diversity of categories. Avoid picking multiple stories from the same category if other categories are available.
- For cross-source stories: set `source` to `"publictv,tv9kannada"` and `source_count` to `2`. Use the best details from both versions.

### Step 4: Get full content + thumbnails
For each of the 5 winners:
- Fetch full article content (PublicTV: full article by ID, TV9: content:encoded from RSS)
- Fetch thumbnail (PublicTV: media API endpoint for featured_media ID, TV9: first `<img src>` from content:encoded)
- **Every article must have a thumbnail.** Both sources provide images for all articles — if you're missing one, you didn't fetch it correctly.

## Translation Rules

- Translate all Kannada text to natural, readable English
- Headlines should be concise and newspaper-style
- Summary: 1-2 sentences capturing the key facts
- Content: full article body as clean markdown (## for subheadings, paragraphs, no HTML)
- Category: translate the source's Kannada category tag to English (e.g. `ಕ್ರೈಂ ಸುದ್ದಿ` → `Crime`)

## Known Quirks

- PublicTV category 255 occasionally includes non-Bengaluru Karnataka articles — check article content to confirm Bengaluru relevance
- TV9 RSS returns ~13 articles, PublicTV API returns ~20
- Both sites sometimes have English keywords inline: "Bengaluru", "Heavy Rain", "BMTC" etc.
