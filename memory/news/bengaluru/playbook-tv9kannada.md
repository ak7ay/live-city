# TV9 Kannada — Bengaluru News Scraping Playbook

**Method:** RSS Feed

**Listing (headlines only):**
```
curl -s "https://tv9kannada.com/karnataka/bengaluru/feed" | python3 -c "
import sys,re
data = sys.stdin.read()
# Strip content:encoded first (raw feed is ~500KB)
data = re.sub(r'<content:encoded>.*?</content:encoded>', '', data, flags=re.DOTALL)
items_raw = re.findall(r'<item>(.*?)</item>', data, flags=re.DOTALL)[:20]
for i, item in enumerate(items_raw, 1):
    title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
    link  = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    pub   = re.search(r'<pubDate>(.*?)</pubDate>', item, re.DOTALL)
    desc  = re.search(r'<description>(.*?)</description>', item, re.DOTALL)
    cats  = re.findall(r'<category><!\[CDATA\[(.*?)\]\]></category>', item)
    def clean(s):
        s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
        s = re.sub(r'<[^>]+>', '', s)
        return s.strip()
    print(f'=== STORY {i} ===')
    print(f'TITLE: {clean(title.group(1)) if title else \"\"}')
    print(f'LINK:  {link.group(1).strip() if link else \"\"}')
    print(f'DATE:  {pub.group(1).strip() if pub else \"\"}')
    print(f'CATS:  {\" | \".join(cats)}')
    print(f'DESC:  {clean(desc.group(1))[:300] if desc else \"\"}')
    print()
"
```
**Why:** Printing the cleaned XML is still ~39KB and overflows tool buffers. Extract fields directly in the same Python pass instead.

**Note:** Titles may contain HTML entities (`&#8216;`, `&#8220;` etc.) — these are smart quotes; decode or ignore as needed.

**Full article content:**

When the article URL is known, fetch it directly with curl — this is simpler and avoids re-fetching the large RSS feed:
```
curl -sL "{article_url}"   # e.g. https://tv9kannada.com/karnataka/bengaluru/{slug}.html
```
**Note:** `--compressed` is recommended for gzip responses but TV9 pages have also been fetched successfully without it (observed 2026-04-11).

The returned HTML contains the full Kannada article body and the thumbnail reference. Pipe through Python to extract both in a single pass.

**Content extraction — use JSON-LD (primary):** TV9 article pages embed a `<script type="application/ld+json">` block whose `articleBody` field contains the full article text, already stripped of HTML. This is cleaner and more reliable than HTML parsing (observed 2026-04-11):
```python
import json, re
schema = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
data = json.loads(schema.group(1))
# data may be a list or a single object
items = data if isinstance(data, list) else [data]
body = next((d['articleBody'] for d in items if d.get('@type') == 'NewsArticle'), '')
```
Strip `ಇದನ್ನೂ ಓದಿ ...` lines and the footer "ಕರ್ನಾಟಕದ ಮತ್ತಷ್ಟು ..." line from the resulting text.

**Extraction fallback (if JSON-LD absent):** Do NOT try `<div class="article">` or `<article>` tags — these match navigation/caption elements (observed 2026-04-11). Instead, extract all `<p>` tags and filter for Kannada Unicode (`[\u0C80-\u0CFF]`) with minimum length ~30 chars.

Fallback (no URL / programmatic): fetch the full RSS and extract `<content:encoded>` for the matching `<link>`:
```
curl -s "https://tv9kannada.com/karnataka/bengaluru/feed"
```

**RSS fields:**
- `<title>` — Kannada headline
- `<link>` — article URL
- `<description>` — Kannada summary/excerpt
- `<content:encoded>` — full article HTML (Kannada)
- `<pubDate>` — publish date
- `<category>` — Kannada category tags (e.g. `ಕ್ರೈಂ ಸುದ್ದಿ` = Crime News)

**Thumbnail:** When fetching the article URL directly, extract from the JSON-LD block in the same pass as `articleBody` — use `thumbnailUrl`, falling back to `image.url` (observed 2026-04-11):
```python
thumbnail = next((d.get('thumbnailUrl') or (d.get('image', {}).get('url', '') if isinstance(d.get('image'), dict) else '') for d in items if d.get('@type') == 'NewsArticle'), '')
```
URLs follow the pattern `https://images.tv9kannada.com/wp-content/uploads/...`. When using RSS fallback, extract the first `<img src="...">` from `<content:encoded>`.

**Video articles** (`/videos/` URL path): These are video-first pages with minimal article text — typically just a YouTube embed and 1–2 short paragraphs. When a TV9 article URL is under `/videos/`, use the RSS `content:encoded` fallback rather than fetching the page directly. Prefer PublicTV content for the full article body in these cases (observed 2026-04-10).

**Content quirks:**
- `ಇದನ್ನೂ ಓದಿ/ನೋಡಿ` ("Also read/watch") links appear inside `<p>` tags (not `<h3>`) — strip these
- Inline related article links — strip
- Footer `<p>` with "ಕರ್ನಾಟಕದ ಮತ್ತಷ್ಟು/ಇನ್ನಷ್ಟು ಸುದ್ದಿಗಳನ್ನು ಓದಲು ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ" ("For more Karnataka news, click here") — strip; appears as `<p>` not `<h3>`; both `ಮತ್ತಷ್ಟು` and `ಇನ್ನಷ್ಟು` variants observed
- Twitter/social media embed blocks appear mid-article as `<p>` tags and pass the Kannada-char filter — strip paragraphs containing `pic.twitter.com` and the following attribution line (`— AccountName (handle) Date`) (observed 2026-04-11, TV9 article 1171538: KSNDMC tweet appeared between body paragraphs)

---

## Known Quirks

- TV9 RSS returns up to 20 articles (observed 20 on 2026-04-10 and 2026-04-11)
- TV9 RSS listing spans into the previous day's late-night stories (observed 2026-04-11: story dated Apr 9 appeared in the Apr 10/11 listing); filter by date if strict same-day output is needed
- TV9 Bengaluru RSS feed includes non-Bengaluru Karnataka stories tagged "ಬೆಂಗಳೂರು ಸುದ್ದಿ" (observed 2026-04-11: Davanagere by-poll, Chikkamagaluru missing girl, copra prices, north Karnataka weather all appeared) — check content to confirm Bengaluru relevance
- TV9 content sometimes has English keywords inline: "Bengaluru", "Heavy Rain", "BMTC" etc.
