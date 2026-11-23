// Market headlines and NSE company filings for the News page, from the backend's /api/news/ (which reads the public feeds).
import { indiaTime } from "./holidayData";

export function makeNewsApi(request) {
  return {
    load: async signal => {
      const result = await request("news/", "GET", null, true, false, true, signal);
      if (result?.type !== "success") throw new Error(result?.message || "News is unavailable right now.");
      return result;
    },
  };
}

// Filing groups from the backend, in the order the filter lists them, with the colour of their label.
export const GROUPS = [
  ["results", "Results & board", "success"],
  ["orders", "Orders", "info"],
  ["action", "Corporate actions", "warning"],
  ["deals", "Deals & capital", "secondary"],
  ["meetings", "Meets & calls", "primary"],
  ["people", "Management", "default"],
  ["rating", "Ratings", "info"],
  ["legal", "Legal", "error"],
  ["press", "Press & updates", "default"],
  ["other", "Other", "default"],
];
export const GROUP_INFO = Object.fromEntries(GROUPS.map(([key, label, color]) => [key, { label, color }]));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "just now", "12 min ago", "3 h ago", "Yesterday 18:30" or "21 Nov, 09:15", in India time. */
export function timeAgo(iso, now) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const { iso: day, clock } = indiaTime(at);
  const today = indiaTime(now).iso;
  if (day === today) return `${Math.floor(minutes / 60)} h ago`;
  const yesterday = indiaTime(now - 864e5).iso;
  const time = clock.slice(0, 5);
  return day === yesterday ? `Yesterday ${time}` : `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}, ${time}`;
}

export const isToday = (iso, now) => indiaTime(Date.parse(iso)).iso === indiaTime(now).iso;

const words = text => (text || "").toLowerCase();
/** Whether a story or filing matches the search box: words in its title, summary, company or stock symbols. */
export function matchesSearch(fields, query) {
  const terms = words(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = words(fields.filter(Boolean).join(" "));
  return terms.every(term => haystack.includes(term));
}

/** The stocks named most often today across stories and filings: [[symbol, count]], busiest first. */
export function mostMentioned(news, filings, limit = 12) {
  const counts = {};
  news.forEach(item => item.symbols.forEach(symbol => { counts[symbol] = (counts[symbol] || 0) + 1; }));
  filings.forEach(row => { if (row.symbol) counts[row.symbol] = (counts[row.symbol] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}
