import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

const model = getModel("anthropic", "claude-opus-4-6");
if (!model) {
	console.error("Model claude-opus-4-6 not found");
	process.exit(1);
}

try {
	const { session } = await createAgentSession({
		model,
		thinkingLevel: "medium",
		sessionManager: SessionManager.inMemory(),
	});

	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	await session.prompt("hi");
	console.log();

	session.dispose();
} catch (error) {
	console.error("Agent session failed:", error);
	process.exit(1);
}
