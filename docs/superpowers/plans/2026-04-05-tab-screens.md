# Tab Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Events, News, and Prices tab screens for the Live Bengaluru Android app, matching the approved design spec.

**Architecture:** Each tab is a standalone Composable screen. A shared `FilterChipRow` component handles the scrollable category chips used by all three tabs. Events and News tabs reuse existing card components and wire click → detail navigation through callback lambdas already plumbed in `MainActivity`. The Prices tab introduces new components (price hero, chart placeholder, history table). All screens use sample data that will later be replaced by Appwrite queries.

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, existing dark theme system (`Color.kt`, `Theme.kt`)

---

### Task 1: Shared FilterChipRow Component

**Files:**
- Create: `app/src/main/java/com/hanif/city/ui/components/FilterChipRow.kt`

- [ ] **Step 1: Create the FilterChipRow composable**

```kotlin
package com.hanif.city.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.theme.*

@Composable
fun FilterChipRow(
    chips: List<String>,
    selectedIndex: Int,
    onSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
    activeColor: Color = Gold,
    activeBg: Color = GoldDim,
) {
    LazyRow(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        itemsIndexed(chips) { index, label ->
            val isActive = index == selectedIndex
            val shape = RoundedCornerShape(20.dp)
            Text(
                text = label,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (isActive) activeColor else Text3,
                modifier = Modifier
                    .clip(shape)
                    .then(
                        if (isActive) Modifier.background(activeBg).border(1.dp, activeColor, shape)
                        else Modifier.background(BgCard).border(1.dp, Border, shape)
                    )
                    .clickable { onSelected(index) }
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}
```

- [ ] **Step 2: Build and verify compilation**

Run:
```bash
cd /Users/hanif/Desktop/projects/live-city-android
ANDROID_HOME=/Users/hanif/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew compileDebugKotlin
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
cd /Users/hanif/Desktop/projects/live-city-android
git add app/src/main/java/com/hanif/city/ui/components/FilterChipRow.kt
git commit -m "feat: add shared FilterChipRow component"
```

---

### Task 2: Events Tab Screen

**Files:**
- Modify: `app/src/main/java/com/hanif/city/ui/events/EventsScreen.kt` (replace placeholder)
- Modify: `app/src/main/java/com/hanif/city/MainActivity.kt` (wire onEventClick from Events tab)

- [ ] **Step 1: Rewrite EventsScreen with full layout**

Replace the entire contents of `EventsScreen.kt`:

