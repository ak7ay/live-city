# Pi SDK Hello World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `src/index.ts` with a working pi-coding-agent SDK integration that sends "hi" and prints the response.

**Architecture:** Single file — creates an agent session with `claude-opus-4-6` / thinking `medium`, subscribes to streamed text deltas, sends "hi", prints response, exits.

**Tech Stack:** `@mariozechner/pi-coding-agent` SDK, `@mariozechner/pi-ai` (bundled), TypeScript, Node 22+

---

### Task 1: Implement the agent script

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` with the agent script**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run the script**

Run: `npx tsx src/index.ts`
Expected: Agent responds to "hi" with a greeting, text streams to stdout, process exits cleanly with code 0.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate pi-coding-agent SDK with hello world prompt"
```
