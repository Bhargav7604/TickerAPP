import { Component } from "react";
import { ALERT_INDEXES, alertLotThreshold } from "../alertThresholds";

class Settings extends Component {
  handleSettingsSave = async e => {
    e.preventDefault();
    await this.props.handleSettingsSave();
  }

  render() {
    const alertsEnabled = !!this.props.settings.alertsEnabled;

    return (
      <div className="app-settings">
        <div className="columns is-mobile">
          <div className="column is-three-fifths-tablet is-offset-one-fifth-tablet is-full-mobile mt-2">
            <div className="card m-2">
              <div className="card-header">
                <h2 className="card-header-title">Strategy Settings</h2>
              </div>

              <div className="card-content">
                <form onSubmit={this.handleSettingsSave} className="m-2" id="settings-form">
                  <h3 className="settings-section-title">User Alert Settings</h3>

                  <div className="field">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        name="alertsEnabled"
                        checked={alertsEnabled}
                        onChange={this.props.handleSettingsChange}
                      />
                      <span className="ml-2">Enable alerts</span>
                    </label>
                  </div>

                  <fieldset className="field">
                    <legend className="label">Alert Swing Lots</legend>
                    <div className="alert-threshold-grid">
                      {ALERT_INDEXES.map(([key, label]) => (
                        <div key={key}>
                          <label htmlFor={`alert-lot-threshold-${key}`} className="alert-threshold-label">{label}</label>
                          <input
                            id={`alert-lot-threshold-${key}`}
                            type="number"
                            name={`alertLotThresholds.${key}`}
                            className="input"
                            min="1"
                            step="1"
                            value={this.props.settings.alertLotThresholds?.[key] ?? alertLotThreshold(this.props.settings, key)}
                            onChange={this.props.handleSettingsChange}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="help">Swing alerts trigger when net lots move by at least this many lots in five minutes. SENSEX trades far fewer lots, so it needs a smaller number. AC/DD alerts trigger on option volume surges above 250%.</p>
                  </fieldset>

                  <div className="field">
                    <label htmlFor="alert-email" className="label">Alert Email</label>
                    <div className="control">
                      <input
                        id="alert-email"
                        type="email"
                        name="alertEmail"
                        className="input"
                        placeholder="Optional email for alert delivery"
                        value={this.props.settings.alertEmail || ""}
                        onChange={this.props.handleSettingsChange}
                      />
                    </div>
                    <p className="help">Email is optional. Without email, alerts still play a sound and show in Swing alerts.</p>
                  </div>
                </form>
              </div>

              <footer className="card-footer">
                <button className="card-footer-item button is-link" type="submit" form="settings-form">Save Settings</button>
              </footer>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Settings;
