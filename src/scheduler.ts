import { Cron } from "croner";
import { logger } from "./config/logger.js";

export function startScheduler(jobName: string, cronExpression: string, onTick: () => Promise<void>): void {
	new Cron(cronExpression, { timezone: "Asia/Kolkata", protect: true }, async () => {
		logger.info({ job: jobName }, "Scheduled tick started");
		try {
			await onTick();
		} catch (error) {
			logger.error({ job: jobName, error }, "Scheduled tick failed");
		}
	});

	logger.info({ job: jobName, cron: cronExpression }, "Scheduler started");
}
