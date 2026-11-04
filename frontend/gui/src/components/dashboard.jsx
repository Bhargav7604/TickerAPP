import { Component, Fragment as ReactFragment } from "react";
import { Alert, Box, Button, Chip, IconButton, Paper, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from "@mui/material";
import { RefreshCw } from "lucide-react";
import { IconSwitch, Segmented, mono } from "../ui/Glass";
import MarketComparison, { MARKET_LAYOUTS } from "./marketComparison";
import MarketChart from "./marketChart";
import MarketColumnSelector from "./marketColumnSelector";
import { alertLotThreshold, describeAlertThresholds } from "../alertThresholds";

const INDEX_LABELS = {
  nifty: "Nifty",
  banknifty: "Banknifty",
  sensex: "Sensex"
};
const INDEX_ORDER = ["nifty", "banknifty", "sensex"];
// Exchange strike-step per index, used to express an option's distance from
// the ATM strike in whole strikes (e.g. ATM+2).
const STRIKE_STEP_BY_INDEX = {
  nifty: 50,
  banknifty: 100,
  sensex: 100
};
const MARKET_LAYOUT_KEY = "utraders-market-layout";
const readMarketLayout = () => {
  try {
    const stored = localStorage.getItem(MARKET_LAYOUT_KEY);
    return MARKET_LAYOUTS.some(([value]) => value === stored) ? stored : "cards";
  } catch { return "cards"; }
};
const CONTRACT_OPTIONS = [
  ["current", "Current"],
  ["next", "Next"],
  ["far", "Far"]
];
const MARKET_OPEN_MINUTES = 9 * 60;
const MARKET_CLOSE_MINUTES = (15 * 60) + 30;
const MARKET_AXIS_STEP_MINUTES = 5;
const MARKET_TIME_ZONE = "Asia/Kolkata";
const MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const MARKET_TIME_PART_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});
const CHART_TIME_RANGES = [
  ["full", "Full day", MARKET_OPEN_MINUTES, MARKET_CLOSE_MINUTES],
  ["morning", "09:00-11:00", MARKET_OPEN_MINUTES, 11 * 60],
  ["midday", "11:00-13:00", 11 * 60, 13 * 60],
  ["afternoon", "13:00-15:30", 13 * 60, MARKET_CLOSE_MINUTES],
  ["last60", "Last 60 min", null, null]
];
// Defaults used when the backend response hasn't loaded yet. The backend is
// the source of truth for the live threshold values (returned in
// thresholds.priceChangePct / volumeDiffPct on /api/acdd/signals/).
const AC_DD_PRICE_THRESHOLD_PCT = 0.2;
const AC_DD_VOLUME_SIGNAL_THRESHOLD_PCT = 250;
const AC_DD_TIMEFRAMES = [
  ["5", "5 min", 5],
  ["15", "15 min", 15]
];
const formatterParts = (formatter, timestamp) => {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return {};
  }

  return formatter.formatToParts(date).reduce((parts, part) => {
    parts[part.type] = part.value;
    return parts;
  }, {});
};
const getMarketDateKey = timestamp => {
  const parts = formatterParts(MARKET_DATE_FORMATTER, timestamp);

  if (!parts.year || !parts.month || !parts.day) {
    return null;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
};
const getMarketMinutesOfDay = timestamp => {
  const parts = formatterParts(MARKET_TIME_PART_FORMATTER, timestamp);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return (hour * 60) + minute;
};

class Dashboard extends Component {
  constructor(props) {
    super(props);

    this.state = {
      selectedChartIndex: "nifty",
      selectedChartTimeRange: "last60",
      selectedActivityTab: "alerts",
      selectedChartMetric: "netLots",
      selectedSnapshotIndex: "all",
      hoveredChartPoint: null,
      marketLayout: readMarketLayout()
    };

    this.dataKeys = {
      nifty: "niftyData",
      banknifty: "bankniftyData",
      sensex: "sensexData"
    };


  }

  handleMarketLayoutChange = marketLayout => {
    this.setState({ marketLayout });
    try { localStorage.setItem(MARKET_LAYOUT_KEY, marketLayout); } catch { /* storage unavailable */ }
  }

  handleChartIndexChange = e => {
    this.setState({
      selectedChartIndex: e.target.value,
      hoveredChartPoint: null
    });
  }

  handleSnapshotIndexChange = e => {
    this.setState({ selectedSnapshotIndex: e.target.value });
  }

  handleChartTimeRangeChange = e => {
    this.setState({
      selectedChartTimeRange: e.target.value,
      hoveredChartPoint: null
    });
  }

  handleChartMetricChange = e => {
    this.setState({
      selectedChartMetric: e.target.value,
      hoveredChartPoint: null
    });
  }

  handleChartPointEnter = (point, x, y) => {
    this.setState({
      hoveredChartPoint: {
        point,
        x,
        y
      }
    });
  }

  handleChartPointLeave = () => {
    this.setState({
      hoveredChartPoint: null
    });
  }

  handleContractMonthClick = contractMonth => {
    if (this.props.handleContractMonthChange) {
      this.props.handleContractMonthChange(contractMonth);
    }
  }

  valueClass = (value, fallbackClass) => {
    if (fallbackClass === "neutral") {
      return "value-neutral";
    }

    const normalizedValue = typeof value === "string" ? value.replace(/,/g, "").replace("%", "") : value;
    const numericValue = Number(normalizedValue);

    if (!Number.isFinite(numericValue) || numericValue === 0) {
      return "value-neutral";
    }

    return numericValue < 0 ? "value-down" : "value-up";
  }

  formatValue = value => {
    if (value === null || value === undefined || value === "") {
      return "-";
    }

    if (value === "N/A") {
      return value;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return value;
    }

    return numericValue.toLocaleString("en-IN", {
      maximumFractionDigits: 2
    });
  }

  formatSignedValue = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue === 0) {
      return this.formatValue(value);
    }

    return `${numericValue > 0 ? "+" : ""}${this.formatValue(numericValue)}`;
  }

  formatPercent = (value, signed=false) => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return "-";
    }

    return `${signed ? this.formatSignedValue(numericValue) : this.formatValue(numericValue)}%`;
  }

  formatTime = timestamp => {
    const minutes = this.getMinutesOfDay(timestamp);

    if (!Number.isFinite(minutes)) {
      return "-";
    }

    return this.formatMarketTime(minutes);
  }

  formatHeartbeatAge = seconds => {
    // Guard explicitly against null/undefined — Number(null) is 0, which
    // would otherwise fall through to the "<60s" branch and lie about
    // freshness when the backend really means "no snapshot at all yet."
    if (seconds === null || seconds === undefined) {
      return "";
    }

    const numericSeconds = Number(seconds);

    if (!Number.isFinite(numericSeconds)) {
      return "";
    }

    if (numericSeconds < 60) {
      return "now";
    }

    const minutes = Math.floor(numericSeconds / 60);

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
  }

  heartbeatClass = status => {
    return ["live", "delayed", "stale", "closed"].includes(status) ? status : "checking";
  }

  formatExpiry = value => {
    if (!value) {
      return "-";
    }

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  formatMarketTime = minutes => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  getMarketAxisMinutes = (startMinutes=MARKET_OPEN_MINUTES, endMinutes=MARKET_CLOSE_MINUTES) => {
    const minutes = [];

    for (let minute = startMinutes; minute <= endMinutes; minute += MARKET_AXIS_STEP_MINUTES) {
      minutes.push(minute);
    }

    return minutes;
  }

  getData = key => {
    const data = this.props[this.dataKeys[key]] || {};
    const spotPrice = Number(this.props.spotPrices?.[key]);
    const futurePrice = Number(data.cmp);
    const spot = Number.isFinite(spotPrice) && spotPrice > 0 ? spotPrice : null;
    const futuresSpotDifference = spot !== null
      && data.symbol === this.getCurrentSymbol(key)
      && Number.isFinite(futurePrice) && futurePrice > 0
      ? Number((futurePrice - spot).toFixed(2))
      : null;

    return { ...data, spot, futuresSpotDifference };
  }

  getMinutesOfDay = timestamp => {
    return getMarketMinutesOfDay(timestamp);
  }

  isSameMarketDate = (timestamp, anchorTimestamp) => {
    return getMarketDateKey(timestamp) === getMarketDateKey(anchorTimestamp);
  }

  isMarketTime = timestamp => {
    const minutes = this.getMinutesOfDay(timestamp);
    return minutes >= MARKET_OPEN_MINUTES && minutes <= MARKET_CLOSE_MINUTES;
  }

  getCurrentSymbol = key => {
    const symbols = this.props.settings.symbols || {};
    return symbols[key]?.symbol || INDEX_LABELS[key].toUpperCase();
  }

  getCurrentExpiry = key => {
    const symbols = this.props.settings.symbols || {};
    const fallbackKey = `${key}Expiry`;

    return symbols[key]?.expiry || this.props.settings[fallbackKey];
  }

  // Snapshots arrive once a minute but the page re-renders with every price tick, so reuse the last answer.
  getChartPoints = key => {
    const symbol = this.getCurrentSymbol(key);
    const day = getMarketDateKey(this.props.marketTime || Date.now());
    const cached = this.chartPointCache?.[key];
    if (cached && cached.history === this.props.chartHistory && cached.symbol === symbol && cached.day === day) return cached.points;
    const points = this.computeChartPoints(key, symbol);
    this.chartPointCache = { ...this.chartPointCache, [key]: { history: this.props.chartHistory, symbol, day, points } };
    return points;
  }

  computeChartPoints = (key, symbol) => {
    const chartHistory = this.props.chartHistory || {};
    const points = chartHistory[key] || [];
    const uniquePoints = new Map();
    const todayMarketDate = getMarketDateKey(this.props.marketTime || Date.now());

    points
      .filter(point => (
        point.symbol === symbol &&
        getMarketDateKey(point.time) === todayMarketDate &&
        this.isMarketTime(point.time)
      ))
      .forEach(point => {
        uniquePoints.set(point.time, point);
      });

    const sortedPoints = Array.from(uniquePoints.values()).sort((a, b) => a.time - b.time);
    const latestPoint = sortedPoints[sortedPoints.length - 1];

    if (!latestPoint) {
      return [];
    }

    return sortedPoints.filter(point => this.isSameMarketDate(point.time, latestPoint.time));
  }

  getSelectedChartTimeRange = points => {
    const selectedRange = CHART_TIME_RANGES.find(([value]) => value === this.state.selectedChartTimeRange) || CHART_TIME_RANGES[0];
    const [value, label, start, end] = selectedRange;

    if (value !== "last60") {
      return { value, label, start, end };
    }

    const latestPoint = points[points.length - 1];
    const latestMinutes = latestPoint ? this.getMinutesOfDay(latestPoint.time) : MARKET_CLOSE_MINUTES;
    const endMinutes = Math.min(Math.max(latestMinutes, MARKET_OPEN_MINUTES + 60), MARKET_CLOSE_MINUTES);
    const startMinutes = Math.max(endMinutes - 60, MARKET_OPEN_MINUTES);

    return {
      value,
      label: `${this.formatMarketTime(startMinutes)}-${this.formatMarketTime(endMinutes)}`,
      start: startMinutes,
      end: endMinutes
    };
  }

  getLatestSnapshot = () => {
    const allPoints = INDEX_ORDER
      .flatMap(key => this.getChartPoints(key))
      .sort((a, b) => a.time - b.time);

    return allPoints[allPoints.length - 1];
  }

  // AC/DD analysis moved to the backend (backend/acdd_analyzer.py). The
  // dashboard reads precomputed signals from props.acDdSignals.byTimeframe
  // keyed by the selected timeframe (in minutes, stringified).

  getRange = (points, field) => {
    const values = points
      .map(point => Number(point[field]))
      .filter(value => Number.isFinite(value));

    if (values.length === 0) {
      return { min: 0, max: 1 };
    }

    let min = Math.min(...values);
    let max = Math.max(...values);

    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.01, 1);
      min -= pad;
      max += pad;
    }

    return { min, max };
  }

  buildPath = (points, field, xScale, yScale) => {
    return points
      .filter(point => Number.isFinite(Number(point[field])))
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${xScale(point)} ${yScale(Number(point[field]))}`;
      })
      .join(" ");
  }

  renderCommandBar = () => {
    const contractMonth = this.props.settings.contractMonth || "current";
    const heartbeat = this.props.snapshotHeartbeat || {};
    const latest = heartbeat.latestSnapshotTime;
    const sessionDate = new Date(this.props.marketTime || Date.now()).toLocaleDateString("en-GB", {
      timeZone: MARKET_TIME_ZONE, day: "2-digit", month: "short", year: "numeric"
    });
    const statusColor = { live: "success", delayed: "warning", stale: "error" }[heartbeat.status] || "default";
    return (
      <Stack component="section" className="scan-command-bar" direction={{ xs: "column", md: "row" }} spacing={1.25}
        justifyContent="space-between" alignItems={{ md: "center" }}>
        <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="h2" component="h1" sx={{ fontSize: "1.15rem" }}>Market overview</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip size="small" variant="outlined" label={sessionDate} />
            <Chip size="small" color={statusColor} variant={statusColor === "default" ? "outlined" : "filled"}
              label={`${this.props.previewLabel || heartbeat.label || "Checking"}${latest !== null && latest !== undefined ? ` · ${this.formatTime(latest)} IST` : ""}`} />
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Segmented highlight label="contract month" value={contractMonth} options={CONTRACT_OPTIONS} onChange={value => this.handleContractMonthClick(value)} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: { xs: "auto", md: 1 } }}>
            <IconSwitch label="Market overview layout" value={this.state.marketLayout} options={MARKET_LAYOUTS} onChange={this.handleMarketLayoutChange} />
            <MarketColumnSelector value={this.props.settings.marketColumns} onSave={this.props.handleMarketColumnsSave} />
            <Tooltip title="Refresh market data">
              <IconButton aria-label="Refresh market data" onClick={this.props.handleDashboardRefresh}><RefreshCw size={19} /></IconButton>
            </Tooltip>
          </Box>
        </Stack>
      </Stack>
    );
  }

  renderSnapshotPreview = () => {
    const times = [...new Set(INDEX_ORDER.flatMap(key => this.getChartPoints(key).map(p => p.time)))].sort((a, b) => b - a).slice(0, 5);
    const byIndex = Object.fromEntries(INDEX_ORDER.map(key => [key, new Map(this.getChartPoints(key).map(p => [p.time, p]))]));
    const tone = value => this.valueClass(value) === "value-up" ? "success.main" : this.valueClass(value) === "value-down" ? "error.main" : "text.primary";
    return <Paper component="section" className="scan-snapshot-preview" aria-label="Five-minute snapshot preview" sx={{ gridArea: "preview", overflow: "hidden", minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="h3" component="h2">Five-minute snapshots</Typography>
        <Button size="small" onClick={() => this.setState({ selectedActivityTab: "snapshots" })}>Full session</Button>
      </Stack>
      <TableContainer>
        <Table size="small" sx={{ "& td, & tbody th": { ...mono, fontSize: 13 }, "& td, & th": { whiteSpace: "nowrap" } }}>
          <TableHead>
            <TableRow><TableCell scope="col" rowSpan={2}>Time</TableCell>
              {INDEX_ORDER.map(key => <TableCell scope="colgroup" colSpan={2} key={key} align="center">{INDEX_LABELS[key]}</TableCell>)}</TableRow>
            <TableRow>{INDEX_ORDER.map(key => <ReactFragment key={key}><TableCell scope="col" align="right">Futures</TableCell><TableCell scope="col" align="right">Net lots</TableCell></ReactFragment>)}</TableRow>
          </TableHead>
          <TableBody>
            {times.map(time => <TableRow key={time} hover><TableCell component="th" scope="row">{this.formatTime(time)}</TableCell>
              {INDEX_ORDER.map(key => { const point = byIndex[key].get(time);
                return <ReactFragment key={key}><TableCell align="right">{this.formatValue(point?.indexLevel)}</TableCell>
                  <TableCell align="right" className={this.valueClass(point?.netLots)} sx={{ color: tone(point?.netLots), fontWeight: 700 }}>{this.formatSignedValue(point?.netLots)}</TableCell></ReactFragment>;
              })}</TableRow>)}
            {!times.length && <TableRow><TableCell colSpan={7} sx={{ color: "text.secondary" }}>No snapshots yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>;
  }

  renderActivity = () => {
    const selected = this.state.selectedActivityTab;
    const swingCount = this.getSwingRows().length;
    // contain: size lets the panel fill the rows beside the chart without making them taller; it scrolls inside.
    return <Paper component="aside" className="scan-activity" sx={{ gridArea: "activity", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden",
      contain: "size", alignSelf: "stretch", height: { xs: 520, lg: "auto" }, minHeight: { lg: 520 } }}>
      <Box sx={{ bgcolor: "background.subtle", flex: "none" }}>
        <Tabs value={selected} onChange={(_, value) => this.setState({ selectedActivityTab: value })} aria-label="Market activity" variant="fullWidth">
          {[["alerts", "Swing alerts"], ["snapshots", "Snapshots"]].map(([value, label]) =>
            <Tab key={value} value={value} id={`activity-tab-${value}`} aria-controls="activity-panel"
              label={<Stack direction="row" spacing={0.75} alignItems="center"><span>{label}</span>
                {value === "alerts" && swingCount > 0 && <Chip size="small" color="primary" label={swingCount} aria-hidden="true" sx={{ height: 20 }} />}</Stack>} />)}
        </Tabs>
      </Box>
      <Box id="activity-panel" role="tabpanel" aria-labelledby={`activity-tab-${selected}`} tabIndex={0} sx={{ outline: "none", flex: 1, minHeight: 0, overflow: "auto" }}>
        {selected === "alerts" ? this.renderAlertPanel() : this.renderRecentSnapshots()}
      </Box>
    </Paper>;
  }

  // Classify an ATM-area option by its moneyness and strike offset from the
  // ATM strike, e.g. "ATM", "ITM (ATM-2)", "OTM (ATM+2)". The offset sign is
  // strike-relative (above ATM = +); ITM/OTM depends on the side, since a call
  // below ATM is in-the-money while a put above ATM is.
  formatMoneyness = (strike, atmStrike, side, indexKey) => {
    const step = STRIKE_STEP_BY_INDEX[indexKey];
    if (!step
      || strike === null || strike === undefined
      || atmStrike === null || atmStrike === undefined) {
      return "-";
    }
    const offset = Math.round((Number(strike) - Number(atmStrike)) / step);
    if (offset === 0) return "ATM";
    const positional = `ATM${offset > 0 ? "+" : "-"}${Math.abs(offset)}`;
    const inTheMoney = side === "CE" ? offset < 0 : offset > 0;
    return `${inTheMoney ? "ITM" : "OTM"} (${positional})`;
  }

  renderAcDdPanel = () => {
    const contractMonth = this.props.settings.contractMonth || "current";
    const contractLabel = CONTRACT_OPTIONS.find(([value]) => value === contractMonth)?.[1] || "Current";
    const acDdSignals = this.props.acDdSignals || {};
    const byTimeframe = acDdSignals.byTimeframe || {};
    const thresholds = acDdSignals.thresholds || {};
    const priceThreshold = Number.isFinite(Number(thresholds.priceChangePct)) ? Number(thresholds.priceChangePct) : AC_DD_PRICE_THRESHOLD_PCT;
    const volumeThreshold = Number.isFinite(Number(thresholds.volumeDiffPct)) ? Number(thresholds.volumeDiffPct) : AC_DD_VOLUME_SIGNAL_THRESHOLD_PCT;
    const emptySide = { rows: [], acCount: 0, ddCount: 0, hasVolume: false };

    // Strike per index is the same across timeframes — pull it from the
    // first timeframe that has option data for that index.
    const strikeByIndex = {};
    const hasOptionDataByIndex = {};
    AC_DD_TIMEFRAMES.forEach(([, , minutes]) => {
      const indexResults = byTimeframe[String(minutes)] || {};
      INDEX_ORDER.forEach(key => {
        const result = indexResults[key];
        if (!result) return;
        if (strikeByIndex[key] === undefined && result.strike !== null && result.strike !== undefined) {
          strikeByIndex[key] = result.strike;
        }
        if (result.hasOptionData) {
          hasOptionDataByIndex[key] = true;
        }
      });
    });

    // Flatten signal rows from every timeframe into a single list with a
    // tfLabel column. Sort newest first.
    let rows = [];
    let totalAc = 0;
    let totalDd = 0;
    let hasVolume = false;

    AC_DD_TIMEFRAMES.forEach(([, tfLabel, minutes]) => {
      const indexResults = byTimeframe[String(minutes)] || {};
      INDEX_ORDER.forEach(key => {
        const result = indexResults[key] || { ce: emptySide, pe: emptySide };
        const ce = result.ce || emptySide;
        const pe = result.pe || emptySide;
        if (ce.hasVolume || pe.hasVolume) hasVolume = true;
        totalAc += (ce.acCount || 0) + (pe.acCount || 0);
        totalDd += (ce.ddCount || 0) + (pe.ddCount || 0);

        (ce.rows || []).forEach(row => {
          rows.push({ ...row, indexKey: key, indexName: INDEX_LABELS[key], side: "CE", tfLabel });
        });
        (pe.rows || []).forEach(row => {
          rows.push({ ...row, indexKey: key, indexName: INDEX_LABELS[key], side: "PE", tfLabel });
        });
      });
    });

    rows = rows.sort((a, b) => b.time - a.time);
    const hasOptionData = Object.keys(hasOptionDataByIndex).length > 0;

    const tone = value => this.valueClass(value) === "value-up" ? "success.main" : this.valueClass(value) === "value-down" ? "error.main" : "text.primary";
    return (
      <Paper component="section" className="data-panel acdd-panel" aria-label="AC/DD signals" sx={{ gridArea: "acdd", overflow: "hidden", minWidth: 0 }}>
        <Box sx={{ px: 2, pt: 1.75, pb: 1 }}>
          <Typography variant="h3" component="h2">AC/DD Signals - ATM Options</Typography>
          <Typography variant="body2" color="text.secondary">
            {contractLabel} ATM options | 5 and 15 min | Price {this.formatPercent(priceThreshold)} | Vol {this.formatPercent(volumeThreshold)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ px: 2, pb: 1.5 }}>
          {INDEX_ORDER.map(key => <Chip key={key} variant="outlined" label={`${INDEX_LABELS[key]} ATM ${strikeByIndex[key] ? this.formatValue(strikeByIndex[key]) : "-"}`} />)}
          <Chip color="success" variant="outlined" label={`Total AC ${totalAc}`} />
          <Chip color="error" variant="outlined" label={`Total DD ${totalDd}`} />
        </Stack>

        {!hasOptionData && <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>Waiting for ATM option snapshots. Contract data must include CE/PE instruments.</Typography>}
        {hasOptionData && !hasVolume && <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>Waiting for volume-backed ATM option snapshots.</Typography>}
        {hasVolume && rows.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>Waiting for the next AC/DD threshold signal.</Typography>}

        {rows.length > 0 && (
          <TableContainer sx={{ maxHeight: 460 }}>
            <Table stickyHeader size="small" aria-label="ATM option accumulation distribution signals" sx={{ "& td": { ...mono, fontSize: 12.5, whiteSpace: "nowrap" }, "& th": { whiteSpace: "nowrap" } }}>
              <TableHead><TableRow>
                {["Timeframe", "Index", "Side", "Signal", "Time", "Option", "Moneyness"].map(label => <TableCell key={label}>{label}</TableCell>)}
                {["Price", "Price Chg", "VWAP?", "Prev Vol", "Curr Vol", "Vol Chg"].map(label => <TableCell key={label} align="right">{label}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow hover className={`${row.signal === "DD" ? "acdd-row-dd" : "acdd-row-ac"}${index === 0 ? " is-latest" : ""}`}
                    key={`${row.tfLabel}-${row.indexKey}-${row.side}-${row.signal}-${row.time}-${row.symbol}`}
                    sx={index === 0 ? { bgcolor: "rgba(74,111,224,0.10)" } : undefined}>
                    <TableCell>{row.tfLabel}</TableCell>
                    <TableCell>{row.indexName}</TableCell>
                    <TableCell>{row.side}</TableCell>
                    <TableCell><Chip size="small" color={row.signal === "DD" ? "error" : "success"} label={row.signal} /></TableCell>
                    <TableCell>{this.formatTime(row.time)}</TableCell>
                    <TableCell title={row.symbol}>{row.symbol}</TableCell>
                    <TableCell>{this.formatMoneyness(row.strike, strikeByIndex[row.indexKey], row.side, row.indexKey)}</TableCell>
                    <TableCell align="right">{this.formatValue(row.indexLevel)}</TableCell>
                    <TableCell align="right" sx={{ color: tone(row.priceChangePct), fontWeight: 700 }}>{this.formatPercent(row.priceChangePct, true)}</TableCell>
                    <TableCell align="right">{row.vwapYN}</TableCell>
                    <TableCell align="right">{this.formatValue(row.previousIntervalVolume)}</TableCell>
                    <TableCell align="right">{this.formatValue(row.intervalVolume)}</TableCell>
                    <TableCell align="right" sx={{ color: tone(row.volumeDiffPct), fontWeight: 700 }}>{this.formatPercent(row.volumeDiffPct, true)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    );
  }

  // Five-minute swings are market data, so they are listed whether or not sound/email alerts are on.
  // A live alert (fired before its five-minute window closed) is listed straight away and
  // merges into that window's row once the snapshot arrives.
  getSwingRows = () => {
    const inputs = [this.props.chartHistory, this.props.swingAlerts, this.props.settings, getMarketDateKey(this.props.marketTime || Date.now())];
    if (this.swingCache && inputs.every((value, index) => value === this.swingCache.inputs[index])) return this.swingCache.rows;
    const rows = this.computeSwingRows();
    this.swingCache = { inputs, rows };
    return rows;
  }

  computeSwingRows = () => {
    const today = getMarketDateKey(this.props.marketTime || Date.now());
    const liveAlerts = this.props.swingAlerts || [];

    return INDEX_ORDER.flatMap(key => {
      const threshold = alertLotThreshold(this.props.settings, key);
      const points = this.getChartPoints(key);
      const windows = new Map();

      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const swing = Number((current.netLots - previous.netLots).toFixed(2));

        if (Math.abs(swing) < threshold) {
          continue;
        }

        windows.set(previous.time, {
          key: `${key}-${previous.time}`,
          time: current.time,
          label: `${INDEX_LABELS[key]} 5-min lot swing`,
          symbol: current.symbol,
          previousNetLots: previous.netLots,
          currentNetLots: current.netLots,
          swing
        });
      }

      const symbol = this.getCurrentSymbol(key);
      liveAlerts
        .filter(alert => alert.indexKey === key && alert.symbol === symbol && getMarketDateKey(alert.time) === today)
        .forEach(alert => {
          const closed = windows.get(alert.previousTime);
          windows.set(alert.previousTime, closed ? { ...closed, alertedAt: alert.time } : {
            key: `${key}-${alert.previousTime}`,
            time: alert.time,
            alertedAt: alert.time,
            live: true,
            label: `${INDEX_LABELS[key]} 5-min lot swing`,
            symbol: alert.symbol,
            previousNetLots: alert.previousNetLots,
            currentNetLots: alert.currentNetLots,
            swing: alert.swingLots
          });
        });

      return Array.from(windows.values());
    }).sort((a, b) => b.time - a.time);
  }

  renderAlertPanel = () => {
    const thresholds = describeAlertThresholds(this.props.settings, this.formatValue);
    const rows = this.getSwingRows();
    const alertsOn = Boolean(this.props.settings.alertsEnabled);

    return (
      <Box component="section" className="side-panel">
        <Alert severity={alertsOn ? "success" : "warning"} role="note" sx={{ m: 1, py: 0.25, fontSize: 12.5 }}
          action={!alertsOn && this.props.openSettings ? <Button size="small" variant="contained" onClick={this.props.openSettings}>Turn on</Button> : undefined}>
          {alertsOn
            ? `Sound alerts are on. Thresholds: ${thresholds} lots. The newest swing is highlighted.`
            : `Showing swings of ${thresholds} lots or more. Sound alerts are off.`}
        </Alert>

        <Box className="side-panel-body" sx={{ display: "grid", gap: 0.5, px: 1, pb: 1 }}>
          {rows.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2.5, fontSize: 14 }}>No five-minute swing has reached its threshold yet today.</Typography>
          )}

          {rows.map((row, index) => {
            const up = row.swing > 0;
            return <Box className={`side-row${index === 0 ? " is-latest" : ""}`} key={row.key} sx={{
              display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "4px 10px", px: 1.5, py: 1.1,
              borderRadius: 2.5, bgcolor: up ? "rgba(14,159,110,0.05)" : "rgba(224,68,90,0.05)",
              ...(index === 0 && { bgcolor: "rgba(74,111,224,0.10)", animation: "latestFlash 1.2s ease-out 3",
                "@keyframes latestFlash": { "0%": { backgroundColor: "rgba(245,184,61,0.35)" }, "100%": { backgroundColor: "rgba(74,111,224,0.10)" } } }),
            }}>
              <Box className="side-copy" sx={{ minWidth: 0, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
                {index === 0 && <Chip size="small" color="primary" label="Latest" className="swing-tag is-latest" sx={{ height: 20 }} />}
                {row.live && <Chip size="small" variant="outlined" label="Live" className="swing-tag" sx={{ height: 20 }} />}
                <Typography component="span" sx={{ fontSize: 13.5, fontWeight: 800 }}>{row.label}</Typography>
              </Box>
              <Chip className={`side-value ${this.valueClass(row.swing)}`} label={`${this.formatSignedValue(row.swing)} lots`} size="small"
                sx={{ ...mono, fontWeight: 800, bgcolor: up ? "rgba(14,159,110,0.12)" : "rgba(224,68,90,0.12)", color: up ? "success.main" : "error.main" }} />
              <Typography className="swing-detail" sx={{ gridColumn: "1 / -1", ...mono, fontSize: 11.5, color: "text.secondary" }}>
                <Box component="span" className="side-time" sx={{ fontWeight: 800, color: "text.primary" }}>{this.formatTime(row.time)}</Box>
                {" · "}<span className="side-symbol">{row.symbol}</span>{" · "}
                {this.formatSignedValue(row.previousNetLots)} → {this.formatSignedValue(row.currentNetLots)} lots
                {row.alertedAt && row.alertedAt !== row.time ? ` · alert at ${this.formatTime(row.alertedAt)}` : ""}
              </Typography>
            </Box>;
          })}
        </Box>
      </Box>
    );
  }

  renderRecentSnapshots = () => {
    // Show every index's five-minute snapshots here (not just the charted one).
    // The dropdown lets the user narrow to a single index; "all" merges them.
    // Lot change is computed per index against that index's previous snapshot,
    // then all rows are merged and shown newest-first.
    const selectedSnapshotIndex = this.state.selectedSnapshotIndex;
    const visibleKeys = selectedSnapshotIndex === "all"
      ? INDEX_ORDER
      : INDEX_ORDER.filter(key => key === selectedSnapshotIndex);
    const rows = visibleKeys
      .flatMap(key => {
        const points = this.getChartPoints(key);
        return points.map((point, index) => {
          const previousPoint = points[index - 1];
          const incrementalChange = previousPoint
            ? Number((point.netLots - previousPoint.netLots).toFixed(2))
            : null;

          return {
            ...point,
            indexKey: key,
            indexLabel: INDEX_LABELS[key],
            incrementalChange
          };
        });
      })
      .sort((a, b) => (
        b.time - a.time || INDEX_ORDER.indexOf(a.indexKey) - INDEX_ORDER.indexOf(b.indexKey)
      ));

    const tone = value => this.valueClass(value) === "value-up" ? "success.main" : this.valueClass(value) === "value-down" ? "error.main" : "text.primary";
    return (
      <Box component="section" className="side-panel">
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Box>
            <Typography variant="h3" component="p">Recent snapshots</Typography>
            <Typography variant="caption" color="text.secondary">All indices, five-minute records</Typography>
          </Box>
          <TextField select size="small" value={selectedSnapshotIndex} onChange={this.handleSnapshotIndexChange}
            SelectProps={{ native: true }} inputProps={{ "aria-label": "recent snapshots index" }} sx={{ minWidth: 140 }}>
            <option value="all">All indices</option>
            {INDEX_ORDER.map(key => <option key={key} value={key}>{INDEX_LABELS[key]}</option>)}
          </TextField>
        </Stack>

        {rows.length === 0 && <Typography color="text.secondary" sx={{ p: 2.5, fontSize: 14 }}>No snapshots yet</Typography>}

        {rows.length > 0 && (
          <TableContainer>
            <Table stickyHeader size="small" aria-label="Recent snapshots across all indices" sx={{ "& td": { ...mono, fontSize: 12.5, whiteSpace: "nowrap" } }}>
              <TableHead><TableRow>
                <TableCell>Time</TableCell><TableCell>Index</TableCell>
                <TableCell align="right">Level</TableCell><TableCell align="right">Net Lots</TableCell>
                <TableCell align="right">Lot Chg</TableCell><TableCell align="right">Ratio</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {rows.map(row => (
                  <TableRow hover key={`${row.symbol}-${row.time}`}>
                    <TableCell sx={{ color: "text.secondary" }}>{this.formatTime(row.time)}</TableCell>
                    <TableCell sx={{ fontFamily: "inherit !important", fontWeight: 700 }}>{row.indexLabel}</TableCell>
                    <TableCell align="right">{this.formatValue(row.indexLevel)}</TableCell>
                    <TableCell align="right" sx={{ color: tone(row.netLots), fontWeight: 700 }}>{this.formatSignedValue(row.netLots)}</TableCell>
                    <TableCell align="right" sx={{ color: row.incrementalChange === null ? "text.secondary" : tone(row.incrementalChange), fontWeight: 700 }}>
                      {row.incrementalChange === null ? "-" : this.formatSignedValue(row.incrementalChange)}
                    </TableCell>
                    <TableCell align="right">{this.formatValue(row.ratio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    );
  }

  renderSnapshotBanner = () => {
    const heartbeat = this.props.snapshotHeartbeat || {};

    if (this.props.feedStatus === "offline") {
      return <Alert severity="warning" role="status" sx={{ mb: 1.5 }}>Live prices are unavailable. Reconnecting automatically.</Alert>;
    }

    if (heartbeat.status !== "stale" || !heartbeat.marketOpen) {
      return null;
    }

    const hasEverReceived = heartbeat.latestSnapshotTime !== null
      && heartbeat.latestSnapshotTime !== undefined;
    const age = this.formatHeartbeatAge(heartbeat.ageSeconds);

    let detail;
    if (!hasEverReceived) {
      detail = " The next update is expected within five minutes.";
    } else if (age) {
      detail = ` Last update ${age}.`;
    } else {
      detail = "";
    }

    return (
      <Alert severity="error" sx={{ mb: 1.5 }}>
        <strong>Live market data is temporarily unavailable.</strong>
        {detail} The chart and history panels will resume automatically
        once the feed is restored.
      </Alert>
    );
  }

  // Each section names its grid area; Home lays them out next to its own summary tiles (display: contents).
  render() {
    return (
      <Box className="market-desk" sx={{ display: "contents" }}>
        <Box sx={{ gridArea: "bar", minWidth: 0 }}>
          {this.renderSnapshotBanner()}
          {this.renderCommandBar()}
        </Box>
        <MarketComparison dashboard={this} layout={this.state.marketLayout} />
        <MarketChart dashboard={this} sx={{ gridArea: "chart" }} />
        {this.renderActivity()}
        {this.renderSnapshotPreview()}
        {this.renderAcDdPanel()}
      </Box>
    );
  }
}

export default Dashboard;
