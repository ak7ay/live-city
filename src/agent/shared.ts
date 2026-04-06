import { getModel } from "@mariozechner/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";

// ── Constants ────────────────────────────────────────────────────────

const MODEL_ID = "claude-sonnet-4-6";
const THINKING_LEVEL = "medium";
const MAX_VALIDATION_RETRIES = 3;

// ── Model ────────────────────────────────────────────────────────────

export function getAgentModel() {
	const model = getModel("anthropic", MODEL_ID);
	if (!model) throw new Error(`Model not found: anthropic/${MODEL_ID}`);
	return model;
}

// ── Session factories ────────────────────────────────────────────────

/** Session WITHOUT skills (for phases that don't need tools beyond bash) */
export async function createPlainSession(cwd: string, systemSuffix: string) {
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
	return session;
}

/** Session WITH browser-tools skill only */
export async function createBrowserSession(cwd: string, systemSuffix: string) {
	const loader = new DefaultResourceLoader({
		cwd,
		skillsOverride: (allSkills) => {
			const browserSkill = allSkills.skills.filter((s) => s.name === "browser-tools");
			return { skills: browserSkill, diagnostics: [] };
		},
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
	return session;
}

// ── Response capture ─────────────────────────────────────────────────

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

function tryParseJson(
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
