import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { logger } from "../config/logger.js";
import { type NewsArticle, newsArticlesSchema } from "./schema.js";

const MAX_VALIDATION_RETRIES = 3;

function buildUserPrompt(playbook: string, city: string, today: string): string {
	return `Fetch today's top 5 ${city} news stories, translate them to English, and return structured JSON.

## Playbook
The playbook below contains city-specific details: sources, API endpoints, content quirks, and known issues. Follow it for all fetching and content cleanup.

${playbook}

## Steps

### 1. Fetch all sources
Use bash tool to fetch listings from ALL sources listed in the playbook.

### 2. Write all scraped stories to a file
Write a file listing EVERY story from EVERY source with: source name, translated title, 1-line translated summary. Group by source. This is your working dataset — do not skip this step.

### 3. Cross-source matching
Read back the file. For every story, check if the same event appears in another source. Two articles match if they describe the same event, even if worded differently. Write the match results to a file: matches with source_count = 2, and single-source stories with source_count = 1.

### 4. Pick the top 5
- **Cross-source stories (source_count: 2) MUST rank above single-source stories.** If there are 4 cross-source matches, at least 4 of the top 5 must be cross-source.
- Among stories of equal source_count, prefer diversity of categories. Avoid picking multiple stories from the same category if others are available.

### 5. Get full content + thumbnails
For each of the 5 winners, fetch full article content and thumbnail following the source-specific instructions in the playbook. Every article must have a thumbnail — all sources provide images.

### 6. Translate
- Translate all text to natural, readable English
- Headlines: concise, newspaper-style
- Summary: 1-2 sentences capturing the key facts
- Content: full article body as clean markdown (## for subheadings, paragraphs, no HTML)
- Category: translate the source's category tag to English

## Output

Your FINAL message must be ONLY a JSON array with exactly 5 objects, no markdown fences, no explanation:

[
  {
    "headline": "English headline",
    "summary": "1-2 sentence English summary",
    "content": "Full article body in English markdown format",
    "category": "English category translated from source",
    "source": "comma-separated source identifiers if on multiple sources",
    "source_count": 1,
    "original_url": "https://...",
    "thumbnail_url": "https://...",
    "rank": 1
  }
]

- source_count: number of sources the story appeared on
- rank: 1 = most important, 5 = least important
- For cross-source stories: combine best details from all versions

Today's date: ${today}
City: ${city}

Start by fetching all sources now.`;
}

function extractJson(text: string): string | null {
	// Match the outermost [ ... ] in the response
	const match = text.match(/\[[\s\S]*\]/);
	return match ? match[0] : null;
}

export async function fetchNewsViaAgent(city: string): Promise<NewsArticle[]> {
	const log = logger.child({ module: "news-agent", city });

	const playbookPath = join("memory", "news", city, "playbook.md");
	const playbook = readFileSync(playbookPath, "utf-8");

	const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

	const model = getModel("anthropic", "claude-sonnet-4-20250514");
	if (!model) {
		throw new Error("Model not found: anthropic/claude-sonnet-4-20250514");
	}

	const agentCwd = mkdtempSync(join(tmpdir(), `news-agent-${city}-`));
	log.info({ cwd: agentCwd }, "Created agent workspace");

	const loader = new DefaultResourceLoader({
		cwd: agentCwd,
		skillsOverride: () => ({ skills: [], diagnostics: [] }),
		appendSystemPrompt: `You are a ${city} news curator.`,
	});
	await loader.reload();

	const sessionManager = SessionManager.create(agentCwd);
	const { session } = await createAgentSession({
		model,
		thinkingLevel: "medium",
		resourceLoader: loader,
		sessionManager,
	});

	log.info({ sessionDir: sessionManager.getCwd() }, "Agent session persisted");

	let fullResponse = "";
	let unsubscribe: (() => void) | undefined;

	const captureResponse = () => {
		unsubscribe?.();
		fullResponse = "";
		unsubscribe = session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				fullResponse += event.assistantMessageEvent.delta;
			}
		});
	};

	try {
		log.info("Starting agent session for news fetch");

		captureResponse();
		const userPrompt = buildUserPrompt(playbook, city, today);
		await session.prompt(userPrompt);

		const rawJson = extractJson(fullResponse);
		if (!rawJson) {
			throw new Error("No JSON array found in agent response");
		}

		log.info("JSON extracted from agent response");
		let parsed = newsArticlesSchema.safeParse(JSON.parse(rawJson));

		if (parsed.success) {
			log.info("Validation passed on first attempt");
			return parsed.data;
		}

		// Retry loop on validation failure
		for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
			const errors = JSON.stringify(parsed.error.issues, null, 2);
			log.info({ attempt, errors }, "Validation failed, sending retry prompt");

			captureResponse();
			await session.prompt(
				`Your JSON had validation errors:\n${errors}\n\nFix and return only the corrected JSON array. No markdown fences, no explanation.`,
			);

			const retryJson = extractJson(fullResponse);
			if (!retryJson) {
				log.info({ attempt }, "No JSON array found in retry response");
				continue;
			}

			parsed = newsArticlesSchema.safeParse(JSON.parse(retryJson));
			if (parsed.success) {
				log.info({ attempt }, "Validation passed after retry");
				return parsed.data;
			}
		}

		throw new Error(
			`Validation failed after ${MAX_VALIDATION_RETRIES} retries: ${JSON.stringify(parsed.error.issues)}`,
		);
	} finally {
		unsubscribe?.();
		session.dispose();
	}
}
