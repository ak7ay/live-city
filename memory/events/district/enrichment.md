# District.in Events — Enrichment Playbook

Requires the **browser-tools** skill for browser automation.

## Step 1: Enrich from detail pages

For each selected event, navigate to its URL (do NOT use `--new`) and extract structured data:

```bash
browser-nav "{event_url}"
sleep 4
```

```bash
browser-eval '(function() {
  var text = document.body.innerText;
  var desc = "";
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

Check the returned `url` against the requested URL to detect redirects (see Quirks).

---

## Parsing venue

District.in venue formats:
```
Phoenix Marketcity, Bengaluru
Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore
Meetup Point: Near Cubbon Metro, Bengaluru
```

Split into `venue_name` and `venue_area`:
- If venue contains `|`: split on `|`, left is `venue_name`, right contains area. Trim any trailing `, {City}` suffix from the area — District appends the city again (may be same-spelling `"Bangalore, Bangalore"` or mixed `"Bangalore, Bengaluru"`).
- Otherwise split on the LAST comma before the city name.

Examples:
- `"Hard Rock Cafe | St. Marks Road, Bangalore, Bangalore"` → name: `Hard Rock Cafe`, area: `St. Marks Road, Bangalore`
- `"Skyye | UB City, Bengaluru"` → name: `Skyye`, area: `UB City`
- `"Phoenix Marketcity, Bengaluru"` → name: `Phoenix Marketcity`, area: `Bengaluru`

---

## Inferring category

District.in does NOT provide explicit categories. Infer from title and description:
- Music/concert keywords → `Music`
- Comedy/standup/funny → `Comedy`
- Food/feast/dinner/brunch → `Food & Drink`
- Workshop/class/learn → `Workshop`
- Sport/IPL/ISL/match → `Sports`
- Meetup/networking/date → `Social`
- Art/exhibition/gallery → `Arts`
- Default → `Events`

---

## Parsing datetime

The listing provides `listing_date` as a single string. Parse it into `event_date` and `event_time`:

| Listing format | event_date | event_time |
|---|---|---|
| `"Sat, 11 Apr, 6:30 PM"` | `"Sat, 11 Apr 2026"` | `"6:30 PM"` |
| `"Wed, 22 Apr, Multiple slots"` | `"Wed, 22 Apr 2026"` | `null` |
| `"Daily, Multiple slots"` | `"Daily"` | `null` |
| `"Daily, 12:00 PM onwards"` | `"Daily"` | `"12:00 PM"` |
| `"Every Sun & Sat, 7:00 PM to 10:30 PM"` | `"Every Sun & Sat"` | `"7:00 PM"` |
| `"Fri, 10 Apr – Sun, 19 Apr, 7:00 PM"` | `"Fri, 10 Apr – Sun, 19 Apr 2026"` | `"7:00 PM"` |
| `"Sat, 25 Apr onwards, Multiple Dates"` | `"Sat, 25 Apr 2026"` | `null` |

Add the current year if not present. The detail page may have a more specific date — prefer it when available.

---

## Quirks (enrichment-only)

- **Detail pages occasionally redirect** — verify the returned `url` matches the requested URL slug. The `sleep 4` is already sufficient; no extra sleep before the eval. If it doesn't match, retry once; if it still redirects, skip and substitute. A non-empty description is NOT a reliable redirect check — the wrong event's description populates silently. Redirects tend to be cross-linked between specific events, so the target's data may still be usable if it's in your top list.
- **Recurring events with old URL slugs** (e.g., `jan13-2024`, `aug31-2024`) redirect on both attempts consistently — skip them proactively rather than burning retries. Prefer candidates with current-year slugs.
