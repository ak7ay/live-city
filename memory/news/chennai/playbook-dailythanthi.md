# Daily Thanthi — Chennai News Scraping Playbook

**Method:** RSS-only. The `stories.rss` feed's `<content:encoded>` already contains the full article body — no article-page fetch required.

**Listing + body (single pipe):**
```
curl -sL --compressed "https://www.dailythanthi.com/stories.rss" | python3 -c "
import sys, re, html as htmlmod

xml = sys.stdin.read()
items = re.findall(r'<item>(.*?)</item>', xml, flags=re.DOTALL)

def clean(s):
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return htmlmod.unescape(s.strip())

def body_text(item):
    ce = re.search(r'<content:encoded>(.*?)</content:encoded>', item, re.DOTALL)
    if not ce: return ''
    b = re.sub(r'<!\[CDATA\[|\]\]>', '', ce.group(1))
    b = re.sub(r'<[^>]+>', ' ', b)
    return re.sub(r'\s+', ' ', htmlmod.unescape(b)).strip()

# Skip /ampstories/ webstories — they carry ~700 chars of stock credit lines, no news.
def link_of(it):
    m = re.search(r'<link>(.*?)</link>', it, re.DOTALL)
    return (m.group(1) if m else '').strip()
items = [it for it in items if '/ampstories/' not in link_of(it)]

for i, item in enumerate(items, 1):
    title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
    link  = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    pub   = re.search(r'<pubDate>(.*?)</pubDate>', item, re.DOTALL)
    cats  = re.findall(r'<category>(.*?)</category>', item, re.DOTALL)
    thumb = re.search(r'(?:media:thumbnail|media:content|enclosure)[^>]*url=\"([^\"]+)\"', item)
    body  = body_text(item)
    print(f'=== STORY {i} ===')
    print(f'TITLE: {clean(title.group(1)) if title else \"\"}')
    print(f'URL:   {clean(link.group(1)) if link else \"\"}')
    print(f'DATE:  {pub.group(1).strip() if pub else \"\"}')
    print(f'CATS:  {[clean(c) for c in cats[:4]]}')
    print(f'THUMB: {thumb.group(1) if thumb else \"\"}')
    print(f'BODY_CHARS: {len(body)}')
    print(f'BODY: {body[:4000]}')
    print()
"
```

**Why one pipe:** `content:encoded` is inline in the listing feed. Extracting body during the listing pass avoids re-fetching per-article.

**Full body for a known URL** (if needed for re-fetch rather than listing):
Re-run the same snippet above on the cached feed and pick out the matching item by `<link>`. There is no separate article-page fetch path — the feed is authoritative.

**Fields:**
- `<title>` — Tamil headline (CDATA-wrapped)
- `<link>` — canonical article URL
- `<pubDate>` — RFC822 UTC, e.g. `Sat, 18 Apr 2026 05:22:35 +0000`
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
- Feed has ~30–44 items; 30 observed on 2026-04-18 (after ampstories filter); polling once/day is sufficient.
- **Output size:** Running 30–44 items with `body[:4000]` produces 100–180KB — exceeds inline tool-result display limit and gets saved to a temp file. When this happens, use `grep -E "^(=== STORY|TITLE:|URL:|DATE:|CATS:)"` on the saved file to extract header fields, then read body lines separately if needed.
- **SIGPIPE truncation risk:** Do NOT pipe the command through `| head -N` (e.g. `tee FILE | head -200`) — head quitting sends SIGPIPE and causes tee/python to terminate early, silently truncating the last story. Redirect directly to a file (`> /tmp/file.txt`) and then grep/head the file separately.

## Known quirks

- Category tags are double-tagged (`தமிழக செய்திகள் (Tamilnadu)`) — translate the parenthetical English half when producing the output, or strip the parenthetical and translate the Tamil.
- Cricket / IPL is well covered (~7/44 items) — useful for city cross-source if the other source lacks sports.
