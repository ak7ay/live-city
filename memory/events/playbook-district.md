# District.in Events — Scraping Playbook

Requires the **browser-tools** skill for browser automation.

## City Setup

District.in uses a cookie to determine the city. You must set it before navigating.

### City Config

| city_slug | city_name | lat | long |
|-----------|-----------|-----|------|
| bengaluru | Bangalore | 12.9716 | 77.5946 |
| mumbai | Mumbai | 19.0760 | 72.8777 |
| delhi | Delhi | 28.6139 | 77.2090 |
| hyderabad | Hyderabad | 17.3850 | 78.4867 |
| chennai | Chennai | 13.0827 | 80.2707 |
| pune | Pune | 18.5204 | 73.8567 |
| kolkata | Kolkata | 22.5726 | 88.3639 |

---

## Step 1: Set city cookie and navigate

First navigate to district.in (any page) to set the cookie domain context:

```bash
browser-nav "https://www.district.in/events/"
```

Then set the location cookie on **both** domains — `www.district.in` often has a stale Gurugram cookie that overrides `.district.in` if you only set one:

```bash
browser-eval '(function() {
  var loc = JSON.stringify({
    fullname: "{city_name}, India",
    lat: {lat},
    long: {long},
    subtitle: "India",
    city_name: "{city_name}",
    city_url: "{city_slug}"
  });
  var encoded = encodeURIComponent(loc);
  document.cookie = "location=" + encoded + ";path=/;domain=.district.in;max-age=31536000";
  document.cookie = "location=" + encoded + ";path=/;domain=www.district.in;max-age=31536000";
  return "cookies set for {city_name}";
})()'
```

Then navigate to the events page **without `--new`** — opening in a new tab now causes immediate redirects to stale event detail pages before any interaction:

```bash
browser-nav "https://www.district.in/events/"
```

**Do not sleep after this navigation.** District.in auto-redirects away from the listing page after a few seconds. Chain navigation and extraction in a single `&&` bash command (see Step 2) — any sleep between them will trigger the redirect.

Do **not** trust the top-left header alone for city verification; it can stay on Gurugram even when the target city's listing is loaded. Confirm by checking the first extracted venues.

---

## Step 2: Extract listing

**Do not scroll.** Event cards load in the DOM without scrolling, and any scroll (including `scrollBy`, even with pointer events disabled) consistently navigates away to an event detail page.

Chain nav and extraction in one bash command — no sleep between them:

```bash
browser-nav "https://www.district.in/events/" && browser-eval '(function() {
  var links = document.querySelectorAll("a[href*=\"/events/\"][href*=\"buy-tickets\"]");
  var events = [];
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var img = a.querySelector("img");
    var lines = a.innerText.trim().split("\n").filter(function(l) { return l.trim() && l.trim() !== "Book tickets"; });
    if (lines.length >= 3) {
      events.push({
        datetime: lines[0],
        title: lines[1],
        venue: lines[2],
        price: lines[3] || null,
        url: a.href,
        image: img ? img.src : null
      });
    }
  }
  return JSON.stringify(events, null, 2);
})()'
```

### Important: Filter by city

District.in may include events from OTHER cities (e.g., IPL matches in Delhi even on the Bangalore page). Filter the results — only keep events whose `venue` contains the target city name or nearby areas.

---

## Step 3: Enrich top events from detail pages

For each selected event, navigate to its URL and extract structured data. Do NOT use `--new` — opening detail pages in a new tab increases redirect failures.

```bash
browser-nav "{event_url}"
sleep 4
```

```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
  // "About the Event" skips Highlights bullets that appear on some pages before the prose
  var ai = text.indexOf("About the Event");
  var offset = 15;
  if (ai < 0) { ai = text.indexOf("About"); offset = 5; }
  if (ai >= 0) {
    var rm = text.indexOf("Read more", ai);
    var end = rm > ai ? rm : text.indexOf("Things to know", ai);
    if (end < 0) end = ai + 1000;
    desc = text.slice(ai + offset, end).replace(/\n{3,}/g, "\n\n").trim();
  }
  var durMatch = text.match(/Duration\s+([^\n]+)/);
  var langMatch = text.match(/Event will be in\s+(.+)/);
  return JSON.stringify({
    url: window.location.href,
    description: desc.slice(0, 500),
    duration: durMatch ? durMatch[1] : null,
    language: langMatch ? langMatch[1] : null
  }, null, 2);
})()'
```

Check the returned `url` field against the requested URL to detect redirects (see Quirks).

### Parsing venue

District.in venue formats:
```
Phoenix Marketcity, Bengaluru
Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore
Meetup Point: Near Cubbon Metro, Bengaluru
JW Marriott Hotel Bengaluru, Bengaluru
```

Split into venue_name and venue_area:
- If venue contains `|`: split on `|`, left is venue_name, right contains area. **Trim any trailing `, {City}` suffix from the area** — District.in appends the city name again at the end (e.g. `"Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore"` — the trailing `, Bangalore` is redundant).
- Otherwise split on the LAST comma before the city name

