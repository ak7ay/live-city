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

First navigate to district.in (any page) to set the cookie:

```bash
browser-nav "https://www.district.in/events/"
sleep 2
```

Then set the location cookie with the city config:

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
  document.cookie = "location=" + encodeURIComponent(loc) + ";path=/;domain=.district.in;max-age=31536000";
  return "cookie set for {city_name}";
})()'
```

Then reload the page:

```bash
browser-nav "https://www.district.in/events/"
sleep 3
```

Verify the page shows the correct city in the top-left header (e.g., "Bangalore" instead of "Gurugram").

---

## Step 2: Extract listing

Extract all event cards.

```bash
browser-eval '(function() {
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

For each selected event, navigate to its URL and extract structured data:

```bash
browser-nav "{event_url}"
sleep 2
```

```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
  var ai = text.indexOf("About");
  var rm = text.indexOf("Read more", ai > 0 ? ai : 0);
  if (ai >= 0) {
    var end = rm > ai ? rm : text.indexOf("Things to know", ai);
    if (end < 0) end = ai + 1000;
    desc = text.slice(ai + 5, end).replace(/\n{3,}/g, "\n\n").trim();
  }
  var durMatch = text.match(/Duration\s+([\d]+\s+\w+)/);
  var langMatch = text.match(/Event will be in\s+(.+)/);
  return JSON.stringify({
    description: desc.slice(0, 500),
    duration: durMatch ? durMatch[1] : null,
    language: langMatch ? langMatch[1] : null
  }, null, 2);
})()'
```

### Parsing venue

District.in venue formats:
```
Phoenix Marketcity, Bengaluru
Hard Rock Cafe | St. Marks Road, Bangalore, Bengaluru
Meetup Point: Near Cubbon Metro, Bengaluru
JW Marriott Hotel Bengaluru, Bengaluru
```

Split into venue_name and venue_area:
- If venue contains `|`: split on `|`, left is venue_name, right contains area. **Trim any trailing `, {City}` suffix from the area** — District.in appends the city name again at the end (e.g. `"Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore"` — the trailing `, Bangalore` is redundant).
- Otherwise split on the LAST comma before the city name

Examples:
- `"Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore"` → name: "Hard Rock Cafe", area: "St. Marks Road, Bangalore"
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
| `"Daily, Multiple slots"` | `"Daily"` | `null` |
| `"Every Sun & Sat, 7:00 PM to 10:30 PM"` | `"Every Sat & Sun"` | `"7:00 PM"` |
| `"Fri, 10 Apr – Sun, 19 Apr, 7:00 PM"` | `"Fri, 10 Apr – Sun, 19 Apr 2026"` | `"7:00 PM"` |

Add the current year if not present. The detail page may have a more specific date — prefer it.

---

## Quirks

- Cookie MUST be set before navigation — without it, District.in defaults to Gurugram/Delhi.
- Featured carousel at top may show different events than the main list. The carousel events also match the `buy-tickets` selector — this is fine, include them.
- Some events from other cities leak into the listing (e.g., IPL in Delhi). Filter by venue city.
- District.in has NO explicit category — you must infer it.
- Images use `media.insider.in` CDN.
- Recurring events ("Daily", "Every Sat") appear — these are valid events.
