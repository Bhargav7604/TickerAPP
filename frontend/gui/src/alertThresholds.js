// SENSEX futures trade far fewer lots than NIFTY or BANKNIFTY, so each index has its own swing threshold.
export const ALERT_INDEXES = [["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["sensex", "SENSEX"]];
export const DEFAULT_ALERT_LOT_THRESHOLDS = { nifty: 400, banknifty: 400, sensex: 40 };

export const alertLotThreshold = (settings, key) => {
  const value = Number(settings?.alertLotThresholds?.[key]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ALERT_LOT_THRESHOLDS[key];
};

export const describeAlertThresholds = (settings, format = String) =>
  ALERT_INDEXES.map(([key, label]) => `${label} ${format(alertLotThreshold(settings, key))}`).join(", ");
