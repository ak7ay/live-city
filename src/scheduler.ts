import cron from "node-cron";
import { logger } from "./config/logger.js";

export function startScheduler(jobName: string, cronExpression: string, onTick: () => Promise<void>): void {
	cron.schedule(
		cronExpression,
		async () => {
			logger.info({ job: jobName }, "Scheduled tick started");
			try {
				await onTick();
			} catch (error) {
				logger.error({ job: jobName, error }, "Scheduled tick failed");
			}
		},
		{ timezone: "Asia/Kolkata" },
	);

	logger.info({ job: jobName, cron: cronExpression }, "Scheduler started");
}
