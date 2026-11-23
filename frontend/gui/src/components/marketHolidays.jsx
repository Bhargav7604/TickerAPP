import React, { useEffect, useState } from "react";
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Panel, Tag } from "./boardUi";
import { PageShell, Segmented, mono } from "../ui/Glass";
import { EXCHANGES, HOLIDAYS, HOLIDAY_YEARS, KINDS, dateLabel, daysBetween, exchangeStatus, holidaySession, indiaTime, longWeekend,
  upcomingHolidays, weekday, whenLabel } from "../holidayData";

const FILTERS = [["all", "All"], ["trading", "Trading"], ["settlement", "Settlement"], ["special", "Special sessions"]];
const KIND_COLOR = { trading: "error", settlement: "warning", special: "info" };
const EQUITY_LABEL = "NSE · BSE · NFO · BFO";
// Below 600px each row becomes a small card: date, day and type on top, the name, then both markets' hours under their own labels
// (the column headings are hidden there).
const PHONE_ROWS = theme => ({
  [theme.breakpoints.down("sm")]: {
    display: "block",
    "& thead": { display: "none" },
    "& tbody": { display: "block" },
    "& tbody tr": { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gridTemplateAreas: '"date day type" "name name name" "eq eq mcx"',
      alignItems: "center", gap: "6px 10px", py: 1.25, borderBottom: 1, borderColor: "divider" },
    "& tbody td": { display: "block", border: 0, p: 0 },
    "& .c-date": { gridArea: "date" }, "& .c-day": { gridArea: "day", color: "text.secondary" }, "& .c-type": { gridArea: "type" },
    "& .c-name": { gridArea: "name" }, "& .c-eq": { gridArea: "eq" }, "& .c-mcx": { gridArea: "mcx" },
    "& td[data-label]::before": { content: "attr(data-label)", display: "block", mb: 0.25, fontSize: 11, color: "text.secondary" },
  },
});

/** The time now, refreshed every second so the status and clock stay current. */
function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

const Dot = ({ color }) => <Box component="span" aria-hidden="true" sx={{ flex: "none", width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />;

/** Green "Open 09:15–15:30" or red "Closed" for one market on a holiday row. */
function SessionTag({ group, date }) {
  const text = holidaySession(group, date);
  return <Tag color={text === "Closed" ? "error" : "success"}><Dot color="currentColor" />{text}</Tag>;
}

function statusLook(status) {
  if (status.state === "open") return { word: "Open", color: "success.main" };
  if (status.state === "pre-open") return { word: "Pre-open", color: "warning.main" };
  return { word: "Closed", color: status.note.startsWith("Holiday") ? "error.main" : "text.disabled" };
}

function statusDetail(status, today) {
  if (status.state === "open") return `Closes ${status.closes}${status.note ? ` · ${status.note}` : ""}`;
  if (status.state === "pre-open") return `Trading starts ${status.opens.time}`;
  const opens = status.opens ? `Opens ${whenLabel(today, status.opens)}` : "";
  return [status.note, opens].filter(Boolean).join(" · ");
}

function LiveStatus({ now }) {
  const { iso, clock } = indiaTime(now);
  const rows = EXCHANGES.map(exchange => ({ exchange, status: exchangeStatus(exchange, now) }));
  const open = rows.filter(row => row.status.state === "open").map(row => row.exchange.key);
  const preOpen = rows.filter(row => row.status.state === "pre-open").map(row => row.exchange.key);
  const summary = open.length ? `Open now: ${open.join(", ")}` : preOpen.length ? `Pre-open: ${preOpen.join(", ")}` : "All exchanges are closed";
  // Phones show only the time, so the clock is never cut short.
  const stamp = <Box component="span" sx={mono}><Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{weekday(iso).slice(0, 3)} {dateLabel(iso)} · </Box>{clock} IST</Box>;
  return <Panel title="Live exchange status" note={stamp}>
    <Typography role="status" sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 800, fontSize: 17, mb: 1.25 }}>
      <Dot color={open.length ? "success.main" : preOpen.length ? "warning.main" : "text.disabled"} />{summary}
    </Typography>
    <Box component="ul" aria-label="Exchange status" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1,
      gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", lg: "repeat(5, minmax(0, 1fr))" } }}>
      {rows.map(({ exchange, status }) => {
        const look = statusLook(status);
        const detail = statusDetail(status, iso);
        return <Box component="li" key={exchange.key} data-exchange={exchange.key} aria-label={`${exchange.key}: ${look.word}${detail ? `. ${detail}` : ""}`}
          sx={{ p: 1.25, borderRadius: 2, border: 1, borderColor: "divider", minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: 15 }}>{exchange.key}</Typography>
            <Typography component="span" variant="caption" color="text.secondary" noWrap>{exchange.name}</Typography>
          </Box>
          <Typography component="span" sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, fontWeight: 800, color: look.color }}>
            <Dot color="currentColor" />{look.word}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, lineHeight: 1.35 }}>{detail}</Typography>
        </Box>;
      })}
    </Box>
  </Panel>;
}

function countdown(today, date) {
  const gap = daysBetween(today, date);
  return gap === 0 ? "Today" : gap === 1 ? "Tomorrow" : `In ${gap} days`;
}

