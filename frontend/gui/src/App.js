import "./App.css";
import Cookies from "js-cookie";
import { Component } from "react";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Components
import MainPage from "./components/mainPage.jsx";
import LoginForm from "./components/loginForm.jsx";

toast.configure();

const isDevelopment = process.env.NODE_ENV === "development";
const debugLog = (...args) => {
  if (isDevelopment) {
    console.log(...args);
  }
};
const requestFrame = callback => (
  window.requestAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 16)
);
const cancelFrame = frameId => {
  if (window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frameId);
  } else {
    window.clearTimeout(frameId);
  }
};

const options = {
  position: "bottom-right",
  pauseOnHover: true,
  closeOnClick: true,
  theme: "dark",
  autoClose: 2500
}

const HISTORY_STORAGE_KEY = "ticker-five-minute-history";
const ALERT_SETUP_DISMISSED_KEY = "ticker-alert-setup-dismissed";
const ACDD_ALERT_STORAGE_KEY = "ticker-acdd-alert-keys";
const HISTORY_INTERVAL_MINUTES = 5;
const AUTH_CHECK_INTERVAL_MS = 15000;
const SNAPSHOT_REFRESH_INTERVAL_MS = 60000;
const HEARTBEAT_REFRESH_INTERVAL_MS = 30000;
const MARKET_OPEN_MINUTES = 9 * 60;
const MARKET_CLOSE_MINUTES = (15 * 60) + 30;
const MARKET_TIME_ZONE = "Asia/Kolkata";
const CONTRACT_MONTH_COUNT = 3;
const SNAPSHOT_INSTRUMENTS_PER_CONTRACT = 3;
const MARKET_SESSION_SAMPLES = Math.floor((MARKET_CLOSE_MINUTES - MARKET_OPEN_MINUTES) / HISTORY_INTERVAL_MINUTES) + 1;
const HISTORY_MAX_POINTS = MARKET_SESSION_SAMPLES * CONTRACT_MONTH_COUNT * SNAPSHOT_INSTRUMENTS_PER_CONTRACT;
// Used only for the alert-setup prompt copy. The actual signal thresholds
// live on the backend now (see backend/acdd_analyzer.py and the response of
// /api/acdd/signals/).
const AC_DD_VOLUME_ALERT_THRESHOLD_PCT = 250;
const AC_DD_ALERT_TIMEFRAMES = [
  ["5 min", 5],
  ["15 min", 15]
];
const INDEX_KEYS = ["nifty", "banknifty", "sensex"];
const INDEX_DATA_KEYS = {
  nifty: "niftyData",
  banknifty: "bankniftyData",
  sensex: "sensexData"
};
const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
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
const INDEX_LABELS = {
  nifty: "NIFTY",
  banknifty: "BANKNIFTY",
  sensex: "SENSEX"
};
const emptyChartHistory = () => ({
  nifty: [],
  banknifty: [],
  sensex: []
});
const emptySnapshotHeartbeat = () => ({
  status: "checking",
  label: "Checking",
  marketOpen: false,
  serverTime: null,
  latestSnapshotTime: null,
  ageSeconds: null,
  delayedAfterSeconds: 420,
  staleAfterSeconds: 720,
  intervalMinutes: 5
});
const emptySpotPrices = () => ({
  nifty: null,
  banknifty: null,
  sensex: null
});
const emptyTickData = () => ({
  symbol: null,
  cmp: 0,
  netChange: 0,
  pctChange: 0,
  vwap: 0,
  oi: 0,
  oiDayHigh: 0,
  oiDayLow: 0,
  netDemand: 0,
  ratio: 0,
  lotSize: 0,
  lot: 0,
  open: 0,
  high: 0,
  low: 0,
  volumeTraded: null,
  avgTradedPrice: null,
  lastUpdated: null
});
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
const getContractMonthCode = value => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-\d{2}$/);

  if (!match) {
    return "";
  }

  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex >= MONTH_CODES.length) {
    return "";
  }

  return `${match[1].slice(-2)}${MONTH_CODES[monthIndex]}`;
};
// const struct = require("cstruct");
// const Buffer = require("buffer");
// const bufferify = require("json-bufferify");
// let KiteTicker = require("kiteconnect").KiteTicker;

