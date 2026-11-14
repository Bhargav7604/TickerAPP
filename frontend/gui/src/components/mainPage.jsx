import { Component, lazy, Suspense } from "react";

import { BottomNavigation, BottomNavigationAction, Box, Paper } from "@mui/material";
import { Ellipsis } from "lucide-react";
import Navbar, { MOBILE_ITEMS, NAV_ITEMS } from "./navbar.jsx";
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

const PAGES = ["market", "money-flow", "intraday", "charts", "index-stocks", "equity", "index-options", "oi-analysis", "tools", "trading", "settings"];
const Equity = lazy(() => import("./equity.jsx"));
const IndexStocks = lazy(() => import("./indexStocks.jsx"));
const LiveDashboard = lazy(() => import("./liveDashboard.jsx"));
const OiAnalysis = lazy(() => import("./oiAnalysis.jsx"));
const TraderDesk = lazy(() => import("./traderDesk.jsx"));
const MarketPage = lazy(() => import("./marketPage.jsx"));
const MoneyFlow = lazy(() => import("./moneyFlow.jsx"));
const Intraday = lazy(() => import("./intraday.jsx"));
const Tools = lazy(() => import("./tools.jsx"));

class MainPage extends Component {
  constructor(props) {
    super(props);

    this.state = {
      currentPage: PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard",
      menuOpen: false
    }
    this.equityApi = props.equityApi || makeEquityApi(props.request);
    this.indexOptionsApi = props.indexOptionsApi || makeEquityApi(props.request, "index-options");
    this.oiApi = props.oiApi || makeOiApi(props.request);
    this.decisionApi = props.decisionApi || makeDecisionApi(props.request);
    this.traderApi = props.traderApi || makeTraderApi(props.request);
    this.indexStocksApi = props.indexStocksApi || makeIndexStocksApi(props.request);
    this.dashboardApi = props.dashboardApi || makeDashboardApi(props.request);
    this.boardApi = props.boardApi || makeBoardApi(props.request);
  }

  componentDidMount() { window.addEventListener("hashchange", this.syncPage); }
  componentWillUnmount() { window.removeEventListener("hashchange", this.syncPage); }
  syncPage = () => this.setState({ currentPage: PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard" });

  changePage = page => {
    window.location.hash = page === "dashboard" ? "index" : page;
    this.setState({
      currentPage: page
    });
  }

  openStocks = index => {
    saveStockIndex(index);
    this.changePage("index-stocks");
  }

  render() {
    let page;

    if (this.state.currentPage === "dashboard") {
      const swingAlerts = this.props.swingAlerts || [];
      page = <Home api={this.decisionApi} onOpenStocks={this.openStocks} latestSwing={swingAlerts[swingAlerts.length - 1]} details={<Dashboard
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
    } else if (this.state.currentPage === "charts") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Dashboard...</div>}><LiveDashboard api={this.dashboardApi} /></Suspense>;
    } else if (this.state.currentPage === "index-stocks") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Index Stocks...</div>}><IndexStocks api={this.indexStocksApi} /></Suspense>;
    } else if (["equity", "index-options"].includes(this.state.currentPage)) {
      const indexOptions = this.state.currentPage === "index-options";
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading {indexOptions ? "Index Options" : "Equity"}...</div>}><Equity key={`${this.props.username}:${this.state.currentPage}`} username={this.props.username} indexOptions={indexOptions} api={indexOptions ? this.indexOptionsApi : this.equityApi} /></Suspense>;
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
        <Sidebar username={this.props.username} handleLogout={this.props.handleLogout} changePage={this.changePage}
          currentPage={this.state.currentPage} handleDashboardRefresh={this.props.handleDashboardRefresh} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Navbar changePage={this.changePage} currentPage={this.state.currentPage} handleDashboardRefresh={this.props.handleDashboardRefresh}
            onMenu={() => this.setState({ menuOpen: true })} menuOpen={this.state.menuOpen} />
          {page}
        </Box>
        <MobileMenu open={this.state.menuOpen} onClose={() => this.setState({ menuOpen: false })} username={this.props.username} handleLogout={this.props.handleLogout} changePage={this.changePage}
          currentPage={this.state.currentPage} handleDashboardRefresh={this.props.handleDashboardRefresh} />
        <Paper component="nav" aria-label="Mobile section navigation" elevation={0} square
          sx={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1100, display: { xs: "block", md: "none" }, pb: "env(safe-area-inset-bottom, 0px)", borderRadius: 0 }}>
          <BottomNavigation showLabels value={MOBILE_ITEMS.includes(this.state.currentPage) ? this.state.currentPage : "more"}
            onChange={(_, page) => page === "more" ? this.setState({ menuOpen: true }) : this.changePage(page)}>
            {NAV_ITEMS.filter(([id]) => MOBILE_ITEMS.includes(id)).map(([id, , shortLabel, Icon]) => <BottomNavigationAction key={id} value={id} label={shortLabel} icon={<Icon size={20} />}
              aria-current={this.state.currentPage === id ? "page" : undefined} sx={{ minWidth: 0, px: 0.5 }} />)}
            <BottomNavigationAction value="more" label="More" icon={<Ellipsis size={20} />} aria-label="More pages"
              aria-current={MOBILE_ITEMS.includes(this.state.currentPage) ? undefined : "page"} sx={{ minWidth: 0, px: 0.5 }} />
          </BottomNavigation>
        </Paper>
      </Box>
    );
  }
}

export default MainPage;
