# TV9 Kannada — Bengaluru News Scraping Playbook

**Method:** RSS Feed

**Listing (today + yesterday IST window):**
```
curl -s "https://tv9kannada.com/karnataka/bengaluru/feed" | python3 -c "
import sys, re
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()
yesterday = today - timedelta(days=1)
window = {today, yesterday}

def clean(s):
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return s.strip()

def story_date(it):
    m = re.search(r'<pubDate>(.*?)</pubDate>', it, re.DOTALL)
    if not m: return None
    try: return datetime.strptime(m.group(1).strip(), '%a, %d %b %Y %H:%M:%S %z').astimezone(IST).date()
    except: return None

data = sys.stdin.read()
# Strip content:encoded first (raw feed is ~500KB)
data = re.sub(r'<content:encoded>.*?</content:encoded>', '', data, flags=re.DOTALL)
items_raw = re.findall(r'<item>(.*?)</item>', data, flags=re.DOTALL)
items_raw = [it for it in items_raw if story_date(it) in window]

for i, item in enumerate(items_raw, 1):
    title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
    link  = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    desc  = re.search(r'<description>(.*?)</description>', item, re.DOTALL)
    cats  = re.findall(r'<category><!\[CDATA\[(.*?)\]\]></category>', item)
    d = story_date(item)
    print(f'=== STORY {i} ===')
    print(f'TITLE: {clean(title.group(1)) if title else \"\"}')
    print(f'LINK:  {link.group(1).strip() if link else \"\"}')
    print(f'DATE:  {d.strftime(\"%Y-%m-%d\") if d else \"\"}')
    print(f'CATS:  {\" | \".join(cats)}')
    print(f'DESC:  {clean(desc.group(1))[:300] if desc else \"\"}')
    print()
"
```
**Why:** Printing the cleaned XML is still ~39KB and overflows tool buffers. Extract fields directly in the same Python pass instead.

**Why the date filter:** The feed routinely spans previous days — up to 16 items from a prior day observed 2026-04-22 (see Known Quirks). Filtering to today+yesterday IST in-python trims noise before it reaches phase-2. The former `[:20]` slice is removed — the date filter is the correct cap (typical window: ~30 items). The normalized `DATE: YYYY-MM-DD` line lets the phase-1 agent copy the date verbatim into each story's `**Date:**` field.

**Note:** Titles may contain HTML entities (`&#8216;`, `&#8220;` etc.) — these are smart quotes; decode or ignore as needed. The `articleBody` from JSON-LD may also contain HTML entities (`&#039;` for apostrophe, `&quot;` for double-quote) — decode these when rendering (observed 2026-04-16, article 1173793).

**Full article content:**

When the article URL is known, fetch it directly with curl — this is simpler and avoids re-fetching the large RSS feed:
```
curl -sL "{article_url}"   # e.g. https://tv9kannada.com/karnataka/bengaluru/{slug}.html
```
**Note:** `--compressed` is recommended for gzip responses but TV9 pages have also been fetched successfully without it (observed 2026-04-11).

The returned HTML contains the full Kannada article body and the thumbnail reference. Pipe through Python to extract both in a single pass.

**Content extraction — use JSON-LD (primary):** TV9 article pages embed one or more `<script type="application/ld+json">` blocks. Use `re.findall` (not `re.search`) to collect all blocks — video articles place a `VideoObject` block first, so `re.search` returns the wrong block and yields empty results (observed 2026-04-19, article 1174774: 7 separate blocks, VideoObject first, NewsArticle second):
```python
import json, re
all_schemas = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
news_article = None
for s in all_schemas:
    try:
        data = json.loads(s)
        items = data if isinstance(data, list) else [data]
        match = next((d for d in items if d.get('@type') == 'NewsArticle'), None)
        if match:
            news_article = match
            break
    except:
        pass
body = news_article.get('articleBody', '') if news_article else ''
```
Strip `ಇದನ್ನೂ ಓದಿ ...` lines and any footer line containing `ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ` from the resulting text.

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

**Thumbnail:** Extract from `news_article` (the matched NewsArticle dict from the loop above) — use `thumbnailUrl`, falling back to `image.url` (observed 2026-04-11):
```python
thumbnail = (news_article.get('thumbnailUrl') or
    (news_article.get('image', {}).get('url', '') if isinstance(news_article.get('image'), dict) else '')) if news_article else ''
```
URLs follow the pattern `https://images.tv9kannada.com/wp-content/uploads/...`. When using RSS fallback, extract the first `<img src="...">` from `<content:encoded>`.

**Caution:** The JSON-LD `thumbnailUrl` can be an image from a completely different article due to a TV9 CMS bug — the filename will have no relation to the story topic (observed 2026-04-20, article 1175251: liquor-price story had `vijayanagara-accident-2.jpg` as its `thumbnailUrl`). No reliable programmatic fix; accept and pass through as-is, or cross-check the filename against the article slug if correctness matters.