```kotlin
package com.hanif.city.ui.events

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.components.FilterChipRow
import com.hanif.city.ui.theme.*

data class EventListItem(
    val title: String,
    val meta: String,
    val tag: String,
    val tagColor: Color,
    val emoji: String,
    val gradientColors: List<Color>,
    val week: String,       // "This Week" or "Next Week"
)

@Composable
fun EventsScreen(
    modifier: Modifier = Modifier,
    onEventClick: (Int) -> Unit = {},
) {
    val categories = listOf("All", "Music", "Food", "Comedy", "Workshop")
    var selectedChip by remember { mutableIntStateOf(0) }

    val allEvents = sampleEventList()

    // Filter events
    val filteredEvents = if (selectedChip == 0) allEvents
        else allEvents.filter { it.tag.equals(categories[selectedChip], ignoreCase = true) }

    // Group by week
    val grouped = filteredEvents.groupBy { it.week }

    Column(modifier = modifier.fillMaxSize()) {
        // Title
        Text(
            text = "Events",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Text1,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp),
        )

        // Filter chips
        FilterChipRow(
            chips = categories,
            selectedIndex = selectedChip,
            onSelected = { selectedChip = it },
        )

        Spacer(modifier = Modifier.height(10.dp))

        // Event list
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            grouped.forEach { (weekLabel, events) ->
                // Section label
                item(key = "header-$weekLabel") {
                    Text(
                        text = weekLabel.uppercase(),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Text3,
                        letterSpacing = 1.5.sp,
                        modifier = Modifier.padding(top = 6.dp, bottom = 2.dp, start = 2.dp),
                    )
                }
                // Event cards
                itemsIndexed(events, key = { _, e -> e.title }) { _, event ->
                    val globalIndex = allEvents.indexOf(event)
                    EventListCard(
                        event = event,
                        onClick = { onEventClick(globalIndex) },
                    )
                }
            }
            // Bottom spacing
            item { Spacer(modifier = Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun EventListCard(
    event: EventListItem,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, Border, shape)
            .background(BgCard)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Thumbnail
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Brush.linearGradient(event.gradientColors)),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = event.emoji, fontSize = 28.sp)
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            // Tag
            Text(
                text = event.tag.uppercase(),
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                letterSpacing = 0.5.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(5.dp))
                    .background(event.tagColor.copy(alpha = 0.8f))
                    .padding(horizontal = 7.dp, vertical = 2.dp),
            )
            Spacer(modifier = Modifier.height(5.dp))
            // Title
            Text(
                text = event.title,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Text1,
                lineHeight = 18.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            // Meta
            Text(
                text = event.meta,
                fontSize = 11.sp,
                color = Text3,
            )
        }
    }
}

internal fun sampleEventList(): List<EventListItem> = listOf(
    EventListItem("Prateek Kuhad Live at Phoenix", "Sat, 22 Mar · 7:30 PM", "Music", Purple, "🎵",
        listOf(Color(0xFF1a1040), Color(0xFF2d1b69)), "This Week"),
    EventListItem("Street Food Festival 2026", "Sat–Sun, 22–23 Mar · All Day", "Food", Orange, "🍜",
        listOf(Color(0xFF2d1a0a), Color(0xFF4a2a10)), "This Week"),
    EventListItem("Stand-Up with Biswa Kalyan", "Sun, 23 Mar · 8:00 PM", "Comedy", Green, "😂",
        listOf(Color(0xFF0a2d1a), Color(0xFF104a2a)), "This Week"),
    EventListItem("Watercolour Weekend at Rangoli", "Sat, 29 Mar · 10:00 AM", "Workshop", Blue, "🎨",
        listOf(Color(0xFF081220), Color(0xFF1A3050)), "Next Week"),
    EventListItem("Indie Night at The Humming Tree", "Fri, 28 Mar · 9:00 PM", "Music", Purple, "🎸",
        listOf(Color(0xFF1A0820), Color(0xFF4A1A50)), "Next Week"),
)
```

- [ ] **Step 2: Wire EventsScreen navigation in MainActivity**

In `MainActivity.kt`, change the Events route in the `when` block to pass the click callback:

Find:
```kotlin
Screen.Events.route -> EventsScreen(modifier = modifier)
```
Replace with:
```kotlin
Screen.Events.route -> EventsScreen(
    modifier = modifier,
    onEventClick = { index ->
        sampleEventArticles.getOrNull(index)?.let {
            detailScreen = DetailScreen.EventDetail(it)
        }
    },
)
```

- [ ] **Step 3: Build and install**

Run:
```bash
cd /Users/hanif/Desktop/projects/live-city-android
ANDROID_HOME=/Users/hanif/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
```
Expected: BUILD SUCCESSFUL, Installed on 1 device.

- [ ] **Step 4: Visual verification**

```bash
ADB=/Users/hanif/Library/Android/sdk/platform-tools/adb
$ADB shell am force-stop com.hanif.city
$ADB shell am start -n com.hanif.city/.MainActivity
sleep 3
# Tap Events tab (second tab, ~x=270, y=2340 in device coords)
$ADB shell input tap 270 2340
sleep 2
$ADB exec-out screencap -p > /tmp/livecity-events-tab.png
```

Verify: Shows "Events" title, filter chips, "THIS WEEK" section with 3 cards, "NEXT WEEK" section with 2 cards.

- [ ] **Step 5: Commit**

```bash
cd /Users/hanif/Desktop/projects/live-city-android
git add -A
git commit -m "feat: build Events tab with filter chips and grouped list"
```

---

### Task 3: News Tab Screen

**Files:**
- Modify: `app/src/main/java/com/hanif/city/ui/news/NewsScreen.kt` (replace placeholder)
- Modify: `app/src/main/java/com/hanif/city/MainActivity.kt` (wire onNewsClick from News tab)

- [ ] **Step 1: Rewrite NewsScreen with full layout**

Replace the entire contents of `NewsScreen.kt`:

