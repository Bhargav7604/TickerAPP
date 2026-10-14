import { Component } from "react";
import { BellRing, ChartCandlestick, LayoutDashboard } from "lucide-react";
import "../login.css";
import brandMark from "../assets/brand/utraders-mark.png";
import logoOnDark from "../assets/brand/utraders-logo-light.png";
import logoOnLight from "../assets/brand/utraders-logo-dark.png";

const FEATURES = [
  [LayoutDashboard, "Live index futures", "NIFTY, BANKNIFTY and SENSEX across all three expiries."],
  [ChartCandlestick, "Stock F&O watchlists", "Futures and options with depth and five-minute charts."],
  [BellRing, "Lot-swing alerts", "Screen, sound and email alerts when net lots move."],
];

class LoginForm extends Component {
  constructor(props) {
    super(props);

    this.state = {
      username: "",
      password: ""
    }
  }

  handleChange = e => {
    const name = e.target.name;
    const value = e.target.value;

    this.setState(prevstate => {
      const newState = { ...prevstate };
      newState[name] = value;
      return newState;
    });
  }

  handleLoginFormSubmit = e => {
    e.preventDefault();
    this.props.handleLogin(this.state);
  }

  render() {
    return (
      <main className="login-page">
        <section className="login-shell" aria-label="Ticker login">
          <div className="login-panel">
            <div className="login-brand">
              <img className="login-logo login-logo-on-dark" src={logoOnDark} alt="Utraders" />
              <img className="login-logo login-logo-on-light" src={logoOnLight} alt="Utraders" />
            </div>

            <div className="login-heading">
              <h1>Sign in to Utraders Ticker</h1>
              <p>Use the username and password from your administrator.</p>
            </div>

            <form onSubmit={this.handleLoginFormSubmit} className="login-form" id="login-form">
              <div className="login-field">
                <label htmlFor="username-input">Username</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M20 21a8 8 0 0 0-16 0" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    required
                    autoFocus
                    type="text"
                    name="username"
                    id="username-input"
                    placeholder="Enter username"
                    autoComplete="username"
                    value={this.state.username}
                    onChange={this.handleChange}
                  />
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="password-input">Password</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                  <input
                    required
                    type="password"
                    name="password"
                    id="password-input"
                    placeholder="Enter password"
                    autoComplete="current-password"
                    value={this.state.password}
                    onChange={this.handleChange}
                  />
                </div>
              </div>

              <button className="login-submit" type="submit">
                <span>Sign in</span>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </button>
            </form>
          </div>

          <div className="login-brand-panel" aria-hidden="true">
            <img className="login-hero-mark" src={brandMark} alt="" />
            <p className="login-tagline">Every tick. Every trade. Everywhere.</p>
            <ul className="login-features">
              {FEATURES.map(([Icon, title, text]) => (
                <li key={title}>
                  <span className="login-feature-icon"><Icon size={18} /></span>
                  <span><strong>{title}</strong>{text}</span>
                </li>
              ))}
            </ul>
            <svg className="login-wave" viewBox="0 0 420 120" preserveAspectRatio="none">
              <defs>
                <linearGradient id="login-wave-stroke" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#67d5da" />
                  <stop offset="50%" stopColor="#5fa8de" />
                  <stop offset="100%" stopColor="#647de2" />
                </linearGradient>
                <linearGradient id="login-wave-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#5fa8de" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#5fa8de" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path fill="url(#login-wave-fill)" d="M0 92 L42 86 L84 90 L126 66 L168 74 L210 50 L252 58 L294 30 L336 44 L378 20 L420 28 L420 120 L0 120 Z" />
              <path fill="none" stroke="url(#login-wave-stroke)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" d="M0 92 L42 86 L84 90 L126 66 L168 74 L210 50 L252 58 L294 30 L336 44 L378 20 L420 28" />
            </svg>
          </div>
        </section>
      </main>
    );
  }
}

export default LoginForm;