Examples:
- `"Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore"` → name: "Hard Rock Cafe", area: "St. Marks Road, Bangalore"
- `"Skyye | UB City, Bengaluru"` → name: "Skyye", area: "UB City"
- `"Phoenix Marketcity, Bengaluru"` → name: "Phoenix Marketcity", area: "Bengaluru"

### Inferring category

District.in does NOT provide explicit categories. Infer from title and description:
- Music/concert keywords → "Music"
- Comedy/standup/funny → "Comedy"
- Food/feast/dinner/brunch → "Food & Drink"
- Workshop/class/learn → "Workshop"
- Sport/IPL/ISL/match → "Sports"
- Meetup/networking/date → "Social"
- Art/exhibition/gallery → "Arts"
- Default → "Events"

---

## Step 4: Parse datetime

The listing provides `datetime` as a single string. Parse it into event_date and event_time:

| Listing format | event_date | event_time |
|---------------|------------|------------|
| `"Sat, 11 Apr, 6:30 PM"` | `"Sat, 11 Apr 2026"` | `"6:30 PM"` |
| `"Wed, 22 Apr, Multiple slots"` | `"Wed, 22 Apr 2026"` | `null` |
| `"Daily, Multiple slots"` | `"Daily"` | `null` |
| `"Daily, 12:00 PM onwards"` | `"Daily"` | `"12:00 PM"` |
| `"Every Sun & Sat, 7:00 PM to 10:30 PM"` | `"Every Sun & Sat"` | `"7:00 PM"` |
| `"Every Sun, Fri & Sat, Multiple slots"` | `"Every Sun, Fri & Sat"` | `null` |
| `"Fri, 10 Apr – Sun, 19 Apr, 7:00 PM"` | `"Fri, 10 Apr – Sun, 19 Apr 2026"` | `"7:00 PM"` |
| `"Mon, 13 Apr – Mon, 20 Apr, Multiple slots"` | `"Mon, 13 Apr – Mon, 20 Apr 2026"` | `null` |
| `"Sat, 25 Apr onwards, Multiple Dates"` | `"Sat, 25 Apr 2026"` | `null` |

Add the current year if not present. The detail page may have a more specific date — prefer it.

---

## Quirks

- Cookie MUST be set before navigation — without it, District.in defaults to Gurugram/Delhi.
- Featured carousel at top may show different events than the main list. The carousel events also match the `buy-tickets` selector — this is fine, include them, but dedupe by `title + datetime + venue` because the same event can appear twice with different URLs.
- Related events in a series can appear as separate listings with slightly different titles but the same venue, datetime, and near-identical descriptions (e.g. "Not Just a Bar Takeover" and "Not Just a Bar Takeover — EP 02" — both PCO Delhi at Taal Bar, Apr 25). The `title + datetime + venue` dedup won't catch these; check for near-identical descriptions and keep only one (prefer the more specifically named variant).
- Some events from other cities leak into the listing (e.g., IPL in Delhi), and a few cards have stale/mismatched title vs venue data. Filter by venue city and dedupe on `title + datetime + venue`, not title alone.
- District.in has NO explicit category — you must infer it.
- Images use `media.insider.in` CDN.
- Recurring events ("Daily", "Every Sat") appear — these are valid events.
- City-slug URL patterns (e.g. `https://www.district.in/bengaluru/events/`) return a 404 — always use `https://www.district.in/events/` and rely solely on the cookie for city selection.
- Event cards are present in the DOM without scrolling — typically 20+ cards load on page render. Do not scroll.
- **Any scroll navigates away**: `scrollTo`, `scrollBy`, and even scroll with all link pointer-events disabled all redirect to an event detail page. This is not recoverable mid-scroll; just avoid it entirely.
- Opening the events page with `--new` causes an immediate redirect to a stale event detail page before any interaction. Always navigate without `--new` for the listing page.
- **The listing page auto-redirects to a BookMyShow event detail page after a few seconds.** Any `sleep` between `browser-nav` and `browser-eval` will trigger this. Chain them with `&&` (no sleep) as shown in Step 2.
- Detail pages occasionally redirect — either back to the listing or to a completely different event page. Always verify the returned `url` field matches the requested URL slug. The `sleep 4` after `browser-nav` is already sufficient; no extra sleep needed before the eval. If it doesn't match, retry once. If it still redirects, skip and substitute with the next candidate. A non-empty description is NOT a reliable redirect check — the wrong event's description will populate it silently. Redirects tend to be cross-linked between specific events (not just to the listing), so the redirect target's data may still be usable if that event is in your target list.
- Recurring events with old URL slugs (e.g. `jan13-2024`, `aug31-2024`, `may10-2025`) redirect on both attempts consistently — skip them proactively rather than burning retries. Prefer candidate substitutes with recent slugs (current year).
- Venue city suffix duplication may be same-spelling (`"Bangalore, Bangalore"`) or mixed (`"Bangalore, Bengaluru"`) — the trailing-city trim logic in Step 3 handles both.
