import { readFileSync } from "node:fs";
import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";

const playbook = readFileSync("memory/news/bengaluru/playbook.md", "utf-8");
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const model = getModel("anthropic", "claude-sonnet-4-20250514");
if (!model) {
	console.error("Model not found");
	process.exit(1);
}

const loader = new DefaultResourceLoader({
	skillsOverride: () => ({ skills: [], diagnostics: [] }),
	appendSystemPrompt: `You are a Bengaluru news curator. You have bash tool available — use it to run curl commands to fetch data from external APIs and RSS feeds. You CAN access the internet via curl.`,
});
await loader.reload();

const { session } = await createAgentSession({
	model,
	thinkingLevel: "medium",
	resourceLoader: loader,
	sessionManager: SessionManager.inMemory(),
});

const userPrompt = `Fetch today's top 5 Bengaluru news stories from Kannada sources, translate them to English, and return structured JSON.

## Playbook — How to fetch the data
${playbook}

## Steps

1. Use bash tool to run curl commands to fetch listings from BOTH sources:
   - PublicTV: curl the WordPress REST API endpoint from the playbook
   - TV9 Kannada: curl the RSS feed endpoint from the playbook
2. Read all titles and excerpts/descriptions from both sources
3. Pick the top 5 most newsworthy Bengaluru stories. Stories appearing on BOTH sources rank higher.
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
City: Bengaluru

Start by fetching both sources now.`;

let fullResponse = "";

try {
	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			process.stdout.write(delta);
			fullResponse += delta;
		}
	});

	await session.prompt(userPrompt);

	console.log("\n\n--- Attempting JSON parse ---");
	const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
	if (jsonMatch) {
		const articles = JSON.parse(jsonMatch[0]);
		console.log(`✅ Parsed ${articles.length} articles`);
		for (const a of articles) {
			console.log(`  #${a.rank} [${a.source}] ${a.headline}`);
			console.log(`    Category: ${a.category}`);
			console.log(`    Summary: ${a.summary.slice(0, 100)}...`);
			console.log();
		}
	} else {
		console.log("❌ No JSON array found in response");
		console.log("Last 500 chars of response:");
		console.log(fullResponse.slice(-500));
	}
} catch (error) {
	console.error("Agent session failed:", error);
	process.exit(1);
} finally {
	session.dispose();
}
