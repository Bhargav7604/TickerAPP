// Sample /api/straddle/ responses for tests and the design preview: a NIFTY session where the straddle decays into expiry.
import { LINES } from "./straddleData";

const STEP = 50;
const at = (day, minutes) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + minutes * 60;
const round2 = value => Math.round(value * 100) / 100;

/** The ladder at one moment: the straddle is `straddle`, each strike out is cheaper, ITM 1 dearer. */
export function makeRows(atm, straddle) {
  return LINES.map(([key]) => {
    const offset = key === "ATM" ? 0 : key === "ITM1" ? -1 : Number(key.slice(3));
    const total = round2(key === "ITM1" ? straddle * 1.32 : straddle * Math.exp(-0.42 * offset));
    const ce = round2(total * (offset >= 0 ? 0.47 : 0.62));
    return { key, ceStrike: atm + offset * STEP, ce, peStrike: atm - offset * STEP, pe: round2(total - ce), total };
  });
}

export function makeStraddlePayload({ day = "2026-11-23", expiry = "2026-11-24", points = 100, live = true, label = "NIFTY", index = "nifty" } = {}) {
  const series = { times: [], spot: [], synthetic: [], atm: [], lines: Object.fromEntries(LINES.map(([key]) => [key, []])) };
  let current = null;
  for (let i = 0; i < points; i += 1) {
    const spot = round2(25480 - i * 0.6 + Math.sin(i / 7) * 28);
    const atm = Math.round((spot + 2) / STEP) * STEP;
    const straddle = round2(210 * Math.exp(-i / 95) + Math.sin(i / 4) * 4);
    const rows = makeRows(atm, straddle);
    const time = at(day, 3 * (i + 1));
    series.times.push(time); series.spot.push(spot); series.synthetic.push(round2(spot + 2)); series.atm.push(atm);
    rows.forEach(row => series.lines[row.key].push(row.total));
    current = { at: time, spot, synthetic: round2(spot + 2), atm, rows };
  }
  return { type: "success", index, label, expiry, day, days: [day, "2026-11-20"], dte: 1, live, current, series, marketOpen: live, message: "" };
}

/** The design preview's straddles, dated today so the clock reads naturally. */
export function makeStraddlePreviewApi() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const later = value => new Promise(resolve => setTimeout(() => resolve(value), 80));
  return {
    expiries: () => later({ type: "success", expiries: [today, "2026-12-01"], recorded: [today] }),
    load: (index, expiry) => later(makeStraddlePayload({ day: today, expiry, index, label: index.toUpperCase(), live: false })),
  };
}