```kotlin
package com.hanif.city.ui.news

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.components.FilterChipRow
import com.hanif.city.ui.home.components.NewsCard
import com.hanif.city.ui.home.components.NewsData
import com.hanif.city.ui.theme.*

data class NewsListItem(
    val data: NewsData,
    val category: String,     // "Transport", "Civic", etc.
)

@Composable
fun NewsScreen(
    modifier: Modifier = Modifier,
    onNewsClick: (Int) -> Unit = {},
) {
    val categories = listOf("All", "Transport", "Civic", "Weather", "Tech", "Traffic")
    var selectedChip by remember { mutableIntStateOf(0) }

    val allNews = sampleNewsList()

    // Filter
    val filteredNews = if (selectedChip == 0) allNews
        else allNews.filter { it.category.equals(categories[selectedChip], ignoreCase = true) }

    Column(modifier = modifier.fillMaxSize()) {
        // Title
        Text(
            text = "News",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Text1,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp),
        )

        // Filter chips
        FilterChipRow(
            chips = categories,
            selectedIndex = selectedChip,
            onSelected = { selectedChip = it },
        )

        Spacer(modifier = Modifier.height(10.dp))

        // News list — flat, no date grouping
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            itemsIndexed(filteredNews, key = { _, n -> n.data.title }) { _, newsItem ->
                val globalIndex = allNews.indexOf(newsItem)
                NewsCard(
                    data = newsItem.data,
                    onClick = { onNewsClick(globalIndex) },
                )
            }
            // Bottom spacing
            item { Spacer(modifier = Modifier.height(8.dp)) }
        }
    }
}

internal fun sampleNewsList(): List<NewsListItem> = listOf(
    NewsListItem(NewsData("Namma Metro Purple Line extension opens next month", "2h ago", "🚇"), "Transport"),
    NewsListItem(NewsData("BBMP announces property tax rebate for early payments", "4h ago", "🏛️"), "Civic"),
    NewsListItem(NewsData("Weekend rain likely across parts of the city", "5h ago", "🌧️"), "Weather"),
    NewsListItem(NewsData("Bengaluru tech park to get new flyover by December", "18h ago", "💻"), "Tech"),
    NewsListItem(NewsData("ORR traffic diversion from Monday for metro work", "22h ago", "🚗"), "Traffic"),
)
```

- [ ] **Step 2: Wire NewsScreen navigation in MainActivity**

In `MainActivity.kt`, change the News route in the `when` block:

Find:
```kotlin
Screen.News.route -> NewsScreen(modifier = modifier)
```
Replace with:
```kotlin
Screen.News.route -> NewsScreen(
    modifier = modifier,
    onNewsClick = { index ->
        sampleNewsArticles.getOrNull(index)?.let {
            detailScreen = DetailScreen.NewsDetail(it)
        }
    },
)
```

- [ ] **Step 3: Build and install**

Run:
```bash
cd /Users/hanif/Desktop/projects/live-city-android
ANDROID_HOME=/Users/hanif/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
```
Expected: BUILD SUCCESSFUL, Installed on 1 device.

- [ ] **Step 4: Visual verification**

```bash
ADB=/Users/hanif/Library/Android/sdk/platform-tools/adb
$ADB shell am force-stop com.hanif.city
$ADB shell am start -n com.hanif.city/.MainActivity
sleep 3
# Tap News tab (third tab, ~x=540, y=2340)
$ADB shell input tap 540 2340
sleep 2
$ADB exec-out screencap -p > /tmp/livecity-news-tab.png
```

Verify: "News" title, filter chips (All active), flat list of 5 news cards with emoji thumbnails.

- [ ] **Step 5: Commit**

```bash
cd /Users/hanif/Desktop/projects/live-city-android
git add -A
git commit -m "feat: build News tab with filter chips and flat news list"
```

---

### Task 4: Prices Tab Screen

**Files:**
- Modify: `app/src/main/java/com/hanif/city/ui/prices/PricesScreen.kt` (replace placeholder)
- Create: `app/src/main/java/com/hanif/city/ui/prices/components/PriceHero.kt`
- Create: `app/src/main/java/com/hanif/city/ui/prices/components/PriceChart.kt`
- Create: `app/src/main/java/com/hanif/city/ui/prices/components/PriceHistory.kt`
- Create: `app/src/main/java/com/hanif/city/ui/prices/components/CategoryChipRow.kt`

