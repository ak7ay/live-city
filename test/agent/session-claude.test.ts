import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock @anthropic-ai/claude-agent-sdk ───────────────────────────────
//
// We need a controllable Query that the test can push messages into,
// so we can exercise the background consumer loop inside createSession
// (in src/agent/shared-claude.ts).
//
// The mock exposes `pushMessage` and `getCloseCount` on the returned
// query object so tests can drive the loop deterministically.

type MockMessage = { type: string; [k: string]: unknown };

interface MockQuery extends AsyncIterable<MockMessage> {
	next(): Promise<IteratorResult<MockMessage>>;
	close(): void;
	interrupt(): Promise<void>;
	// Test-only hooks
	pushMessage(msg: MockMessage): void;
	endStream(): void;
	getCloseCount(): number;
}

function createMockQuery(): MockQuery {
	const messageQueue: MockMessage[] = [];
	const waiters: ((v: IteratorResult<MockMessage>) => void)[] = [];
	let closed = false;
	let closeCount = 0;

	const drainWaiters = () => {
		while (waiters.length > 0) {
			const w = waiters.shift();
			if (w) w({ value: undefined, done: true });
		}
	};

	const q: MockQuery = {
		async next(): Promise<IteratorResult<MockMessage>> {
			if (messageQueue.length > 0) {
				const msg = messageQueue.shift();
				if (msg) return { value: msg, done: false };
			}
			if (closed) return { value: undefined, done: true };
			return new Promise((resolve) => {
				waiters.push(resolve);
			});
		},
		[Symbol.asyncIterator]() {
			return this;
		},
		close() {
			closeCount++;
			closed = true;
			drainWaiters();
		},
		async interrupt() {},
		pushMessage(msg: MockMessage) {
			if (waiters.length > 0) {
				const w = waiters.shift();
				if (w) w({ value: msg, done: false });
			} else {
				messageQueue.push(msg);
			}
		},
		endStream() {
			closed = true;
			drainWaiters();
		},
		getCloseCount() {
			return closeCount;
		},
	};

	return q;
}

// Module-scoped holder so tests can grab the most recently created mock
// Query after calling createPlainSession.
let currentMock: MockQuery | null = null;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(() => {
		currentMock = createMockQuery();
		return currentMock;
	}),
}));

// Import AFTER vi.mock so the module-under-test picks up the mocked SDK.
import { captureResponseText, createPlainSession } from "../../src/agent/shared-claude.js";

// Helper: let the background consumer loop process pending messages.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("shared-claude session wrapper", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		currentMock = null;
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("happy path: accumulates assistant text and resolves prompt on result", async () => {
		const session = await createPlainSession("/tmp", "system suffix");
		expect(currentMock).not.toBeNull();

		const capture = captureResponseText(session);

		const promptPromise = session.prompt("test");

		// Let the consumer loop attach and see no messages yet.
		await tick();

		// Push one assistant message with a single text block.
		currentMock?.pushMessage({
			type: "assistant",
			message: {
				content: [{ type: "text", text: "hello world" }],
			},
		});
		await tick();

		// Push the result message that signals turn-end.
		currentMock?.pushMessage({
			type: "result",
			subtype: "success",
			result: "hello world",
		});

		await promptPromise;
		capture.stop();

		expect(capture.getText()).toBe("hello world");
		expect(warnSpy).not.toHaveBeenCalled();

		session.dispose();
	});

	it("error turn: prompt still resolves, warning logged, text empty", async () => {
		const session = await createPlainSession("/tmp", "");
		const capture = captureResponseText(session);

		const promptPromise = session.prompt("test");
		await tick();

		// No assistant message — straight to an error result.
		currentMock?.pushMessage({
			type: "result",
			subtype: "error_during_execution",
			errors: ["boom"],
		});

		await promptPromise;
		capture.stop();

		expect(capture.getText()).toBe("");
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(
			"[agent-claude] turn ended with error",
			expect.objectContaining({ subtype: "error_during_execution" }),
		);

		session.dispose();
	});

	it("dispose during in-flight turn: closes Query and blocks subsequent prompts", async () => {
		const session = await createPlainSession("/tmp", "");
		expect(currentMock?.getCloseCount()).toBe(0);

		// Fire a prompt but don't resolve the turn — we just want the Query
		// to have a pending user message on the input side.
		const inFlight = session.prompt("test");
		await tick();

		session.dispose();

		// close() should have been invoked exactly once.
		expect(currentMock?.getCloseCount()).toBe(1);

		// Second dispose is a no-op (idempotent).
		session.dispose();
		expect(currentMock?.getCloseCount()).toBe(1);

		// Subsequent prompts throw synchronously.
		await expect(session.prompt("again")).rejects.toThrow("Session disposed");

		// The in-flight prompt is effectively abandoned — we don't await it
		// to completion because the mock Query was closed without yielding
		// a result. Catching is enough to prove dispose didn't deadlock.
		inFlight.catch(() => {});
	});
});
