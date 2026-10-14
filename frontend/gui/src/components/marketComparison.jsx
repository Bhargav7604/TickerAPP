import React from "react";
import { selectedMarketColumns } from "../marketColumns";

const INDICES = ["nifty", "banknifty", "sensex"];

export default function MarketComparison({ dashboard }) {
  const selected = dashboard.state.selectedChartIndex;
  const columns = selectedMarketColumns(dashboard.props.settings.marketColumns);
  const columnStyle = column => ({ "--metric-width": column.width + "px", "--metric-mobile-width": column.mobileWidth + "px" });
  return (
    <section className="market-comparison" aria-label="Index comparison">
      <div className="scan-table-scroll" tabIndex="0" aria-label="Index metrics, scroll for more columns">
        <table className="scan-table">
          <thead><tr>
            <th scope="col">Index / Symbol</th>
            {columns.map(column => <th scope="col" key={column.id} data-column={column.id} style={columnStyle(column)}>
              {column.heading ? <abbr title={column.label}>{column.heading}</abbr> : column.label}
              {column.unit && <span>({column.unit})</span>}
            </th>)}
          </tr></thead>
          <tbody>{INDICES.map(key => {
            const data = dashboard.getData(key);
            const expiry = dashboard.getCurrentExpiry(key);
            const shortContract = expiry ? new Date(expiry + "T00:00:00").toLocaleDateString("en-GB", { month: "short" }).toUpperCase() + " FUT" : "-";
            const price = dashboard.props.feedStatus === "offline" ? null : data.cmp;
            const liveValue = value => dashboard.props.feedStatus === "offline" ? null : value;
            const values = {
              futures: price,
              spot: data.spot,
              difference: data.futuresSpotDifference,
              netLots: liveValue(data.lot),
              ratio: liveValue(data.ratio),
              vwap: liveValue(data.vwap),
              lotSize: dashboard.props.settings.symbols?.[key]?.lotSize || data.lotSize || null,
              oi: liveValue(data.oi),
              demandSupply: liveValue(data.netDemand),
              change: liveValue(data.netChange),
            };
            const signed = ["difference", "netLots", "vwap", "demandSupply", "change"];
            const renderValue = id => {
              if (id === "ohlc") return ["open", "high", "low"].map(field => dashboard.formatValue(liveValue(data[field]))).join(" / ");
              if (id === "oiRange") return ["oiDayHigh", "oiDayLow"].map(field => dashboard.formatValue(liveValue(data[field]))).join(" / ");
              if (id === "change") return dashboard.formatSignedValue(values.change) + " / " + dashboard.formatSignedValue(liveValue(data.pctChange)) + "%";
              return signed.includes(id) ? dashboard.formatSignedValue(values[id]) : dashboard.formatValue(values[id]);
            };
            return <tr key={key} className={selected === key ? "is-selected" : ""}>
              <th scope="row">
                <button className="index-select-button" aria-pressed={selected === key}
                  aria-label={"Chart " + key} onClick={() => dashboard.handleChartIndexChange({ target: { value: key } })}
                  title={dashboard.getCurrentSymbol(key) + " | Expiry " + dashboard.formatExpiry(expiry)}>
                  <strong>{key.toUpperCase()}</strong>
                  <span className="full-symbol">{dashboard.getCurrentSymbol(key)}</span>
                  <span className="short-symbol">{shortContract}</span>
                </button>
              </th>
              {columns.map(column => <td key={column.id} data-column={column.id} style={columnStyle(column)}
                className={column.id === "futures" ? "scan-price" : signed.includes(column.id) ? dashboard.valueClass(values[column.id]) : ""}>
                {renderValue(column.id)}
              </td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
