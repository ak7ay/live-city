#!/usr/bin/env python3
"""
Mirror of the Daily Thanthi scraping playbook's inline snippet.
stdin: raw RSS XML for https://www.dailythanthi.com/stories.rss
stdout: JSON list of {n, title, url, date, cats, thumb, body}
"""
import sys, re, json, html as htmlmod


def clean(s: str) -> str:
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return htmlmod.unescape(s.strip())


def body_text(item: str) -> str:
    ce = re.search(r'<content:encoded>(.*?)</content:encoded>', item, re.DOTALL)
    if not ce:
        return ''
    b = re.sub(r'<!\[CDATA\[|\]\]>', '', ce.group(1))
    b = re.sub(r'<[^>]+>', ' ', b)
    return re.sub(r'\s+', ' ', htmlmod.unescape(b)).strip()


def link_of(item: str) -> str:
    m = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
    return (m.group(1) if m else '').strip()


def main() -> None:
    xml = sys.stdin.read()
    items = re.findall(r'<item>(.*?)</item>', xml, flags=re.DOTALL)
    # Skip /ampstories/ webstories — stock credit lines, no news value.
    items = [it for it in items if '/ampstories/' not in link_of(it)]

    out = []
    for i, item in enumerate(items[:10], 1):
        title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
        link = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
        pub = re.search(r'<pubDate>(.*?)</pubDate>', item, re.DOTALL)
        cats = re.findall(r'<category>(.*?)</category>', item, re.DOTALL)
        thumb = re.search(
            r'(?:media:thumbnail|media:content|enclosure)[^>]*url="([^"]+)"',
            item,
        )
        out.append({
            'n': i,
            'title': clean(title.group(1)) if title else '',
            'url': clean(link.group(1)) if link else '',
            'date': pub.group(1).strip() if pub else '',
            'cats': [clean(c) for c in cats[:4]],
            'thumb': thumb.group(1) if thumb else '',
            'body': body_text(item),
        })

    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
