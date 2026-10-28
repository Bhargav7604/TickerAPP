export function makeTraderApi(request) {
  async function call(route, method = "GET", body = null, signal) {
    const result = await request(`trader/${route}`, method, body, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "Could not load your trading desk.");
    return result;
  }
  return {
    overview: signal => call("", "GET", null, signal),
    saveProfile: data => call("profile/", "POST", data),
    checkin: answers => call("checkin/", "POST", answers),
    plan: trade => call("plan/", "POST", trade),
    addTrade: trade => call("trades/", "POST", trade),
    closeTrade: (id, exit) => call(`trades/${id}/close/`, "POST", { exit }),
    alerts: (month, signal) => call(`alerts/?month=${month}`, "GET", null, signal),
    replay: (date, signal) => call(`replay/?${new URLSearchParams(date ? { date } : {})}`, "GET", null, signal),
    expiryReport: (index, date) => call(`expiry-report/?${new URLSearchParams({ index, date })}`),
    mentorLink: revoke => call("mentor-link/", "POST", { revoke: Boolean(revoke) }),
  };
}

export const rupees = value => Number.isFinite(value) ? `${value < 0 ? "-" : ""}₹${Math.abs(Math.round(value)).toLocaleString("en-IN")}` : "--";
export const price = value => Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
export const clockOf = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
export const dateOf = seconds => new Date(seconds * 1000).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