- [ ] **Step 1: Create CategoryChipRow (Prices-specific chip with colored dot)**

```kotlin
package com.hanif.city.ui.prices.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.theme.*

data class PriceCategory(
    val label: String,
    val accentColor: Color,
    val accentDim: Color,
)

@Composable
fun CategoryChipRow(
    categories: List<PriceCategory>,
    selectedIndex: Int,
    onSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        itemsIndexed(categories) { index, cat ->
            val isActive = index == selectedIndex
            val shape = RoundedCornerShape(20.dp)
            Row(
                modifier = Modifier
                    .clip(shape)
                    .then(
                        if (isActive) Modifier.background(cat.accentDim).border(1.dp, cat.accentColor, shape)
                        else Modifier.background(BgCard).border(1.dp, Border, shape)
                    )
                    .clickable { onSelected(index) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(if (isActive) cat.accentColor else cat.accentColor.copy(alpha = 0.4f)),
                )
                Text(
                    text = cat.label,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (isActive) cat.accentColor else Text3,
                )
            }
        }
    }
}
```

- [ ] **Step 2: Create PriceHero composable**

```kotlin
package com.hanif.city.ui.prices.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.theme.*

data class PriceHeroData(
    val label: String,          // "● Gold 22K"
    val price: String,          // "₹8,105"
    val subtitle: String,       // "per gram · Bengaluru · 21 Mar"
    val changeToday: String,    // "▲ ₹58 today"
    val changeTodayUp: Boolean,
    val changeWeek: String,     // "▲ ₹320 this week"
    val changeWeekUp: Boolean,
    val accentColor: Color,
)

@Composable
fun PriceHero(
    data: PriceHeroData,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = data.label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = data.accentColor,
            letterSpacing = 0.8.sp,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = data.price,
            fontSize = 38.sp,
            fontWeight = FontWeight.Bold,
            color = Text1,
            letterSpacing = (-1.5).sp,
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = data.subtitle,
            fontSize = 12.sp,
            color = Text3,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ChangeBadge(data.changeToday, data.changeTodayUp)
            ChangeBadge(data.changeWeek, data.changeWeekUp)
        }
    }
}

@Composable
private fun ChangeBadge(text: String, isUp: Boolean) {
    val color = if (isUp) Green else Red
    val bg = if (isUp) GreenDim else RedDim
    Text(
        text = text,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = color,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}
```

- [ ] **Step 3: Create PriceChart composable (Canvas-drawn line chart)**

```kotlin
package com.hanif.city.ui.prices.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.theme.*

data class ChartData(
    val points: List<Float>,      // normalized 0..1 values
    val xLabels: List<String>,    // e.g. ["21 Feb", "1 Mar", "11 Mar", "21 Mar"]
)

@Composable
fun PriceChart(
    data: ChartData,
    accentColor: Color,
    modifier: Modifier = Modifier,
) {
    val periods = listOf("7D", "1M", "3M", "6M", "1Y")
    var selectedPeriod by remember { mutableIntStateOf(1) } // default 1M

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, Border, RoundedCornerShape(14.dp))
            .background(BgCard)
            .padding(14.dp),
    ) {
        // Period chips — centred
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
        ) {
            periods.forEachIndexed { index, label ->
                val isActive = index == selectedPeriod
                Text(
                    text = label,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (isActive) accentColor else Text4,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .then(
                            if (isActive) Modifier.background(accentColor.copy(alpha = 0.10f))
                            else Modifier
                        )
                        .clickable { selectedPeriod = index }
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Chart canvas
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(140.dp),
        ) {
            val w = size.width
            val h = size.height
            val points = data.points
            if (points.size < 2) return@Canvas

            val path = Path()
            val fillPath = Path()

            points.forEachIndexed { i, value ->
                val x = w * i / (points.size - 1)
                val y = h * (1f - value)  // invert: 1.0 = top
                if (i == 0) {
                    path.moveTo(x, y)
                    fillPath.moveTo(x, y)
                } else {
                    path.lineTo(x, y)
                    fillPath.lineTo(x, y)
                }
            }

            // Fill gradient
            fillPath.lineTo(w, h)
            fillPath.lineTo(0f, h)
            fillPath.close()
            drawPath(
                path = fillPath,
                brush = Brush.verticalGradient(
                    colors = listOf(accentColor.copy(alpha = 0.25f), accentColor.copy(alpha = 0f)),
                ),
            )

            // Line
            drawPath(
                path = path,
                color = accentColor,
                style = Stroke(width = 4f),
            )

            // End dot
            val lastX = w
            val lastY = h * (1f - points.last())
            drawCircle(accentColor, radius = 8f, center = Offset(lastX, lastY))
        }

        Spacer(modifier = Modifier.height(8.dp))

        // X labels
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            data.xLabels.forEach { label ->
                Text(text = label, fontSize = 9.sp, color = Text4)
            }
        }
    }
}
```

