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

**Listing (headlines only):**
```
curl -s "https://tv9kannada.com/karnataka/bengaluru/feed" | python3 -c "
import sys,re
data = sys.stdin.read()
cleaned = re.sub(r'<content:encoded>.*?</content:encoded>', '', data, flags=re.DOTALL)
items = list(re.finditer(r'<item>', cleaned))
if len(items) > 20:
    cut = cleaned.find('</item>', items[19].end()) + len('</item>')
    cleaned = cleaned[:cut] + '</channel></rss>'
print(cleaned)
"
```
The raw RSS feed is ~400KB (60 items with full article HTML). The command above strips `content:encoded` and limits to 20 items (~20KB).

**Full article content:**
```
GET https://tv9kannada.com/karnataka/bengaluru/feed
```
Fetch the full RSS again and extract `<content:encoded>` for the specific article URL.

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

## Known Quirks

- PublicTV category 255 occasionally includes non-Bengaluru Karnataka articles — check article content to confirm Bengaluru relevance
- TV9 RSS returns ~13 articles, PublicTV API returns ~20
- Both sites sometimes have English keywords inline: "Bengaluru", "Heavy Rain", "BMTC" etc.
