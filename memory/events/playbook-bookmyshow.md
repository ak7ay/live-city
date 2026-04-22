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

**Then scroll to the bottom and re-extract** — scroll can trigger lazy-loading of additional cards. Deduplicate by URL before selecting top 10:

```bash
browser-eval 'window.scrollTo(0, document.body.scrollHeight)'
sleep 3
# run the same browser-eval extraction script again
```

Note: scroll does not reliably produce a different set of events. In some runs the second extraction is identical to the first — that's fine, just deduplicate and proceed. The listing order can also change between extractions, and individual events may appear or disappear (the listing is dynamic). Always union both extractions by URL before selecting candidates.

Events without a `date` (null) are further down the ranking. **Do not skip them outright** — their detail pages often have a valid date. Prefer dated events for ranking, but enrich null-date events if needed to fill your top 10 and check the detail page before discarding.

---

## Step 2: Enrich top events from detail pages

For each event you want to include, visit its URL and extract the detail fields the frontend needs.

Navigate to the event page and extract in a **single chained bash command** — BMS SPA auto-routes to recommended events after ~4–5 seconds. **`sleep 1` is sufficient and safer than `sleep 3`** — longer sleeps increase the chance of re-routing on some pages.

**CRITICAL: Keep only ONE tab open during all detail visits.** When multiple tabs are open, `browser-eval` runs in an unpredictable tab (not the one just navigated), producing wrong data. Before starting detail visits, close all extras:
```bash
curl -s http://localhost:9222/json | python3 -c "
import json,sys,urllib.request
tabs=[t for t in json.load(sys.stdin) if t.get('type')=='page']
[urllib.request.urlopen(f'http://localhost:9222/json/close/{t[\"id\"]}') for t in tabs[1:]]
print('Kept:', tabs[0]['id'])
"
```

Then for each detail page (single tab only):
```bash
browser-nav "{event_url}" && sleep 1 && browser-eval '...'
```

Always include `title` and `url` in the eval output to verify you landed on the right page. If the URL or title doesn't match, **retry** — SPA timing issues are common. On the first retry, keep `sleep 1`. If it redirects again (possibly to a *different* wrong event), try `sleep 2` on the next attempt. Only skip after two failed attempts. Note: consecutive retries can redirect to different events each time — this is normal SPA behavior, not a broken URL.

