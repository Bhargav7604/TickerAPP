import { alertHit, changeSinceOpen, sampleEvery } from "./straddleData";
import { makeStraddlePayload } from "./straddleFixtures";

const clock = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

test("a coarser interval keeps the quarter hours, the first point and the latest", () => {
  const series = makeStraddlePayload({ points: 10 }).series;   // 09:18 ... 09:45, every 3 minutes
  expect(sampleEvery(series, 3)).toBe(series);
  const sampled = sampleEvery(series, 15);
  expect(sampled.times.map(clock)).toEqual(["09:18", "09:30", "09:45"]);
  expect(sampled.lines.ATM).toEqual([series.lines.ATM[0], series.lines.ATM[4], series.lines.ATM[9]]);
  expect(sampled.atm).toHaveLength(3);
});

test("the change since the open compares the live straddle with its first price of the day", () => {
  const payload = makeStraddlePayload({ points: 5 });
  const move = changeSinceOpen(payload.series, payload.current);
  const first = payload.series.lines.ATM[0];
  expect(move.value).toBe(payload.series.lines.ATM[4]);
  expect(move.change).toBeCloseTo(move.value - first);
  expect(move.pct).toBeCloseTo((move.value - first) / first * 100);
  expect(changeSinceOpen({ times: [], lines: { ATM: [] } }, payload.current)).toBeNull();
});

test("an armed alert fires at or beyond its level in the chosen direction", () => {
  expect(alertHit({ armed: true, direction: "below", level: 75 }, 75)).toBe(true);
  expect(alertHit({ armed: true, direction: "below", level: 75 }, 75.1)).toBe(false);
  expect(alertHit({ armed: true, direction: "above", level: 120 }, 121)).toBe(true);
  expect(alertHit({ armed: false, direction: "above", level: 120 }, 121)).toBe(false);
  expect(alertHit({ armed: true, direction: "above", level: NaN }, 121)).toBe(false);
});
