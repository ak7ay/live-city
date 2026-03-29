import pino from "pino";

const isDev = process.env.NODE_ENV === "development";
const level = process.env.LOG_LEVEL || "info";

export const logger = pino({
	level,
	transport: {
		targets: [
			// stdout — formatted in dev, JSON in prod
			isDev
				? { target: "pino-logfmt", options: {}, level }
				: { target: "pino/file", options: { destination: 1 }, level },
			// file — always JSON for easy parsing
			{
				target: "pino/file",
				options: { destination: "logs/app.log", mkdir: true },
				level,
			},
		],
	},
});
