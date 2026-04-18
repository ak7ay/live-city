#!/usr/bin/env python3
"""
Mirror of the Polimer article-body snippet from the scraping playbook.
stdin: raw HTML of a Polimer article page
stdout: JSON {chars, thumb, body}
"""
import sys, re, json, html as htmlmod


def main() -> None:
    html = sys.stdin.read()
    schemas = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>',
        html,
        re.DOTALL,
    )

    body = ''
    thumb = ''
    for s in schemas:
        try:
            data = json.loads(s)
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

    # articleBody has varying escape depth (some &amp;quot;, some &amp;amp;quot;).
    # Fixed-point unescape until the string stabilises.
    while True:
        new_body = htmlmod.unescape(body)
        if new_body == body:
            break
        body = new_body

    if not thumb:
        m = re.search(
            r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"',
            html,
        )
        thumb = m.group(1) if m else ''

    json.dump({'chars': len(body), 'thumb': thumb, 'body': body},
              sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
