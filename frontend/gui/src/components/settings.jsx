import { Component } from "react";

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

                  <div className="field">
                    <label htmlFor="alert-lot-threshold" className="label">Alert Swing Lots</label>
                    <div className="control">
                      <input
                        id="alert-lot-threshold"
                        type="number"
                        name="alertLotThreshold"
                        className="input"
                        min="0"
                        step="1"
                        value={this.props.settings.alertLotThreshold || 400}
                        onChange={this.props.handleSettingsChange}
                      />
                    </div>
                    <p className="help">Popup and sound trigger for lot swings above this value and AC/DD option volume surges above 250%.</p>
                  </div>

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
                    <p className="help">Email is optional. Alerts still show popup and sound without email.</p>
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
