import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { logger } from "../config/logger.js";
import { createNewsArticleSchema, createNewsSelectionsSchema, type NewsArticle, type NewsSelection } from "./schema.js";

// ── Constants ────────────────────────────────────────────────────────

const MAX_VALIDATION_RETRIES = 3;
const MODEL_ID = "claude-sonnet-4-6";
const THINKING_LEVEL = "medium";
const STORY_COUNT = 8;
const SOURCES = ["publictv", "tv9kannada"] as const;

// ── Shared helpers ───────────────────────────────────────────────────

function getAgentModel() {
	const model = getModel("anthropic", MODEL_ID);
	if (!model) throw new Error(`Model not found: anthropic/${MODEL_ID}`);
	return model;
}

function createWorkspace(city: string, today: string): string {
	const dir = join(homedir(), ".cache", "news", city, today);
	mkdirSync(dir, { recursive: true });
	return dir;
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
		cwd,
		model: getAgentModel(),
		thinkingLevel: THINKING_LEVEL,
		resourceLoader: loader,
		sessionManager,
	});

	return { session, sessionManager };
}

function captureResponseText(session: { subscribe: (cb: (event: any) => void) => () => void }) {
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
	// Try array first, then object
	const arrayMatch = text.match(/\[[\s\S]*\]/);
	if (arrayMatch) return arrayMatch[0];
	const objectMatch = text.match(/\{[\s\S]*\}/);
	return objectMatch ? objectMatch[0] : null;
}

// ── Phase 1: Extract ─────────────────────────────────────────────────

async function runPhase1(source: string, city: string, playbook: string, today: string, cwd: string): Promise<void> {
	const log = logger.child({ module: "news-agent", phase: 1, source });
	const outputFile = `stories-${source}.md`;
	log.info("Starting phase 1 extraction");

	const { session } = await createPhaseSession(cwd, `You are a ${city} news extractor for ${source}.`);
	try {
		const capture = captureResponseText(session);
		await session.prompt(`You are extracting today's news stories from the "${source}" source for ${city}.

## Playbook
${playbook}

## Instructions

1. Use the playbook above to fetch the LISTING from the "${source}" source only. Use bash with curl.
2. Translate ALL headlines and summaries to English.
3. Write a file called \`stories-${source}.md\` in the current directory with this exact format:

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

Include EVERY story from the listing. Do not skip any.
Today's date: ${today}`);
		capture.stop();

		const outputPath = join(cwd, outputFile);
		if (!existsSync(outputPath)) {
			throw new Error(`Phase 1: agent did not write ${outputFile}`);
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

	const { session } = await createPhaseSession(cwd, `You are a ${city} news editor selecting the top stories.`);
	try {
		const capture = captureResponseText(session);
		await session.prompt(`You are selecting the top ${STORY_COUNT} news stories for ${city} from multiple sources.

## Source Files
The following files are in the current directory. Read them all first:
${sourceFiles.map((f) => `- ${f}`).join("\n")}

## Steps

1. **Read** all source files listed above using the read tool.
2. **Cross-source match**: Identify stories that appear in multiple sources (same event, even if worded differently). Mark each story's source_count.
3. **Pick the top ${STORY_COUNT}** using these ranking criteria:
   - Cross-source stories (appearing in 2+ sources) rank HIGHER than single-source stories
   - Among equal source_count, prefer stories with higher public impact/importance
   - Use category diversity as a tiebreaker — avoid clustering same-category stories

## Output

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
- For cross-source stories: include ALL source entries`);
		capture.stop();

		const rawJson = extractJson(capture.getText());
		if (!rawJson) throw new Error("No JSON found in phase 2 response");

		const parsed = selectionsSchema.safeParse(JSON.parse(rawJson));
		if (parsed.success) {
			log.info("Phase 2 validation passed");
			return parsed.data;
		}

		throw new Error(`Phase 2 validation failed: ${JSON.stringify(parsed.error.issues)}`);
	} finally {
		session.dispose();
	}
}

// ── Phase 3: Translate ───────────────────────────────────────────────

async function runPhase3(selection: NewsSelection, city: string, playbook: string, cwd: string): Promise<NewsArticle> {
	const log = logger.child({ module: "news-agent", phase: 3, rank: selection.rank });
	log.info({ headline: selection.headline_en }, "Starting phase 3 translation");

	const articleSchema = createNewsArticleSchema(STORY_COUNT);

	const { session } = await createPhaseSession(cwd, `You are a ${city} news translator and content extractor.`);
	try {
		const selectionJson = JSON.stringify(selection, null, 2);

		const capture = captureResponseText(session);
		await session.prompt(`You are fetching and translating a full news article for ${city}.

## Playbook
${playbook}

## Selected Story
${selectionJson}

## Instructions

1. Fetch the FULL article content from the source(s) listed above.
   - Use the playbook's source-specific instructions for fetching full articles.
   - If multiple sources are listed, fetch from BOTH and pick the richer/more complete version.
2. Extract the thumbnail URL following the playbook's source-specific instructions.
3. Translate the full article content to natural, readable English:
   - Headline: concise, newspaper-style
   - Summary: 1-2 sentences capturing key facts
   - Content: full article body as clean markdown (## for subheadings, paragraphs, no HTML)
   - Category: translate the source's category tag

## Output

Your FINAL message must be ONLY a JSON object, no markdown fences, no explanation:

{
  "headline": "English headline",
  "summary": "1-2 sentence English summary",
  "content": "Full article body in English markdown",
  "category": "English category",
  "source": "source name(s), comma-separated if multiple",
  "source_count": ${selection.sources.length},
  "original_url": "primary article URL",
  "thumbnail_url": "thumbnail image URL",
  "rank": ${selection.rank}
}`);
		capture.stop();

		let lastError = "";
		const tryParse = (text: string) => {
			const raw = extractJson(text);
			if (!raw) {
				lastError = "No JSON object found in response";
				return null;
			}
			try {
				const obj = JSON.parse(raw);
				const result = articleSchema.safeParse(obj);
				if (result.success) return result.data;
				lastError = JSON.stringify(result.error.issues, null, 2);
			} catch (e) {
				lastError = e instanceof Error ? e.message : String(e);
			}
			return null;
		};

		const firstResult = tryParse(capture.getText());
		if (firstResult) {
			log.info("Phase 3 validation passed on first attempt");
			return firstResult;
		}

		// Retry loop on validation/parse failure
		for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
			log.info({ attempt, error: lastError }, "Phase 3 validation failed, retrying");

			const retryCapture = captureResponseText(session);
			await session.prompt(
				`Your JSON had errors:\n${lastError}\n\nFix and return only the corrected JSON object. No markdown fences, no explanation.`,
			);
			retryCapture.stop();

			const retryResult = tryParse(retryCapture.getText());
			if (retryResult) {
				log.info({ attempt }, "Phase 3 validation passed after retry");
				return retryResult;
			}
		}

		throw new Error(
			`Phase 3 failed for rank ${selection.rank} after ${MAX_VALIDATION_RETRIES} retries: ${lastError}`,
		);
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
