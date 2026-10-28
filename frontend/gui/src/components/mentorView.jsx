import React, { useEffect, useState } from "react";
import "../traderDesk.css";
import { dateOf, price, rupees } from "../traderData";

// Read-only page a trader shares with their mentor. No login; the link itself is the key.
export default function MentorView({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${window.location.origin}/api/mentor/${encodeURIComponent(token)}/`)
      .then(response => response.json())
      .then(json => json.type === "success" ? setData(json) : setError(json.message))
      .catch(() => setError("Could not load this report."));
  }, [token]);
  if (error) return <main className="desk-page"><p className="desk-error" role="alert">{error}</p></main>;
  if (!data) return <main className="desk-page"><p role="status">Loading…</p></main>;
  return <main className="desk-page desk-mentor">
    <header className="desk-head"><div><h1>Trader report for mentor</h1><span>Trader {data.trader} · read-only</span></div></header>
    <section className="desk-grid">
      <div className="desk-card"><h2>Licence</h2><p className="desk-big">{data.licence.name}</p><p>{data.licence.text}</p></div>
      <div className="desk-card"><h2>Discipline</h2><p className="desk-big">{data.discipline.followedPct}%</p><p>Followed the plan in {data.discipline.followedPct}% of {data.discipline.trades} closed trades.</p></div>
      <div className="desk-card"><h2>Emotions</h2><p>{data.emotionCost.text}</p></div>
      <div className="desk-card"><h2>Lessons</h2><p>Following the plan would have saved {rupees(data.lessons.totalSaved)}.</p>
        <ul>{data.lessons.lessons.map(item => <li key={item.tradeId}>{item.date} {item.symbol}: {item.text}</li>)}</ul></div>
    </section>
    <section className="desk-card"><h2>Trade list</h2>
      <div className="desk-table-scroll"><table className="desk-table"><thead><tr><th>Date</th><th>Contract</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Plan</th><th>Mood</th></tr></thead>
        <tbody>{data.trades.map(trade => <tr key={trade.id}><td>{dateOf(trade.openedAt)}</td><td>{trade.symbol}{trade.practice ? " (practice)" : ""}</td><td>{trade.side}</td><td>{trade.lots}</td>
          <td>{price(trade.entry)}</td><td>{price(trade.exit)}</td><td className={trade.pnl > 0 ? "desk-up" : trade.pnl < 0 ? "desk-down" : ""}>{rupees(trade.pnl)}</td>
          <td>{trade.followedPlan == null ? "open" : trade.followedPlan ? "✓" : "✗"}</td><td>{trade.emotion}</td></tr>)}</tbody></table></div>
    </section>
  </main>;
}
