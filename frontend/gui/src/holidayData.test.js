import { EXCHANGES, HOLIDAYS, exchangeStatus, holidaySession, indiaTime, longWeekend, mcxClose, sessionOn, upcomingHolidays, weekday, whenLabel } from "./holidayData";

const at = text => Date.parse(`${text}+05:30`);
const exchange = key => EXCHANGES.find(item => item.key === key);
const status = (key, text) => exchangeStatus(exchange(key), at(text));

test("the calendar is in date order, trading and settlement holidays fall on weekdays and special sessions on weekends", () => {
  const dates = HOLIDAYS.map(row => row.date);
  expect([...dates].sort()).toEqual(dates);
  expect(new Set(dates).size).toBe(dates.length);
  HOLIDAYS.forEach(row => {
    const weekend = ["Saturday", "Sunday"].includes(weekday(row.date));
    expect([row.date, weekend]).toEqual([row.date, row.kind === "special"]);
  });
  expect(HOLIDAYS.filter(row => row.kind === "trading")).toHaveLength(16);
});

test("India time does not depend on the browser's time zone", () => {
  expect(indiaTime(Date.parse("2026-11-23T08:37:34Z"))).toEqual({ iso: "2026-11-23", clock: "14:07:34", minute: 14 * 60 + 7 });
  expect(indiaTime(Date.parse("2026-11-23T19:00:00Z")).iso).toBe("2026-11-24");
});

test("MCX closes at 23:30 during US summer time and at 23:55 otherwise", () => {
  expect(["2026-03-06", "2026-03-09", "2026-10-30", "2026-11-02"].map(mcxClose)).toEqual(["23:55", "23:30", "23:30", "23:55"]);
});

test("each holiday resolves to the hours equity and MCX actually trade", () => {
  expect(sessionOn("equity", "2026-11-24")).toBeNull();
  expect(sessionOn("mcx", "2026-11-24")).toEqual(["17:00", "23:55"]);
  expect(sessionOn("mcx", "2026-06-26")).toEqual(["17:00", "23:30"]);
  expect(sessionOn("mcx", "2026-12-25")).toBeNull();
  expect(sessionOn("equity", "2026-02-19")).toEqual(["09:15", "15:30"]);
  expect(sessionOn("equity", "2026-11-08")).toEqual(["14:20", "15:30"]);
  expect(sessionOn("equity", "2026-11-22")).toBeNull();
  expect([holidaySession("equity", "2026-11-24"), holidaySession("mcx", "2026-11-24")]).toEqual(["Closed", "Open 17:00–23:55"]);
});

test("exchange status follows the clock, skips holidays and weekends, and names the holiday", () => {
  expect(status("NSE", "2026-11-23T14:07:34")).toMatchObject({ state: "open", closes: "15:30" });
  expect(status("MCX", "2026-11-23T16:00:00")).toMatchObject({ state: "open", closes: "23:55" });

  const afterHours = status("NFO", "2026-11-23T16:00:00");
  expect(afterHours).toMatchObject({ state: "closed", note: "After hours", opens: { date: "2026-11-25", time: "09:15" } });
  expect(whenLabel("2026-11-23", afterHours.opens)).toBe("Wed 25 Nov, 09:15");

  const holiday = status("NSE", "2026-11-24T11:00:00");
  expect(holiday).toMatchObject({ state: "closed", note: "Holiday: Guru Nanak Jayanti" });
  expect(whenLabel("2026-11-24", holiday.opens)).toBe("tomorrow 09:15");
  const mcxMorning = status("MCX", "2026-11-24T11:00:00");
  expect(mcxMorning.note).toBe("Guru Nanak Jayanti: evening session only");
  expect(whenLabel("2026-11-24", mcxMorning.opens)).toBe("today 17:00");
  expect(status("MCX", "2026-11-24T18:00:00")).toMatchObject({ state: "open", note: "Evening session only (Guru Nanak Jayanti)" });

  expect(status("NSE", "2026-11-25T09:05:00")).toMatchObject({ state: "pre-open", opens: { time: "09:15" } });
  expect(status("NFO", "2026-11-25T09:05:00")).toMatchObject({ state: "closed", note: "Before the open" });
  expect(status("NSE", "2026-11-25T15:30:00").state).toBe("closed");

  const weekend = status("BSE", "2026-11-28T10:00:00");
  expect(weekend.note).toBe("Weekend");
  expect(whenLabel("2026-11-28", weekend.opens)).toBe("Mon 30 Nov, 09:15");
  expect(status("NSE", "2026-11-08T14:30:00")).toMatchObject({ state: "open", closes: "15:30", note: "Diwali Laxmi Pujan (Muhurat trading)" });
});

test("upcoming holidays and long weekends", () => {
  expect(upcomingHolidays("2026-11-23", ["trading"]).map(row => row.name)).toEqual(["Guru Nanak Jayanti", "Christmas"]);
  expect(upcomingHolidays("2026-12-26")).toEqual([]);
  const byDate = date => HOLIDAYS.find(row => row.date === date);
  expect(["2026-12-25", "2026-01-26", "2026-11-24", "2026-04-01"].map(date => longWeekend(byDate(date)))).toEqual([true, true, false, false]);
});
