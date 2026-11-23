import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, ButtonBase, IconButton, InputAdornment, Link, MenuItem, TextField, Typography } from "@mui/material";
import { ExternalLink, FileText, Search, X } from "lucide-react";
import { fpc, poll, useBoard } from "../boardData";
import { indiaTime } from "../holidayData";
import { GROUPS, GROUP_INFO, isToday, matchesSearch, mostMentioned, timeAgo } from "../newsData";
import { Panel, Tag, toneColor } from "./boardUi";
import StockDrawer from "./stockDrawer";
import { PageShell, Segmented, mono } from "../ui/Glass";

const REFRESH_MS = 120000;
const PAGE = 30;
const SCOPES = [["tracked", "NIFTY 500 & F&O"], ["all", "All companies"]];

/** A stock named in a story or filing, with its live move when the board has it. Clicking shows only that stock's news. */
function StockChip({ sym, info, st, count, active, onClick }) {
  const pc = st?.pc;
  return <ButtonBase onClick={onClick} data-sym={sym} aria-pressed={active || undefined}
    title={`${info?.company || sym}: show only its news and filings`}
    sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, px: 1, py: 0.35, borderRadius: 999, border: 1, fontSize: 12, fontWeight: 800,
      borderColor: active ? "primary.main" : "divider", bgcolor: active ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
    <span>{sym}</span>
    {info?.fno && <Box component="span" sx={{ fontSize: 9, fontWeight: 800, color: "info.main" }}>F&O</Box>}
    {Number.isFinite(pc) && <Box component="span" sx={{ ...mono, color: toneColor(pc) }}>{fpc(pc)}</Box>}
    {count > 0 && <Box component="span" sx={{ ...mono, color: "text.secondary", fontWeight: 700 }}>· {count}</Box>}
  </ButtonBase>;
}

function ShowMore({ total, shown, onMore, what }) {
  if (total <= shown) return null;
  return <Button size="small" onClick={onMore} sx={{ mt: 1 }}>Show {Math.min(PAGE, total - shown)} more {what} ({total - shown} left)</Button>;
}

function Empty({ children }) {
  return <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{children}</Typography>;
}

function NewsList({ items, total, stocks, bySym, now, focus, onStock, onMore }) {
  if (!total) return <Empty>No stories match.</Empty>;
  return <>
    <Box component="ul" aria-label="Market news" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {items.map(item => <Box component="li" key={item.id} data-id={item.id} sx={{
        display: "grid", gridTemplateColumns: item.image ? "minmax(0, 1fr) clamp(76px, 22%, 112px)" : "minmax(0, 1fr)", gap: 1.5,
        py: 1.5, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ fontWeight: 600 }}>
            {item.source}{item.section ? ` · ${item.section}` : ""} · <time dateTime={item.published}>{timeAgo(item.published, now)}</time>
          </Typography>
          <Link href={item.url} target="_blank" rel="noopener noreferrer" underline="hover"
            sx={{ display: "block", mt: 0.25, color: "text.primary", fontWeight: 800, fontSize: 15, lineHeight: 1.35 }}>
            {item.title}<Box component={ExternalLink} size={12} aria-hidden="true" sx={{ ml: 0.5, verticalAlign: "-1px", color: "text.secondary" }} />
          </Link>
          {item.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {item.summary}
          </Typography>}
          {item.symbols.length > 0 && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
            {item.symbols.map(sym => <StockChip key={sym} sym={sym} info={stocks[sym]} st={bySym[sym]} active={focus === sym} onClick={() => onStock(sym)} />)}
          </Box>}
        </Box>
        {item.image && <Box component="img" src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer"
          onError={event => { event.currentTarget.style.display = "none"; }}
          sx={{ width: "100%", aspectRatio: "3 / 2", objectFit: "cover", borderRadius: 2, bgcolor: "action.hover", alignSelf: "start" }} />}
      </Box>)}
    </Box>
    <ShowMore total={total} shown={items.length} onMore={onMore} what="stories" />
  </>;
}

function filingTime(iso, now) {
  const { iso: day, clock } = indiaTime(Date.parse(iso));
  return day === indiaTime(now).iso ? clock.slice(0, 5) : timeAgo(iso, now);
}

