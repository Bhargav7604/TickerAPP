import { Component } from "react";
import { ChartNoAxesColumn, Layers, LayoutDashboard, LogOut, Moon, RefreshCw, Settings, Sun, UserCircle } from "lucide-react";
import { ThemeContext } from "../theme";
import brandMark from "../assets/brand/utraders-mark.png";
import wordmark from "../assets/brand/utraders-wordmark-light.png";

class Navbar extends Component {
  static contextType = ThemeContext;
  state = { isMenuOpen: false };
  accountRef = null;
  componentDidMount() { document.addEventListener("pointerdown", this.closeOutside); }
  componentWillUnmount() { document.removeEventListener("pointerdown", this.closeOutside); }
  closeOutside = event => {
    if (this.accountRef && !this.accountRef.contains(event.target)) this.setState({ isMenuOpen: false });
  };
  render() {
    return <nav className="scan-topbar" aria-label="Main navigation">
      <button className="scan-brand" type="button" onClick={() => this.props.changePage("dashboard")} aria-label="Utraders dashboard">
        <img className="brand-logo-mark" src={brandMark} alt="" />
        <img className="brand-wordmark" src={wordmark} alt="" />
      </button>
      <div className="scan-nav-links">
        <button type="button" className={this.props.currentPage === "dashboard" ? "active" : ""}
          onClick={() => this.props.changePage("dashboard")} aria-current={this.props.currentPage === "dashboard" ? "page" : undefined}>
          <LayoutDashboard size={17} /><span>Index</span>
        </button>
        <button type="button" className={this.props.currentPage === "equity" ? "active" : ""} aria-current={this.props.currentPage === "equity" ? "page" : undefined}
          onClick={() => this.props.changePage("equity")}><ChartNoAxesColumn size={18} /><span>Equity</span></button>
        <button type="button" className={this.props.currentPage === "index-options" ? "active" : ""} aria-current={this.props.currentPage === "index-options" ? "page" : undefined}
          onClick={() => this.props.changePage("index-options")}><Layers size={18} /><span>Index Options</span></button>
        <button type="button" className={this.props.currentPage === "settings" ? "active" : ""} title="Settings" aria-label="Settings"
          onClick={() => this.props.changePage("settings")}><Settings size={19} /><span>Settings</span></button>
      </div>
      <div className="scan-nav-end">
        <button className="scan-icon-button" type="button" title={this.context.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={this.context.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={this.context.toggleTheme}>
          {this.context.theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        {!["equity", "index-options"].includes(this.props.currentPage) && <button className="scan-icon-button mobile-refresh" type="button" title="Refresh market data" aria-label="Refresh market data"
          onClick={this.props.handleDashboardRefresh}><RefreshCw size={20} /></button>}
        <button className="scan-icon-button mobile-settings" type="button" title="Settings" aria-label="Settings"
          onClick={() => this.props.changePage("settings")}><Settings size={21} /></button>
        <div className="scan-account" ref={element => { this.accountRef = element; }}>
          <button type="button" className="scan-icon-button" title="Account" aria-label="Account menu" aria-expanded={this.state.isMenuOpen}
            onClick={() => this.setState(state => ({ isMenuOpen: !state.isMenuOpen }))}
            onKeyDown={event => { if (event.key === "Escape") this.setState({ isMenuOpen: false }); }}>
            <UserCircle size={23} />
          </button>
          {this.state.isMenuOpen && <div className="scan-account-popover">
            <strong>{this.props.username}</strong>
            <button type="button" onClick={this.props.handleLogout}><LogOut size={16} />Log out</button>
          </div>}
        </div>
      </div>
    </nav>;
  }
}
export default Navbar;