class App extends Component {
  constructor(props) {
    super(props);
    this.connectionVersion = 0;
    this.settingsVersion = 0;
    this.columnPreferencesVersion = 0;

    // this.MarketData = struct`
    //   char exchange;
    //   uint32 token;
    //   uint32 ltp;
    //   uint32 ltt;
    //   uint32 ltq;
    //   uint32 volume;
    //   uint32 best_bid_price;
    //   uint32 best_bid_quantity;
    //   float32 total_buy_quantity;
    //   float32 total_sell_quantity;
    //   uint32 atp;
    //   uint32 exchange_time_stamp;
    //   uint32 open;
    //   uint32 high;
    //   uint32 low;
    //   uint32 close;
    //   uint32 yearly_high;
    //   uint32 yearly_low;
    // `

    this.URL = process.env.NODE_ENV === "production" ? "" : "http://localhost:8000";
    debugLog(process.env.NODE_ENV, this.URL);

    this.state = {
      loggedIn: localStorage.getItem("jwt-token") ? true : false,
      username: "",
      feedStatus: "checking",
      lots: {},
      spotPrices: emptySpotPrices(),
      chartHistory: emptyChartHistory(),
      settings: {
        contractMonth: "current",
        niftyExpiry: "2000-01-01",
        bankniftyExpiry: "2000-01-01",
        sensexExpiry: "2000-01-01",
        alertsEnabled: false,
        alertEmail: "",
        alertLotThreshold: 400,
        symbols: {}
      },
      niftyData: emptyTickData(),
      bankniftyData: emptyTickData(),
      sensexData: emptyTickData(),
      snapshotHeartbeat: emptySnapshotHeartbeat(),
      acDdSignals: { byTimeframe: {}, thresholds: {}, timeframes: [], contractMonth: null },
      activeAlert: null,
      showAlertSetupPrompt: false,
    }
    try {
      this.acDdAlertKeys = new Set(JSON.parse(localStorage.getItem(ACDD_ALERT_STORAGE_KEY) || "[]"));
    } catch (e) {
      this.acDdAlertKeys = new Set();
      localStorage.removeItem(ACDD_ALERT_STORAGE_KEY);
    }
    this.acDdAlertsInitialized = false;
    this.realtimeLotAlertKeys = new Set();
    this.pendingTickState = {};
    this.tickStateFrame = null;
  }

  request = async (route, method, body=null, logoutOnElse=true, msgOnSuccess=true, quiet=false, signal) => {
    const requestOptions = {
      signal,
      method: method,
      headers: {
        "Authorization": `jwt-token ${localStorage.getItem("jwt-token")}`,
        "X-CSRFToken": this.getCsrfCookie(),
        "Content-Type": "application/json"
      }
    };

    if (method !== "GET" && body !== null) {
      requestOptions.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(`${this.URL}/api/${route}`, requestOptions);
    } catch (e) {
      debugLog(e);
      if (!quiet) toast.error("Network error. Please try again.", options);
      return { type: "NetworkError", message: "Network error" };
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      debugLog(e);
      if (!quiet) toast.error("Server returned an invalid response.", options);
      return { type: "ServerError", message: "Invalid server response" };
    }
    debugLog(json);

    if (json.type === "success") {
      if (msgOnSuccess) {
        toast.success(`Success: ${json.message}`, options);
      }

      return json

    } else if (json.type === "info") {
      if (msgOnSuccess) {
        toast.info(`Success: ${json.message}`, options);
      }

      return json

    } else if (json.type === "error") {
      if (!quiet) toast.error(`Error: ${json.message}`, options);

      return json

    } else if (json.type === "generateToken") {
      // Defensive: the server should never send this to app users anymore.
      // The broker OAuth flow is admin-only. Show a generic outage message.
      toast.warn("Live market data is temporarily unavailable. It will resume automatically.", options);

      return json

    } else if (json.type === "KiteOffline") {
      toast.warn(json.message, options);

      return json

    } else {
      if (!quiet) toast.error(`${json.type}: ${json.message}`, options);
      if (logoutOnElse) {
        toast.error("Logged out !", options);
        this.handleLogout();
      }

      return json
    }
  }

  componentDidMount = async () => {
    this.loadChartHistory();
    this.snapshotHistoryTimer = setInterval(() => {
      if (this.state.loggedIn && localStorage.getItem("jwt-token")) {
        this.loadSnapshotHistory();
      }
    }, SNAPSHOT_REFRESH_INTERVAL_MS);
    this.snapshotHeartbeatTimer = setInterval(() => {
      if (this.state.loggedIn && localStorage.getItem("jwt-token")) {
        this.loadSnapshotHeartbeat();
      }
    }, HEARTBEAT_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    if (this.state.loggedIn) {
      this.startAuthCheck();
      const json = await this.request("current-user/", "GET");

      if (json.type === "success") {
        this.setState({ username: json.username });
        this.startDashboardData();
      }
    }
  }

  componentWillUnmount = () => {
    this.stopMarketData();

    if (this.snapshotHistoryTimer) {
      clearInterval(this.snapshotHistoryTimer);
    }

    if (this.snapshotHeartbeatTimer) {
      clearInterval(this.snapshotHeartbeatTimer);
    }

    this.clearPendingTickState();

    document.removeEventListener("visibilitychange", this.handleVisibilityChange);

    this.stopAuthCheck();

  }

  handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" || !this.state.loggedIn || !localStorage.getItem("jwt-token")) {
      return;
    }

