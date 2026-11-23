import { isToday, matchesSearch, mostMentioned, timeAgo } from "./newsData";

const now = Date.parse("2026-11-23T14:31:00+05:30");

test("times read as minutes, hours, yesterday or a date, in India time", () => {
  expect(timeAgo("2026-11-23T14:30:40+05:30", now)).toBe("just now");
  expect(timeAgo("2026-11-23T14:05:00+05:30", now)).toBe("26 min ago");
  expect(timeAgo("2026-11-23T09:05:00+05:30", now)).toBe("5 h ago");
  expect(timeAgo("2026-11-22T18:30:00+05:30", now)).toBe("Yesterday 18:30");
  expect(timeAgo("2026-11-20T09:15:00+05:30", now)).toBe("20 Nov, 09:15");
  expect(timeAgo("not a date", now)).toBe("");
  // Just after midnight in India the previous evening is "yesterday" even though it is under a day ago.
  expect(timeAgo("2026-11-22T23:00:00+05:30", Date.parse("2026-11-23T00:30:00+05:30"))).toBe("Yesterday 23:00");
  expect([isToday("2026-11-23T00:10:00+05:30", now), isToday("2026-11-22T23:59:00+05:30", now)]).toEqual([true, false]);
});

test("search needs every word somewhere in the story", () => {
  const fields = ["Tata Steel dips 7%", "APL Apollo deal", "TATASTEEL"];
  expect(matchesSearch(fields, "")).toBe(true);
  expect(matchesSearch(fields, "tata apollo")).toBe(true);
  expect(matchesSearch(fields, "tata infosys")).toBe(false);
});

test("the most named stocks count stories and filings, busiest first", () => {
  const news = [{ symbols: ["TATASTEEL", "TCS"] }, { symbols: ["TATASTEEL"] }, { symbols: [] }];
  const filings = [{ symbol: "TCS" }, { symbol: null }, { symbol: "TATASTEEL" }, { symbol: "INFY" }];
  expect(mostMentioned(news, filings)).toEqual([["TATASTEEL", 3], ["TCS", 2], ["INFY", 1]]);
  expect(mostMentioned(news, filings, 1)).toEqual([["TATASTEEL", 3]]);
});
