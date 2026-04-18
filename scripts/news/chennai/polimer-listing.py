#!/usr/bin/env python3
"""
Mirror of the Polimer listing snippet from the scraping playbook.
stdin: raw RSS XML for https://www.polimernews.com/rss
stdout: JSON list of {n, title, url, date, cats, desc, thumb}
"""
import sys, re, json, html as htmlmod


def clean(s: str) -> str:
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.DOTALL)
    s = re.sub(r'<[^>]+>', '', s)
    return htmlmod.unescape(s.strip())


def main() -> None:
    xml = sys.stdin.read()
    items = re.findall(r'<item>(.*?)</item>', xml, flags=re.DOTALL)

    out = []
    for i, item in enumerate(items[:10], 1):
        title = re.search(r'<title>(.*?)</title>', item, re.DOTALL)
        link = re.search(r'<link>(.*?)</link>', item, re.DOTALL)
        pub = re.search(r'<pubDate>(.*?)</pubDate>', item, re.DOTALL)
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
            'date': pub.group(1).strip() if pub else '',
            'cats': [clean(c) for c in cats[:4]],
            'desc': clean(desc.group(1))[:200] if desc else '',
            'thumb': thumb.group(1) if thumb else '',
        })

    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
