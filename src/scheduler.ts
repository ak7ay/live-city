import cron from "node-cron";
import { logger } from "./config/logger.js";

export function startScheduler(jobName: string, onTick: () => Promise<void>): void {
	// Every 10 minutes from 9:00 to 15:59 IST
	cron.schedule(
		"*/10 9-15 * * *",
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

	// Final check at 16:00 IST
	cron.schedule(
		"0 16 * * *",
		async () => {
			logger.info({ job: jobName }, "Final tick started (16:00 IST)");
			try {
				await onTick();
			} catch (error) {
				logger.error({ job: jobName, error }, "Final tick failed");
			}
		},
		{ timezone: "Asia/Kolkata" },
	);

	logger.info({ job: jobName }, "Scheduler started: every 10min, 9:00-16:00 IST");
}
