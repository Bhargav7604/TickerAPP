import { Component, lazy, Suspense } from "react";

import { BottomNavigation, BottomNavigationAction, Box, Paper } from "@mui/material";
import Navbar, { NAV_ITEMS } from "./navbar.jsx";
import Sidebar, { MobileMenu } from "./sidebar.jsx";
import Settings from "./settings.jsx";
import Dashboard from "./dashboard.jsx";
import Home from "./home.jsx";
import { makeEquityApi } from "../equityData";
import { makeOiApi } from "../oiData";
import { makeDecisionApi } from "../decisionData";
import { makeTraderApi } from "../traderData";
import { makeIndexStocksApi, saveStockIndex } from "../indexStocksData";

const PAGES = ["index-stocks", "equity", "index-options", "oi-analysis", "trading", "settings"];
const Equity = lazy(() => import("./equity.jsx"));
const IndexStocks = lazy(() => import("./indexStocks.jsx"));
const OiAnalysis = lazy(() => import("./oiAnalysis.jsx"));
const TraderDesk = lazy(() => import("./traderDesk.jsx"));

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

    } else if (this.state.currentPage === "index-stocks") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading Index Stocks...</div>}><IndexStocks api={this.indexStocksApi} /></Suspense>;
    } else if (["equity", "index-options"].includes(this.state.currentPage)) {
      const indexOptions = this.state.currentPage === "index-options";
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading {indexOptions ? "Index Options" : "Equity"}...</div>}><Equity key={`${this.props.username}:${this.state.currentPage}`} username={this.props.username} indexOptions={indexOptions} api={indexOptions ? this.indexOptionsApi : this.equityApi} /></Suspense>;
    } else if (this.state.currentPage === "oi-analysis") {
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading OI Analysis...</div>}><OiAnalysis api={this.oiApi} /></Suspense>;
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
          <BottomNavigation showLabels value={this.state.currentPage} onChange={(_, page) => this.changePage(page)}>
            {NAV_ITEMS.map(([id, , shortLabel, Icon]) => <BottomNavigationAction key={id} value={id} label={shortLabel} icon={<Icon size={20} />}
              aria-current={this.state.currentPage === id ? "page" : undefined} />)}
          </BottomNavigation>
        </Paper>
      </Box>
    );
  }
}

export default MainPage;
