// Returns true if `date` (a JS Date) falls inside one of the two daily IST
// windows where Lalithaa Jewellery's rates actually change: 09:30–10:30 IST
// (every 5 min) and 15:00–19:00 IST (every 10 min). The cron runs every 5
// min across the UTC superset, so the afternoon branch filters out the odd
// 5-min ticks to achieve a 10-min cadence.
export function isWithinPriceWindow(date) {
	const istMinutes = istMinutesOfDay(date);
	const morningStart = 9 * 60 + 30; // 09:30
	const morningEnd = 10 * 60 + 30; // 10:30
	const afternoonStart = 15 * 60; // 15:00
	const afternoonEnd = 19 * 60; // 19:00

	if (istMinutes >= morningStart && istMinutes <= morningEnd) {
		return true;
	}
	if (istMinutes >= afternoonStart && istMinutes <= afternoonEnd) {
		return istMinutes % 10 === 0;
	}
	return false;
}

function istMinutesOfDay(date) {
	// IST is a fixed +5:30 offset (no DST), so we can derive IST minutes
	// from UTC without needing a tz database.
	const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
	const istTotal = utcMinutes + 5 * 60 + 30;
	return ((istTotal % (24 * 60)) + 24 * 60) % (24 * 60);
}
