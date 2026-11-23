import { Component, lazy, Suspense } from "react";

import { BottomNavigation, BottomNavigationAction, Box, Paper, Typography } from "@mui/material";
import { Ellipsis } from "lucide-react";
import Navbar, { INDIA_ONLY, mobileItemsFor, navItemsFor } from "./navbar.jsx";
import { Segmented } from "../ui/Glass";
import Sidebar, { MobileMenu } from "./sidebar.jsx";
import Settings from "./settings.jsx";
import Dashboard from "./dashboard.jsx";
import Home from "./home.jsx";
import { makeEquityApi } from "../equityData";
import { makeOiApi } from "../oiData";
import { makeDecisionApi } from "../decisionData";
import { makeTraderApi } from "../traderData";
import { makeIndexStocksApi, saveStockIndex } from "../indexStocksData";
import { makeDashboardApi } from "../dashboardData";
import { makeBoardApi } from "../boardData";
import { makeNewsApi } from "../newsData";
import { makeStraddleApi } from "../straddleData";
import { MARKETS, makeCommodityApi, readMarket, saveMarket } from "../commodityData";

const PAGES = ["index-analysis", "market", "news", "money-flow", "intraday", "charts", "index-stocks", "equity", "index-options", "oi-analysis", "tools", "holidays", "trading", "settings"];
const Equity = lazy(() => import("./equity.jsx"));
const IndexStocks = lazy(() => import("./indexStocks.jsx"));
const LiveDashboard = lazy(() => import("./liveDashboard.jsx"));
const OiAnalysis = lazy(() => import("./oiAnalysis.jsx"));
const TraderDesk = lazy(() => import("./traderDesk.jsx"));
const MarketPage = lazy(() => import("./marketPage.jsx"));
const MoneyFlow = lazy(() => import("./moneyFlow.jsx"));
const Intraday = lazy(() => import("./intraday.jsx"));
const Tools = lazy(() => import("./tools.jsx"));
const MarketHolidays = lazy(() => import("./marketHolidays.jsx"));
const News = lazy(() => import("./news.jsx"));
const CommodityDetails = lazy(() => import("./commodityDetails.jsx"));
const Overview = lazy(() => import("./overview.jsx"));

class MainPage extends Component {
  constructor(props) {
    super(props);

    const currentPage = PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard";
    this.state = {
      currentPage,
      menuOpen: false,
      // A link to an Indian-market page opens the Indian market even if Commodity was chosen last time.
      market: INDIA_ONLY.includes(currentPage) ? "india" : readMarket()
    }
    this.equityApi = props.equityApi || makeEquityApi(props.request);
    this.indexOptionsApi = props.indexOptionsApi || makeEquityApi(props.request, "index-options");
    this.oiApi = props.oiApi || makeOiApi(props.request);
    this.decisionApi = props.decisionApi || makeDecisionApi(props.request);
    this.traderApi = props.traderApi || makeTraderApi(props.request);
    this.indexStocksApi = props.indexStocksApi || makeIndexStocksApi(props.request);
    this.dashboardApi = props.dashboardApi || makeDashboardApi(props.request);
    this.boardApi = props.boardApi || makeBoardApi(props.request);
    this.newsApi = props.newsApi || makeNewsApi(props.request);
    this.straddleApi = props.straddleApi || makeStraddleApi(props.request);
    this.commodityApi = props.commodityApi || makeCommodityApi(props.request);
    // Home in Commodity mode: the same page fed with MCX cards; no sector contribution or index swing alerts.
    this.commodityHomeApi = { decision: signal => this.commodityApi.decision(signal) };
  }

  componentDidMount() { window.addEventListener("hashchange", this.syncPage); }
  componentWillUnmount() { window.removeEventListener("hashchange", this.syncPage); }
  syncPage = () => {
    const currentPage = PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard";
    if (INDIA_ONLY.includes(currentPage) && this.state.market === "commodity") saveMarket("india");
    this.setState(state => ({ currentPage, market: INDIA_ONLY.includes(currentPage) ? "india" : state.market }));
  }

  changePage = page => {
    window.location.hash = page === "dashboard" ? "index" : page;
    this.setState({
      currentPage: page
    });
  }

  changeMarket = market => {
    saveMarket(market);
    if (market === "commodity" && INDIA_ONLY.includes(this.state.currentPage)) this.changePage("dashboard");
    this.setState({ market });
  }

  openStocks = index => {
    saveStockIndex(index);
    this.changePage("index-stocks");
  }

