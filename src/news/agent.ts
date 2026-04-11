import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { captureResponseText, createPlainSession, retryValidation } from "../agent/index.js";
import { logger } from "../config/logger.js";
import { createNewsArticleSchema, createNewsSelectionsSchema, type NewsArticle, type NewsSelection } from "./schema.js";

// ── Constants ────────────────────────────────────────────────────────

const STORY_COUNT = 8;

interface NewsSourceDef {
	key: string;
	playbookFile: string;
}

const NEWS_SOURCES: NewsSourceDef[] = [
	{ key: "publictv", playbookFile: "playbook-publictv.md" },
	{ key: "tv9kannada", playbookFile: "playbook-tv9kannada.md" },
];

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

async function runPhase1(
	source: string,
	city: string,
	playbook: string,
	playbookPath: string,
	today: string,
	cwd: string,
): Promise<void> {
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

		// ── Playbook feedback ──
		log.info("Requesting phase 1 playbook feedback");
		const feedbackCapture = captureResponseText(session);
		await session.prompt(`Review your session. If you encountered issues with the playbook while extracting the listing, edit the file directly:

- Broken endpoint (API/URL returned errors, wrong data, or no data)
- Changed response structure (fields, categories, date formats)
- Content quirks not documented (noise, strip patterns, encoding issues)
- Better listing extraction approach discovered

Only note things you directly observed in this run. Keep the playbook concise — don't let it grow unboundedly.

File: ${playbookPath}

If everything worked, say "No playbook changes needed."`);
		feedbackCapture.stop();
		log.info("Phase 1 feedback complete");
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

/**
 * Phase 3: translate a single selected story.
 *
 * - `playbook` is already built by the orchestrator — for single-source stories
 *   it's that source's file verbatim; for cross-source stories it's both files
 *   concatenated with `---`. The per-source h1 in each file provides source
 *   attribution, so the agent can tell which rules apply to which URL without
 *   needing an extra label.
 * - `feedbackPath` is non-null only when this session qualifies as the first
 *   single-source occurrence of its source in this run (tracked by the
 *   orchestrator via a `feedbackDone` Set). When null, the feedback turn is
 *   skipped entirely — saves 6 of 8 turns in a typical run and eliminates any
 *   risk of cross-source feedback landing in the wrong playbook file.
 */
async function runPhase3(
	selection: NewsSelection,
	city: string,
	playbook: string,
	feedbackPath: string | null,
	cwd: string,
): Promise<NewsArticle> {
	const log = logger.child({
		module: "news-agent",
		phase: 3,
		rank: selection.rank,
		sources: selection.sources.map((s) => s.name),
		feedback: feedbackPath !== null,
	});
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

		// ── Playbook feedback (conditional: only single-source + first-occurrence per source) ──
		if (feedbackPath !== null) {
			log.info("Requesting phase 3 playbook feedback");
			const feedbackCapture = captureResponseText(session);
			await session.prompt(`Review your session. If you encountered issues with the playbook's full-article fetch or thumbnail extraction instructions, edit the file directly:

- Full-article endpoint returned truncated, incomplete, or wrong content (forcing you to refetch)
- Thumbnail extraction pattern failed or was suboptimal
- Better URL/endpoint pattern discovered while fetching
- Content cleanup quirks not documented (noise, strip patterns)

Do NOT edit the listing-extraction section — that's phase 1's concern. Only note things you directly observed in this session while fetching and translating this article, not hypotheses. Keep the playbook concise.

File: ${feedbackPath}

If everything worked, say "No playbook changes needed."`);
			feedbackCapture.stop();
			log.info("Phase 3 feedback complete");
		}

		return article;
	} finally {
		session.dispose();
	}
}

/**
 * Build the phase-3 system-prompt playbook for a selected story.
 *
 * For single-source stories returns that source's playbook verbatim.
 * For cross-source stories concatenates all known source playbooks with `---`.
 * Unknown source names in the selection are silently filtered out (schema
 * should prevent this, but we don't want to crash if a drift happens); if
 * nothing matches, throws — we can't do phase 3 without any playbook.
 */
function buildPhase3Playbook(selection: NewsSelection, playbooks: Record<string, string>): string {
	const used = selection.sources.map((s) => s.name).filter((n) => n in playbooks);
	if (used.length === 0) {
		throw new Error(
			`Phase 3: no known playbooks for sources ${JSON.stringify(selection.sources.map((s) => s.name))}`,
		);
	}
	return used.map((n) => playbooks[n]).join("\n\n---\n\n");
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function fetchNewsViaAgent(city: string): Promise<NewsArticle[]> {
	const log = logger.child({ module: "news-agent", city });

	// 1. Preload per-source playbooks. Paths are resolved to absolute so agents
	//    running in the news-cache cwd can still edit them during the feedback
	//    turn. We hold both the path (for the feedback prompt) and the content
	//    (for the system prompt) in Records keyed by source name.
	const playbookPaths: Record<string, string> = Object.fromEntries(
		NEWS_SOURCES.map((s) => [s.key, resolve("memory", "news", city, s.playbookFile)]),
	);
	const playbooks: Record<string, string> = Object.fromEntries(
		Object.entries(playbookPaths).map(([k, p]) => [k, readFileSync(p, "utf-8")]),
	);
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	// 2. Create workspace
	const cwd = createWorkspace(city, today);
	log.info({ cwd }, "Using workspace");

	// 3. Phase 1: Extract — sequential per source, each source gets ONLY its
	//    own playbook (no cross-source context pollution).
	for (const source of NEWS_SOURCES) {
		await runPhase1(source.key, city, playbooks[source.key] ?? "", playbookPaths[source.key] ?? "", today, cwd);
	}
	log.info("Phase 1 complete — all sources extracted");

	// 4. Phase 2: Select — single call
	const sourceFiles = NEWS_SOURCES.map((s) => `stories-${s.key}.md`);
	const selections = await runPhase2(city, sourceFiles, cwd);
	log.info({ count: selections.length }, "Phase 2 complete — stories selected");

	// 5. Phase 3: Translate — sequential per article.
	//
	//    Feedback policy: only single-source stories trigger the feedback
	//    turn, and only the FIRST single-source occurrence per source (once
	//    per source per run). Tracked via `feedbackDone`. This:
	//    - caps phase-3 feedback at ≤2 turns per run (vs 8 before)
	//    - eliminates any risk of cross-source feedback editing the wrong
	//      playbook file (a real risk now that files are split)
	//    - accepts a small tradeoff on mid-run amortization past rank-1 of
	//      each source — subsequent same-source ranks don't get their own
	//      learning baked in during this run, but will benefit on the next
	//      run via the rank-1 feedback that did land.
	const feedbackDone = new Set<string>();
	const articles: NewsArticle[] = [];
	for (const selection of selections) {
		const combinedPlaybook = buildPhase3Playbook(selection, playbooks);

		let feedbackPath: string | null = null;
		const knownSources = selection.sources.map((s) => s.name).filter((n) => n in playbookPaths);
		if (knownSources.length === 1) {
			const sourceName = knownSources[0];
			if (sourceName && !feedbackDone.has(sourceName)) {
				feedbackPath = playbookPaths[sourceName] ?? null;
				feedbackDone.add(sourceName);
			}
		}

		const article = await runPhase3(selection, city, combinedPlaybook, feedbackPath, cwd);
		articles.push(article);
	}
	log.info(
		{ count: articles.length, feedbackSources: [...feedbackDone] },
		"Phase 3 complete — all articles translated",
	);

	// 6. Return
	return articles;
}
