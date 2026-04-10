// Runtime-selectable agent backend.
//
// Default: AGENT_RUNTIME unset → @anthropic-ai/claude-agent-sdk (current).
// Opt-in:  AGENT_RUNTIME=pi → pi-coding-agent (legacy fallback).
//
// Both modules are imported eagerly; only one is re-exported. The unused
// backend is still loaded at module-init time (a few MB of JS), but makes
// no network calls and no SDK invocations unless AGENT_RUNTIME selects it.
//
// To remove the pi backend in a follow-up commit: delete shared.ts, then
// either simplify this file to re-export shared-claude directly or rename
// shared-claude.ts → shared.ts and delete this file.

import * as pi from "./shared.js";
import * as claude from "./shared-claude.js";

const backend = process.env.AGENT_RUNTIME === "pi" ? pi : claude;

export const getAgentModel = backend.getAgentModel;
export const createPlainSession = backend.createPlainSession;
export const createBrowserSession = backend.createBrowserSession;
export const captureResponseText = backend.captureResponseText;
export const extractJson = backend.extractJson;
export const tryParseJson = backend.tryParseJson;
export const retryValidation = backend.retryValidation;