**Video articles** (`/videos/` URL path): Try the direct JSON-LD fetch first — some `/videos/` pages embed a full NewsArticle block with a complete article body (observed 2026-04-21, article 1175637: 3 full paragraphs via JSON-LD). Only fall back to RSS `content:encoded` if the NewsArticle block is absent or `articleBody` is very short (1–2 sentences). The original observation of minimal text (observed 2026-04-10) appears to be article-dependent, not universal for all `/videos/` URLs.

**Content quirks:**
- `ಇದನ್ನೂ ಓದಿ/ನೋಡಿ` ("Also read/watch") links appear inside `<p>` tags (not `<h3>`) — strip these
- Inline related article links — strip
- Footer `<p>` with "click here for more news" — strip; appears as `<p>` not `<h3>`; reliable strip signal across all variants is `ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ` (common suffix); observed variants: `ಕರ್ನಾಟಕದ ಮತ್ತಷ್ಟು/ಇನ್ನಷ್ಟು ಸುದ್ದಿಗಳನ್ನು ಓದಲು ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ`, `ರಾಜ್ಯದ ಸುದ್ದಿಗಳನ್ನು ಓದಲು ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ` (observed 2026-04-16, article 1173793), `ಮತ್ತಷ್ಟು ಸುದ್ದಿ ಓದಲು ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ` — shorter form, no `ಕರ್ನಾಟಕದ` prefix, no `ಗಳನ್ನು` (observed 2026-04-19, article 1175179), `ಕರ್ನಾಟಕದ ಮತ್ತಷ್ಟು ಸುದ್ದಿಗಾಗಿ ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ` — uses `ಸುದ್ದಿಗಾಗಿ` (for news) instead of `ಓದಲು` (to read), missed by narrower `ಓದಲು ಇಲ್ಲಿ` signal (observed 2026-04-21, article 1175888). **Caution:** the `articleBody` may contain zero-width spaces (U+200B, `​` in HTML source) embedded within words — after `html.unescape()` these remain as `\u200b` and break naive `in` string matching against the strip pattern (observed 2026-04-20, article 1175251: footer read as `ಕ್ಲಿಕ್\u200b\u200b ಮಾಡಿ`). Strip zero-width chars before matching: `re.sub(r'[\u200b-\u200f]', '', line)`
- Twitter/social media embed blocks appear mid-article and pass the Kannada-char filter — strip by detecting the attribution line `— AccountName (@handle) Date` (this is the reliable universal signal); also strip the preceding duplicated-content block and any label line like "ಸಚಿವ [Name] ಟ್ವೀಟ್​". Image tweets additionally contain `pic.twitter.com` but text-only tweets do not — use the attribution line, not `pic.twitter.com`, as the primary signal (observed 2026-04-11, article 1171538: image tweet; 2026-04-18, article 1174577: text-only tweet from @dineshgrao)
- Bullet list items in `articleBody` are prefixed with ` \t` (space + tab) rather than standard list markers — treat lines starting with ` \t` as list items and render as markdown `- item` (observed 2026-04-14, article 1172659)
- `articleBody` may contain a full appended related story after the main article body, before the footer line — appears as a standalone headline-style line followed by a complete off-topic paragraph (observed 2026-04-14, article 1172869: Miss Universe Karnataka story appended to investment article); strip any content that is clearly from a different story topic
- Reporter byline appears as the last line of `articleBody` before the footer, in the form `ವರದಿ: [Name], ಟಿವಿ9 ಬೆಂಗಳೂರು` ("Report: [Name], TV9 Bengaluru") — keep or strip depending on output preference (observed 2026-04-17, article 1173928)

---

## Known Quirks

- TV9 RSS returns up to 20 articles (observed 20 on 2026-04-10 and 2026-04-11)
- TV9 RSS listing routinely includes stories from the previous day — count varies: 6 stories on 2026-04-18 (stories 15–20, ranging 16:43–21:48 IST Apr 17), 10 stories on 2026-04-14 (all Apr 13, ranging 14:23–22:32 IST), 6 stories on 2026-04-19 (stories 15–20, all Apr 18, fetched ~16:37 IST), 16 stories on 2026-04-22 (stories 5–20, all Apr 21, fetched ~8am IST — new high, consistent with early-morning fetch before same-day stories accumulate); count decreases through the day as same-day stories accumulate; filter by date if strict same-day output is needed
- TV9 Bengaluru RSS feed includes non-Bengaluru Karnataka stories tagged "ಬೆಂಗಳೂರು ಸುದ್ದಿ" (observed 2026-04-11: Davanagere by-poll, Chikkamagaluru missing girl, copra prices, north Karnataka weather all appeared) — check content to confirm Bengaluru relevance
- Story URLs in the feed are not always under `/karnataka/bengaluru/` — observed `/politics/` (2026-04-18, story 1174934), `/karnataka/mandya/` (story 1174774), `/karnataka/mysuru/` (2026-04-19, story 1175173), `/karnataka/` top-level with no subcategory (2026-04-19, story 1175331), `/education/` top-level (2026-04-21, story 1176105), and `/trending/` top-level (2026-04-22, story 1176342) paths for stories tagged as Bengaluru news; use category tags, not URL path, to identify Bengaluru stories
- TV9 content sometimes has English keywords inline: "Bengaluru", "Heavy Rain", "BMTC" etc.
