# Detail Screens Design — News & Event

**Date:** 2026-04-05  
**Status:** Approved  
**Prototype:** `design/detail-screens.html`

## News Detail Screen

**Entry:** Tap a news card from Home or News tab.

**Layout (top to bottom):**
1. **Top bar** — back button (←) + "News" label. No share button.
2. **Hero image** — optional. Show if article has an image, skip entirely if not. Title moves up when absent.
3. **Category tag** — pill badge (e.g. "Transport", "Civic"). Color varies by category.
4. **Title** — 22px bold, full text (no truncation).
5. **Meta line** — date + dot separator + read time (e.g. "5 Apr 2026 · 3 min read").
6. **Divider** — thin horizontal rule.
7. **Body text** — 15px, 1.75 line height. Drop cap on first paragraph. 2-4 paragraphs typical.
8. **End** — clean end, no related articles or CTAs for now.

**No image variant:** Same layout minus hero. Title is slightly larger (24px) to fill visual space.

## Event Detail Screen

**Entry:** Tap an event card from Home or Events tab.

**Layout (top to bottom):**
1. **Top bar** — back button (←) + "Event" label. No share button.
2. **Hero image** — gradient area with category tag (top-left) and emoji/poster. Always present.
3. **Title** — 22px bold, full event name.
4. **Info rows** — icon + label + subtitle format:
   - 📅 Date — "Saturday, 22 March 2026" / "7:30 PM – 10:00 PM"
   - 📍 Venue — "Phoenix Marketcity" / "Whitefield, Bengaluru"
5. **Divider**
6. **About section** — section title + description paragraph.
7. **Price card** — "Starting from" label + price in gold (e.g. "₹1,499"). Or "Free".
8. **End** — no CTA button (no external booking links for now).

## Design Tokens

Both screens use the existing dark theme system:
- Background: `--bg-app` (#08090C)
- Cards/icons: `--bg-card` (#151820)
- Text hierarchy: `--text-1` through `--text-4`
- Category colors: blue, purple, orange, green (per category)
- Price: `--gold` (#E8B931)

## Future Additions (not in scope now)
- Share button (when public URLs exist)
- Related articles below news body
- "Book Tickets" CTA linking to BookMyShow/Insider
