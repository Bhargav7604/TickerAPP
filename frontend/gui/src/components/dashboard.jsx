import { Component, Fragment as ReactFragment } from "react";
import { RefreshCw } from "lucide-react";
import MarketComparison from "./marketComparison";
import MarketChart from "./marketChart";
import MarketColumnSelector from "./marketColumnSelector";
import "../scan-dashboard.css";
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
      hoveredChartPoint: null
    };

    this.dataKeys = {
      nifty: "niftyData",
      banknifty: "bankniftyData",
      sensex: "sensexData"
    };


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

  getChartPoints = key => {
    const chartHistory = this.props.chartHistory || {};
    const symbol = this.getCurrentSymbol(key);
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
    return (
      <section className="scan-command-bar">
        <div className="scan-command-copy">
          <h1>Market overview</h1>
          <span className="scan-session-date">{sessionDate}</span>
          <span className="scan-session-state">
            {this.props.previewLabel || heartbeat.label || "Checking"}
            <span className="mobile-session-date"> · {sessionDate}</span>
            {latest !== null && latest !== undefined ? ` · ${this.formatTime(latest)} IST` : ""}
          </span>
        </div>
        <div className="scan-command-actions">
          <div className="contract-segmented" aria-label="contract month">
            {CONTRACT_OPTIONS.map(([value, label]) => (
              <button type="button" key={value}
                className={contractMonth === value ? "contract-segment active" : "contract-segment"}
                aria-pressed={contractMonth === value} onClick={() => this.handleContractMonthClick(value)}>
                {label}
              </button>
            ))}
          </div>
          <MarketColumnSelector value={this.props.settings.marketColumns} onSave={this.props.handleMarketColumnsSave} />
          <button className="scan-icon-button" type="button" title="Refresh market data" aria-label="Refresh market data"
            onClick={this.props.handleDashboardRefresh}><RefreshCw size={19} /></button>
        </div>
      </section>
    );
  }

  renderSnapshotPreview = () => {
    const times = [...new Set(INDEX_ORDER.flatMap(key => this.getChartPoints(key).map(p => p.time)))].sort((a, b) => b - a).slice(0, 5);
    const byIndex = Object.fromEntries(INDEX_ORDER.map(key => [key, new Map(this.getChartPoints(key).map(p => [p.time, p]))]));
    return <section className="scan-snapshot-preview" aria-label="Five-minute snapshot preview">
      <div className="scan-section-heading"><h2>Five-minute snapshots</h2>
        <button type="button" className="scan-text-button" onClick={() => this.setState({ selectedActivityTab: "snapshots" })}>Full session</button>
      </div>
      <div className="scan-preview-scroll">
        <table className="scan-preview-table"><thead>
          <tr><th scope="col" rowSpan="2">Time</th>{INDEX_ORDER.map(key => <th scope="colgroup" colSpan="2" key={key}>{INDEX_LABELS[key]}</th>)}</tr>
          <tr>{INDEX_ORDER.map(key => <ReactFragment key={key}><th scope="col">Futures</th><th scope="col">Net lots</th></ReactFragment>)}</tr>
        </thead><tbody>
          {times.map(time => <tr key={time}><th scope="row">{this.formatTime(time)}</th>
            {INDEX_ORDER.map(key => { const point = byIndex[key].get(time);
              return <ReactFragment key={key}><td>{this.formatValue(point?.indexLevel)}</td>
                <td className={this.valueClass(point?.netLots)}>{this.formatSignedValue(point?.netLots)}</td></ReactFragment>;
            })}</tr>)}
          {!times.length && <tr><td colSpan="7" className="scan-empty">No snapshots yet</td></tr>}
        </tbody></table>
      </div>
    </section>;
  }

  renderActivity = () => {
    const selected = this.state.selectedActivityTab;
    const swingCount = this.getSwingRows().length;
    return <aside className="scan-activity">
      <div className="scan-activity-head">
        <div role="tablist" aria-label="Market activity">
          {[["alerts", "Swing alerts"], ["snapshots", "Snapshots"]].map(([value, label]) =>
            <button key={value} type="button" role="tab" id={`activity-tab-${value}`} aria-selected={selected === value}
              aria-controls="activity-panel" tabIndex={selected === value ? 0 : -1}
              onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? "alerts" : event.key === "End" ? "snapshots" : selected === "alerts" ? "snapshots" : "alerts";
                this.setState({ selectedActivityTab: next }, () => document.getElementById(`activity-tab-${next}`)?.focus());
              } }}
              onClick={() => this.setState({ selectedActivityTab: value })}>{label}
              {value === "alerts" && swingCount > 0 && <span className="scan-tab-count" aria-hidden="true">{swingCount}</span>}</button>)}
        </div>
        <span className={`scan-threshold${this.props.settings.alertsEnabled ? " is-on" : ""}`}>{this.props.settings.alertsEnabled ? "Alerts on" : "Alerts off"}</span>
      </div>
      <div id="activity-panel" role="tabpanel" aria-labelledby={`activity-tab-${selected}`} tabIndex="0">
        {selected === "alerts" ? this.renderAlertPanel() : this.renderRecentSnapshots()}
      </div>
    </aside>;
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

    return (
      <section className="data-panel acdd-panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">AC/DD Signals - ATM Options</div>
            <div className="panel-subtitle">
              {contractLabel} ATM options | 5 and 15 min | Price {this.formatPercent(priceThreshold)} | Vol {this.formatPercent(volumeThreshold)}
            </div>
          </div>
        </div>

        <div className="acdd-summary-grid">
          {INDEX_ORDER.map(key => (
            <div className="acdd-summary-cell" key={key}>
              <span>{INDEX_LABELS[key]} ATM</span>
              <strong className="value-neutral">{strikeByIndex[key] ? this.formatValue(strikeByIndex[key]) : "-"}</strong>
            </div>
          ))}
          <div className="acdd-summary-cell">
            <span>Total AC</span>
            <strong className="value-up">{totalAc}</strong>
          </div>
          <div className="acdd-summary-cell">
            <span>Total DD</span>
            <strong className="value-down">{totalDd}</strong>
          </div>
        </div>

        {!hasOptionData && (
          <div className="empty-side-row">Waiting for ATM option snapshots. Contract data must include CE/PE instruments.</div>
        )}

        {hasOptionData && !hasVolume && (
          <div className="empty-side-row">Waiting for volume-backed ATM option snapshots.</div>
        )}

        {hasVolume && rows.length === 0 && (
          <div className="empty-side-row">Waiting for the next AC/DD threshold signal.</div>
        )}

        {rows.length > 0 && (
          <div className="acdd-grid-wrap">
            <div className="acdd-grid acdd-grid-tf" role="table" aria-label="ATM option accumulation distribution signals">
              <div className="acdd-grid-row acdd-grid-head" role="row">
                <div className="acdd-grid-cell" role="columnheader">Timeframe</div>
                <div className="acdd-grid-cell" role="columnheader">Index</div>
                <div className="acdd-grid-cell" role="columnheader">Side</div>
                <div className="acdd-grid-cell" role="columnheader">Signal</div>
                <div className="acdd-grid-cell" role="columnheader">Time</div>
                <div className="acdd-grid-cell" role="columnheader">Option</div>
                <div className="acdd-grid-cell" role="columnheader">Moneyness</div>
                <div className="acdd-grid-cell acdd-number" role="columnheader">Price</div>
                <div className="acdd-grid-cell acdd-number" role="columnheader">Price Chg</div>
                <div className="acdd-grid-cell acdd-number" role="columnheader">VWAP?</div>
                <div className="acdd-grid-cell acdd-number" role="columnheader">Prev Vol</div>
                <div className="acdd-grid-cell acdd-number" role="columnheader">Curr Vol</div>
                <div className="acdd-grid-cell acdd-number" role="columnheader">Vol Chg</div>
              </div>

              {rows.map((row, index) => (
                <div className={`acdd-grid-row ${row.signal === "DD" ? "acdd-row-dd" : "acdd-row-ac"}${index === 0 ? " is-latest" : ""}`} role="row" key={`${row.tfLabel}-${row.indexKey}-${row.side}-${row.signal}-${row.time}-${row.symbol}`}>
                  <div className="acdd-grid-cell" role="cell">{row.tfLabel}</div>
                  <div className="acdd-grid-cell" role="cell">{row.indexName}</div>
                  <div className="acdd-grid-cell acdd-signal" role="cell">{row.side}</div>
                  <div className={`acdd-grid-cell acdd-signal ${row.signal === "DD" ? "acdd-signal-dd" : "acdd-signal-ac"}`} role="cell">{row.signal}</div>
                  <div className="acdd-grid-cell" role="cell">{this.formatTime(row.time)}</div>
                  <div className="acdd-grid-cell acdd-symbol-cell" role="cell" title={row.symbol}>{row.symbol}</div>
                  <div className="acdd-grid-cell acdd-moneyness-cell" role="cell">{this.formatMoneyness(row.strike, strikeByIndex[row.indexKey], row.side, row.indexKey)}</div>
                  <div className="acdd-grid-cell acdd-number" role="cell">{this.formatValue(row.indexLevel)}</div>
                  <div className={`acdd-grid-cell acdd-number ${this.valueClass(row.priceChangePct)}`} role="cell">{this.formatPercent(row.priceChangePct, true)}</div>
                  <div className="acdd-grid-cell acdd-number" role="cell">{row.vwapYN}</div>
                  <div className="acdd-grid-cell acdd-number" role="cell">{this.formatValue(row.previousIntervalVolume)}</div>
                  <div className="acdd-grid-cell acdd-number" role="cell">{this.formatValue(row.intervalVolume)}</div>
                  <div className={`acdd-grid-cell acdd-number ${this.valueClass(row.volumeDiffPct)}`} role="cell">{this.formatPercent(row.volumeDiffPct, true)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  // Five-minute swings are market data, so they are listed whether or not sound/email alerts are on.
  // A live alert (fired before its five-minute window closed) is listed straight away and
  // merges into that window's row once the snapshot arrives.
  getSwingRows = () => {
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
      <section className="side-panel">
        <div className={`swing-alert-status${alertsOn ? " is-on" : ""}`}>
          <span>{alertsOn
            ? `Sound alerts are on. Thresholds: ${thresholds} lots. The newest swing is highlighted.`
            : `Showing swings of ${thresholds} lots or more. Sound alerts are off.`}</span>
          {!alertsOn && this.props.openSettings && (
            <button type="button" onClick={this.props.openSettings}>Turn on</button>
          )}
        </div>

        <div className="side-panel-body">
          {rows.length === 0 && (
            <div className="empty-side-row">No five-minute swing has reached its threshold yet today.</div>
          )}

          {rows.map((row, index) => (
            <div className={`side-row${index === 0 ? " is-latest" : ""}`} key={row.key}>
              <div className="side-time">{this.formatTime(row.time)}</div>
              <div className="side-copy">
                <div>
                  {index === 0 && <span className="swing-tag is-latest">Latest</span>}
                  {row.live && <span className="swing-tag">Live</span>}
                  {row.label}
                </div>
                <div className="side-symbol">{row.symbol}</div>
                <div className="swing-detail">
                  {this.formatSignedValue(row.previousNetLots)} → {this.formatSignedValue(row.currentNetLots)} lots
                  {row.alertedAt && row.alertedAt !== row.time ? ` · alert at ${this.formatTime(row.alertedAt)}` : ""}
                </div>
              </div>
              <div className={`side-value ${this.valueClass(row.swing)}`}>{this.formatSignedValue(row.swing)} lots</div>
            </div>
          ))}
        </div>
      </section>
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

    return (
      <section className="side-panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Recent Snapshots</div>
            <div className="panel-subtitle">All indices, five-minute records</div>
          </div>
          <select
            className="snapshot-index-select"
            aria-label="recent snapshots index"
            value={selectedSnapshotIndex}
            onChange={this.handleSnapshotIndexChange}
          >
            <option value="all">All indices</option>
            {INDEX_ORDER.map(key => (
              <option key={key} value={key}>{INDEX_LABELS[key]}</option>
            ))}
          </select>
        </div>

        <div className="side-panel-body">
          {rows.length === 0 && (
            <div className="empty-side-row">No snapshots yet</div>
          )}

          {rows.length > 0 && (
            <div className="snapshot-grid-wrap">
              <div className="snapshot-grid" role="table" aria-label="Recent snapshots across all indices">
                <div className="snapshot-grid-row snapshot-grid-head" role="row">
                  <div className="snapshot-grid-cell" role="columnheader">Time</div>
                  <div className="snapshot-grid-cell" role="columnheader">Index</div>
                  <div className="snapshot-grid-cell snapshot-number" role="columnheader">Level</div>
                  <div className="snapshot-grid-cell snapshot-number" role="columnheader">Net Lots</div>
                  <div className="snapshot-grid-cell snapshot-number" role="columnheader">Lot Chg</div>
                  <div className="snapshot-grid-cell snapshot-number" role="columnheader">Ratio</div>
                </div>

                {rows.map(row => (
                  <div className="snapshot-grid-row" role="row" key={`${row.symbol}-${row.time}`}>
                    <div className="snapshot-grid-cell snapshot-time" role="cell">{this.formatTime(row.time)}</div>
                    <div className="snapshot-grid-cell snapshot-index-cell" role="cell">{row.indexLabel}</div>
                    <div className="snapshot-grid-cell snapshot-number" role="cell">{this.formatValue(row.indexLevel)}</div>
                    <div className={`snapshot-grid-cell snapshot-number ${this.valueClass(row.netLots)}`} role="cell">{this.formatSignedValue(row.netLots)}</div>
                    <div className={`snapshot-grid-cell snapshot-number ${row.incrementalChange === null ? "value-neutral" : this.valueClass(row.incrementalChange)}`} role="cell">
                      {row.incrementalChange === null ? "-" : this.formatSignedValue(row.incrementalChange)}
                    </div>
                    <div className="snapshot-grid-cell snapshot-number" role="cell">{this.formatValue(row.ratio)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  renderSnapshotBanner = () => {
    const heartbeat = this.props.snapshotHeartbeat || {};

    if (this.props.feedStatus === "offline") {
      return (
        <div className="snapshot-stale-banner" role="status">
          Live prices are unavailable. Reconnecting automatically.
        </div>
      );
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
      <div className="snapshot-stale-banner" role="alert">
        <strong>Live market data is temporarily unavailable.</strong>
        {detail} The chart and history panels will resume automatically
        once the feed is restored.
      </div>
    );
  }

  render() {
    return (
      <main className="dashboard-page scan-dashboard">
        {this.renderSnapshotBanner()}
        {this.renderCommandBar()}
        <MarketComparison dashboard={this} />
        <section className="scan-workspace">
          <div className="scan-main">
            <MarketChart dashboard={this} />
            {this.renderSnapshotPreview()}
          </div>
          {this.renderActivity()}
        </section>
        {this.renderAcDdPanel()}
      </main>
    );
  }
}

export default Dashboard;