Extract structured data:
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
- **BMS SPA auto-routes detail pages** — After loading an event detail page, BMS navigates to recommended events after ~4–5 seconds. Chain `nav && sleep 1 && eval` as shown in Step 2. Never run nav and eval as separate commands with sleep 5+. The re-routing is per-tab, but only matters if you have a single tab open (see the tab-cleanup step above).
- **Wrong-page redirects are often timing, not permanent** — When `nav && sleep 1 && eval` returns a different event's page, it's usually the SPA routing before the eval ran, not a stale/sold-out URL. Retry the same URL once — it almost always succeeds on the second attempt. Only skip after two failures.
- **"X Apr onwards" listing date ≠ next available slot** — Events with "onwards" in the listing date may show a much later `full_date` on the detail page (e.g. listing "Sat, 11 Apr onwards" → detail `full_date: "Sat 25 Apr 2026"`). This is a single session booked for that later date. Detail page is authoritative; if it falls outside your window, skip the event. Only use the listing date as fallback when the detail page returns `null` for both `full_date` and `range_start`.
- **Recurring weekly events: detail page returns null date** — Small venue events (comedy club nights, weekly jamming sessions, etc.) sometimes return null for both `full_date` and `range_start` on the detail page. Fall back to the listing date, which reflects the next scheduled occurrence.
- **Recurring/multi-slot events show far-future dates on the detail page** — e.g. a weekly club night listed as "Sun, 12 Apr onwards" may show "Sun 27 Dec 2026" on the detail page (the last scheduled slot). This makes them rank lower by proximity. Use the detail page date as-is per the authoritative rule, but be aware these events may be deprioritised in ranking.
- "PROMOTED" events appear first — they're paid placements but real events.
- Date in listing is partial (no year, no time). Detail page has full date + time.
- **Detail page date is authoritative** — listing dates frequently diverge from the detail page for any recurring event (club nights, DJ nights, workshop series, comedy tours, PROMOTED cards). A listing date reflects the next slot for any city; the Bengaluru detail page may be weeks later. Always prefer the detail page date.
- **Skip detail visits for clearly out-of-window listing dates** — if the listing shows a hard date (no "onwards", not null) that is beyond your cutoff, skip the detail visit entirely. Only visit detail pages for in-window dates, "onwards" events, and null-date events.
- **Events with date range blocks** (tours, workshop series, recurring multi-slot events) show `"Sun 12 Apr 2026 - Sat 30 May 2026"` instead of `date\ntime\nduration` on separate lines. The `info` regex returns `null` for these; the detail script captures `range_start` (start of the range) as a fallback. Use `range_start` if set, otherwise fall back to the listing date. Leave `time`/`duration` as null. This is very common for comedy tours and multi-show runs, as well as Arts & Crafts workshops.
- **Multi-batch programme events** (e.g. science workshops, skill courses with multiple cohorts) embed their dates as prose inside the description (e.g. `"I Batch: April 28 to May 02, 2026; Time: 10:30am to 12:30 pm"`) rather than in the structured block. The `info` regex returns `null`. Fallback: use the listing date; parse time from the description text if a specific batch time is visible there.
- Some detail pages have `description` empty — use the first paragraph of visible text below the title.
- **Description bleed**: Short descriptions may have no "Read More" sentinel and run into boilerplate sections like "Artists", "Terms & Conditions", or "You May Also Like". The updated extraction code above uses all of these as end sentinels.
- **`venue_full` can be null** on some detail pages (regex misses the block). Fall back to the listing's `venue` field in that case — it is always populated.
- Duration may be missing for multi-day events — leave null.
- **Duration regex can return garbage** — The `([\d]+\s+\w+)` capture group sometimes matches non-duration text that happens to follow the time line (e.g. "12 Minutes" for a 2-hour live concert). If `duration` looks implausible (under 30 minutes for a concert or club event), discard it and set to null.
- **Time regex can return garbage** — The `time` field sometimes captures UI clock values rather than event times, producing results like "2:09 PM" or "3:02 PM" for arts & crafts workshops. Discard time values with implausible non-round minutes (e.g., :02, :06, :08, :09) for workshop events and set to null.
- Image URLs from the listing contain ImageKit transforms with the date baked in — use as-is.
- **Null-date listing events still have detail-page dates** — the listing image URL encodes the date; if the image is missing (empty `image` field) the date is null in the listing, but the detail page may still have a full date. Always check the detail page.
- **Trailing punctuation in `venue_area`** — venue strings sometimes end with a period (e.g. `"Church Street Social: Bengaluru."`). Strip trailing `.` and whitespace from both `venue_name` and `venue_area` after splitting.
- **`event_date` must be a non-empty string** — if no date is found on either listing or detail page, drop the event and substitute the next candidate rather than emitting an empty or null date.
- **Listing venue may have no colon separator** — e.g. `"Bhartiya Mall Of Bengaluru"` has no `: `. In this case `venue_name` = the full string and `venue_area` = null.
- **Venue colon without space** — some venues use `:` with no trailing space (e.g. `"Art Of Living Yoga And Meditation Center:Bengaluru"`). The LAST `: ` split won't match; fall back to splitting on the last bare `:` instead.
- **BMS event URL may redirect to an external partner site** — some events (e.g. Swiftchella) open on `district.in` or another external domain instead of BMS. Detect via `window.location.href` not containing `bookmyshow.com` after nav. Treat the event as unusable and skip it.
