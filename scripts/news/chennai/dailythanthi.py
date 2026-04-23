#!/usr/bin/env python3
"""
Mirror of the Daily Thanthi scraping playbook's inline snippet.
stdin: raw RSS XML for https://www.dailythanthi.com/stories.rss
stdout: JSON list of {n, title, url, date, cats, thumb}

date: normalized IST YYYY-MM-DD (the playbook's own DATE: print line uses
the same value, which the agent copies into stories-dailythanthi.md).

Items outside today + yesterday (IST) are dropped at parse time so the
agent never sees them.

NEWS_TODAY_OVERRIDE (env, YYYY-MM-DD): test-only hook. When set, replaces
datetime.now(IST).date(). The inlined playbook snippet does NOT use this
env var — production always uses real "now".
"""
import os, sys, re, json, html as htmlmod
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def _today() -> 'datetime.date':
    override = os.environ.get('NEWS_TODAY_OVERRIDE')
    if override:
        return datetime.strptime(override, '%Y-%m-%d').date()
    return datetime.now(IST).date()


def clean(s: str) -> str:
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return htmlmod.unescape(s.strip())


def link_of(item: str) -> str:
    m = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    return (m.group(1) if m else '').strip()


def story_date(item: str):
    pub = re.search(r'<pubDate>(.*?)</pubDate>', item, re.DOTALL)
    if not pub:
        return None
    try:
        return datetime.strptime(
            pub.group(1).strip(), '%a, %d %b %Y %H:%M:%S %z'
        ).astimezone(IST).date()
    except Exception:
        return None


def main() -> None:
    today = _today()
    yesterday = today - timedelta(days=1)
    window = {today, yesterday}

    xml = sys.stdin.read()
    items = re.findall(r'<item>(.*?)</item>', xml, flags=re.DOTALL)
    # Skip /ampstories/ webstories — stock credit lines, no news value.
    items = [it for it in items if '/ampstories/' not in link_of(it)]
    # Drop items outside today + yesterday (IST). Items with unparseable
    # pubDate are dropped — they can't be safely included.
    items = [it for it in items if story_date(it) in window]

    out = []
    for i, item in enumerate(items, 1):
        title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
        link = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
        d = story_date(item)
        cats = re.findall(r'<category>(.*?)</category>', item, re.DOTALL)
        thumb = re.search(
            r'(?:media:thumbnail|media:content|enclosure)[^>]*url="([^"]+)"',
            item,
        )
        out.append({
            'n': i,
            'title': clean(title.group(1)) if title else '',
            'url': clean(link.group(1)) if link else '',
            'date': d.strftime('%Y-%m-%d') if d else '',
            'cats': [clean(c) for c in cats[:4]],
            'thumb': thumb.group(1) if thumb else '',
        })

    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
