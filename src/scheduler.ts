import cron from "node-cron";
import { logger } from "./config/logger.js";

export function startScheduler(jobName: string, onTick: () => Promise<void>): void {
	cron.schedule(
		"*/10 9-16 * * *",
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

	logger.info({ job: jobName }, "Scheduler started: every 10min, 9:00-16:50 IST");
}
