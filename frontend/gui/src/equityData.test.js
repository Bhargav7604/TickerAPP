import { isOlderEquityQuote, reconcileEquityQuotes } from "./equityData";

const quote = { ltp: 101, quotedAt: "2026-10-13T10:00:04+05:30", fetchedAt: 100, stale: false };

test("broker timestamps reject a delayed quote even when it was fetched more recently", () => {
  const delayed = { ...quote, ltp: 95, quotedAt: "2026-10-13T10:00:00+05:30", fetchedAt: 104 };
  expect(isOlderEquityQuote(quote, delayed)).toBe(true);
  expect(reconcileEquityQuotes({ A: quote }, { A: delayed }, 104).A).toEqual(quote);
});

test("real price falls and same-second depth updates remain allowed", () => {
  const lower = { ...quote, ltp: 95, quotedAt: "2026-10-13T10:00:08+05:30", fetchedAt: 104 };
  const depth = { ...quote, bid: 100.5, fetchedAt: 104 };
  expect(reconcileEquityQuotes({ A: quote }, { A: lower }, 104).A).toBe(lower);
  expect(reconcileEquityQuotes({ A: quote }, { A: depth }, 104).A).toBe(depth);
});

test("fetch time prevents older cached data replacing same-second or undated quotes", () => {
  expect(isOlderEquityQuote(quote, { ...quote, fetchedAt: 99 })).toBe(true);
  expect(isOlderEquityQuote({ fetchedAt: 100 }, { fetchedAt: 99 })).toBe(true);
  expect(isOlderEquityQuote({ quotedAt: "bad", fetchedAt: 100 }, { quotedAt: null, fetchedAt: 99 })).toBe(true);
  expect(isOlderEquityQuote({ ltp: 101 }, { ltp: 102 })).toBe(false);
});

test("quotes are scoped by contract and absent or unavailable quotes are not retained", () => {
  const next = { ...quote, ltp: 99 };
  expect(reconcileEquityQuotes({ A: quote }, { B: next }, 100)).toEqual({ B: next });
  expect(reconcileEquityQuotes({ A: quote }, {}, 100)).toEqual({});
  expect(reconcileEquityQuotes({ A: quote }, { A: null }, 100)).toEqual({ A: null });
});

test("retained quotes age into delayed state and recover on a current snapshot", () => {
  const delayed = { ...quote, quotedAt: "2026-10-13T10:00:00+05:30", fetchedAt: 116 };
  const retained = reconcileEquityQuotes({ A: quote }, { A: delayed }, 116);
  expect(retained.A).toEqual({ ...quote, stale: true });
  const fresh = { ...quote, quotedAt: "2026-10-13T10:00:20+05:30", fetchedAt: 120 };
  expect(reconcileEquityQuotes(retained, { A: fresh }, 120).A).toBe(fresh);
});
