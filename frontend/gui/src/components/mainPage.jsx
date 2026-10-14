import { Component, lazy, Suspense } from "react";

import Navbar from "./navbar.jsx";
import Settings from "./settings.jsx";
import Dashboard from "./dashboard.jsx";
import "../equity.css";
import { makeEquityApi } from "../equityData";
import { ChartNoAxesColumn, Layers, LayoutDashboard, Settings as SettingsIcon } from "lucide-react";

const Equity = lazy(() => import("./equity.jsx"));

class MainPage extends Component {
  constructor(props) {
    super(props);

    this.state = {
      currentPage: ["equity", "index-options", "settings"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard"
    }
    this.equityApi = props.equityApi || makeEquityApi(props.request);
    this.indexOptionsApi = props.indexOptionsApi || makeEquityApi(props.request, "index-options");
  }

  componentDidMount() { window.addEventListener("hashchange", this.syncPage); }
  componentWillUnmount() { window.removeEventListener("hashchange", this.syncPage); }
  syncPage = () => this.setState({ currentPage: ["equity", "index-options", "settings"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard" });

  changePage = page => {
    window.location.hash = page === "dashboard" ? "index" : page;
    this.setState({
      currentPage: page
    });
  }

  render() {
    let page;

    if (this.state.currentPage === "dashboard") {
      page = <Dashboard
        settings={this.props.settings}
        niftyData={this.props.niftyData}
        bankniftyData={this.props.bankniftyData}
        sensexData={this.props.sensexData}
        spotPrices={this.props.spotPrices}
        feedStatus={this.props.feedStatus}
        chartHistory={this.props.chartHistory}
        snapshotHeartbeat={this.props.snapshotHeartbeat}
        acDdSignals={this.props.acDdSignals}
        marketTime={this.props.marketTime}
        previewLabel={this.props.previewLabel}
        handleContractMonthChange={this.props.handleContractMonthChange}
        handleMarketColumnsSave={this.props.handleMarketColumnsSave}
        handleDashboardRefresh={this.props.handleDashboardRefresh}
      />

    } else if (["equity", "index-options"].includes(this.state.currentPage)) {
      const indexOptions = this.state.currentPage === "index-options";
      page = <Suspense fallback={<div className="eq-empty" role="status">Loading {indexOptions ? "Index Options" : "Equity"}...</div>}><Equity key={`${this.props.username}:${this.state.currentPage}`} username={this.props.username} indexOptions={indexOptions} api={indexOptions ? this.indexOptionsApi : this.equityApi} /></Suspense>;
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
          {[["dashboard", "Index", LayoutDashboard], ["equity", "Equity", ChartNoAxesColumn], ["index-options", "Index Options", Layers], ["settings", "Settings", SettingsIcon]].map(([id, label, Icon]) =>
            <button key={id} type="button" className={this.state.currentPage === id ? "active" : ""} aria-current={this.state.currentPage === id ? "page" : undefined} onClick={() => this.changePage(id)}><Icon size={21} /><span>{label}</span></button>)}
        </nav>
      </div>
    );
  }
}

export default MainPage;
