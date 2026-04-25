import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

const prettyOptions = {
	translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
	ignore: "pid,hostname,level",
	singleLine: true,
};

export const logger = pino({
	level,
	base: null,
	transport: {
		targets: [
			{
				target: "pino-pretty",
				options: { ...prettyOptions, destination: 1, colorize: true },
				level,
			},
			{
				target: "pino-pretty",
				options: { ...prettyOptions, destination: "logs/app.log", mkdir: true, colorize: false },
				level,
			},
		],
	},
});
