# District.in Events — Listing Playbook

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

Navigate to district.in to set the cookie domain context:

```bash
browser-nav "https://www.district.in/events/"
```

Then set the location cookie on **both** domains — `www.district.in` often has a stale Gurugram cookie that overrides `.district.in`:

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

Then navigate to the events page **without `--new`** — opening in a new tab causes immediate redirects to stale detail pages:

```bash
browser-nav "https://www.district.in/events/"
```

**Do not sleep after this navigation.** District.in auto-redirects away from the listing after a few seconds. Chain navigation and extraction in a single `&&` bash command (see Step 2).

Do NOT trust the top-left header alone for city verification; it can stay on Gurugram even when the target city's listing is loaded. Confirm by checking the first extracted venues.

---

## Step 2: Extract listing

**Do not scroll.** Event cards load without scrolling, and any scroll (including `scrollBy`) navigates away to a detail page.

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
        listing_date: lines[0],
        title: lines[1],
        venue_line: lines[2],
        price: lines[3] || null,
        url: a.href,
        image_url: img ? img.src : null
      });
    }
  }
  return JSON.stringify(events, null, 2);
})()'
```

### Filter by city

District.in may include events from OTHER cities (e.g., IPL matches in Delhi even on the Bangalore page). Only keep events whose `venue_line` contains the target city name or nearby areas.

### Dedup

Dedup by `title + listing_date + venue_line`. The featured carousel at the top duplicates main-list events with different URLs.

---

## Quirks (listing-only)

- **Cookie MUST be set before navigation** — without it, District.in defaults to Gurugram/Delhi.
- **No scroll, ever** — `scrollTo`, `scrollBy`, even with pointer events disabled, all redirect to a detail page. Cards render without scroll (20+ load).
- **No `--new`** — opening in a new tab causes an immediate redirect to a stale detail page.
- **Listing page auto-redirects to BookMyShow after a few seconds** — any sleep between `browser-nav` and `browser-eval` triggers this. Chain with `&&`.
- **City-slug URL variants 404** (e.g., `https://www.district.in/bengaluru/events/`) — always use `https://www.district.in/events/` and rely on the cookie.
- **Related events in a series** can appear as separate listings with slightly different titles (e.g. `"Not Just a Bar Takeover"` vs `"… EP 02"`). The title+listing_date+venue_line dedup won't catch these; check for near-identical descriptions and keep the more specifically named variant.
- **Images use `media.insider.in` CDN**. No overlays/transforms — clean URLs.

## Tooling fallback

When `browser-eval.js` or `browser-nav.js` time out (puppeteer ↔ Chrome version mismatch), see `memory/events/tooling-fallback.md`.
