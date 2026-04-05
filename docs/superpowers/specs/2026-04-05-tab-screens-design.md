# Tab Screens Design — Events, News, Prices

**Date:** 2026-04-05
**Status:** Approved
**Prototypes:** `.superpowers/brainstorm/3680-1775406250/content/events-tab-layout.html`, `news-tab-layout.html`, `prices-tab-v2.html`

---

## Events Tab

**Layout:** Vertical list (Option A).

**Structure (top to bottom):**
1. **Top bar** — "Events" title, same style as other tabs.
2. **Filter chips** — horizontally scrollable: All (default), Music, Food, Comedy, Workshop. Active chip uses gold-dim background + gold border/text. "All" is selected by default.
3. **Section labels** — group events by time: "This Week", "Next Week", etc. Uppercase, 10px, `text-3` color, letter-spaced.
4. **Event list cards** — each card is a row:
   - Left: 72×72px gradient thumbnail with emoji (same gradient style as home event cards).
   - Right: category tag pill (9px, uppercase, colored background) → title (13px, semibold) → meta line (11px, `text-3`: "Sat, 22 Mar · 7:30 PM").
   - Card: `bg-card` background, 1px `border`, 14px radius, 12px padding.
5. **Tap action** — opens Event detail screen (already built).

**Data:** Same event data model as home screen. Full list instead of 3-item horizontal scroll.

---

## News Tab

**Layout:** Simple rows (Option A), flat list — no date grouping.

**Structure (top to bottom):**
1. **Top bar** — "News" title.
2. **Filter chips** — horizontally scrollable: All (default), Transport, Civic, Weather, Tech, Traffic. Active chip uses gold-dim background + gold border/text.
3. **News cards** — same card style as home screen news cards:
   - Left: title (14px, semibold) + time ("2h ago", 11px, `text-4`).
   - Right: 52×52px emoji thumbnail with gradient background.
   - Card: `bg-card`, 1px `border`, 12px radius, 12px padding.
4. **No date sections** — flat chronological list of current news only. No "Today" / "Yesterday" grouping.
5. **Tap action** — opens News detail screen (already built).

**Data:** Same news data model as home screen. Full list instead of 3-item preview.

---

## Prices Tab

**Layout:** Chart-first with scrollable category chips (Option C, extensible).

**Structure (top to bottom):**
1. **Top bar** — "Prices" title.
2. **Category chips** — horizontally scrollable, same style as Events/News filter chips but with a colored dot prefix:
   - Launch: Gold (gold accent), Silver (silver accent).
   - Future: Petrol (green accent), Nifty 50 (blue accent), etc.
   - Active chip: colored dim background + colored border + colored text + glowing dot.
   - Inactive chip: `bg-card`, `border`, `text-3`.
3. **Price hero** — centred block:
   - Label: "● Gold 22K" (11px, uppercase, category color).
   - Price: large (38px, bold, `text-1`).
   - Subtitle: "per gram · Bengaluru · 21 Mar" (12px, `text-3`).
   - Change badges: "▲ ₹58 today" and "▲ ₹320 this week" — green/red badges.
4. **Chart card** — `bg-card` with border:
   - Period chips centred: 7D, 1M (default active), 3M, 6M, 1Y. Active chip uses category color.
   - Line chart: ~140px height. Line + gradient fill in category color.
   - X-axis date labels below (9px, `text-4`).
5. **History table** — `bg-card` with border:
   - Header: "Last 7 Days" (11px, uppercase, `text-3`).
   - Rows: date (`text-2`) | price (`text-1`, bold) | change (green ▲ / red ▼).
   - Rows separated by 1px `border`.
6. **Tap on category chip** — switches all content (hero, chart, history) to that category. Chart color and accent color change to match.

**Extensibility:** Adding a new price category means:
- Add a chip to the selector (label + accent color).
- Provide the same data shape: current price, unit, change, chart data points, history rows.
- No layout changes needed.

---

## Shared Design Patterns

All three tabs share:
- **Filter/category chips** — same horizontally scrollable chip component, gold active state (or category-colored for Prices).
- **Top bar** — tab title (18px, bold), no back arrow (tabs, not detail screens).
- **Card styling** — `bg-card`, 1px `border`, 14px radius (or 12px for news cards).
- **Bottom nav** — same as home, with active tab highlighted in gold.
- **Section labels** — uppercase, 10–11px, `text-3`, letter-spaced (used in Events for time groups, Prices for history header).

## Design Tokens

Same dark theme system as home and detail screens:
- Backgrounds: `bg-primary` (#0D0F14), `bg-card` (#151820), `bg-elevated` (#1E222E)
- Text: `text-1` through `text-4`
- Accents: gold, silver, green, red, blue, purple, orange
- Borders: 5% white, 8% white (light)

## Future Additions (not in scope now)
- Search/filter within tabs
- Pull-to-refresh
- Infinite scroll / pagination for News
- Price alerts / notifications
- Petrol, Nifty 50 price categories