function NextHoliday({ today }) {
  const year = today.slice(0, 4);
  const tradingThisYear = HOLIDAYS.filter(row => row.kind === "trading" && row.date.startsWith(year));
  const [next, after] = upcomingHolidays(today, ["trading"]);
  const left = tradingThisYear.filter(row => row.date >= today).length;
  return <Panel title="Next trading holiday" note={next ? countdown(today, next.date) : undefined} aria-label="Next trading holiday">
    {next ? <>
      <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15 }}>{weekday(next.date)}, {dateLabel(next.date)}</Typography>
      <Typography sx={{ fontWeight: 700, color: "error.main", mt: 0.25 }}>{next.name}</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: "8px 12px", mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">{EQUITY_LABEL}</Typography><Box><SessionTag group="equity" date={next.date} /></Box>
        <Typography variant="body2" color="text.secondary">MCX</Typography><Box><SessionTag group="mcx" date={next.date} /></Box>
      </Box>
      {longWeekend(next) && <Tag color="info" sx={{ mt: 1.5 }}>Long weekend</Tag>}
      {after && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        After that: {weekday(after.date).slice(0, 3)} {dateLabel(after.date, true)} · {after.name}
      </Typography>}
    </> : <Typography variant="body2" color="text.secondary">
      No more trading holidays listed. Next year's list is added when NSE publishes its circular, usually in December.
    </Typography>}
    {tradingThisYear.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
      {left} of {tradingThisYear.length} trading holidays left in {year}
    </Typography>}
  </Panel>;
}

function HolidayTable({ today }) {
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useState(HOLIDAY_YEARS.includes(thisYear) ? thisYear : HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1]);
  const [filter, setFilter] = useState("all");
  const yearRows = HOLIDAYS.filter(row => row.date.startsWith(year));
  const rows = yearRows.filter(row => filter === "all" || row.kind === filter);
  const next = yearRows.find(row => row.date >= today);
  const counts = Object.fromEntries(Object.keys(KINDS).map(kind => [kind, yearRows.filter(row => row.kind === kind).length]));
  const head = { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary", whiteSpace: "nowrap" };
  return <Panel title={`${year} holiday calendar`} aria-label="Holiday calendar"
    note={`${counts.trading} trading · ${counts.settlement} settlement · ${counts.special} special`}>
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mb: 1.25 }}>
      {HOLIDAY_YEARS.length > 1 && <Segmented label="Year" value={year} onChange={setYear} options={HOLIDAY_YEARS.map(item => [item, item])} />}
      <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS} />
    </Box>
    {!HOLIDAY_YEARS.includes(thisYear) && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
      The {thisYear} list is not published yet; showing {year}.
    </Typography>}
    <TableContainer sx={{ overflowX: { sm: "auto" } }}>
      <Table size="small" aria-label={`${year} market holidays`} sx={[{ minWidth: { sm: 760 }, "& td, & th": { borderColor: "divider" } }, PHONE_ROWS]}>
        <TableHead>
          <TableRow>
            {["Date", "Day", "Holiday", "Type", EQUITY_LABEL, "MCX"].map(label => <TableCell key={label} scope="col" sx={head}>{label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => {
            const past = row.date < today;
            const isNext = row === next;
            return <TableRow key={row.date} data-date={row.date} data-past={past || undefined} aria-current={isNext ? "date" : undefined}
              sx={{ opacity: past ? 0.55 : 1, bgcolor: theme => isNext ? alpha(theme.palette.primary.main, 0.08) : "transparent" }}>
              <TableCell className="c-date" sx={{ ...mono, whiteSpace: "nowrap", fontWeight: 700 }}>{dateLabel(row.date)}</TableCell>
              <TableCell className="c-day" sx={{ whiteSpace: "nowrap" }}>{weekday(row.date)}</TableCell>
              <TableCell className="c-name">
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
                  <Box component="span" sx={{ fontWeight: 700 }}>{row.name}</Box>
                  {isNext && <Tag color="primary">{row.date === today ? "Today" : "Next"}</Tag>}
                  {longWeekend(row) && !past && <Tag color="info">Long weekend</Tag>}
                </Box>
              </TableCell>
              <TableCell className="c-type"><Tag color={KIND_COLOR[row.kind]}>{KINDS[row.kind]}</Tag></TableCell>
              <TableCell className="c-eq" data-label={EQUITY_LABEL}><SessionTag group="equity" date={row.date} /></TableCell>
              <TableCell className="c-mcx" data-label="MCX"><SessionTag group="mcx" date={row.date} /></TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </TableContainer>
  </Panel>;
}

export default function MarketHolidays() {
  const now = useNow();
  const today = indiaTime(now).iso;
  return <PageShell className="holidays-page">
    <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" }, mb: 0.5 }}>Market Holidays</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      Which Indian exchanges are open right now, and the NSE, BSE and MCX trading and settlement holidays for the year.
    </Typography>
    <Box sx={{ display: "grid", gap: 1.5, alignItems: "stretch", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(300px, 1fr)" }, mb: 1.5 }}>
      <LiveStatus now={now} />
      <NextHoliday today={today} />
    </Box>
    <HolidayTable today={today} />
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5, lineHeight: 1.6 }}>
      Normal hours: NSE and BSE cash 09:15–15:30 with pre-open from 09:00; NSE and BSE F&O 09:15–15:30; MCX 09:00–23:30 while the US is on summer time
      (mid-March to early November) and 09:00–23:55 the rest of the year. On a settlement holiday the markets trade as usual and trades settle a day later.
      On most NSE holidays MCX skips the morning and opens for the evening session at 17:00.
    </Typography>
  </PageShell>;
}
