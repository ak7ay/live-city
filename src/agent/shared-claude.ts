import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Options, type Query, query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../config/logger.js";

// ── Constants ────────────────────────────────────────────────────────

const MODEL_ID = "claude-sonnet-4-6";
const MAX_VALIDATION_RETRIES = 3;
const MAX_TURNS = 200;

const THINKING: NonNullable<Options["thinking"]> = {
	type: "enabled",
	budgetTokens: 10_000,
};

// Plain sessions: no browser; full read/write + search. Matches pi's
// "no skills" posture while giving Claude its standard built-in toolbelt.
// WebFetch deliberately omitted — its internal summarizer destroys raw
// content (foreign-language bodies, full JSON) and it 401s on some
// endpoints where curl works fine. Bash + curl is the substitute.
const PLAIN_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "TodoWrite"];

// Browser sessions: same + Skill (so browser-tools SKILL.md is invokable).
const BROWSER_ALLOWED_TOOLS = [...PLAIN_ALLOWED_TOOLS, "Skill"];

// Subagents OFF. Block both legacy "Task" and current "Agent" names so we're
// safe across SDK versions (the rename happened in v2.1.63).
const DISALLOWED_TOOLS = ["Task", "Agent"];

// Plugin root directory — contains .claude-plugin/plugin.json and
// skills/browser-tools/SKILL.md. Built by scripts/install-browser-skills.sh.
const BROWSER_PLUGIN_PATH = join(homedir(), ".live-city", "agent");
const BROWSER_SKILL_MD = join(BROWSER_PLUGIN_PATH, "skills", "browser-tools", "SKILL.md");

// ── Model ────────────────────────────────────────────────────────────

export function getAgentModel() {
	return { provider: "anthropic", id: MODEL_ID } as const;
}

// ── Session contract (structural, matches the pi backend) ───────────

type Subscriber = (event: unknown) => void;

export interface Session {
	prompt(msg: string): Promise<void>;
	subscribe(cb: Subscriber): () => void;
	dispose(): void;
}

// ── Session factories ────────────────────────────────────────────────

/** Session WITHOUT skills (plain bash/file/search tooling only). */
export async function createPlainSession(cwd: string, systemSuffix: string): Promise<Session> {
	return createSession({
		cwd,
		model: MODEL_ID,
		systemPrompt: { type: "preset", preset: "claude_code", append: systemSuffix },
		allowedTools: PLAIN_ALLOWED_TOOLS,
		disallowedTools: DISALLOWED_TOOLS,
		permissionMode: "dontAsk",
		thinking: THINKING,
		maxTurns: MAX_TURNS,
		// NO plugins, NO settingSources — zero skill pollution.
	});
}

/** Session WITH the browser-tools skill loaded from the isolated plugin dir. */
export async function createBrowserSession(cwd: string, systemSuffix: string): Promise<Session> {
	assertBrowserPluginExists();
	return createSession({
		cwd,
		model: MODEL_ID,
		systemPrompt: { type: "preset", preset: "claude_code", append: systemSuffix },
		allowedTools: BROWSER_ALLOWED_TOOLS,
		disallowedTools: DISALLOWED_TOOLS,
		permissionMode: "dontAsk",
		thinking: THINKING,
		maxTurns: MAX_TURNS,
		// ONLY this plugin. No project/user skill discovery.
		plugins: [{ type: "local", path: BROWSER_PLUGIN_PATH }],
	});
}

function assertBrowserPluginExists(): void {
	if (!existsSync(BROWSER_SKILL_MD)) {
		throw new Error(`browser-tools plugin not found at ${BROWSER_SKILL_MD}. Run: scripts/install-browser-skills.sh`);
	}
}

