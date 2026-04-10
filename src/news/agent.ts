import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { captureResponseText, createPlainSession, retryValidation } from "../agent/index.js";
import { logger } from "../config/logger.js";
import { createNewsArticleSchema, createNewsSelectionsSchema, type NewsArticle, type NewsSelection } from "./schema.js";

// ── Constants ────────────────────────────────────────────────────────

const STORY_COUNT = 8;
const SOURCES = ["publictv", "tv9kannada"] as const;

// ── Helpers ──────────────────────────────────────────────────────────

function createWorkspace(city: string, today: string): string {
	const dir = join(homedir(), ".cache", "news", city, today);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Prompt builders ─────────────────────────────────────────────────

function extractionSystemPrompt(city: string, source: string, playbook: string, today: string): string {
	return `\
You are a ${city} news extractor for ${source}.

## Playbook

${playbook}

## Output Format

Write a file called \`stories-${source}.md\` in the current directory with this exact format:

\`\`\`
# ${source} — ${city} Stories (${today})

## 1. [English headline]
- **Category:** [translated category]
- **Summary:** [1-line English summary]
- **URL:** [article URL]
- **ID:** [source-specific ID or "none"]

## 2. [English headline]
...
\`\`\`

Include EVERY story from the listing. Do not skip any.`;
}

function extractionUserPrompt(source: string, city: string, today: string): string {
	return `\
Extract today's news stories from the "${source}" source for ${city}.
Today's date: ${today}

## Steps

1. Use the playbook to fetch the LISTING from the "${source}" source only. Use bash with curl.
2. Translate ALL headlines and summaries to English.
3. Write the output file in the format specified.`;
}

function selectionSystemPrompt(city: string): string {
	return `\
You are a ${city} news editor selecting the top stories.

## Ranking Criteria

- Cross-source stories (appearing in 2+ sources) rank HIGHER than single-source stories
- Among equal source_count, prefer stories with higher public impact/importance
- Use category diversity as a tiebreaker — avoid clustering same-category stories

## Output Format

Your FINAL message must be ONLY a JSON array with exactly ${STORY_COUNT} objects, no markdown fences, no explanation:

[
  {
    "rank": 1,
    "headline_en": "English headline",
    "summary_en": "1-2 sentence English summary",
    "category_en": "English category",
    "sources": [
      { "name": "publictv", "url": "https://...", "source_id": "12345" },
      { "name": "tv9kannada", "url": "https://...", "source_id": null }
    ]
  }
]

- rank: 1 = most important
- sources: array of all sources where this story appeared, with article URL and source-specific ID (null if none)
- For cross-source stories: include ALL source entries`;
}

function selectionUserPrompt(city: string, sourceFiles: string[]): string {
	return `\
Select the top ${STORY_COUNT} news stories for ${city} from multiple sources.

## Source Files
The following files are in the current directory. Read them all first:
${sourceFiles.map((f) => `- ${f}`).join("\n")}

## Steps

1. **Read** all source files listed above using the read tool.
2. **Cross-source match**: Identify stories that appear in multiple sources (same event, even if worded differently). Mark each story's source_count.
3. **Pick the top ${STORY_COUNT}** using the ranking criteria.`;
}

function translationSystemPrompt(city: string, playbook: string): string {
	return `\
You are a ${city} news translator and content extractor.

## Playbook

${playbook}

## Translation Rules

- Headline: concise, newspaper-style
- Summary: 1-2 sentences capturing key facts
- Content: full article body as clean markdown (## for subheadings, paragraphs, no HTML)
- Category: translate the source's category tag

## Output Format

Your FINAL message must be ONLY a JSON object, no markdown fences, no explanation:

{
  "headline": "English headline",
  "summary": "1-2 sentence English summary",
  "content": "Full article body in English markdown",
  "category": "English category",
  "source": "source name(s), comma-separated if multiple",
  "source_count": number,
  "original_url": "primary article URL",
  "thumbnail_url": "thumbnail image URL",
  "rank": number
}`;
}

function translationUserPrompt(city: string, selectionJson: string, sourcesLength: number, rank: number): string {
	return `\
Fetch and translate the following news article for ${city}.

## Selected Story
${selectionJson}

## Steps

1. Fetch the FULL article content from the source(s) listed above.
   - Use the playbook's source-specific instructions for fetching full articles.
   - If multiple sources are listed, fetch from BOTH and pick the richer/more complete version.
2. Extract the thumbnail URL following the playbook's source-specific instructions.
3. Translate the full article content to English following the translation rules.
4. Return the JSON output with source_count: ${sourcesLength} and rank: ${rank}.`;
}

// ── Phase 1: Extract ─────────────────────────────────────────────────

async function runPhase1(source: string, city: string, playbook: string, today: string, cwd: string): Promise<void> {
	const log = logger.child({ module: "news-agent", phase: 1, source });
	const outputFile = `stories-${source}.md`;
	log.info("Starting phase 1 extraction");

	const session = await createPlainSession(cwd, extractionSystemPrompt(city, source, playbook, today));
	try {
		const capture = captureResponseText(session);
		await session.prompt(extractionUserPrompt(source, city, today));
		capture.stop();

		const outputPath = join(cwd, outputFile);
		if (!existsSync(outputPath)) {
			throw new Error(`Phase 1: agent did not write ${outputFile}`);
		}
		const fileSize = readFileSync(outputPath, "utf-8").length;
		if (fileSize < 100) {
			throw new Error(`Phase 1: ${outputFile} is too small (${fileSize} chars) — likely empty or malformed`);
		}
		log.info({ file: outputFile }, "Phase 1 complete for source");
	} finally {
		session.dispose();
	}
}

// ── Phase 2: Select ──────────────────────────────────────────────────

async function runPhase2(city: string, sourceFiles: string[], cwd: string): Promise<NewsSelection[]> {
	const log = logger.child({ module: "news-agent", phase: 2 });
	log.info("Starting phase 2 selection");

	const selectionsSchema = createNewsSelectionsSchema(STORY_COUNT);

	const session = await createPlainSession(cwd, selectionSystemPrompt(city));
	try {
		const capture = captureResponseText(session);
		await session.prompt(selectionUserPrompt(city, sourceFiles));
		capture.stop();

		const selections: NewsSelection[] = await retryValidation(session, capture.getText(), selectionsSchema, log);
		log.info("Phase 2 validation passed");
		return selections;
	} finally {
		session.dispose();
	}
}

// ── Phase 3: Translate ───────────────────────────────────────────────

async function runPhase3(selection: NewsSelection, city: string, playbook: string, cwd: string): Promise<NewsArticle> {
	const log = logger.child({ module: "news-agent", phase: 3, rank: selection.rank });
	log.info({ headline: selection.headline_en }, "Starting phase 3 translation");

	const articleSchema = createNewsArticleSchema(STORY_COUNT);

	const session = await createPlainSession(cwd, translationSystemPrompt(city, playbook));
	try {
		const selectionJson = JSON.stringify(selection, null, 2);
		const capture = captureResponseText(session);
		await session.prompt(translationUserPrompt(city, selectionJson, selection.sources.length, selection.rank));
		capture.stop();

		const article: NewsArticle = await retryValidation(session, capture.getText(), articleSchema, log);
		log.info("Phase 3 validation passed");
		return article;
	} finally {
		session.dispose();
	}
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function fetchNewsViaAgent(city: string): Promise<NewsArticle[]> {
	const log = logger.child({ module: "news-agent", city });

	// 1. Read playbook
	const playbookPath = join("memory", "news", city, "playbook.md");
	const playbook = readFileSync(playbookPath, "utf-8");
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// 2. Create workspace
	const cwd = createWorkspace(city, today);
	log.info({ cwd }, "Using workspace");

	// 3. Phase 1: Extract — sequential per source
	for (const source of SOURCES) {
		await runPhase1(source, city, playbook, today, cwd);
	}
	log.info("Phase 1 complete — all sources extracted");

	// 4. Phase 2: Select — single call
	const sourceFiles = SOURCES.map((s) => `stories-${s}.md`);
	const selections = await runPhase2(city, sourceFiles, cwd);
	log.info({ count: selections.length }, "Phase 2 complete — stories selected");

	// 5. Phase 3: Translate — sequential per article
	const articles: NewsArticle[] = [];
	for (const selection of selections) {
		const article = await runPhase3(selection, city, playbook, cwd);
		articles.push(article);
	}
	log.info({ count: articles.length }, "Phase 3 complete — all articles translated");

	// 6. Return
	return articles;
}