    this.loadSnapshotHeartbeat();
    this.loadSnapshotHistory();
    this.startMarketData();
  }

  loadChartHistory = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "{}");
      const chartHistory = this.normalizeChartHistory(stored);

      this.setState({ chartHistory });
      this.saveChartHistory(chartHistory);

    } catch (e) {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    }
  }

  saveChartHistory = chartHistory => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.normalizeChartHistory(chartHistory)));
  }

  normalizeHistoryPoints = points => {
    const uniquePoints = new Map();
    const todayMarketDate = getMarketDateKey(Date.now());

    if (!Array.isArray(points)) {
      return [];
    }

    points.forEach(point => {
      const time = Number(point?.time);
      const pointMarketDate = getMarketDateKey(time);

      if (!point?.symbol || !Number.isFinite(time) || pointMarketDate !== todayMarketDate) {
        return;
      }

      uniquePoints.set(`${point.symbol}-${time}`, {
        ...point,
        time
      });
    });

    return Array.from(uniquePoints.values())
      .sort((a, b) => a.time - b.time)
      .slice(-HISTORY_MAX_POINTS);
  }

  normalizeChartHistory = chartHistory => {
    const normalized = emptyChartHistory();

    INDEX_KEYS.forEach(key => {
      normalized[key] = this.normalizeHistoryPoints(chartHistory?.[key]);
    });

    return normalized;
  }

  getCsrfCookie = () => {
    return Cookies.get("csrftoken");
  }

  formatAlertNumber = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return value;
    }

    return numericValue.toLocaleString("en-IN", {
      maximumFractionDigits: 2
    });
  }

  formatAlertSignedNumber = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue === 0) {
      return this.formatAlertNumber(value);
    }

    return `${numericValue > 0 ? "+" : ""}${this.formatAlertNumber(numericValue)}`;
  }

  formatAlertPercent = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return "-";
    }

    return `${this.formatAlertSignedNumber(numericValue)}%`;
  }

  formatAlertDateTime = timestamp => {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-IN", {
      timeZone: MARKET_TIME_ZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  getAlertAudioContext = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) {
        return null;
      }

      if (!this.alertAudioContext || this.alertAudioContext.state === "closed") {
        this.alertAudioContext = new AudioContext();
      }

      if (this.alertAudioContext.state === "suspended") {
        this.alertAudioContext.resume();
      }

      return this.alertAudioContext;

    } catch (e) {
      debugLog(e);
      return null;
    }
  }

  unlockAlertSound = () => {
    const audioContext = this.getAlertAudioContext();

    if (!audioContext) {
      return;
    }

    try {
      const gain = audioContext.createGain();
      const oscillator = audioContext.createOscillator();
      const now = audioContext.currentTime;

      gain.gain.setValueAtTime(0.0001, now);
      oscillator.frequency.setValueAtTime(440, now);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.03);

    } catch (e) {
      debugLog(e);
    }
  }

  playAlertSound = () => {
    try {
      const audioContext = this.getAlertAudioContext();

      if (!audioContext) {
        return;
      }

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.setValueAtTime(660, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.6);

    } catch (e) {
      debugLog(e);
    }
  }

  showLotSwingAlert = alert => {
    this.setState({ activeAlert: { type: "lot", ...alert } });
    this.playAlertSound();
  }

  showAcDdAlert = alert => {
    this.setState({ activeAlert: { type: "acdd", ...alert } });
    this.playAlertSound();
  }

  closeAlertPopup = () => {
    this.setState({ activeAlert: null });
  }

  startAuthCheck = () => {
    this.stopAuthCheck();

    this.authCheckTimer = setInterval(() => {
      if (!this.state.loggedIn || !localStorage.getItem("jwt-token")) {
        this.stopAuthCheck();
        return;
      }

      this.request("current-user/", "GET", null, true, false);
    }, AUTH_CHECK_INTERVAL_MS);
  }

  stopAuthCheck = () => {
    if (this.authCheckTimer) {
      clearInterval(this.authCheckTimer);
      this.authCheckTimer = null;
    }
  }

  handleLogin = async data => {
    debugLog(data);
    this.unlockAlertSound();
    const json = await this.request("login/", "POST", data, false);

    if (json.type === "success") {
      localStorage.setItem("jwt-token", json.jwtToken);
      this.setState({loggedIn: true});
      this.startAuthCheck();

      const user_json = await this.request("current-user/", "GET");

      if (user_json.type === "success") {
        this.setState({
          username: user_json.username
        });

        this.startDashboardData();
      }
    }
  }

  handleLogout = () => {
    localStorage.removeItem("jwt-token");
    this.stopMarketData();
    this.settingsVersion += 1;
    this.columnPreferencesVersion += 1;
    this.stopAuthCheck();

    this.setState({
      loggedIn: false,
      feedStatus: "offline",
      spotPrices: emptySpotPrices(),
      snapshotHeartbeat: emptySnapshotHeartbeat(),
      acDdSignals: { byTimeframe: {}, thresholds: {}, timeframes: [], contractMonth: null },
      activeAlert: null
    });
    this.realtimeLotAlertKeys.clear();
  }

  startDashboardData = async () => {
    await this.getSettings();
    if (this.state.loggedIn) this.startMarketData();
  }

  getSettings = async () => {
    const version = this.settingsVersion;
    const columnVersion = this.columnPreferencesVersion;
    const json = await this.request("settings/", "GET");

    if (json.type === "success" && this.state.loggedIn && version === this.settingsVersion) {
      await new Promise(resolve => this.setState(previous => ({ settings: {
        ...json.settings,
        marketColumns: columnVersion === this.columnPreferencesVersion ? json.settings.marketColumns : previous.settings.marketColumns
      } }), resolve));
      this.loadSnapshotHistory();
      this.loadSnapshotHeartbeat();
      this.maybeShowAlertSetupPrompt();
    }
  }

  loadSnapshotHistory = async () => {
    const json = await this.request("snapshots/", "GET", null, true, false);

    if (json.type === "success") {
      const chartHistory = this.normalizeChartHistory(json.chartHistory || {});
      this.setState({ chartHistory }, () => {
        this.saveChartHistory(chartHistory);
        this.loadAcDdSignals();
      });
    }
  }

  loadSnapshotHeartbeat = async () => {
    const json = await this.request("snapshots/heartbeat/", "GET", null, true, false);

    if (json.type === "success") {
      this.setState({
        snapshotHeartbeat: {
          ...emptySnapshotHeartbeat(),
          ...(json.heartbeat || {})
        }
      });
    }
  }

  saveAcDdAlertKeys = () => {
    localStorage.setItem(ACDD_ALERT_STORAGE_KEY, JSON.stringify(Array.from(this.acDdAlertKeys).slice(-300)));
  }

  loadAcDdSignals = async () => {
    const timeframes = AC_DD_ALERT_TIMEFRAMES.map(([, minutes]) => minutes).join(",");
    const json = await this.request(`acdd/signals/?timeframes=${timeframes}`, "GET", null, true, false);

    if (json.type === "success") {
      const acDdSignals = {
        byTimeframe: json.byTimeframe || {},
        thresholds: json.thresholds || {},
        timeframes: json.timeframes || [],
        contractMonth: json.contractMonth || null
      };

      this.setState({ acDdSignals }, () => {
        this.processAcDdSignalAlerts(acDdSignals);
      });
    }
  }

  processAcDdSignalAlerts = acDdSignals => {
    const settings = this.state.settings || {};

    if (!settings.alertsEnabled) {
      return;
    }

    const byTimeframe = acDdSignals.byTimeframe || {};
    const threshold = Number(acDdSignals.thresholds?.volumeDiffPct) || 0;
    let alertKeysChanged = false;

    AC_DD_ALERT_TIMEFRAMES.forEach(([timeframeLabel, timeframeMinutes]) => {
      const indexResults = byTimeframe[String(timeframeMinutes)] || {};

      INDEX_KEYS.forEach(key => {
        const result = indexResults[key];
        if (!result) {
          return;
        }

        ["ce", "pe"].forEach(side => {
          const sideRows = (result[side] && result[side].rows) || [];

          sideRows.forEach(row => {
            const alertKey = `${timeframeLabel}-${key}-${row.symbol}-${row.time}-${row.signal}`;
            if (this.acDdAlertKeys.has(alertKey)) {
              return;
            }

            this.acDdAlertKeys.add(alertKey);
            alertKeysChanged = true;

            if (!this.acDdAlertsInitialized) {
              return;
            }

            this.showAcDdAlert({
              indexName: INDEX_LABELS[key],
              signal: row.signal,
              side: row.instrumentType,
              symbol: row.symbol,
              strike: row.strike,
              optionPrice: row.indexLevel,
              previousOptionPrice: row.previousIndexLevel,
              intervalVolume: row.intervalVolume,
              previousIntervalVolume: row.previousIntervalVolume,
              previousTime: row.previousTime,
              priceChangePct: Number(Number(row.priceChangePct).toFixed(2)),
              volumeDiffPct: Number(Number(row.volumeDiffPct).toFixed(2)),
              threshold,
              timeframeLabel,
              vwapYN: row.vwapYN,
              time: row.time
            });
          });
        });
      });
    });

    if (alertKeysChanged) {
      this.saveAcDdAlertKeys();
    }

    this.acDdAlertsInitialized = true;
  }

  maybeShowAlertSetupPrompt = () => {
    if (
      this.state.loggedIn &&
      !this.state.settings.alertsEnabled &&
      sessionStorage.getItem(ALERT_SETUP_DISMISSED_KEY) !== "true"
    ) {
      this.setState({ showAlertSetupPrompt: true });
    }
  }

  enableAlertsFromPrompt = async () => {
    this.unlockAlertSound();
    const nextSettings = {
      ...this.state.settings,
      alertsEnabled: true,
      alertLotThreshold: this.state.settings.alertLotThreshold || 400
    };

    this.setState({
      settings: nextSettings,
      showAlertSetupPrompt: false
    });
    await this.request("settings/save/", "POST", nextSettings);
    await this.getSettings();
  }

  dismissAlertSetupPrompt = () => {
    this.unlockAlertSound();
    sessionStorage.setItem(ALERT_SETUP_DISMISSED_KEY, "true");
    this.setState({ showAlertSetupPrompt: false });
  }

  handleSettingsChange = e => {
    const name = e.target.name;
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;

    this.setState(prevState => {
      const newState = { ...prevState };
      const newSettings = { ...newState.settings };

      newSettings[name] = val;
      newState.settings = newSettings;

      return newState;
    });
  }

  handleSettingsSave = () => {
    const version = ++this.settingsVersion;
    const columnVersion = this.columnPreferencesVersion;
    const settings = { ...this.state.settings };
    this.stopMarketData();
    if (settings.alertsEnabled) this.unlockAlertSound();
    this.settingsSaveQueue = (this.settingsSaveQueue || Promise.resolve()).then(async () => {
      if (version !== this.settingsVersion || !this.state.loggedIn) return;
      const json = await this.request("settings/save/", "POST", settings);
      if (version !== this.settingsVersion || !this.state.loggedIn) return;
      if (json.type === "success") {
        await new Promise(resolve => this.setState(previous => ({ settings: {
          ...json.settings,
          marketColumns: columnVersion === this.columnPreferencesVersion ? json.settings.marketColumns : previous.settings.marketColumns
        } }), resolve));
        this.loadSnapshotHistory();
      }
      this.startMarketData();
    });
    return this.settingsSaveQueue;
  }

  handleMarketColumnsSave = async marketColumns => {
    const version = ++this.columnPreferencesVersion;
    const username = this.state.username;
    const json = await this.request("settings/columns/", "POST", { marketColumns }, false, false, true);
    if (json.type === "TokenException" || json.type === "UserException") this.handleLogout();
    if (json.type !== "success" || !this.state.loggedIn || this.state.username !== username || version !== this.columnPreferencesVersion) {
      throw new Error("Unable to save market columns");
    }
    await new Promise(resolve => this.setState(previous => ({
      settings: { ...previous.settings, marketColumns: json.marketColumns }
    }), resolve));
  }

  handleContractMonthChange = contractMonth => {
    if (!contractMonth || contractMonth === this.state.settings.contractMonth) {
      return;
    }

    this.stopMarketData();
    this.setState(prevState => ({
      settings: {
        ...prevState.settings,
        contractMonth
      },
      spotPrices: emptySpotPrices(),
      niftyData: emptyTickData(),
      bankniftyData: emptyTickData(),
      sensexData: emptyTickData()
    }), this.handleSettingsSave);
  }

  handleDashboardRefresh = async () => {
    this.stopMarketData();
    await this.getSettings();
    if (this.state.loggedIn) this.startMarketData();
  }

  getInstrumentSymbols = () => {
    const symbols = this.state.settings.symbols || {};

    return {
      nifty: symbols.nifty?.symbol || `NIFTY${getContractMonthCode(this.state.settings.niftyExpiry)}FUT`,
      banknifty: symbols.banknifty?.symbol || `BANKNIFTY${getContractMonthCode(this.state.settings.bankniftyExpiry)}FUT`,
      sensex: symbols.sensex?.symbol || `SENSEX${getContractMonthCode(this.state.settings.sensexExpiry)}FUT`
    };
  }

  getMinutesOfDay = timestamp => {
    return getMarketMinutesOfDay(timestamp);
  }

  isMarketTime = timestamp => {
    const minutes = this.getMinutesOfDay(timestamp);
    return minutes >= MARKET_OPEN_MINUTES && minutes <= MARKET_CLOSE_MINUTES;
  }

  getLatestSnapshotPoint = (key, symbol) => {
    const points = this.normalizeHistoryPoints(this.state.chartHistory[key] || []);

    return points
      .filter(point => (
        point.symbol === symbol &&
        getMarketDateKey(point.time) === getMarketDateKey(Date.now()) &&
        this.isMarketTime(point.time)
      ))
      .sort((a, b) => a.time - b.time)
      .slice(-1)[0];
  }

  processRealtimeLotSwingAlerts = updatedState => {
    const settings = this.state.settings || {};
    const threshold = Number(settings.alertLotThreshold || 0);

    if (!settings.alertsEnabled || !Number.isFinite(threshold) || threshold <= 0) {
      return;
    }

    const symbols = this.getInstrumentSymbols();

    INDEX_KEYS.forEach(key => {
      const dataKey = INDEX_DATA_KEYS[key];
      if (!updatedState[dataKey]) {
        return;
      }

      const symbol = symbols[key];
      const currentData = this.state[dataKey];
      const currentNetLots = Number(currentData.lot);
      const indexLevel = Number(currentData.cmp);
      const alertTime = Number(currentData.lastUpdated) || Date.now();

      if (
        !symbol ||
        currentData.symbol !== symbol ||
        !Number.isFinite(currentNetLots) ||
        !Number.isFinite(indexLevel) ||
        !this.isMarketTime(alertTime)
      ) {
        return;
      }

      const previous = this.getLatestSnapshotPoint(key, symbol);
      if (!previous) {
        return;
      }

      const swingLots = Number((currentNetLots - Number(previous.netLots)).toFixed(2));
      const absSwingLots = Math.abs(swingLots);
      if (absSwingLots <= threshold) {
        return;
      }

      const direction = swingLots < 0 ? "down" : "up";
      const alertKey = `${key}-${symbol}-${previous.time}-${direction}-${threshold}`;
      if (this.realtimeLotAlertKeys.has(alertKey)) {
        return;
      }

      this.realtimeLotAlertKeys.add(alertKey);
      this.sendLotSwingAlert(key, previous, {
        symbol,
        indexLevel,
        netLots: currentNetLots,
        time: alertTime
      });
    });
  }

  sendLotSwingAlert = async (key, previous, current) => {
    const settings = this.state.settings || {};
    const threshold = Number(settings.alertLotThreshold || 0);
    const swingLots = Number((current.netLots - previous.netLots).toFixed(2));
    const absSwingLots = Math.abs(swingLots);

    if (!settings.alertsEnabled || !Number.isFinite(threshold) || threshold <= 0) {
      return;
    }

    if (absSwingLots <= threshold) {
      return;
    }

    this.showLotSwingAlert({
      indexName: INDEX_LABELS[key],
      symbol: current.symbol,
      indexLevel: current.indexLevel,
      previousNetLots: previous.netLots,
      currentNetLots: current.netLots,
      swingLots: swingLots,
      threshold: threshold,
      time: current.time
    });

    if (!settings.alertEmail) {
      return;
    }

    const json = await this.request("alerts/send/", "POST", {
      indexName: INDEX_LABELS[key],
      symbol: current.symbol,
      indexLevel: current.indexLevel,
      previousNetLots: previous.netLots,
      currentNetLots: current.netLots,
      swingLots: swingLots,
      threshold: threshold
    }, false, false);

    if (json.type === "success") {
      toast.warning(`${INDEX_LABELS[key]} lot swing alert sent (${absSwingLots.toFixed(2)} lots).`, options);
    }
  }

  getLotSize = (key, symbol) => {
    const symbols = this.state.settings.symbols || {};
    const lotSize = Number(this.state.lots[symbol] || symbols[key]?.lotSize || 0);

    return Number.isFinite(lotSize) && lotSize > 0 ? lotSize : null;
  }

  formatTickData = (tick, lotSize, symbol) => {
    const avgTradedPrice = Number(tick.average_traded_price);
    const volumeTraded = Number(tick.volume_traded);
    const ratio = Number(tick.total_buy_quantity) / Number(tick.total_sell_quantity);

    return {
      symbol: symbol,
      cmp: tick.last_price,
      netChange: ((tick.change / 100) * tick.ohlc.close).toFixed(2),
      pctChange: tick.change.toFixed(2),
      vwap: Number.isFinite(avgTradedPrice) ? (tick.last_price - avgTradedPrice).toFixed(2) : "N/A",
      oi: tick.oi,
      oiDayHigh: tick.oi_day_high,
      oiDayLow: tick.oi_day_low,
      netDemand: (tick.total_buy_quantity - tick.total_sell_quantity).toFixed(2),
      ratio: Number.isFinite(ratio) ? ratio.toFixed(2) : "N/A",
      lotSize: lotSize || "N/A",
      lot: lotSize ? ((tick.total_buy_quantity - tick.total_sell_quantity) / lotSize).toFixed(2) : "N/A",
      open: tick.ohlc.open,
      high: tick.ohlc.high,
      low: tick.ohlc.low,
      volumeTraded: Number.isFinite(volumeTraded) ? volumeTraded : null,
      avgTradedPrice: Number.isFinite(avgTradedPrice) ? avgTradedPrice : null,
      lastUpdated: tick.receivedAt
    };
  }

  clearPendingTickState = () => {
    if (this.tickStateFrame !== null) {
      cancelFrame(this.tickStateFrame);
    }
    this.tickStateFrame = null;
    this.pendingTickState = {};
  }

  queueTickState = nextState => {
    const spotPrices = nextState.spotPrices ? {
      ...this.pendingTickState.spotPrices,
      ...nextState.spotPrices
    } : this.pendingTickState.spotPrices;
    this.pendingTickState = {
      ...this.pendingTickState,
      ...nextState,
      ...(spotPrices ? { spotPrices } : {})
    };

    if (this.tickStateFrame) {
      return;
    }

    this.tickStateFrame = requestFrame(() => {
      const pendingState = this.pendingTickState;
      this.pendingTickState = {};
      this.tickStateFrame = null;

      if (Object.keys(pendingState).length > 0) {
        this.setState(previous => ({
          ...pendingState,
          spotPrices: { ...previous.spotPrices, ...pendingState.spotPrices }
        }), () => {
          this.processRealtimeLotSwingAlerts(pendingState);
        });
      }
    });
  }

  stopMarketData = () => {
    this.connectionVersion += 1;
    clearTimeout(this.marketDataTimer);
    this.marketDataTimer = null;
    this.marketDataRequest?.abort();
    this.clearPendingTickState();
  }

  startMarketData = () => {
    this.stopMarketData();
    return this.pollMarketData(this.connectionVersion);
  }

  clearLiveData = () => {
    this.clearPendingTickState();
    this.setState({
      feedStatus: "offline",
      spotPrices: emptySpotPrices(),
      niftyData: emptyTickData(),
      bankniftyData: emptyTickData(),
      sensexData: emptyTickData()
    });
  }

  applyMarketData = json => {
    const nextState = { feedStatus: json.feedStatus, spotPrices: emptySpotPrices() };
    const symbols = json.symbols || {};
    INDEX_KEYS.forEach(key => {
      const contract = symbols[key];
      const tick = json.feedStatus === "live" ? json.quotes?.[key] : null;
      nextState[INDEX_DATA_KEYS[key]] = tick && contract
        ? this.formatTickData(tick, Number(contract.lotSize), contract.symbol)
        : emptyTickData();
      const price = Number(json.spotPrices?.[key]);
      nextState.spotPrices[key] = json.feedStatus === "live" && Number.isFinite(price) && price > 0 ? price : null;
    });
    this.setState(previous => ({
      settings: {
        ...previous.settings,
        symbols: Object.keys(symbols).length ? symbols : previous.settings.symbols
      }
    }));
    this.queueTickState(nextState);
  }

  pollMarketData = async version => {
    if (version !== this.connectionVersion || !this.state.loggedIn) return;
    const month = this.state.settings.contractMonth || "current";
    const controller = new AbortController();
    this.marketDataRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const json = await this.request(
        `market-data/?contractMonth=${month}`, "GET", null, false, false, true, controller.signal
      );
      if (version !== this.connectionVersion || !this.state.loggedIn) return;
      if (json.type === "TokenException" || json.type === "UserException") {
        this.handleLogout();
        return;
      }
      if (json.type === "success" && json.contractMonth === this.state.settings.contractMonth) {
        this.applyMarketData(json);
      } else {
        this.clearLiveData();
      }
    } finally {
      clearTimeout(timeout);
      if (this.marketDataRequest === controller) this.marketDataRequest = null;
      if (version === this.connectionVersion && this.state.loggedIn) {
        this.marketDataTimer = setTimeout(() => this.pollMarketData(version), 1000);
      }
    }
  }

  renderAlertPopup = () => {
    const alert = this.state.activeAlert;

    if (!alert) {
      return null;
    }

    if (alert.type === "acdd") {
      const priceChgClass = alert.priceChangePct < 0 ? "value-down" : "value-up";
      const prevTimeLabel = alert.previousTime ? this.formatAlertDateTime(alert.previousTime) : "—";
      const currTimeLabel = this.formatAlertDateTime(alert.time);

      return (
        <div className="lot-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="acdd-alert-title">
          <div className="lot-alert-modal">
            <div className="lot-alert-head">
              <div>
                <div className="lot-alert-label">AC/DD Alert</div>
                <h2 id="acdd-alert-title">{alert.indexName} {alert.side} {alert.signal} {alert.timeframeLabel || "5 min"} volume surge</h2>
              </div>
              <button className="lot-alert-close" type="button" onClick={this.closeAlertPopup} aria-label="Close alert">x</button>
            </div>

            <div className="lot-alert-body">
              <div className="lot-alert-symbol">{alert.symbol}</div>
              <div className="lot-alert-time">Alert time: {currTimeLabel}</div>
              <div className={`lot-alert-swing ${alert.signal === "DD" ? "value-down" : "value-up"}`}>
                {alert.signal} | {this.formatAlertPercent(alert.volumeDiffPct)} vol diff
              </div>

              <table className="acdd-candle-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Previous candle<br/><span className="acdd-candle-time">{prevTimeLabel}</span></th>
                    <th>Signal candle<br/><span className="acdd-candle-time">{currTimeLabel}</span></th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Option price</td>
                    <td>{this.formatAlertNumber(alert.previousOptionPrice)}</td>
                    <td>{this.formatAlertNumber(alert.optionPrice)}</td>
                    <td className={priceChgClass}>{this.formatAlertPercent(alert.priceChangePct)}</td>
                  </tr>
                  <tr>
                    <td>Volume ({alert.timeframeLabel || "5 min"})</td>
                    <td>{this.formatAlertNumber(alert.previousIntervalVolume)}</td>
                    <td>{this.formatAlertNumber(alert.intervalVolume)}</td>
                    <td className="value-up">{this.formatAlertPercent(alert.volumeDiffPct)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="lot-alert-grid">
                <div>
                  <span>Threshold</span>
                  <strong>{this.formatAlertNumber(alert.threshold)}%</strong>
                </div>
                <div>
                  <span>Timeframe</span>
                  <strong>{alert.timeframeLabel || "5 min"}</strong>
                </div>
                <div>
                  <span>VWAP?</span>
                  <strong>{alert.vwapYN}</strong>
                </div>
                <div>
                  <span>Strike</span>
                  <strong>{this.formatAlertNumber(alert.strike)}</strong>
                </div>
              </div>
            </div>

            <div className="lot-alert-actions">
              <button type="button" onClick={this.closeAlertPopup}>Dismiss</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="lot-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="lot-alert-title">
        <div className="lot-alert-modal">
          <div className="lot-alert-head">
            <div>
              <div className="lot-alert-label">Lot Swing Alert</div>
              <h2 id="lot-alert-title">{alert.indexName} threshold crossed</h2>
            </div>
            <button className="lot-alert-close" type="button" onClick={this.closeAlertPopup} aria-label="Close alert">x</button>
          </div>

          <div className="lot-alert-body">
            <div className="lot-alert-symbol">{alert.symbol}</div>
            <div className="lot-alert-time">Alert time: {this.formatAlertDateTime(alert.time)}</div>
            <div className={`lot-alert-swing ${alert.swingLots < 0 ? "value-down" : "value-up"}`}>
              {this.formatAlertSignedNumber(alert.swingLots)} lots
            </div>
            <div className="lot-alert-grid">
              <div>
                <span>Time</span>
                <strong>{this.formatAlertDateTime(alert.time)}</strong>
              </div>
              <div>
                <span>Threshold</span>
                <strong>{this.formatAlertNumber(alert.threshold)} lots</strong>
              </div>
              <div>
                <span>Index</span>
                <strong>{this.formatAlertNumber(alert.indexLevel)}</strong>
              </div>
              <div>
                <span>Previous lots</span>
                <strong>{this.formatAlertSignedNumber(alert.previousNetLots)}</strong>
              </div>
              <div>
                <span>Current lots</span>
                <strong>{this.formatAlertSignedNumber(alert.currentNetLots)}</strong>
              </div>
            </div>
          </div>

          <div className="lot-alert-actions">
            <button type="button" onClick={this.closeAlertPopup}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }

  renderAlertSetupPrompt = () => {
    if (!this.state.showAlertSetupPrompt) {
      return null;
    }

    const threshold = this.state.settings.alertLotThreshold || 400;

    return (
      <div className="lot-alert-overlay" role="dialog" aria-modal="true" aria-labelledby="alert-setup-title">
        <div className="lot-alert-modal alert-setup-modal">
          <div className="lot-alert-head">
            <div>
              <div className="lot-alert-label">Alert Setup</div>
              <h2 id="alert-setup-title">Enable screen alerts?</h2>
            </div>
            <button className="lot-alert-close" type="button" onClick={this.dismissAlertSetupPrompt} aria-label="Close alert setup">x</button>
          </div>

          <div className="lot-alert-body">
            <p className="alert-setup-copy">
              Screen popup and sound alerts will trigger for lot swings above {this.formatAlertNumber(threshold)} lots and AC/DD option volume surges above {this.formatAlertNumber(AC_DD_VOLUME_ALERT_THRESHOLD_PCT)}%.
            </p>
            <p className="alert-setup-copy muted">
              Email is optional and can be added later from Settings.
            </p>
          </div>

          <div className="lot-alert-actions">
            <button className="secondary" type="button" onClick={this.dismissAlertSetupPrompt}>Not now</button>
            <button type="button" onClick={this.enableAlertsFromPrompt}>Enable alerts</button>
          </div>
        </div>
      </div>
    );
  }

  render() {
    let page = null;

    if (!this.state.loggedIn) {
      page = <LoginForm
        handleLogin={this.handleLogin}
      />

    } else {
      page = <MainPage
        request={this.request}
        URL={this.URL}
        username={this.state.username}
        handleLogout={this.handleLogout}

        settings={this.state.settings}
        handleSettingsSave={this.handleSettingsSave}
        handleSettingsChange={this.handleSettingsChange}
        handleContractMonthChange={this.handleContractMonthChange}
        handleMarketColumnsSave={this.handleMarketColumnsSave}
        handleDashboardRefresh={this.handleDashboardRefresh}

        niftyData={this.state.niftyData}
        bankniftyData={this.state.bankniftyData}
        sensexData={this.state.sensexData}
        spotPrices={this.state.spotPrices}
        feedStatus={this.state.feedStatus}
        chartHistory={this.state.chartHistory}
        snapshotHeartbeat={this.state.snapshotHeartbeat}
        acDdSignals={this.state.acDdSignals}
      />
    }

    return (
      <div className="App">
        {page}
        {this.renderAlertSetupPrompt()}
        {this.renderAlertPopup()}
      </div>
    );
  }
}

export default App;
