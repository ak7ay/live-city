import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { logger } from "../config/logger.js";
import { type NewsArticle, newsArticlesSchema } from "./schema.js";

const MAX_VALIDATION_RETRIES = 3;

function buildUserPrompt(playbook: string, city: string, today: string): string {
	return `Fetch today's top 5 ${city} news stories from Kannada sources, translate them to English, and return structured JSON.

## Playbook — How to fetch the data
${playbook}

## Steps

1. Use bash tool to run curl commands to fetch listings from BOTH sources:
   - PublicTV: curl the WordPress REST API endpoint from the playbook
   - TV9 Kannada: curl the RSS feed endpoint from the playbook
2. Read all titles and excerpts/descriptions from both sources
3. Pick the top 5 most newsworthy ${city} stories. Stories appearing on BOTH sources rank higher.
4. For each of the 5 winners, ensure you have the full article content:
   - PublicTV: fetch full article by ID if needed
   - TV9: content:encoded is already in the RSS
5. Strip HTML noise (video embeds, "also read" links, footer links)
6. Translate everything from Kannada to English
7. Translate the source category tags to English too

## Output

Your FINAL message must be ONLY a JSON array with exactly 5 objects, no markdown fences, no explanation:

[
  {
    "headline": "English headline",
    "summary": "1-2 sentence English summary",
    "content": "Full article body in English markdown format",
    "category": "English category translated from source",
    "source": "tv9kannada or publictv or tv9kannada,publictv if on both",
    "source_count": 1,
    "original_url": "https://...",
    "thumbnail_url": "https://...",
    "rank": 1
  }
]

Today's date: ${today}
City: ${city}

Start by fetching both sources now.`;
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

	const loader = new DefaultResourceLoader({
		skillsOverride: () => ({ skills: [], diagnostics: [] }),
		appendSystemPrompt: `You are a ${city} news curator. You have bash tool available — use it to run curl commands to fetch data from external APIs and RSS feeds. You CAN access the internet via curl.`,
	});
	await loader.reload();

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "medium",
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

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
