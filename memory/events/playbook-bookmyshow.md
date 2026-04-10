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

This gives ~15-20 events sorted by BMS popularity. Events without a `date` (null) are further down the ranking. **Do not skip them outright** — their detail pages often have a valid date. Prefer dated events for ranking, but enrich null-date events if needed to fill your top 10 and check the detail page before discarding.

---

## Step 2: Enrich top events from detail pages

For each event you want to include, visit its URL and extract the detail fields the frontend needs.

Navigate to the event page — **run nav and eval as separate commands**, never chained with `&&`. BMS pages are slow; `sleep 2` is not enough:
```bash
browser-nav "{event_url}"
sleep 4
```

Then extract structured data (always include `title` and `url` to verify you're on the right page — stale tab content is a known issue, see Quirks):
```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
  var ai = text.indexOf("About The Event");
  if (ai >= 0) {
    var sentinels = ["Read More", "See More", "Global Event", "Artists", "Terms & Conditions", "You May Also Like"];
    var end = -1;
    for (var s = 0; s < sentinels.length; s++) {
      var si = text.indexOf(sentinels[s], ai + 15);
      if (si > ai && (end < 0 || si < end)) end = si;
    }
    if (end < 0) end = ai + 1000;
    desc = text.slice(ai + 15, end).replace(/\n{3,}/g, "\n\n").trim();
  }
  var info = text.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4})\n(\d{1,2}:\d{2}\s*[AP]M)\n([\d]+\s+\w+)/);
  var rangeMatch = text.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4})\s*-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+\w+\s+\d{4}/);
  var venue = text.match(/(?:Hours?|yrs[+ ]*)\n(?:.*\n){0,3}?([^:\n]+:\s*[^\n]+)\n/);
  return JSON.stringify({
    title: document.querySelector("h1") ? document.querySelector("h1").innerText : null,
    url: window.location.href,
    full_date: info ? info[1] : null,
    range_start: (!info && rangeMatch) ? rangeMatch[1] : null,
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
- **Chrome may have no open page tab** — if `browser-nav` fails with "Cannot read properties of undefined (reading 'goto')", Chrome is running but only has extension background pages. Fix: `curl -X PUT http://localhost:9222/json/new` to open a blank tab, then retry nav.
- **BMS pages are slow to load** — use `sleep 3–4` after `browser-nav`, not `sleep 2`. Pages appear to navigate successfully but JS content is still rendering.
- **Never chain `browser-nav` and `browser-eval` in a single `&&` pipeline** — if nav takes longer than the shell timeout, eval runs on whichever page the browser happens to be on. Always run nav, then sleep, then eval as separate commands. Verify with `document.title` or `window.location.href` if uncertain which page is active.
- **Recurring weekly events: detail page returns null date** — Small venue music events (e.g. weekly cafe jamming sessions) return null for both `full_date` and `range_start` on the detail page. Fall back to the listing date, which reflects the next scheduled occurrence.
- **Recurring/multi-slot events show far-future dates on the detail page** — e.g. a weekly club night listed as "Sun, 12 Apr onwards" may show "Sun 27 Dec 2026" on the detail page (the last scheduled slot). This makes them rank lower by proximity. Use the detail page date as-is per the authoritative rule, but be aware these events may be deprioritised in ranking.
- "PROMOTED" events appear first — they're paid placements but real events.
- Date in listing is partial (no year, no time). Detail page has full date + time.
- **Detail page date is authoritative** — BMS listing dates can silently diverge from the detail page (e.g. listing shows Apr 24 but detail shows May 17 for a different city's slot of the same tour). Always prefer the detail page date. **PROMOTED events are especially prone to this drift** — the promoted listing card may show a stale or wrong date while the detail page has the correct one (observed: listing showed Sat 11 Apr, detail showed Sun 26 Apr for the same event).
- **Tour/multi-city events** have a date range block like `"Sun 12 Apr 2026 - Sat 30 May 2026"` instead of `date\ntime\nduration` on separate lines. The `info` regex returns `null` for these; the detail script now captures `range_start` (the start of the range) as a fallback. Use `range_start` if set, otherwise fall back to the listing date. Leave `time`/`duration` as null.
- **Multi-batch programme events** (e.g. science workshops, skill courses with multiple cohorts) embed their dates as prose inside the description (e.g. `"I Batch: April 28 to May 02, 2026; Time: 10:30am to 12:30 pm"`) rather than in the structured block. The `info` regex returns `null`. Fallback: use the listing date; parse time from the description text if a specific batch time is visible there.
- Some detail pages have `description` empty — use the first paragraph of visible text below the title.
- **Description bleed**: Short descriptions may have no "Read More" sentinel and run into boilerplate sections like "Artists", "Terms & Conditions", or "You May Also Like". The updated extraction code above uses all of these as end sentinels.
- **`venue_full` can be null** on some detail pages (regex misses the block). Fall back to the listing's `venue` field in that case — it is always populated.
- Duration may be missing for multi-day events — leave null.
- Image URLs from the listing contain ImageKit transforms with the date baked in — use as-is.
- **Null-date listing events still have detail-page dates** — the listing image URL encodes the date; if the image is missing (empty `image` field) the date is null in the listing, but the detail page may still have a full date. Always check the detail page.
- **Trailing punctuation in `venue_area`** — venue strings sometimes end with a period (e.g. `"Church Street Social: Bengaluru."`). Strip trailing `.` and whitespace from both `venue_name` and `venue_area` after splitting.
- **`event_date` must be a non-empty string** — if no date is found on either listing or detail page, drop the event and substitute the next candidate rather than emitting an empty or null date.
- **Listing venue may have no colon separator** — e.g. `"Bhartiya Mall Of Bengaluru"` has no `: `. In this case `venue_name` = the full string and `venue_area` = null.
