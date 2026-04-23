# Polimer News — Chennai News Scraping Playbook

**Method:** RSS for listing, article-page JSON-LD (`NewsArticle.articleBody`) for body.

**Listing (today + yesterday IST window):**
```
curl -sL --compressed "https://www.polimernews.com/rss" | python3 -c "
import sys, re, html as htmlmod
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()
yesterday = today - timedelta(days=1)
window = {today, yesterday}

xml = sys.stdin.read()
items = re.findall(r'<item>(.*?)</item>', xml, flags=re.DOTALL)

def clean(s):
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return htmlmod.unescape(s.strip())

def story_date(it):
    pub = re.search(r'<pubDate>(.*?)</pubDate>', it, re.DOTALL)
    if not pub: return None
    try:
        return datetime.strptime(pub.group(1).strip(), '%a, %d %b %Y %H:%M:%S %z').astimezone(IST).date()
    except Exception:
        return None

items = [it for it in items if story_date(it) in window]

for i, item in enumerate(items, 1):
    title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
    link  = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    d     = story_date(item)
    cats  = re.findall(r'<category>(.*?)</category>', item, re.DOTALL)
    desc  = re.search(r'<description>(.*?)</description>', item, re.DOTALL)
    thumb = re.search(r'(?:media:thumbnail|media:content|enclosure)[^>]*url=\"([^\"]+)\"', item)
    print(f'=== STORY {i} ===')
    print(f'TITLE: {clean(title.group(1)) if title else \"\"}')
    print(f'URL:   {clean(link.group(1)) if link else \"\"}')
    print(f'DATE:  {d.strftime(\"%Y-%m-%d\") if d else \"\"}')
    print(f'CATS:  {[clean(c) for c in cats[:4]]}')
    print(f'THUMB: {thumb.group(1) if thumb else \"\"}')
    print(f'DESC:  {clean(desc.group(1))[:200] if desc else \"\"}')
    print()
"
```

**Full article by URL (JSON-LD primary):**

Polimer article pages embed multiple `<script type="application/ld+json">` blocks; one has `@type: NewsArticle` with a full `articleBody`.
```
curl -sL --compressed "{article_url}" | python3 -c "
import sys, re, json, html as htmlmod

html = sys.stdin.read()
schemas = re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.DOTALL)

body  = ''
thumb = ''
for s in schemas:
    try:
        # NewsArticle blocks sometimes embed raw newlines inside JSON strings,
        # causing json.loads() to fail with 'Invalid control character'.
        # Strip bare control chars (except \t\n\r) before parsing.
        s_clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', s)
        data = json.loads(s_clean)
    except Exception:
        continue
    items = data if isinstance(data, list) else [data]
    for d in items:
        if d.get('@type') == 'NewsArticle':
            body = body or d.get('articleBody', '')
            img = d.get('image')
            if not thumb:
                if isinstance(img, dict):
                    thumb = img.get('url', '')
                elif isinstance(img, str):
                    thumb = img

# articleBody has varying escape depth across the string (some &amp;quot;, some &amp;amp;quot;).
# Fixed-point unescape until stable — a fixed pass count leaves stray &quot; in parts.
while True:
    new_body = htmlmod.unescape(body)
    if new_body == body: break
    body = new_body

if not thumb:
    m = re.search(r'<meta[^>]*property=\"og:image\"[^>]*content=\"([^\"]+)\"', html)
    thumb = m.group(1) if m else ''

print('BODY_CHARS:', len(body))
print('BODY:', body[:5000])
print('THUMB:', thumb)
"
```

**Fields:**
- `<title>` — Tamil headline (CDATA)
- `<link>` — article URL; pattern `https://www.polimernews.com/{section}/{slug}-{id}`
- `<pubDate>` — RFC822 IST (e.g. `Fri, 17 Apr 2026 20:45:11 +0530`) — the listing snippet normalizes this to IST `YYYY-MM-DD` and emits it as `DATE:`
- `<category>` — Tamil tags: `முகப்பு` (home), `தமிழ்நாடு`, `அரசியல்`, `மாவட்டம்`, city names, etc.
- `<media:content url="...">` / `<enclosure url="...">` — Publive CDN thumbnail (`img-cdn.publive.online/...`)
- Article page `NewsArticle.articleBody` — Tamil body; full articles ~3000–4000 chars, `/latestnews/` stubs can be as short as ~200 chars (genuine, not an extraction failure)

## Chennai relevance

Polimer tags some items with the Tamil city name `சென்னை` in the `<category>` list (e.g. items under `/districtnews/...-in-chennai-...`). Filter at selection time:
- Category list contains `சென்னை` (most reliable)
- URL slug contains `chennai`
- Body contains `சென்னை`

`/tag/chennai/rss` exists but returns 0 items — do not use.

## Content quirks

- **`articleBody` is over-escaped** with varying depth. Use the fixed-point `html.unescape()` loop in the snippet above — a one-shot or two-shot unescape leaves visible `&quot;` in parts of the body.
- Category tags can be purely Tamil (`முகப்பு`, `சற்றுமுன்`) and need translation at render time.
- Sports (IPL / cricket) is **not** published to the main RSS feed — `/sportsnews` section exists but is effectively dormant (article IDs ~288k behind current RSS IDs). Do not expect cricket cross-source matches from Polimer.
- Some entries are in English (`TRENDING`, `LATEST NEWS`) mixed into the Tamil category tree — keep as-is, the ranking prompt handles this.

## Known quirks

- Feed returns ~50 items pre-filter; today+yesterday window typically leaves ~30–40.
- **Date filter:** the listing snippet drops anything not dated today or yesterday (IST).
- Thumbnails are consistently present on every item.
- Article pages are ~230KB — piping directly into python avoids double-buffering the payload.