  render() {
    let page;
    const market = this.state.market;
    const items = navItemsFor(market);
    const mobileItems = mobileItemsFor(market);

    if (this.state.currentPage === "dashboard" && this.state.market === "commodity") {
      page = <Home key="commodity" api={this.commodityHomeApi} market="commodity"
        details={<Suspense fallback={null}><CommodityDetails api={this.commodityApi} /></Suspense>} />;
    } else if (this.state.currentPage === "dashboard") {
      // Home: one screen with a box for each part of the app; each box opens its page.
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Home...</div>}><Overview boardApi={this.boardApi} decisionApi={this.decisionApi}
        oiApi={this.oiApi} newsApi={this.newsApi} straddleApi={this.straddleApi} onOpen={this.changePage} onOpenStocks={this.openStocks} /></Suspense>;
    } else if (this.state.currentPage === "index-analysis") {
      // The index futures signals that used to be Home.
      const swingAlerts = this.props.swingAlerts || [];
      page = <Home key="india" api={this.decisionApi} market="india" onOpenStocks={this.openStocks}
        latestSwing={swingAlerts[swingAlerts.length - 1]} details={<Dashboard
        settings={this.props.settings}
        niftyData={this.props.niftyData}
        bankniftyData={this.props.bankniftyData}
        sensexData={this.props.sensexData}
        spotPrices={this.props.spotPrices}
        feedStatus={this.props.feedStatus}
        chartHistory={this.props.chartHistory}
        snapshotHeartbeat={this.props.snapshotHeartbeat}
        acDdSignals={this.props.acDdSignals}
        swingAlerts={swingAlerts}
        marketTime={this.props.marketTime}
        previewLabel={this.props.previewLabel}
        handleContractMonthChange={this.props.handleContractMonthChange}
        handleMarketColumnsSave={this.props.handleMarketColumnsSave}
        handleDashboardRefresh={this.props.handleDashboardRefresh}
        openSettings={() => this.changePage("settings")}
        loadCandles={this.decisionApi.candles}
      />} />

    } else if (this.state.currentPage === "market") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Market...</div>}><MarketPage api={this.boardApi} /></Suspense>;
    } else if (this.state.currentPage === "money-flow") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Money Flow...</div>}><MoneyFlow api={this.boardApi} /></Suspense>;
    } else if (this.state.currentPage === "intraday") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Intraday...</div>}><Intraday api={this.boardApi} /></Suspense>;
    } else if (this.state.currentPage === "tools") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Tools...</div>}><Tools api={this.boardApi} /></Suspense>;
    } else if (this.state.currentPage === "news") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading News...</div>}><News api={this.newsApi} boardApi={this.boardApi} /></Suspense>;
    } else if (this.state.currentPage === "holidays") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Market Holidays...</div>}><MarketHolidays /></Suspense>;
    } else if (this.state.currentPage === "charts") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Dashboard...</div>}><LiveDashboard api={this.dashboardApi} /></Suspense>;
    } else if (this.state.currentPage === "index-stocks") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Index Stocks...</div>}><IndexStocks api={this.indexStocksApi} /></Suspense>;
    } else if (["equity", "index-options"].includes(this.state.currentPage)) {
      const indexOptions = this.state.currentPage === "index-options";
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading {indexOptions ? "Index Options" : "Equity"}...</div>}><Equity key={`${this.props.username}:${this.state.currentPage}`} username={this.props.username} indexOptions={indexOptions} api={indexOptions ? this.indexOptionsApi : this.equityApi} straddleApi={indexOptions ? null : this.straddleApi} /></Suspense>;
    } else if (this.state.currentPage === "oi-analysis") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading OI Analysis...</div>}><OiAnalysis api={this.oiApi} boardApi={this.boardApi} /></Suspense>;
    } else if (this.state.currentPage === "trading") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading My trading...</div>}><TraderDesk api={this.traderApi} /></Suspense>;
    } else if (this.state.currentPage === "settings") {
      page = <Settings
        settings={this.props.settings}
        handleSettingsSave={this.props.handleSettingsSave}
        handleSettingsChange={this.props.handleSettingsChange}
      />
    }

    return (
      <Box className="has-section-nav" sx={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar username={this.props.username} handleLogout={this.props.handleLogout} changePage={this.changePage} items={items}
          currentPage={this.state.currentPage} handleDashboardRefresh={this.props.handleDashboardRefresh} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Navbar changePage={this.changePage} currentPage={this.state.currentPage} handleDashboardRefresh={this.props.handleDashboardRefresh}
            onMenu={() => this.setState({ menuOpen: true })} menuOpen={this.state.menuOpen} />
          <Box component="nav" aria-label="Market" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", px: { xs: 2, md: 3 }, pt: { xs: 1.5, md: 2 } }}>
            <Segmented label="Choose market" value={market} onChange={this.changeMarket} options={MARKETS} highlight />
            <Typography variant="caption" color="text.secondary">
              {market === "commodity" ? "MCX futures · 09:00–23:30/23:55 IST" : "NSE · BSE · 09:15–15:30 IST"}
            </Typography>
          </Box>
          {page}
        </Box>
        <MobileMenu open={this.state.menuOpen} onClose={() => this.setState({ menuOpen: false })} username={this.props.username} handleLogout={this.props.handleLogout} changePage={this.changePage} items={items}
          currentPage={this.state.currentPage} handleDashboardRefresh={this.props.handleDashboardRefresh} />
        <Paper component="nav" aria-label="Mobile section navigation" elevation={0} square
          sx={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1100, display: { xs: "block", md: "none" }, pb: "env(safe-area-inset-bottom, 0px)", borderRadius: 0 }}>
          <BottomNavigation showLabels value={mobileItems.includes(this.state.currentPage) ? this.state.currentPage : "more"}
            onChange={(_, page) => page === "more" ? this.setState({ menuOpen: true }) : this.changePage(page)}>
            {items.filter(([id]) => mobileItems.includes(id)).map(([id, , shortLabel, Icon]) => <BottomNavigationAction key={id} value={id} label={shortLabel} icon={<Icon size={20} />}
              aria-current={this.state.currentPage === id ? "page" : undefined} sx={{ minWidth: 0, px: 0.5 }} />)}
            <BottomNavigationAction value="more" label="More" icon={<Ellipsis size={20} />} aria-label="More pages"
              aria-current={mobileItems.includes(this.state.currentPage) ? undefined : "page"} sx={{ minWidth: 0, px: 0.5 }} />
          </BottomNavigation>
        </Paper>
      </Box>
    );
  }
}

export default MainPage;