// ── createSession core ───────────────────────────────────────────────
//
// Bridges @anthropic-ai/claude-agent-sdk's pull-based `query()` into a
// push-based { prompt, subscribe, dispose } contract so the rest of the
// codebase (retryValidation, captureResponseText, call sites in
// src/events/agent.ts and src/news/agent.ts) can stay unchanged.
//
// Input side:  pendingMessages queue + pullResolver wake-up, consumed by
//              an inputGen() async generator fed to query({ prompt }).
// Output side: background consumer loop iterates the Query; on assistant
//              messages it emits text_delta events to subscribers; on
//              result messages it resolves the in-flight prompt promise.
function createSession(options: Options): Session {
	const subscribers = new Set<Subscriber>();
	const pendingMessages: SDKUserMessage[] = [];
	let pullResolver: ((m: SDKUserMessage | null) => void) | null = null;
	// Wrapped in an object so property access survives closure-capture
	// narrowing inside the async consumer loop below. TypeScript would
	// otherwise narrow the `let`-bound resolver/rejecter to `null` at the
	// point the IIFE captures them, since they're only ever *assigned*
	// inside `prompt()` which TS can't see reaching from that closure.
	const turn: {
		resolver: (() => void) | null;
		rejecter: ((e: Error) => void) | null;
	} = { resolver: null, rejecter: null };
	let disposed = false;

	async function* inputGen(): AsyncGenerator<SDKUserMessage> {
		while (!disposed) {
			if (pendingMessages.length > 0) {
				const next = pendingMessages.shift();
				if (next) yield next;
				continue;
			}
			const next = await new Promise<SDKUserMessage | null>((resolve) => {
				pullResolver = resolve;
			});
			if (next === null) return;
			yield next;
		}
	}

	const q: Query = query({ prompt: inputGen(), options });

	// Background consumer loop — runs until Query ends or dispose() is called.
	void (async () => {
		try {
			for await (const msg of q as AsyncIterable<SDKMessage>) {
				if (disposed) break;

				if (msg.type === "assistant") {
					let text = "";
					const content = msg.message.content ?? [];
					for (const block of content) {
						const b = block as { type?: string; text?: string };
						if (b.type === "text" && typeof b.text === "string") {
							text += b.text;
						}
					}
					if (text) {
						const event = {
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: text },
						};
						for (const sub of subscribers) sub(event);
					}
				}

				if (msg.type === "result") {
					if (msg.subtype !== "success") {
						logger.warn(
							{
								module: "agent-claude",
								subtype: msg.subtype,
								errors: (msg as { errors?: unknown }).errors,
							},
							"Turn ended with error",
						);
					}
					const resolver = turn.resolver;
					turn.resolver = null;
					turn.rejecter = null;
					if (resolver) resolver();
				}
			}
			// Loop exited cleanly (Query exhausted or disposed mid-iteration).
			// If a turn is still in flight at this point, the SDK terminated
			// without sending a result message — reject so the caller is not
			// left awaiting forever. Idempotent with dispose()'s own rejection:
			// whichever path runs first nulls turn.rejecter and the other
			// observes null and skips.
			const endRejecter = turn.rejecter;
			turn.resolver = null;
			turn.rejecter = null;
			if (endRejecter) {
				endRejecter(new Error(disposed ? "Session disposed" : "Session ended unexpectedly"));
			}
		} catch (err) {
			const rejecter = turn.rejecter;
			turn.resolver = null;
			turn.rejecter = null;
			if (rejecter) rejecter(err instanceof Error ? err : new Error(String(err)));
		}
	})();

	return {
		async prompt(userText: string): Promise<void> {
			if (disposed) throw new Error("Session disposed");
			if (turn.resolver) {
				throw new Error("prompt() called while previous turn in flight");
			}

			const turnDone = new Promise<void>((resolve, reject) => {
				turn.resolver = resolve;
				turn.rejecter = reject;
			});

			const userMessage = {
				type: "user",
				message: { role: "user", content: userText },
				parent_tool_use_id: null,
			} as unknown as SDKUserMessage;

			if (pullResolver) {
				const resolve = pullResolver;
				pullResolver = null;
				resolve(userMessage);
			} else {
				pendingMessages.push(userMessage);
			}

			await turnDone;
		},

		subscribe(cb: Subscriber): () => void {
			subscribers.add(cb);
			return () => {
				subscribers.delete(cb);
			};
		},

		dispose(): void {
			if (disposed) return;
			disposed = true;
			// Reject any in-flight prompt synchronously so the caller is not
			// left awaiting a promise that will never settle. Idempotent with
			// the loop-end handler in the consumer IIFE — whichever runs
			// first nulls turn.rejecter and the other observes null.
			const rejecter = turn.rejecter;
			turn.resolver = null;
			turn.rejecter = null;
			if (rejecter) rejecter(new Error("Session disposed"));
			// Wake the input generator so it can return.
			if (pullResolver) {
				const resolve = pullResolver;
				pullResolver = null;
				resolve(null);
			}
			try {
				q.close();
			} catch {
				/* already closed */
			}
			subscribers.clear();
		},
	};
}