- [ ] **Step 4: Create PriceHistory composable**

```kotlin
package com.hanif.city.ui.prices.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.theme.*

data class HistoryRow(
    val date: String,
    val price: String,
    val change: String,
    val isUp: Boolean,
)

@Composable
fun PriceHistory(
    rows: List<HistoryRow>,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(shape)
            .border(1.dp, Border, shape)
            .background(BgCard),
    ) {
        // Header
        Text(
            text = "LAST 7 DAYS",
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = Text3,
            letterSpacing = 1.sp,
            modifier = Modifier.padding(start = 14.dp, top = 12.dp, bottom = 8.dp),
        )

        rows.forEach { row ->
            HorizontalDivider(color = Border, thickness = 1.dp)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 9.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = row.date, fontSize = 12.sp, color = Text2)
                Text(text = row.price, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Text1)
                Text(
                    text = row.change,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (row.isUp) Green else Red,
                )
            }
        }
    }
}
```

- [ ] **Step 5: Build PricesScreen assembling all components**

Replace the entire contents of `PricesScreen.kt`:

```kotlin
package com.hanif.city.ui.prices

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hanif.city.ui.prices.components.*
import com.hanif.city.ui.theme.*

@Composable
fun PricesScreen(modifier: Modifier = Modifier) {
    val categories = listOf(
        PriceCategory("Gold", Gold, GoldDim),
        PriceCategory("Silver", Silver, SilverDim),
    )
    var selectedCategory by remember { mutableIntStateOf(0) }

    val priceData = samplePriceData()
    val current = priceData[selectedCategory]

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        // Title
        Text(
            text = "Prices",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Text1,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp),
        )

        // Category chips
        CategoryChipRow(
            categories = categories,
            selectedIndex = selectedCategory,
            onSelected = { selectedCategory = it },
        )

        Spacer(modifier = Modifier.height(4.dp))

        // Price hero
        PriceHero(data = current.hero)

        // Chart
        PriceChart(
            data = current.chart,
            accentColor = categories[selectedCategory].accentColor,
        )

        Spacer(modifier = Modifier.height(14.dp))

        // History
        PriceHistory(rows = current.history)

        Spacer(modifier = Modifier.height(24.dp))
    }
}

private data class PriceCategoryData(
    val hero: PriceHeroData,
    val chart: ChartData,
    val history: List<HistoryRow>,
)

private fun samplePriceData(): List<PriceCategoryData> = listOf(
    // Gold
    PriceCategoryData(
        hero = PriceHeroData(
            label = "● Gold 22K",
            price = "₹8,105",
            subtitle = "per gram · Bengaluru · 21 Mar",
            changeToday = "▲ ₹58 today",
            changeTodayUp = true,
            changeWeek = "▲ ₹320 this week",
            changeWeekUp = true,
            accentColor = Gold,
        ),
        chart = ChartData(
            points = listOf(0.10f, 0.15f, 0.20f, 0.17f, 0.35f, 0.45f, 0.40f, 0.55f, 0.70f, 0.75f, 0.82f, 0.90f, 0.95f),
            xLabels = listOf("21 Feb", "1 Mar", "11 Mar", "21 Mar"),
        ),
        history = listOf(
            HistoryRow("21 Mar", "₹8,105", "▲ ₹58", true),
            HistoryRow("20 Mar", "₹8,047", "▼ ₹12", false),
            HistoryRow("19 Mar", "₹8,059", "▲ ₹95", true),
            HistoryRow("18 Mar", "₹7,964", "▲ ₹22", true),
            HistoryRow("17 Mar", "₹7,942", "▼ ₹35", false),
        ),
    ),
    // Silver
    PriceCategoryData(
        hero = PriceHeroData(
            label = "● Silver",
            price = "₹99.50",
            subtitle = "per gram · Bengaluru · 21 Mar",
            changeToday = "▼ ₹1.20 today",
            changeTodayUp = false,
            changeWeek = "▼ ₹3.80 this week",
            changeWeekUp = false,
            accentColor = Silver,
        ),
        chart = ChartData(
            points = listOf(0.80f, 0.75f, 0.70f, 0.78f, 0.60f, 0.50f, 0.55f, 0.45f, 0.38f, 0.35f, 0.30f, 0.25f, 0.22f),
            xLabels = listOf("21 Feb", "1 Mar", "11 Mar", "21 Mar"),
        ),
        history = listOf(
            HistoryRow("21 Mar", "₹99.50", "▼ ₹1.20", false),
            HistoryRow("20 Mar", "₹100.70", "▲ ₹0.30", true),
            HistoryRow("19 Mar", "₹100.40", "▼ ₹0.80", false),
            HistoryRow("18 Mar", "₹101.20", "▼ ₹0.50", false),
            HistoryRow("17 Mar", "₹101.70", "▲ ₹0.90", true),
        ),
    ),
)
```

