# Daily Thanthi — Chennai News Scraping Playbook

**Method:** RSS-only. The `stories.rss` feed's `<content:encoded>` already contains the full article body — no article-page fetch required.

**Listing (today + yesterday IST window):**
```
curl -sL --compressed "https://www.dailythanthi.com/stories.rss" | python3 -c "
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

def link_of(it):
    m = re.search(r'<link>(.*?)</link>', it, re.DOTALL)
    return (m.group(1) if m else '').strip()

def story_date(it):
    pub = re.search(r'<pubDate>(.*?)</pubDate>', it, re.DOTALL)
    if not pub: return None
    try:
        return datetime.strptime(pub.group(1).strip(), '%a, %d %b %Y %H:%M:%S %z').astimezone(IST).date()
    except Exception:
        return None

# Skip /ampstories/ webstories — stock credit lines, no news.
items = [it for it in items if '/ampstories/' not in link_of(it)]
# Drop items outside today + yesterday (IST).
items = [it for it in items if story_date(it) in window]

for i, item in enumerate(items, 1):
    title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
    link  = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    d     = story_date(item)
    cats  = re.findall(r'<category>(.*?)</category>', item, re.DOTALL)
    thumb = re.search(r'(?:media:thumbnail|media:content|enclosure)[^>]*url=\"([^\"]+)\"', item)
    print(f'=== STORY {i} ===')
    print(f'TITLE: {clean(title.group(1)) if title else \"\"}')
    print(f'URL:   {clean(link.group(1)) if link else \"\"}')
    print(f'DATE:  {d.strftime(\"%Y-%m-%d\") if d else \"\"}')
    print(f'CATS:  {[clean(c) for c in cats[:4]]}')
    print(f'THUMB: {thumb.group(1) if thumb else \"\"}')
    print()
"
```

**Why no body in the listing:** phase-3 re-fetches the full body for the 8 selected stories via the same RSS pipe (matching `<link>`), so emitting body during listing burns context for stories that get dropped. Article body is still in `<content:encoded>` — recover it on demand from a cached RSS dump.

**Full body for a known URL** (re-fetch path, used by phase-3):
```
curl -sL --compressed "https://www.dailythanthi.com/stories.rss" | python3 -c "
import sys, re, html as htmlmod
xml = sys.stdin.read()
items = re.findall(r'<item>(.*?)</item>', xml, flags=re.DOTALL)
target = '{article_url}'
for item in items:
    link = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    if not link or link.group(1).strip() != target: continue
    ce = re.search(r'<content:encoded>(.*?)</content:encoded>', item, re.DOTALL)
    if not ce: break
    b = re.sub(r'<!\[CDATA\[|\]\]>', '', ce.group(1))
    b = re.sub(r'<[^>]+>', ' ', b)
    print(re.sub(r'\s+', ' ', htmlmod.unescape(b)).strip())
    break
"
```

**Fields:**
- `<title>` — Tamil headline (CDATA-wrapped)
- `<link>` — canonical article URL
- `<pubDate>` — RFC822 UTC, e.g. `Sat, 18 Apr 2026 05:22:35 +0000` — the listing snippet normalizes this to IST `YYYY-MM-DD` and emits it as `DATE:`
- `<category>` — mixed Tamil/English tags, e.g. `தமிழக செய்திகள் (Tamilnadu)`, `கிரிக்கெட் (Cricket)`
- `<content:encoded>` — full article HTML; stripped text is ~3000–4000 chars for regular news items, ~500–1500 for shorter wire briefs
- `<media:content url="...">` / `<enclosure url="...">` — AssetType CDN thumbnail

## Chennai relevance

The feed is Tamil-Nadu-wide. No Chennai-only feed exists (`/rssfeed/chennai` → 404). Filter at selection time:
- URL slug contains `chennai`, `gold-rate-chennai`, `madras`, etc. (~15/44 items on a typical run)
- Or body contains `சென்னை`

## Content quirks

- **Webstories** (URL contains `/ampstories/`) carry only stock credit lines (~700 chars, repeated `credit: freepik` pattern) — filter is already in the listing snippet, do not remove.
- HTML entities in body (`&amp;quot;`, `&apos;`) — a single `html.unescape()` pass handles these; unlike Polimer, Thanthi bodies are not over-escaped.
- Bylines sometimes appear at body start as `சென்னை,` or `பாமக தலைவர்...` — typical dateline; keep.
- Feed has ~30–44 items pre-filter; the today+yesterday filter typically leaves ~15–35.
- **SIGPIPE truncation risk:** Do NOT pipe the listing through `| head -N` — head quitting sends SIGPIPE and causes python to terminate early, silently truncating the last story. Redirect directly to a file (`> /tmp/file.txt`) and grep/head the file separately if you need to slice it.
- **Date filter:** the listing snippet drops anything not dated today or yesterday (IST). If you suspect the filter is over-trimming, run the snippet with `today = datetime.now(IST).date() + timedelta(days=1)` swapped in to see what's just outside the window.

## Known quirks

- Category tags are double-tagged (`தமிழக செய்திகள் (Tamilnadu)`) — translate the parenthetical English half when producing the output, or strip the parenthetical and translate the Tamil.
- Cricket / IPL is well covered (~7/44 items) — useful for city cross-source if the other source lacks sports.
