# PublicTV — Bengaluru News Scraping Playbook

**Method:** WordPress REST API

**Listing (today + yesterday IST window):**
```
curl -s "https://publictv.in/wp-json/wp/v2/posts?categories=255&per_page=20&_fields=id,title,excerpt,link,date" | python3 -c "
import sys, json, re, html
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()
yesterday = today - timedelta(days=1)
window = {today, yesterday}

def clean_html(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\s+', ' ', s)
    return html.unescape(s.strip())

def story_date(p):
    try: return datetime.strptime(p.get('date',''), '%Y-%m-%dT%H:%M:%S').date()
    except: return None

data = json.load(sys.stdin)
data = [p for p in data if story_date(p) in window]
for i, post in enumerate(data, 1):
    d = story_date(post)
    print(f'=== STORY {i} ===')
    print(f'ID: {post[\"id\"]}')
    print(f'DATE: {d.strftime(\"%Y-%m-%d\")}')
    print(f'LINK: {post[\"link\"]}')
    print(f'TITLE: {clean_html(post[\"title\"][\"rendered\"])}')
    print(f'EXCERPT: {clean_html(post[\"excerpt\"][\"rendered\"])[:300]}')
    print()
"
```
**Why:** The raw JSON response is ~53KB even without `featured_media` and overflows tool buffers (observed 2026-04-10). Pipe through Python immediately — do not fetch and then parse separately. Do NOT include `featured_media` in `_fields`; it inflates further and is not needed at listing stage.

**Why the date filter:** The listing routinely spans into prior days (see Known Quirks). Filtering to today+yesterday in-python trims noise before it reaches phase-2. `post.date` is naive IST (verified 2026-04-23: `date_gmt` is exactly +5:30 from `date`) so it parses directly without a timezone conversion. The normalized `DATE: YYYY-MM-DD` line lets the phase-1 agent copy the date verbatim into each story's `**Date:**` field.

**Full article by ID:**
```
curl -s "https://publictv.in/wp-json/wp/v2/posts/{id}?_fields=id,title,content,featured_media"
```

**Truncated `content.rendered` fallback:** `content.rendered` may contain only 1–2 paragraphs of a longer article (observed 2026-04-10, post 1449766). If the rendered content looks short, refetch the article URL directly with curl:
```
curl -sL --compressed "{article_url}" -o /tmp/publictv_article.html
python3 << 'PYEOF'
# read from /tmp/publictv_article.html
PYEOF
```
**Note:** `--compressed` is required — PublicTV HTML pages are gzip-encoded; omitting it causes `UnicodeDecodeError` in Python (observed 2026-04-11).
**Note:** Save to a temp file first (`-o /tmp/...`), then run Python separately via heredoc. Do NOT pipe curl directly into `python3 << 'PYEOF'` — bash gives stdin to the pipe, so the HTML becomes Python's source code and fails. `python3 -c "..."` also fails here because multi-line regex patterns with single quotes break the quoting (observed 2026-04-19).

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
end_idx = min((section.find(m) for m in ['sharedaddy','jp-post-flair','post-tags','related-posts','TAGGED'] if section.find(m) > 0), default=len(section))
content_html = section[:end_idx]
```
**Note:** `TAGGED` was added 2026-04-14 (post 1450683) — the other markers were absent on that page and extraction continued into "Cinema news" and "You Might Also Like" sections. `TAGGED:` appears immediately after the last article paragraph and is a reliable stop point.

**Content quirks:**
- Titles and excerpts contain HTML entities (`&#8211;`, `&#8216;`, `&#8217;` etc.) — `html.unescape()` is included in the listing `clean_html` above (observed consistently 2026-04-11)
- Inline `<script>` blocks (googletag ad code) appear as plain text after tag stripping — strip script blocks before stripping tags: `re.sub(r'<script[^>]*>.*?</script>', '', s, flags=re.DOTALL)` (observed 2026-04-14, post 1450903)
- Video player text noise mixed in content — strip it
- `ಇದನ್ನೂ ಓದಿ:` ("Also read:") inline links — strip these
- YouTube iframe embeds — strip
- Content is in `content.rendered` (HTML with Kannada Unicode text)
- Excerpt is in `excerpt.rendered`
- `content.rendered` may include unrelated trailing content from other stories appended after `ಇದನ್ನೂ ಓದಿ` links (observed 2026-04-11, post 1450017: Udupi temple paragraph appeared at the end of an LPG article) — stop extracting after the last on-topic paragraph

---

## Known Quirks

- PublicTV category 255 occasionally includes non-Bengaluru or even non-Karnataka stories (observed 2026-04-11: a Hyderabad singer fraud story appeared, ID 1450167) — check article content to confirm Bengaluru relevance
- PublicTV `per_page=20` listing routinely spans well into the previous day — observed spillback as far as 12:50 PM the day before (2026-04-13 run: 5 of 20 stories were from April 12, earliest at 12:50); on low-volume days (e.g. holidays) spillback can reach 2 days prior — morning run on 2026-04-15 (post-Ugadi) had only 2/20 from that day with 6 reaching back to April 13; by afternoon the same day a re-run showed 11/20 from April 15 and 9 from April 14, none from April 13 — spillback normalises as same-day content accumulates; filter by date if strict same-day output is needed
- PublicTV API returns ~20 articles per listing
- PublicTV content sometimes has English keywords inline: "Bengaluru", "Heavy Rain", "BMTC" etc.