function FilingList({ rows, total, stocks, bySym, now, focus, onStock, onMore }) {
  if (!total) return <Empty>No filings match.</Empty>;
  return <>
    <Box component="ul" aria-label="Company filings" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {rows.map(row => {
        const group = GROUP_INFO[row.group] || GROUP_INFO.other;
        return <Box component="li" key={row.id} data-id={row.id} sx={{ py: 1.25, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: 14.5, minWidth: 0 }}>{row.company}</Typography>
            {row.symbol && <StockChip sym={row.symbol} info={stocks[row.symbol]} st={bySym[row.symbol]} active={focus === row.symbol} onClick={() => onStock(row.symbol)} />}
            <Box component="time" dateTime={row.published} sx={{ ...mono, ml: "auto", fontSize: 12, color: "text.secondary", whiteSpace: "nowrap" }}>{filingTime(row.published, now)}</Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 0.75 }}>
            <Tag color={group.color}>{group.label}</Tag>
            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>{row.subject}</Typography>
          </Box>
          {row.text && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{row.text}</Typography>}
          {row.url && <Link href={row.url} target="_blank" rel="noopener noreferrer" underline="hover"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, mt: 0.75, fontSize: 13, fontWeight: 700 }}>
            <FileText size={14} aria-hidden="true" />Open filing (PDF)
          </Link>}
        </Box>;
      })}
    </Box>
    <ShowMore total={total} shown={rows.length} onMore={onMore} what="filings" />
  </>;
}

function SourceNotes({ sources, keys }) {
  const down = sources.filter(source => keys.includes(source.key) && !source.ok);
  if (!down.length) return null;
  const names = [...new Set(down.map(source => source.name))];
  const kept = down.some(source => source.count > 0);
  return <Typography variant="caption" color="warning.main" component="p" sx={{ mb: 1 }}>
    {names.join(", ")} {names.length > 1 ? "are" : "is"} not responding{kept ? "; showing the stories fetched earlier" : ""}.
  </Typography>;
}

