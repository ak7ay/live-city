#!/usr/bin/env python3
"""
Mirror of the Polimer listing snippet from the scraping playbook.
stdin: raw RSS XML for https://www.polimernews.com/rss
stdout: JSON list of {n, title, url, date, cats, desc, thumb}

date: normalized IST YYYY-MM-DD (mirrors the playbook's DATE: line).

Items outside today + yesterday (IST) are dropped at parse time so the
agent never sees them.

NEWS_TODAY_OVERRIDE (env, YYYY-MM-DD): test-only hook. The inlined
playbook snippet does NOT use this env var.
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
    items = [it for it in items if story_date(it) in window]

    out = []
    for i, item in enumerate(items, 1):
        title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
        link = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
        d = story_date(item)
        cats = re.findall(r'<category>(.*?)</category>', item, re.DOTALL)
        desc = re.search(r'<description>(.*?)</description>', item, re.DOTALL)
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
            'desc': clean(desc.group(1))[:200] if desc else '',
            'thumb': thumb.group(1) if thumb else '',
        })

    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