- [ ] **Step 6: Build and install**

Run:
```bash
cd /Users/hanif/Desktop/projects/live-city-android
ANDROID_HOME=/Users/hanif/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
```
Expected: BUILD SUCCESSFUL, Installed on 1 device.

- [ ] **Step 7: Visual verification**

```bash
ADB=/Users/hanif/Library/Android/sdk/platform-tools/adb
$ADB shell am force-stop com.hanif.city
$ADB shell am start -n com.hanif.city/.MainActivity
sleep 3
# Tap Prices tab (fourth tab, ~x=810, y=2340)
$ADB shell input tap 810 2340
sleep 2
$ADB exec-out screencap -p > /tmp/livecity-prices-tab.png
```

Verify: "Prices" title, Gold/Silver chips with gold active, centred price hero (₹8,105), line chart with gradient fill, period chips (7D/1M/3M/6M/1Y), history table with 5 rows.

- [ ] **Step 8: Commit**

```bash
cd /Users/hanif/Desktop/projects/live-city-android
git add -A
git commit -m "feat: build Prices tab with chart, hero, and history"
```

---

### Task 5: Wire Home Screen "See all" and "More" Links

**Files:**
- Modify: `app/src/main/java/com/hanif/city/ui/home/HomeScreen.kt`
- Modify: `app/src/main/java/com/hanif/city/MainActivity.kt`

- [ ] **Step 1: Add tab navigation callback to HomeScreen**

In `HomeScreen.kt`, add an `onNavigateTab` parameter and wire it to the section headers:

Change the function signature:
```kotlin
@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    onNewsClick: (Int) -> Unit = {},
    onEventClick: (Int) -> Unit = {},
    onNavigateTab: (String) -> Unit = {},
)
```

Change the Events section header:
```kotlin
SectionHeader(title = "Events", action = "See all →", onAction = { onNavigateTab("events") })
```

Change the News section header:
```kotlin
SectionHeader(title = "News", action = "More →", onAction = { onNavigateTab("news") })
```

- [ ] **Step 2: Wire onNavigateTab in MainActivity**

In the Home route in `MainActivity.kt`, add the callback:

Find:
```kotlin
Screen.Home.route -> HomeScreen(
    modifier = modifier,
    onNewsClick = { index ->
```
Replace with:
```kotlin
Screen.Home.route -> HomeScreen(
    modifier = modifier,
    onNavigateTab = { route -> currentRoute = route },
    onNewsClick = { index ->
```

- [ ] **Step 3: Build and install**

Run:
```bash
cd /Users/hanif/Desktop/projects/live-city-android
ANDROID_HOME=/Users/hanif/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
cd /Users/hanif/Desktop/projects/live-city-android
git add -A
git commit -m "feat: wire home See All / More links to tab navigation"
```