export default function News({ api, boardApi }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(null);
  const [pick, setPick] = useState(null);
  const [view, setView] = useState("news");
  const [source, setSource] = useState("all");
  const [scope, setScope] = useState("tracked");
  const [group, setGroup] = useState("all");
  const [newsShown, setNewsShown] = useState(PAGE);
  const [filingsShown, setFilingsShown] = useState(PAGE);
  const { snapshot, scan } = useBoard(boardApi, { every: 15000 });

  useEffect(() => poll(async (signal, stopped) => {
    try {
      const result = await api.load(signal);
      if (!stopped()) { setData(result); setError(""); setNow(Date.now()); }
    } catch (exc) {
      if (!stopped() && exc.name !== "AbortError") setError(exc.message);
    }
  }, REFRESH_MS), [api]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const stocks = data?.stocks || {};
  const bySym = snapshot?.bySym || {};
  const allNews = data?.news || [];
  const allFilings = data?.announcements || [];
  const sources = data?.sources || [];
  const publishers = [...new Set(allNews.map(item => item.source))].sort();
  const companyNames = symbols => symbols.map(sym => stocks[sym]?.company);

  const news = useMemo(() => allNews.filter(item => (source === "all" || item.source === source)
    && (!focus || item.symbols.includes(focus))
    && matchesSearch([item.title, item.summary, item.source, ...item.symbols, ...companyNames(item.symbols)], query)),
  [allNews, source, focus, query, stocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoped = allFilings.filter(row => (scope === "all" || row.symbol) && (!focus || row.symbol === focus)
    && matchesSearch([row.company, row.subject, row.text, row.symbol], query));
  const filings = scoped.filter(row => group === "all" || row.group === group);
  const groupCounts = scoped.reduce((counts, row) => ({ ...counts, [row.group]: (counts[row.group] || 0) + 1 }), {});

  const todayNews = allNews.filter(item => isToday(item.published, now));
  const todayFilings = allFilings.filter(row => isToday(row.published, now));
  const trending = mostMentioned(todayNews, todayFilings);
  const chooseStock = sym => { setFocus(previous => previous === sym ? null : sym); setNewsShown(PAGE); setFilingsShown(PAGE); };
  const columnShown = key => ({ xs: view === key ? "block" : "none", lg: "block" });

  return <PageShell className="news-page">
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap", mb: 0.5 }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>News</Typography>
      {data && <Typography variant="caption" color="text.secondary" sx={mono}>
        Today: {todayNews.length} stories · {todayFilings.length} filings · updated {indiaTime(Date.parse(data.updated)).clock.slice(0, 5)} IST
      </Typography>}
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      Market headlines from Economic Times, Mint, Business Standard and The Hindu BusinessLine, and company filings from NSE,
      tagged with the NIFTY 500 and F&O stocks they mention. Stories open on the publisher's site.
    </Typography>

    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1.5 }}>
      <TextField size="small" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search stories, companies or symbols"
        inputProps={{ "aria-label": "Search news" }} sx={{ flex: "1 1 260px", maxWidth: 460 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
          endAdornment: query ? <InputAdornment position="end"><IconButton size="small" aria-label="Clear search" onClick={() => setQuery("")}><X size={15} /></IconButton></InputAdornment> : null }} />
      {focus && <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="body2">Showing <b>{focus}</b>{stocks[focus]?.company ? ` · ${stocks[focus].company}` : ""}</Typography>
        {bySym[focus] && <Button size="small" variant="outlined" onClick={() => setPick(focus)}>Open stock card</Button>}
        <Button size="small" onClick={() => setFocus(null)} startIcon={<X size={14} />}>Show all</Button>
      </Box>}
    </Box>

    {trending.length > 0 && <Box component="section" aria-label="In the news today" sx={{ mb: 1.5 }}>
      <Typography variant="overline" color="text.secondary" component="h2">In the news today</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
        {trending.map(([sym, count]) => <StockChip key={sym} sym={sym} info={stocks[sym]} st={bySym[sym]} count={count} active={focus === sym} onClick={() => chooseStock(sym)} />)}
      </Box>
    </Box>}

    {error && <Typography role="alert" variant="body2" sx={{ mb: 1.5, px: 1.5, py: 1, borderRadius: 2, bgcolor: "action.hover", color: "text.secondary" }}>
      {error}{data ? " Showing the last news fetched." : ""}
    </Typography>}
    {!data && !error && <Typography role="status" variant="body2" color="text.secondary">Loading news…</Typography>}
    {data?.message && <Typography role="status" variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{data.message}</Typography>}

    {data && <>
      <Box sx={{ display: { xs: "block", lg: "none" }, mb: 1.5 }}>
        <Segmented label="Show" value={view} onChange={setView} options={[["news", `News (${news.length})`], ["filings", `Filings (${filings.length})`]]} />
      </Box>
      <Box sx={{ display: "grid", gap: 1.5, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1.15fr) minmax(0, 1fr)" } }}>
        <Panel title="Market news" note={`${news.length} stories`} sx={{ display: columnShown("news") }}
          actions={<TextField select size="small" value={source} onChange={event => { setSource(event.target.value); setNewsShown(PAGE); }}
            SelectProps={{ inputProps: { "aria-label": "News source" } }} sx={{ minWidth: 150, "& .MuiInputBase-root": { fontSize: 13 } }}>
            <MenuItem value="all">All sources</MenuItem>
            {publishers.map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
          </TextField>}>
          <SourceNotes sources={sources} keys={sources.filter(item => item.key !== "nse").map(item => item.key)} />
          <NewsList items={news.slice(0, newsShown)} total={news.length} stocks={stocks} bySym={bySym} now={now} focus={focus}
            onStock={chooseStock} onMore={() => setNewsShown(shown => shown + PAGE)} />
        </Panel>
        <Panel title="Company filings · NSE" note={`${filings.length} filings`} sx={{ display: columnShown("filings") }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mb: 1 }}>
            <Segmented label="Companies" value={scope} onChange={value => { setScope(value); setFilingsShown(PAGE); }} options={SCOPES} />
            <TextField select size="small" value={group} onChange={event => { setGroup(event.target.value); setFilingsShown(PAGE); }}
              SelectProps={{ inputProps: { "aria-label": "Filing type" } }} sx={{ minWidth: 170, "& .MuiInputBase-root": { fontSize: 13 } }}>
              <MenuItem value="all">All types ({scoped.length})</MenuItem>
              {GROUPS.filter(([key]) => groupCounts[key]).map(([key, label]) => <MenuItem key={key} value={key}>{label} ({groupCounts[key]})</MenuItem>)}
            </TextField>
          </Box>
          <SourceNotes sources={sources} keys={["nse"]} />
          <FilingList rows={filings.slice(0, filingsShown)} total={filings.length} stocks={stocks} bySym={bySym} now={now} focus={focus}
            onStock={chooseStock} onMore={() => setFilingsShown(shown => shown + PAGE)} />
        </Panel>
      </Box>
    </>}
    <StockDrawer sym={pick} snapshot={snapshot} scan={scan} api={boardApi} onClose={() => setPick(null)} />
  </PageShell>;
}
