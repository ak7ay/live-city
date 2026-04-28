# BookMyShow Events — Enrichment Playbook

Requires the **browser-tools** skill for browser automation.

## Image fallback rule

When composing the final event JSON, set `image_url` as follows:

1. If the listing candidate's `image_url` was non-null, use it.
2. Otherwise use `banner_image` from the detail page eval output (see Step 1).
3. Otherwise `null`.

---

## Step 1: Enrich top events from detail pages

For each event you want to include, visit its URL and extract detail fields.

Navigate and extract in a **single chained bash command** — BMS SPA auto-routes to recommended events after ~4–5 seconds. `sleep 1` is sufficient and safer than `sleep 3`.

**CRITICAL: Keep only ONE tab open during all detail visits.** When multiple tabs are open, `browser-eval` runs in an unpredictable tab. Before starting detail visits, close all extras:
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

Always include `title` and `url` in the eval output to verify you landed on the right page. If the URL or title doesn't match, **retry once** with `sleep 1`; on a second redirect, try `sleep 2`. Only skip after two failed attempts. Consecutive retries can redirect to different events — this is normal SPA behavior.

Extract structured data (note: `banner_image` is the `/nmcms/` fallback from the image rule above):
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
    banner_image: Array.from(document.querySelectorAll("img")).map(function(i){return i.src;}).find(function(s){return s && s.indexOf("/nmcms/") >= 0 && s.indexOf("/synopsis/") < 0;}) || null,
    description: desc.slice(0, 500)
  }, null, 2);
})()'
```

---

## Parsing venue

The `venue_full` string is formatted as:
```
Venue Name: City
Venue Name: Area, City
Venue Name, Area: City
```

Split on the LAST `: ` to get:
- **venue_name** — everything before the last `: `
- **venue_area** — everything after

Examples:
- `"NICE Grounds: Bengaluru"` → name: `NICE Grounds`, area: `Bengaluru`
- `"MLR Convention Centre: Whitefield, Bengaluru"` → name: `MLR Convention Centre`, area: `Whitefield, Bengaluru`

Edge cases:
- **Null `venue_full`** — fall back to the listing candidate's `venue_line` (always populated).
- **No colon separator** — `venue_name` = full string, `venue_area` = null.
- **Colon without space** — split on the last bare `:` instead.
- **Trailing period** — strip trailing `.` from both fields after splitting.

---

## Date authority rules

- **Detail page date is authoritative** — listing dates frequently diverge for any recurring event (club nights, DJ nights, workshop series, comedy tours, PROMOTED cards).
- Prefer `full_date`; if null, use `range_start`; if both null and the listing date is a hard date (no "onwards", not null), use the listing date.
- **Recurring weekly events** may return null for both detail-page dates — fall back to the listing date.
- **Multi-batch programme events** embed dates in the description prose (e.g. `"I Batch: April 28 to May 02, 2026"`); fall back to the listing date.
- **`event_date` must be a non-empty string** — if no date resolves, drop the event and substitute the next candidate from the remaining listing pool.
- **Skip out-of-window candidates without visiting the detail** — if the listing shows a hard date (no "onwards") beyond your window, skip the detail visit entirely.

---

## Regex output sanity checks

- **Duration** — `([\d]+\s+\w+)` sometimes matches non-duration text. If `duration` looks implausible (under 30 minutes for a concert or club event), discard it and set to null.
- **Time** — sometimes captures UI clock values. Discard times with implausible non-round minutes (`:02`, `:06`, `:08`, `:09`) for workshop events; set to null.
- **Description bleed** — short descriptions without a "Read More" sentinel may run into boilerplate ("Artists", "Terms & Conditions", "You May Also Like"). The script's sentinel list handles this.

---

## Quirks (enrichment-only)

- **SPA auto-reroute** on detail pages to recommended events after ~4–5 seconds. Chain `nav && sleep 1 && eval`; never run them with `sleep 5+` between.
- **Wrong-page redirects are often timing, not permanent** — retry the same URL once; usually succeeds on the second attempt.
- **External partner redirects** — some events (e.g., Swiftchella) open on `district.in` instead. If `window.location.href` no longer contains `bookmyshow.com`, skip and substitute.

## Tooling fallback

When `browser-eval.js` or `browser-nav.js` times out (puppeteer ↔ Chrome version mismatch), see `memory/events/tooling-fallback.md`.
