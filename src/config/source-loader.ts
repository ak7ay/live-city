import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod/v4";

const stateEntrySchema = z.object({
	state_name: z.string(),
	city: z.string(),
});

const lalithaaConfigSchema = z.object({
	name: z.string(),
	api_url: z.url(),
	states_api_url: z.url(),
	states: z.array(stateEntrySchema).min(1),
});

export type LalithaaConfig = z.infer<typeof lalithaaConfigSchema>;

export function loadLalithaaConfig(filePath: string): LalithaaConfig {
	const raw = readFileSync(filePath, "utf-8");
	const parsed = parse(raw);
	return lalithaaConfigSchema.parse(parsed);
}
