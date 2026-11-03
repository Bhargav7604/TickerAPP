import React from "react";
import { selectedMarketColumns } from "../marketColumns";

const INDICES = ["nifty", "banknifty", "sensex"];
// Price and day change sit in each card's header, so they are not repeated as rows.
const HEADER_COLUMNS = ["futures", "change"];
const SIGNED = ["difference", "netLots", "vwap", "demandSupply", "change"];

export default function MarketComparison({ dashboard }) {
  const selected = dashboard.state.selectedChartIndex;
  const columns = selectedMarketColumns(dashboard.props.settings.marketColumns).filter(column => !HEADER_COLUMNS.includes(column.id));
  const offline = dashboard.props.feedStatus === "offline";
  return (
    <section className="market-comparison market-cards" aria-label="Index comparison">
      {INDICES.map(key => {
        const data = dashboard.getData(key);
        const expiry = dashboard.getCurrentExpiry(key);
        const contract = expiry ? new Date(expiry + "T00:00:00").toLocaleDateString("en-GB", { month: "short" }).toUpperCase() + " FUT" : "";
        const live = value => offline ? null : value;
        const values = {
          spot: data.spot,
          difference: data.futuresSpotDifference,
          netLots: live(data.lot),
          ratio: live(data.ratio),
          vwap: live(data.vwap),
          lotSize: dashboard.props.settings.symbols?.[key]?.lotSize || data.lotSize || null,
          oi: live(data.oi),
          demandSupply: live(data.netDemand),
        };
        const show = id => {
          if (id === "ohlc") return ["open", "high", "low"].map(field => dashboard.formatValue(live(data[field]))).join(" / ");
          if (id === "oiRange") return ["oiDayHigh", "oiDayLow"].map(field => dashboard.formatValue(live(data[field]))).join(" / ");
          return SIGNED.includes(id) ? dashboard.formatSignedValue(values[id]) : dashboard.formatValue(values[id]);
        };
        const change = live(data.netChange);
        const isSelected = selected === key;
        return <article key={key} className={"market-card" + (isSelected ? " is-selected" : "")} aria-label={key.toUpperCase() + " overview"}>
          <button type="button" className="market-card-head" aria-pressed={isSelected} aria-label={"Chart " + key}
            title={dashboard.getCurrentSymbol(key) + " | Expiry " + dashboard.formatExpiry(expiry)}
            onClick={() => dashboard.handleChartIndexChange({ target: { value: key } })}>
            <span className="market-card-name"><strong>{key.toUpperCase()}</strong><small>{contract}</small></span>
            <span className="market-card-price">
              <b>{dashboard.formatValue(offline ? null : data.cmp)}</b>
              <small className={dashboard.valueClass(change)}>
                {dashboard.formatSignedValue(change)} ({dashboard.formatSignedValue(live(data.pctChange))}%)
              </small>
            </span>
          </button>
          <dl className="market-card-metrics">
            {columns.map(column => <div key={column.id} data-column={column.id}>
              <dt>{column.label}{column.unit && <span> ({column.unit})</span>}</dt>
              <dd className={SIGNED.includes(column.id) ? dashboard.valueClass(values[column.id]) : ""}>{show(column.id)}</dd>
            </div>)}
          </dl>
        </article>;
      })}
    </section>
  );
}
