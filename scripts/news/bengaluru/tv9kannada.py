#!/usr/bin/env python3
"""TV9 Kannada (Bengaluru) RSS mirror — 1:1 with memory/news/bengaluru/playbook-tv9kannada.md.

Reads the raw RSS feed from stdin, filters to today+yesterday IST, emits a JSON
array to stdout. Fields: n, title, url, date (YYYY-MM-DD), cats, desc, thumb.

Environment:
  NEWS_TODAY_OVERRIDE  YYYY-MM-DD to pin "today" (test hook).
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def _today():
    override = os.environ.get("NEWS_TODAY_OVERRIDE")
    if override:
        return datetime.strptime(override, "%Y-%m-%d").date()
    return datetime.now(IST).date()


def clean(s):
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s, flags=re.DOTALL)
    s = re.sub(r"<[^>]+>", "", s)
    return s.strip()


def story_date(item):
    m = re.search(r"<pubDate>(.*?)</pubDate>", item, re.DOTALL)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1).strip(), "%a, %d %b %Y %H:%M:%S %z").astimezone(IST).date()
    except Exception:
        return None


def thumb_of(item):
    # Prefer media:content or enclosure url attribute; fall back to first <img src=...>.
    m = re.search(r'url="(https?://[^"]+)"', item)
    if m:
        return m.group(1)
    m = re.search(r'<img[^>]+src="(https?://[^"]+)"', item)
    return m.group(1) if m else ""


def main():
    today = _today()
    yesterday = today - timedelta(days=1)
    window = {today, yesterday}

    data = sys.stdin.read()
    # Strip content:encoded first — the raw feed is ~500KB otherwise.
    data = re.sub(r"<content:encoded>.*?</content:encoded>", "", data, flags=re.DOTALL)
    items = re.findall(r"<item>(.*?)</item>", data, flags=re.DOTALL)
    items = [it for it in items if story_date(it) in window]

    out = []
    for i, item in enumerate(items, 1):
        title = re.search(r"<title>(.*?)</title>", item, re.DOTALL)
        link = re.search(r"<link>(.*?)</link>", item, re.DOTALL)
        desc = re.search(r"<description>(.*?)</description>", item, re.DOTALL)
        cats = re.findall(r"<category><!\[CDATA\[(.*?)\]\]></category>", item)
        d = story_date(item)
        out.append(
            {
                "n": i,
                "title": clean(title.group(1)) if title else "",
                "url": (link.group(1).strip() if link else ""),
                "date": d.strftime("%Y-%m-%d") if d else "",
                "cats": cats,
                "desc": clean(desc.group(1))[:300] if desc else "",
                "thumb": thumb_of(item),
            }
        )
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
