#!/usr/bin/env python3
"""PublicTV (Bengaluru) listing mirror — 1:1 with memory/news/bengaluru/playbook-publictv.md.

Reads the WordPress REST API JSON response from stdin, filters to today+yesterday
IST, emits a JSON array to stdout. Fields: n, title, url, date (YYYY-MM-DD),
excerpt. Listing does not include a thumbnail — the playbook extracts og:image
from the article URL fallback instead.

Environment:
  NEWS_TODAY_OVERRIDE  YYYY-MM-DD to pin "today" (test hook; not used in
                       production where `datetime.now(IST).date()` is used).
"""
import html as htmlmod
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


def clean_html(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s)
    return htmlmod.unescape(s.strip())


def story_date(post):
    # `post["date"]` is naive IST (verified: diff to date_gmt is exactly +5:30).
    raw = post.get("date", "")
    try:
        return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%S").date()
    except Exception:
        return None


def main():
    today = _today()
    yesterday = today - timedelta(days=1)
    window = {today, yesterday}

    data = json.load(sys.stdin)
    kept = [(p, story_date(p)) for p in data if story_date(p) in window]

    out = []
    for i, (post, d) in enumerate(kept, 1):
        out.append(
            {
                "n": i,
                "title": clean_html(post["title"]["rendered"]),
                "url": post["link"],
                "date": d.strftime("%Y-%m-%d"),
                "excerpt": clean_html(post["excerpt"]["rendered"])[:300],
            }
        )
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
