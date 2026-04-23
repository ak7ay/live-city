// Returns true if `date` (a JS Date) falls inside one of the two daily
// IST windows where Lalithaa Jewellery's published rates actually change:
// 09:30–10:30 IST and 15:00–16:00 IST (both inclusive of endpoints).
export function isWithinPriceWindow(date) {
	const istMinutes = istMinutesOfDay(date);
	const morningStart = 9 * 60 + 30; // 09:30
	const morningEnd = 10 * 60 + 30; // 10:30
	const afternoonStart = 15 * 60; // 15:00
	const afternoonEnd = 16 * 60; // 16:00

	return (
		(istMinutes >= morningStart && istMinutes <= morningEnd) ||
		(istMinutes >= afternoonStart && istMinutes <= afternoonEnd)
	);
}

function istMinutesOfDay(date) {
	// IST is a fixed +5:30 offset (no DST), so we can derive IST minutes
	// from UTC without needing a tz database.
	const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
	const istTotal = utcMinutes + 5 * 60 + 30;
	return ((istTotal % (24 * 60)) + 24 * 60) % (24 * 60);
}
