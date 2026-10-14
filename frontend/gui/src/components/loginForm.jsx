import { Component } from "react";

const PANEL_METRICS = [
  ["NIFTY", "+0.42%", "up"],
  ["BANKNIFTY", "-0.18%", "down"],
  ["SENSEX", "+0.31%", "up"]
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
              <div className="login-brand-mark" aria-hidden="true">
                <span>QL</span>
              </div>
              <div>
                <div className="login-kicker">QuantLab</div>
                <h1>QuantLab Ticker</h1>
              </div>
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

          <div className="login-market-panel" aria-hidden="true">
            <div className="market-panel-head">
              <div>
                <span className="market-panel-label">Market Session</span>
                <strong>Live index desk</strong>
              </div>
              <span className="market-live-dot" />
            </div>

            <div className="market-card-grid">
              {PANEL_METRICS.map(([label, value, direction]) => (
                <div className="market-mini-card" key={label}>
                  <span>{label}</span>
                  <strong className={direction === "down" ? "value-down" : "value-up"}>{value}</strong>
                </div>
              ))}
            </div>

            <div className="login-chart">
              <svg viewBox="0 0 420 160" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="login-chart-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#1f6feb" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#1f6feb" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className="login-chart-area" d="M0 115 L42 108 L84 112 L126 84 L168 92 L210 65 L252 72 L294 43 L336 58 L378 35 L420 42 L420 160 L0 160 Z" />
                <path className="login-chart-line" d="M0 115 L42 108 L84 112 L126 84 L168 92 L210 65 L252 72 L294 43 L336 58 L378 35 L420 42" />
              </svg>
            </div>

            <div className="market-tape">
              <span>09:15</span>
              <span>11:00</span>
              <span>13:30</span>
              <span>15:30</span>
            </div>
          </div>
        </section>
      </main>
    );
  }
}

export default LoginForm;
