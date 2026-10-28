import { Component, lazy, Suspense } from "react";

import Navbar from "./navbar.jsx";
import Settings from "./settings.jsx";
import Dashboard from "./dashboard.jsx";
import Home from "./home.jsx";
import "../equity.css";
import "../brand.css";
import { makeEquityApi } from "../equityData";
import { Activity, ChartNoAxesColumn, House, Layers, Settings as SettingsIcon, WalletCards } from "lucide-react";
import { makeOiApi } from "../oiData";
import { makeDecisionApi } from "../decisionData";
import { makeTraderApi } from "../traderData";

const Equity = lazy(() => import("./equity.jsx"));
const OiAnalysis = lazy(() => import("./oiAnalysis.jsx"));
const TraderDesk = lazy(() => import("./traderDesk.jsx"));

class MainPage extends Component {
  constructor(props) {
    super(props);

    this.state = {
      currentPage: ["equity", "index-options", "oi-analysis", "trading", "settings"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard"
    }
    this.equityApi = props.equityApi || makeEquityApi(props.request);
    this.indexOptionsApi = props.indexOptionsApi || makeEquityApi(props.request, "index-options");
    this.oiApi = props.oiApi || makeOiApi(props.request);
    this.decisionApi = props.decisionApi || makeDecisionApi(props.request);
    this.traderApi = props.traderApi || makeTraderApi(props.request);
  }

  componentDidMount() { window.addEventListener("hashchange", this.syncPage); }
  componentWillUnmount() { window.removeEventListener("hashchange", this.syncPage); }
  syncPage = () => this.setState({ currentPage: ["equity", "index-options", "oi-analysis", "trading", "settings"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard" });

  changePage = page => {
    window.location.hash = page === "dashboard" ? "index" : page;
    this.setState({
      currentPage: page
    });
  }

  render() {
    let page;

    if (this.state.currentPage === "dashboard") {
      const swingAlerts = this.props.swingAlerts || [];
      page = <Home api={this.decisionApi} latestSwing={swingAlerts[swingAlerts.length - 1]} details={<Dashboard
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
      />} />

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
      <div className="has-section-nav">
        <Navbar
          username={this.props.username}
          handleLogout={this.props.handleLogout}
          changePage={this.changePage}
          currentPage={this.state.currentPage}
          handleDashboardRefresh={this.props.handleDashboardRefresh}
        />
        {page}
        <nav className="eq-mobile-navigation" aria-label="Mobile section navigation">
          {[["dashboard", "Home", House], ["equity", "Equity", ChartNoAxesColumn], ["index-options", "Options", Layers], ["oi-analysis", "OI", Activity], ["trading", "Trading", WalletCards], ["settings", "Settings", SettingsIcon]].map(([id, label, Icon]) =>
            <button key={id} type="button" className={this.state.currentPage === id ? "active" : ""} aria-current={this.state.currentPage === id ? "page" : undefined} onClick={() => this.changePage(id)}><Icon size={21} /><span>{label}</span></button>)}
        </nav>
      </div>
    );
  }
}

export default MainPage;