// ── Response capture ─────────────────────────────────────────────────
// Verbatim from src/agent/shared.ts — depends only on the Session contract.

export function captureResponseText(session: { subscribe: (cb: (event: any) => void) => () => void }) {
	let text = "";
	const unsubscribe = session.subscribe((event: any) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			text += event.assistantMessageEvent.delta;
		}
	});
	return { getText: () => text, stop: () => unsubscribe() };
}

// ── JSON extraction ──────────────────────────────────────────────────
// Verbatim from src/agent/shared.ts — pure function.

export function extractJson(text: string): string | null {
	const candidates: string[] = [];
	const openers = { "[": "]", "{": "}" } as const;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== "[" && ch !== "{") continue;
		const closer = openers[ch as "[" | "{"];
		let depth = 1;
		let inString = false;
		let escaped = false;
		for (let j = i + 1; j < text.length; j++) {
			const c = text[j];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (c === "\\") {
				escaped = true;
				continue;
			}
			if (c === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (c === ch) depth++;
			else if (c === closer) depth--;
			if (depth === 0) {
				candidates.push(text.slice(i, j + 1));
				break;
			}
		}
	}
	candidates.sort((a, b) => b.length - a.length);
	for (const c of candidates) {
		try {
			JSON.parse(c);
			return c;
		} catch {
			/* next */
		}
	}
	return null;
}

// ── Validation with retry ────────────────────────────────────────────
// Verbatim from src/agent/shared.ts — depends only on Session contract.

export function tryParseJson(
	text: string,
	schema: { safeParse: (v: unknown) => any },
): { data: any; error: null } | { data: null; error: string } {
	const raw = extractJson(text);
	if (!raw) return { data: null, error: "No JSON found in response" };
	try {
		const obj = JSON.parse(raw);
		const result = schema.safeParse(obj);
		if (result.success) return { data: result.data, error: null };
		return { data: null, error: JSON.stringify(result.error.issues, null, 2) };
	} catch (e) {
		return { data: null, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function retryValidation(
	session: { prompt: (msg: string) => Promise<void> } & { subscribe: (cb: (event: any) => void) => () => void },
	text: string,
	schema: Parameters<typeof tryParseJson>[1],
	log: { info: (...args: any[]) => void },
) {
	let result = tryParseJson(text, schema);
	if (result.data !== null) return result.data;
	for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
		log.info({ attempt, error: result.error }, "Validation failed, retrying");
		const retry = captureResponseText(session);
		await session.prompt(
			`Your JSON had errors:\n${result.error}\n\nFix and return only the corrected JSON. No markdown fences.`,
		);
		retry.stop();
		result = tryParseJson(retry.getText(), schema);
		if (result.data !== null) {
			log.info({ attempt }, "Validation passed");
			return result.data;
		}
	}
	throw new Error(`Validation failed after ${MAX_VALIDATION_RETRIES} retries: ${result.error}`);
}
