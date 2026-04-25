# BookMyShow Events — Listing Playbook

Requires the **browser-tools** skill for browser automation.

## City

The city slug will be provided (e.g., `bengaluru`, `mumbai`, `hyderabad`).

URL pattern: `https://in.bookmyshow.com/explore/events-{city_slug}`

For this-week-only runs, append the daygroup filter:
`https://in.bookmyshow.com/explore/events-{city_slug}?daygroups=today|tomorrow|this-weekend`

The page heading becomes "Events happening This Weekend" and the card set narrows to dates in that window.

---

## Step 1: Extract listing

Navigate to the listing page and wait for content:

```bash
browser-nav "https://in.bookmyshow.com/explore/events-{city_slug}?daygroups=today|tomorrow|this-weekend"
sleep 4
```

Extract all visible event cards in a single call:

```bash
browser-eval '(function() {
  var cards = document.querySelectorAll("a[href*=\"/events/\"][href*=\"/ET\"]");
  var events = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var img = card.querySelector("img");
    var lines = card.innerText.trim().split("\n").filter(function(l) { return l.trim(); });
    var dateStr = null;
    if (img && img.src) {
      var m = img.src.match(/ie-([A-Za-z0-9+/=_%]+)/);
      if (m) {
        try { dateStr = atob(decodeURIComponent(m[1])); } catch(e) {}
      }
    }
    if (lines.length >= 3) {
      events.push({
        title: lines[0],
        venue_line: lines[1],
        category: lines[2],
        price: lines[3] || null,
        date: dateStr,
        url: card.href,
        image_url: img && img.src ? img.src : null
      });
    }
  }
  return JSON.stringify(events, null, 2);
})()'
```

**Then scroll to the bottom and re-extract** — scroll can trigger lazy-loading of additional cards. Deduplicate by URL before returning:

```bash
browser-eval 'window.scrollTo(0, document.body.scrollHeight)'
sleep 3
# run the same browser-eval extraction script again
```

Note: scroll does not reliably produce a different set of events. In some runs the second extraction is identical to the first — that's fine, just deduplicate by URL. The listing order can also change between extractions.

**If the scroll re-extract returns `[]`**, the BMS SPA has auto-routed the listing page away. Don't retry the scroll — just proceed with the first extraction.

---

## Quirks (listing-only)

- **Cloudflare blocks curl/fetch** — MUST use browser tools for listing navigation.
- **PROMOTED events appear first** — paid placements but real events. Include them.
- **Listing date is partial** — no year, no time. Use the `ie-` ImageKit decode path as shown; null is acceptable.
- **Many cards render with empty `<img src>`** — a lazy-load placeholder pattern (opacity:0, no data-src, no srcset). Forcing viewport via `scrollIntoView` does not reliably trigger src population. Return `image_url: null` for those — enrichment.md will recover the image from the detail page `/nmcms/` banner.
- **"X Apr onwards"** in the listing date means a recurring/multi-slot event. Keep the listing as-is; the detail page (in enrichment.md) resolves the next available date.
- **Image URLs (when present) contain ImageKit transforms** with the date baked in via `ie-` base64. Use as-is.

## Tooling fallback

When `browser-eval.js` times out (e.g., Chrome/puppeteer version mismatch), see `memory/events/tooling-fallback.md` for the Python CDP-WebSocket alternative.
