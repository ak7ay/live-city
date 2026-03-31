# 3-Phase News Agent Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-agent news scraping with a 3-phase pipeline (Extract → Select → Translate) for better cross-source matching and translation quality.

**Architecture:** Each phase is a separate agent session with a focused task. Phase 1 extracts headlines per source (writes markdown). Phase 2 selects top 5 from English headlines (returns JSON). Phase 3 translates one full article at a time (returns JSON). Code orchestrates the handoffs.

**Tech Stack:** TypeScript, `@mariozechner/pi-coding-agent` SDK, `@mariozechner/pi-ai`, Zod v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-29-news-3phase-pipeline-design.md`

---

### Task 1: Add Phase 2 selection schema

**Files:**
- Modify: `src/news/schema.ts`
- Modify: `test/news/schema.test.ts`

Phase 2 returns JSON that our code must validate. Add a Zod schema for the selection output.

- [ ] **Step 1: Write failing tests for selection schema**

Add to `test/news/schema.test.ts`:

```typescript
import { newsArticlesSchema, newsSelectionsSchema } from "../../src/news/schema.js";

describe("newsSelectionsSchema", () => {
	const validSelection = {
		rank: 1,
		headline_en: "Test headline",
		summary_en: "Test summary",
		category_en: "Crime",
		sources: [
			{ name: "PublicTV", url: "https://publictv.in/article-1", source_id: "1446930" },
		],
	};

	it("accepts valid array of 5 selections", () => {
		const selections = Array.from({ length: 5 }, (_, i) => ({
			...validSelection,
			rank: i + 1,
		}));
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("accepts selection with multiple sources", () => {
		const selections = Array.from({ length: 5 }, (_, i) => ({
			...validSelection,
			rank: i + 1,
			sources: [
				{ name: "PublicTV", url: "https://publictv.in/article-1", source_id: "1446930" },
				{ name: "TV9 Kannada", url: "https://tv9kannada.com/article-1", source_id: null },
			],
		}));
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("accepts selection with null source_id", () => {
		const selections = Array.from({ length: 5 }, (_, i) => ({
			...validSelection,
			rank: i + 1,
			sources: [{ name: "TV9 Kannada", url: "https://tv9kannada.com/x", source_id: null }],
		}));
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(true);
	});

	it("rejects array with fewer than 5 selections", () => {
		const selections = [validSelection];
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(false);
	});

	it("rejects selection with empty sources array", () => {
		const selections = Array.from({ length: 5 }, (_, i) => ({
			...validSelection,
			rank: i + 1,
			sources: [],
		}));
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(false);
	});

	it("rejects selection with missing headline_en", () => {
		const selections = Array.from({ length: 5 }, (_, i) => ({
			...validSelection,
			rank: i + 1,
			headline_en: "",
		}));
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(false);
	});

	it("rejects rank outside 1-5", () => {
		const selections = Array.from({ length: 5 }, (_, i) => ({
			...validSelection,
			rank: i + 10,
		}));
		const result = newsSelectionsSchema.safeParse(selections);
		expect(result.success).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/news/schema.test.ts`
Expected: FAIL — `newsSelectionsSchema` not exported

- [ ] **Step 3: Implement the selection schema**

Add to `src/news/schema.ts`:

```typescript
const selectionSourceSchema = z.object({
	name: z.string().min(1),
	url: z.url(),
	source_id: z.string().nullable(),
});

const newsSelectionSchema = z.object({
	rank: z.int().min(1).max(5),
	headline_en: z.string().min(1).max(512),
	summary_en: z.string().min(1).max(2048),
	category_en: z.string().min(1).max(64),
	sources: z.array(selectionSourceSchema).min(1),
});

export const newsSelectionsSchema = z.array(newsSelectionSchema).length(5);
export type NewsSelection = z.infer<typeof newsSelectionSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/news/schema.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/news/schema.ts test/news/schema.test.ts
git commit -m "feat: add Zod schema for Phase 2 news selections"
```

---

### Task 2: Add Phase 3 single-article schema

**Files:**
- Modify: `src/news/schema.ts`
- Modify: `test/news/schema.test.ts`

Phase 3 returns a single article (not an array of 5). Add a schema and export for it.

- [ ] **Step 1: Write failing tests for single article schema**

Add to `test/news/schema.test.ts`:

```typescript
import { newsArticleSchema, newsArticlesSchema, newsSelectionsSchema } from "../../src/news/schema.js";

describe("newsArticleSchema (single)", () => {
	const validArticle = {
		headline: "Test headline",
		summary: "Test summary",
		content: "Full article content here",
		category: "Crime",
		source: "PublicTV",
		source_count: 1,
		original_url: "https://example.com/article",
		thumbnail_url: "https://example.com/thumb.jpg",
		rank: 1,
	};

	it("accepts a valid single article", () => {
		const result = newsArticleSchema.safeParse(validArticle);
		expect(result.success).toBe(true);
	});

	it("rejects article with empty content", () => {
		const result = newsArticleSchema.safeParse({ ...validArticle, content: "" });
		expect(result.success).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/news/schema.test.ts`
Expected: FAIL — `newsArticleSchema` not exported

- [ ] **Step 3: Export the single article schema**

In `src/news/schema.ts`, change the `newsArticleSchema` from a local `const` to an exported one:

```typescript
export const newsArticleSchema = z.object({
```

No logic changes — just add the `export` keyword to the existing schema.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/news/schema.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/news/schema.ts test/news/schema.test.ts
git commit -m "feat: export single article schema for Phase 3 validation"
```

---

### Task 3: Rewrite agent.ts with 3-phase pipeline

**Files:**
- Rewrite: `src/news/agent.ts`

This is the core change. Replace the single `fetchNewsViaAgent` function with 3 phase functions and an orchestrator. The public API stays the same: `fetchNewsViaAgent(city)` returns `Promise<NewsArticle[]>`.

- [ ] **Step 1: Write the new agent.ts**

Rewrite `src/news/agent.ts` with this structure:

```typescript
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { logger } from "../config/logger.js";
import { type NewsArticle, type NewsSelection, newsArticleSchema, newsSelectionsSchema } from "./schema.js";

const MAX_VALIDATION_RETRIES = 3;
const MODEL_ID = "claude-sonnet-4-6";
const THINKING_LEVEL = "high";

// --- Shared helpers ---

function getAgentModel() {
	const model = getModel("anthropic", MODEL_ID);
	if (!model) throw new Error(`Model not found: anthropic/${MODEL_ID}`);
	return model;
}

function createWorkspace(label: string): string {
	return mkdtempSync(join(tmpdir(), `news-${label}-`));
}

async function createPhaseSession(cwd: string, systemSuffix: string) {
	const loader = new DefaultResourceLoader({
		cwd,
		skillsOverride: () => ({ skills: [], diagnostics: [] }),
		appendSystemPrompt: systemSuffix,
	});
	await loader.reload();

	const sessionManager = SessionManager.create(cwd);
	const { session } = await createAgentSession({
		model: getAgentModel(),
		thinkingLevel: THINKING_LEVEL,
		resourceLoader: loader,
		sessionManager,
	});
	return session;
}

function captureResponseText(session: ReturnType<typeof createPhaseSession> extends Promise<infer T> ? T : never) {
	let text = "";
	const unsubscribe = session.subscribe((event: any) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			text += event.assistantMessageEvent.delta;
		}
	});
	return {
		getText: () => text,
		stop: () => unsubscribe(),
	};
}

function extractJson(text: string): string | null {
	const arrayMatch = text.match(/\[[\s\S]*\]/);
	if (arrayMatch) return arrayMatch[0];
	const objMatch = text.match(/\{[\s\S]*\}/);
	if (objMatch) return objMatch[0];
	return null;
}

// --- Source list ---

const SOURCES = ["publictv", "tv9kannada"] as const;

// --- Phase 1: Extract ---

function buildPhase1Prompt(playbook: string, source: string, city: string, today: string): string {
	const outputFile = `stories-${source}.md`;
	return `You are extracting news headlines from the ${source} source for ${city}.

## Playbook
${playbook}

## Task
1. Fetch the listing from the ${source} source (see playbook for endpoint and method).
2. Translate EVERY headline and summary/excerpt to English.
3. Write the results to a file called \`${outputFile}\` in your working directory.

## Output format for ${outputFile}

\`\`\`markdown
# ${source} — ${city} Stories (${today})

## 1. [Translated English headline]
- **Category:** [Translated category from source]
- **Summary:** [1-line translated summary]
- **URL:** [article URL]
- **ID:** [source-specific ID, or "none" if not applicable]

## 2. [Next headline]
...
\`\`\`

Include ALL stories from the listing, not just a selection. Translate accurately.
Write the file now.`;
}

async function runPhase1(playbook: string, source: string, city: string, today: string, cwd: string): Promise<string> {
	const log = logger.child({ module: "news-phase1", city, source });
	const outputFile = `stories-${source}.md`;
	log.info({ cwd }, "Phase 1: starting extraction");

	const session = await createPhaseSession(cwd, `You extract ${city} news headlines from ${source}.`);
	const capture = captureResponseText(session);

	try {
		await session.prompt(buildPhase1Prompt(playbook, source, city, today));
		capture.stop();

		const storiesPath = join(cwd, outputFile);
		if (!existsSync(storiesPath)) {
			throw new Error(`Phase 1: agent did not write ${outputFile}`);
		}

		const content = readFileSync(storiesPath, "utf-8");
		log.info({ file: outputFile, chars: content.length }, "Phase 1: file read successfully");
		return content;
	} finally {
		capture.stop();
		session.dispose();
	}
}

// --- Phase 2: Select ---

function buildPhase2Prompt(city: string, today: string, sourceFiles: string[]): string {
	return `You are selecting the top 5 ${city} news stories for ${today}.

## Task
Your working directory contains markdown files — one per news source. Each file lists translated English headlines and summaries scraped from that source.

Files to read: ${sourceFiles.map((f) => `\`${f}\``).join(", ")}

### Steps
1. Read all source files.
2. **Cross-source matching:** Compare all headlines and summaries across sources. Two articles match if they describe the SAME EVENT, even if worded differently. List every match you find.
3. **Pick top 5:** Cross-source stories (appearing on multiple sources) rank higher. Among equal stories, prefer category diversity.

## Output
Your FINAL message must be ONLY a JSON array — no markdown fences, no explanation:

[
  {
    "rank": 1,
    "headline_en": "English headline",
    "summary_en": "1-2 sentence summary",
    "category_en": "Category",
    "sources": [
      { "name": "publictv", "url": "https://...", "source_id": "12345" },
      { "name": "tv9kannada", "url": "https://...", "source_id": null }
    ]
  }
]

- Exactly 5 items, ranked 1-5 (1 = most important)
- sources array: every source that covered this story
- source_id: the ID from the source file, or null if listed as "none"
- For source name, use the exact filename without .md extension

Read the files and select the top 5 now.`;
}

async function runPhase2(
	city: string,
	today: string,
	cwd: string,
	sourceFiles: string[],
): Promise<NewsSelection[]> {
	const log = logger.child({ module: "news-phase2", city });
	log.info({ cwd, sourceFiles }, "Phase 2: starting selection");

	const session = await createPhaseSession(cwd, `You select the top ${city} news stories.`);
	const capture = captureResponseText(session);

	try {
		await session.prompt(buildPhase2Prompt(city, today, sourceFiles));
		capture.stop();

		const rawJson = extractJson(capture.getText());
		if (!rawJson) {
			throw new Error("Phase 2: no JSON array found in response");
		}

		const parsed = newsSelectionsSchema.safeParse(JSON.parse(rawJson));
		if (!parsed.success) {
			throw new Error(`Phase 2: validation failed: ${JSON.stringify(parsed.error.issues)}`);
		}

		log.info("Phase 2: selections validated");
		return parsed.data;
	} finally {
		capture.stop();
		session.dispose();
	}
}

// --- Phase 3: Translate ---

function buildPhase3Prompt(playbook: string, selection: NewsSelection): string {
	const sourcesDesc = selection.sources
		.map((s) => {
			const idPart = s.source_id ? ` (ID: ${s.source_id})` : "";
			return `- **${s.name}**: ${s.url}${idPart}`;
		})
		.join("\n");

	return `You are translating a single news article to English.

## Playbook
${playbook}

## Article to translate
**Rank:** ${selection.rank}
**Headline (preliminary):** ${selection.headline_en}
**Sources:**
${sourcesDesc}

## Task
1. Fetch the full article content from the source(s) listed above using the playbook instructions.
${selection.sources.length > 1 ? "2. You have multiple sources — fetch both, pick the richer content or combine the best parts." : ""}
2. Extract the thumbnail URL following the playbook instructions for the source.
3. Translate everything fresh from the source content — do NOT reuse the preliminary headline above.

## Translation guidelines
- Headline: concise, newspaper-style English
- Summary: 1-2 sentences capturing key facts
- Content: full article body as clean markdown (## for subheadings, paragraphs, no HTML)
- Category: translate the source's category tag to English

## Output
Your FINAL message must be ONLY a JSON object — no markdown fences, no explanation:

{
  "headline": "English headline",
  "summary": "1-2 sentence summary",
  "content": "Full article in English markdown",
  "category": "English category",
  "source": "${selection.sources.map((s) => s.name).join(", ")}",
  "source_count": ${selection.sources.length},
  "original_url": "${selection.sources[0].url}",
  "thumbnail_url": "https://...",
  "rank": ${selection.rank}
}

Fetch the article and translate it now.`;
}

async function runPhase3(playbook: string, selection: NewsSelection): Promise<NewsArticle> {
	const log = logger.child({ module: "news-phase3", rank: selection.rank });
	const cwd = createWorkspace(`phase3-rank${selection.rank}-`);
	log.info({ cwd, headline: selection.headline_en }, "Phase 3: starting translation");

	const session = await createPhaseSession(cwd, "You translate news articles to English.");
	const capture = captureResponseText(session);

	try {
		await session.prompt(buildPhase3Prompt(playbook, selection));
		capture.stop();

		const rawJson = extractJson(capture.getText());
		if (!rawJson) {
			throw new Error(`Phase 3 rank ${selection.rank}: no JSON found in response`);
		}

		let parsed = newsArticleSchema.safeParse(JSON.parse(rawJson));

		if (parsed.success) {
			log.info("Phase 3: validation passed on first attempt");
			return parsed.data;
		}

		// Retry loop
		for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
			const errors = JSON.stringify(parsed.error.issues, null, 2);
			log.info({ attempt, errors }, "Phase 3: validation failed, retrying");

			const retryCap = captureResponseText(session);
			await session.prompt(
				`Your JSON had validation errors:\n${errors}\n\nFix and return only the corrected JSON object. No markdown fences, no explanation.`,
			);
			retryCap.stop();

			const retryJson = extractJson(retryCap.getText());
			if (!retryJson) continue;

			parsed = newsArticleSchema.safeParse(JSON.parse(retryJson));
			if (parsed.success) {
				log.info({ attempt }, "Phase 3: validation passed after retry");
				return parsed.data;
			}
		}

		throw new Error(
			`Phase 3 rank ${selection.rank}: validation failed after ${MAX_VALIDATION_RETRIES} retries`,
		);
	} finally {
		capture.stop();
		session.dispose();
	}
}

// --- Orchestrator (public API unchanged) ---

export async function fetchNewsViaAgent(city: string): Promise<NewsArticle[]> {
	const log = logger.child({ module: "news-agent", city });
	const playbookPath = join("memory", "news", city, "playbook.md");
	const playbook = readFileSync(playbookPath, "utf-8");
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// Shared workspace for Phase 1 + Phase 2
	const pipelineCwd = createWorkspace(`news-${city}-`);

	// Phase 1: Extract headlines from each source
	const sourceFiles: string[] = [];
	for (const source of SOURCES) {
		log.info({ source }, "Phase 1: extracting headlines");
		await runPhase1(playbook, source, city, today, pipelineCwd);
		sourceFiles.push(`stories-${source}.md`);
	}

	// Phase 2: Select top 5
	log.info("Phase 2: selecting top 5 stories");
	const selections = await runPhase2(city, today, pipelineCwd, sourceFiles);

	// Phase 3: Translate each article
	const articles: NewsArticle[] = [];
	for (const selection of selections) {
		log.info({ rank: selection.rank }, "Phase 3: translating article");
		const article = await runPhase3(playbook, selection);
		articles.push(article);
	}

	log.info({ count: articles.length }, "All phases complete");
	return articles;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all existing tests**

Run: `npx vitest run`
Expected: ALL PASS — existing tests mock `fetchNewsViaAgent` so they don't care about internals

- [ ] **Step 4: Commit**

```bash
git add src/news/agent.ts
git commit -m "feat: rewrite agent.ts as 3-phase pipeline (extract → select → translate)"
```

---

### Task 4: Update existing news-updater tests

**Files:**
- Modify: `test/extractor/news-updater.test.ts`

The tests mock `fetchNewsViaAgent` and should still pass unchanged. Verify and confirm.

- [ ] **Step 1: Run news-updater tests**

Run: `npx vitest run test/extractor/news-updater.test.ts`
Expected: ALL PASS (3 tests) — the tests mock the agent module, so the internal rewrite is invisible

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit (if any test fixes were needed)**

If tests passed with no changes, skip this step.

---

### Task 5: E2E smoke test

**Files:**
- Modify: `e2e-news.ts` (test script, not committed)

Run the full pipeline end-to-end to verify articles land in Appwrite.

- [ ] **Step 1: Run the E2E test**

Run: `npx tsx e2e-news.ts`
Expected: Logs show Phase 1 (×2), Phase 2 (×1), Phase 3 (×5) completing. 5 articles stored.

- [ ] **Step 2: Verify results in Appwrite**

Run: `npx tsx e2e-verify.ts`
Expected: 5 articles with English headlines, thumbnails, valid categories. Check for cross-source matches (source_count: 2) if applicable.

- [ ] **Step 3: Check session files**

Check the temp directories for persisted session files:
```bash
find /var/folders -name "*.jsonl" -newer /tmp -path "*news-*" 2>/dev/null | head -20
```

Verify Phase 1 sessions show curl + write, Phase 2 shows read + analysis, Phase 3 shows fetch + translate.

- [ ] **Step 4: Review Phase 1 markdown outputs**

Find the Phase 1 temp dirs and inspect `stories.md` files:
```bash
find /var/folders -name "stories.md" -newer /tmp 2>/dev/null
```

Verify all headlines are translated, IDs present, format matches spec.

- [ ] **Step 5: Commit any prompt tweaks**

If prompts needed adjustment during E2E, commit:
```bash
git add src/news/agent.ts
git commit -m "fix: adjust phase prompts based on E2E results"
```

---

### Task 6: Clean up dead code

**Files:**
- Delete: `e2e-news.ts` (if still tracked in git)
- Delete: `e2e-verify.ts` (if still tracked in git)

- [ ] **Step 1: Check for accidentally tracked test scripts**

```bash
git ls-files e2e-*.ts
```

- [ ] **Step 2: Remove if tracked**

```bash
git rm e2e-news.ts e2e-verify.ts 2>/dev/null
echo "e2e-*.ts" >> .gitignore
git add .gitignore
git commit -m "chore: remove e2e test scripts, add to gitignore"
```

- [ ] **Step 3: Final full test run**

Run: `npx vitest run`
Expected: ALL PASS
