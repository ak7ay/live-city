# BookMyShow Events — Scraping Playbook

Requires the **browser-tools** skill for browser automation.

## City

The city slug will be provided (e.g., `bengaluru`, `mumbai`, `hyderabad`).

URL pattern: `https://in.bookmyshow.com/explore/events-{city_slug}`

---

## Step 1: Extract listing

Navigate to the listing page and wait for content:

```bash
browser-nav "https://in.bookmyshow.com/explore/events-{city_slug}"
sleep 2
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
        venue: lines[1],
        category: lines[2],
        price: lines[3] || null,
        date: dateStr,
        url: card.href,
        image: img ? img.src : null
      });
    }
  }
  return JSON.stringify(events, null, 2);
})()'
```

This gives ~15-20 events sorted by BMS popularity. Events without a `date` (null) are further down the ranking — skip them.

---

## Step 2: Enrich top events from detail pages

For each event you want to include, visit its URL and extract the detail fields the frontend needs.

Navigate to the event page:
```bash
browser-nav "{event_url}"
sleep 2
```

Then extract structured data:
```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
  var ai = text.indexOf("About The Event");
  var rm = text.indexOf("Read More", ai > 0 ? ai : 0);
  if (ai >= 0) {
    var sentinels = ["Read More", "Global Event", "Artists", "Terms & Conditions", "You May Also Like"];
    var end = -1;
    for (var s = 0; s < sentinels.length; s++) {
      var si = text.indexOf(sentinels[s], ai + 15);
      if (si > ai && (end < 0 || si < end)) end = si;
    }
    if (end < 0) end = ai + 1000;
    desc = text.slice(ai + 15, end).replace(/\n{3,}/g, "\n\n").trim();
  }
  var info = text.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4})\n(\d{1,2}:\d{2}\s*[AP]M)\n([\d]+\s+\w+)/);
  var venue = text.match(/(?:Hours?|yrs[+ ]*)\n(?:.*\n){0,3}?([^:\n]+:\s*[^\n]+)\n/);
  return JSON.stringify({
    full_date: info ? info[1] : null,
    time: info ? info[2] : null,
    duration: info ? info[3] : null,
    venue_full: venue ? venue[1].trim() : null,
    description: desc.slice(0, 500)
  }, null, 2);
})()'
```

### Parsing venue

The `venue_full` string from both listing and detail is formatted as:
```
Venue Name: City
Venue Name: Area, City
Venue Name, Area: City
```

Split on the LAST `: ` to get:
- **venue_name** — everything before the last `: `
- **venue_area** — everything after

Examples:
- `"NICE Grounds: Bengaluru"` → name: "NICE Grounds", area: "Bengaluru"
- `"MLR Convention Centre: Whitefield, Bengaluru"` → name: "MLR Convention Centre", area: "Whitefield, Bengaluru"

---

## Quirks

- Cloudflare blocks curl/fetch — MUST use browser tools.
- "PROMOTED" events appear first — they're paid placements but real events.
- Date in listing is partial (no year, no time). Detail page has full date + time.
- **Detail page date is authoritative** — BMS listing dates can silently diverge from the detail page (e.g. listing shows Apr 24 but detail shows May 17 for a different city's slot of the same tour). Always prefer the detail page date.
- **Tour/multi-city events** have a date range block like `"Sun 12 Apr 2026 - Sat 30 May 2026"` instead of `date\ntime\nduration` on separate lines. The `info` regex returns `null` for these. Fallback: use the listing date and leave `time`/`duration` as null.
- Some detail pages have `description` empty — use the first paragraph of visible text below the title.
- **Description bleed**: Short descriptions may have no "Read More" sentinel and run into boilerplate sections like "Artists", "Terms & Conditions", or "You May Also Like". The updated extraction code above uses all of these as end sentinels.
- **`venue_full` can be null** on some detail pages (regex misses the block). Fall back to the listing's `venue` field in that case — it is always populated.
- Duration may be missing for multi-day events — leave null.
- Image URLs from the listing contain ImageKit transforms with the date baked in — use as-is.
