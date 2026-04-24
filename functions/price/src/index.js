import { Client, Messaging, TablesDB } from "node-appwrite";
import { isWithinPriceWindow } from "./ist-window.js";
import { fetchPrice, resolveStateIds } from "./lalithaa.js";
import { buildPriceChangeEvent, sendPriceNotification } from "./price-notifier.js";
import { fetchNotificationContext, isFirstGoldChangeOfDay, updatePriceForCity } from "./prices-updater.js";

const LALITHAA_SOURCE = "lalithaa_jewellery";
const STATES_API_URL = "https://api.lalithaajewellery.com/public/states";
const PRICES_API_URL = "https://api.lalithaajewellery.com/public/pricings/latest";

export default async ({ req, res, log, error }) => {
	const now = new Date();

	// Cron superset is `*/5 4-5,9-13 * * *` UTC — filter to the exact IST windows inside.
	const scheduledTrigger = req.headers["x-appwrite-trigger"] === "schedule";
	if (scheduledTrigger && !isWithinPriceWindow(now)) {
		log(`Outside IST price window (now=${now.toISOString()}), skipping.`);
		return res.json({ skipped: true, reason: "outside_ist_window" });
	}

	const statesConfig = JSON.parse(process.env.LALITHAA_STATES_JSON);

	const client = new Client()
		.setEndpoint(process.env.APPWRITE_ENDPOINT)
		.setProject(process.env.APPWRITE_PROJECT_ID)
		.setKey(process.env.APPWRITE_API_KEY);
	const db = new TablesDB(client);
	const messaging = new Messaging(client);

	const stateMap = await resolveStateIds(STATES_API_URL, statesConfig);

	const summary = [];
	for (const [city, { stateId }] of stateMap) {
		try {
			const prices = await fetchPrice(PRICES_API_URL, stateId);
			const { action } = await updatePriceForCity(db, city, LALITHAA_SOURCE, prices);

			// Notify at most once per city per day: the first row today whose
			// gold price diverges from yesterday's last row. Check after writing
			// so the fresh row is included in the count.
			if (action !== "checked") {
				const { yesterdayRef, todayRows } = await fetchNotificationContext(db, city, LALITHAA_SOURCE);
				if (isFirstGoldChangeOfDay(todayRows, yesterdayRef)) {
					const event = buildPriceChangeEvent(city, yesterdayRef, prices);
					try {
						await sendPriceNotification(messaging, event);
					} catch (notifyErr) {
						error(`Push failed for ${city}: ${notifyErr.message}`);
					}
				}
			}

			log(`${action} ${city}: gold=${prices.gold_22k_price} silver=${prices.silver_price}`);
			summary.push({ city, action });
		} catch (cityErr) {
			error(`Failed ${city}: ${cityErr.message}`);
			summary.push({ city, action: "error", error: cityErr.message });
		}
	}

	return res.json({ now: now.toISOString(), summary });
};
