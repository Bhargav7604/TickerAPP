// NSE, BSE and MCX trading calendar, and which exchanges are open at a given moment.
// Update HOLIDAYS from the exchange circulars each December, when NSE publishes the next year's list.
//
// kind: "trading" (exchanges shut), "settlement" (markets trade, settlement waits a day) or "special" (an extra session, often on a Sunday).
// equity, for NSE, BSE, NFO and BFO: "closed", "open" (normal hours) or ["HH:MM", "HH:MM"] for a special session.
// mcx: "closed", "evening" (17:00 to the normal close), "open" or ["HH:MM", "HH:MM"].
export const HOLIDAYS = [
  { date: "2026-01-15", name: "Municipal Corporation Election", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-01-26", name: "Republic Day", kind: "trading", equity: "closed", mcx: "closed" },
  { date: "2026-02-01", name: "Union Budget session", kind: "special", equity: ["09:15", "15:30"], mcx: ["09:00", "17:00"] },
  { date: "2026-02-19", name: "Chhatrapati Shivaji Maharaj Jayanti", kind: "settlement", equity: "open", mcx: "open" },
  { date: "2026-03-03", name: "Holi", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-03-19", name: "Gudi Padwa", kind: "settlement", equity: "open", mcx: "open" },
  { date: "2026-03-26", name: "Ram Navami", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-03-31", name: "Mahavir Jayanti", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-04-01", name: "Annual Bank Closing", kind: "settlement", equity: "open", mcx: "open" },
  { date: "2026-04-03", name: "Good Friday", kind: "trading", equity: "closed", mcx: "closed" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-05-01", name: "Maharashtra Day", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-05-28", name: "Bakri Id (Eid-ul-Adha)", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-06-26", name: "Muharram", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-08-26", name: "Id-E-Milad", kind: "settlement", equity: "open", mcx: "open" },
  { date: "2026-09-14", name: "Ganesh Chaturthi", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti", kind: "trading", equity: "closed", mcx: "closed" },
  { date: "2026-10-20", name: "Dussehra", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-11-08", name: "Diwali Laxmi Pujan (Muhurat trading)", kind: "special", equity: ["14:20", "15:30"], mcx: ["14:20", "15:30"] },
  { date: "2026-11-10", name: "Diwali Balipratipada", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti", kind: "trading", equity: "closed", mcx: "evening" },
  { date: "2026-12-25", name: "Christmas", kind: "trading", equity: "closed", mcx: "closed" },
];
const BY_DATE = Object.fromEntries(HOLIDAYS.map(row => [row.date, row]));
export const holidayOn = iso => BY_DATE[iso] || null;
export const HOLIDAY_YEARS = [...new Set(HOLIDAYS.map(row => row.date.slice(0, 4)))];

export const KINDS = { trading: "Trading holiday", settlement: "Settlement holiday", special: "Special session" };
export const EQUITY_HOURS = ["09:15", "15:30"];
export const MCX_OPEN = "09:00";
export const MCX_EVENING = "17:00";
const PRE_OPEN_MINUTES = 15;

export const EXCHANGES = [
  { key: "NSE", name: "NSE cash", group: "equity", preOpen: true },
  { key: "BSE", name: "BSE cash", group: "equity", preOpen: true },
  { key: "NFO", name: "NSE F&O", group: "equity" },
  { key: "BFO", name: "BSE F&O", group: "equity" },
  { key: "MCX", name: "Commodities", group: "mcx" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = number => String(number).padStart(2, "0");
const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const asDate = iso => new Date(`${iso}T00:00:00Z`);
export const weekday = iso => DAYS[asDate(iso).getUTCDay()];
export const addDays = (iso, days) => new Date(asDate(iso).getTime() + days * 864e5).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((asDate(to) - asDate(from)) / 864e5);
/** "24 Nov 2026"; short drops the year. */
export const dateLabel = (iso, short = false) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}${short ? "" : ` ${iso.slice(0, 4)}`}`;

/** The date, time and seconds in India for a moment, whatever the browser's own time zone. */
export function indiaTime(ms) {
  const shifted = new Date(ms + 5.5 * 3600e3);
  const iso = shifted.toISOString().slice(0, 10);
  const clock = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
  return { iso, clock, minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

// MCX follows US trading hours: it closes at 23:30 while the US is on summer time and at 23:55 the rest of the year.
const nthSunday = (year, month, nth) => {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return `${year}-${pad(month + 1)}-${pad(1 + (7 - first) % 7 + (nth - 1) * 7)}`;
};
export const mcxClose = iso => {
  const year = Number(iso.slice(0, 4));
  return iso >= nthSunday(year, 2, 2) && iso < nthSunday(year, 10, 1) ? "23:30" : "23:55";
};

/** The [open, close] session of "equity" or "mcx" on a date, or null when that market is shut. */
export function sessionOn(group, iso) {
  const day = asDate(iso).getUTCDay();
  const normal = day === 0 || day === 6 ? null : group === "mcx" ? [MCX_OPEN, mcxClose(iso)] : EQUITY_HOURS;
  const rule = holidayOn(iso)?.[group];
  if (!rule || rule === "open") return normal;
  if (rule === "closed") return null;
  if (rule === "evening") return normal && [MCX_EVENING, normal[1]];
  return rule;
}

const sessionText = session => (session ? `Open ${session[0]}–${session[1]}` : "Closed");
/** How a holiday row reads for "equity" or "mcx": "Closed" or "Open 17:00–23:55". */
export const holidaySession = (group, iso) => sessionText(sessionOn(group, iso));

function nextOpen(exchange, iso, minute) {
  for (let ahead = 0; ahead <= 21; ahead += 1) {
    const day = addDays(iso, ahead);
    const session = sessionOn(exchange.group, day);
    if (session && (ahead > 0 || minute < toMinutes(session[0]))) return { date: day, time: session[0] };
  }
  return null;
}

/** Whether an exchange is open at a moment, when it closes or next opens, and the holiday behind a closure. */
export function exchangeStatus(exchange, ms) {
  const { iso, minute } = indiaTime(ms);
  const session = sessionOn(exchange.group, iso);
  const holiday = holidayOn(iso);
  if (session) {
    const [open, close] = session.map(toMinutes);
    if (minute >= open && minute < close) {
      const evening = holiday?.[exchange.group] === "evening";
      return { state: "open", closes: session[1], session, holiday, note: evening ? `Evening session only (${holiday.name})` : holiday?.kind === "special" ? holiday.name : "" };
    }
    if (exchange.preOpen && session[0] === EQUITY_HOURS[0] && minute >= open - PRE_OPEN_MINUTES && minute < open) {
      return { state: "pre-open", opens: { date: iso, time: session[0] }, holiday };
    }
  }
  const weekend = [0, 6].includes(asDate(iso).getUTCDay());
  const beforeOpen = session && minute < toMinutes(session[0]);
  const reason = holiday && !session ? `Holiday: ${holiday.name}`
    : weekend && !session ? "Weekend"
    : beforeOpen && holiday?.[exchange.group] === "evening" ? `${holiday.name}: evening session only`
    : beforeOpen ? "Before the open" : "After hours";
  return { state: "closed", opens: nextOpen(exchange, iso, minute), holiday, note: reason };
}

/** "today 09:15", "tomorrow 09:00" or "Wed 25 Nov, 09:15". */
export function whenLabel(today, at) {
  if (!at) return "";
  const gap = daysBetween(today, at.date);
  const day = gap === 0 ? "today" : gap === 1 ? "tomorrow" : `${weekday(at.date).slice(0, 3)} ${dateLabel(at.date, true)},`;
  return `${day} ${at.time}`;
}

/** Holidays on or after a date; `kinds` limits them, such as ["trading"]. */
export const upcomingHolidays = (today, kinds = Object.keys(KINDS)) => HOLIDAYS.filter(row => row.date >= today && kinds.includes(row.kind));

/** A trading holiday on a Monday or Friday gives a three-day weekend. */
export const longWeekend = row => row.kind === "trading" && [1, 5].includes(asDate(row.date).getUTCDay());
