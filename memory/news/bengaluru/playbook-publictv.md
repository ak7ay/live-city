# PublicTV — Bengaluru News Scraping Playbook

**Method:** WordPress REST API

**Listing (titles + excerpts only):**
```
curl -s "https://publictv.in/wp-json/wp/v2/posts?categories=255&per_page=20&_fields=id,title,excerpt,link,date" | python3 -c "
import sys, json, re, html

data = json.load(sys.stdin)

def clean_html(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\s+', ' ', s)
    return html.unescape(s.strip())

for i, post in enumerate(data, 1):
    print(f'=== STORY {i} ===')
    print(f'ID: {post[\"id\"]}')
    print(f'DATE: {post[\"date\"]}')
    print(f'LINK: {post[\"link\"]}')
    print(f'TITLE: {clean_html(post[\"title\"][\"rendered\"])}')
    print(f'EXCERPT: {clean_html(post[\"excerpt\"][\"rendered\"])[:300]}')
    print()
"
```
**Why:** The raw JSON response is ~53KB even without `featured_media` and overflows tool buffers (observed 2026-04-10). Pipe through Python immediately — do not fetch and then parse separately. Do NOT include `featured_media` in `_fields`; it inflates further and is not needed at listing stage.

**Full article by ID:**
```
curl -s "https://publictv.in/wp-json/wp/v2/posts/{id}?_fields=id,title,content,featured_media"
```

**Truncated `content.rendered` fallback:** `content.rendered` may contain only 1–2 paragraphs of a longer article (observed 2026-04-10, post 1449766). If the rendered content looks short, refetch the article URL directly with curl:
```
curl -sL --compressed "{article_url}"   # e.g. https://publictv.in/{slug}/
```
**Note:** `--compressed` is required — PublicTV HTML pages are gzip-encoded; omitting it causes `UnicodeDecodeError` in Python (observed 2026-04-11).
The full page HTML contains the article body — extract it with a Python parse step in the same pipeline.

**Thumbnail URL from featured_media ID:**
```
curl -s "https://publictv.in/wp-json/wp/v2/media/{featured_media_id}?_fields=source_url"
```
**Note:** The returned image may be an old archive stock photo (e.g. `uploads/2025/01/...`) rather than the article's actual thumbnail. Prefer TV9's thumbnail when both sources cover the same story — it is reliably accessible and article-specific.

**Shortcut when using the article-URL fallback:** The article HTML page already contains the thumbnail — extract via `<meta property="og:image">` in the same curl response (observed 2026-04-11; simpler than the media API call or hunting for WordPress size suffixes). TV9 article pages expose the thumbnail the same way.

**Content extraction from article-URL fallback:** Class-based regex (`class="entry-content..."`) fails unreliably due to attribute ordering. Use `html.find('entry-content')` to locate the section, then search forward for end markers (`sharedaddy`, `jp-post-flair`, `post-tags`, `related-posts`) and slice (observed 2026-04-11):
```python
idx = html.find('entry-content')
section = html[idx:]
end_idx = min((section.find(m) for m in ['sharedaddy','jp-post-flair','post-tags','related-posts'] if section.find(m) > 0), default=len(section))
content_html = section[:end_idx]
```

**Content quirks:**
- Titles and excerpts contain HTML entities (`&#8211;`, `&#8216;`, `&#8217;` etc.) — `html.unescape()` is included in the listing `clean_html` above (observed consistently 2026-04-11)
- Video player text noise mixed in content — strip it
- `ಇದನ್ನೂ ಓದಿ:` ("Also read:") inline links — strip these
- YouTube iframe embeds — strip
- Content is in `content.rendered` (HTML with Kannada Unicode text)
- Excerpt is in `excerpt.rendered`
- `content.rendered` may include unrelated trailing content from other stories appended after `ಇದನ್ನೂ ಓದಿ` links (observed 2026-04-11, post 1450017: Udupi temple paragraph appeared at the end of an LPG article) — stop extracting after the last on-topic paragraph

---

## Known Quirks

- PublicTV category 255 occasionally includes non-Bengaluru Karnataka articles — check article content to confirm Bengaluru relevance
- PublicTV `per_page=20` listing spans into the previous day's late-night stories (e.g. ~21:00–23:00 the night before); filter by date if strict same-day output is needed
- PublicTV API returns ~20 articles per listing
- PublicTV content sometimes has English keywords inline: "Bengaluru", "Heavy Rain", "BMTC" etc.
