import React, { useState } from "react";
import { compactOi, formatOi, formatSignedOi } from "../oiData";

// [toggle value, button label, field on each call/put, chart name]
const METRICS = [
  ["oi", "Open interest", "oi", "Open interest"],
  ["change", "OI change today", "oiChange", "OI change"],
  ["oiPct", "OI %", "oiChangePct", "OI change %"],
  ["ltpPct", "LTP %", "ltpChangePct", "LTP change %"],
];
const signedPct = value => `${value > 0 ? "+" : ""}${Number(value.toFixed(1))}%`;
const SLOT = 34;
const HEIGHT = 240;
const PAD = { top: 18, bottom: 34, left: 56 };

export default function OiStrikeBars({ rows, atm, maxCallStrike, maxPutStrike }) {
  const [metric, setMetric] = useState("oi");
  const [, , key, chartName] = METRICS.find(([value]) => value === metric);
  const percent = key.endsWith("Pct");
  const values = rows.flatMap(row => [row.call?.[key], row.put?.[key]]).filter(Number.isFinite);
  // A strike that started the day with tiny OI or a near-zero price can jump thousands of percent;
  // cap the scale so one outlier does not flatten every other bar (the tooltip keeps the real value).
  const sorted = values.map(Math.abs).sort((a, b) => a - b);
  const cap = percent && sorted.length > 3 ? Math.max(10, sorted[Math.floor(sorted.length * 0.9)] * 1.5) : Infinity;
  const clip = value => Math.max(-cap, Math.min(cap, value));
  const clipped = values.some(value => Math.abs(value) > cap);
  const top = Math.max(1, ...values.map(clip));
  const bottom = Math.min(0, ...values.map(clip));
  const plot = HEIGHT - PAD.top - PAD.bottom;
  const y = value => PAD.top + (top - value) / (top - bottom) * plot;
  const zero = y(0);
  const width = PAD.left + rows.length * SLOT + 8;
  const ticks = [top, (top + bottom) / 2, bottom].filter((value, index, list) => list.indexOf(value) === index);
  const format = percent ? signedPct : metric === "oi" ? formatOi : formatSignedOi;
  const axisLabel = value => percent ? `${Math.round(value)}%` : compactOi(value);

  return <div className="oi-bars">
    <div className="oi-bars-head">
      <div className="oi-toggle" role="group" aria-label="Strike bar metric">
        {METRICS.map(([value, label]) =>
          <button key={value} type="button" aria-pressed={metric === value} className={metric === value ? "active" : ""} onClick={() => setMetric(value)}>{label}</button>)}
      </div>
      <div className="oi-bars-legend"><span className="oi-legend-call">Call</span><span className="oi-legend-put">Put</span>
        {maxCallStrike != null && <span>Resistance (max call OI) <b>{maxCallStrike}</b></span>}
        {maxPutStrike != null && <span>Support (max put OI) <b>{maxPutStrike}</b></span>}
      </div>
    </div>
    <div className="oi-bars-scroll">
      <svg width={width} height={HEIGHT} role="img" aria-label={`${chartName} by strike for ${rows.length} strikes`}>
        {ticks.map(value => <g key={value}>
          <line x1={PAD.left} x2={width} y1={y(value)} y2={y(value)} className="oi-grid" />
          <text x={PAD.left - 6} y={y(value) + 4} className="oi-axis" textAnchor="end">{axisLabel(value)}</text>
        </g>)}
        <line x1={PAD.left} x2={width} y1={zero} y2={zero} className="oi-zero" />
        {rows.map((row, index) => {
          const x = PAD.left + index * SLOT;
          const bar = (side, offset, className) => {
            const value = row[side]?.[key];
            if (!Number.isFinite(value)) return null;
            const shown = clip(value);
            const top = Math.min(y(shown), zero);
            return <rect x={x + offset} y={top} width={12} height={Math.max(1, Math.abs(y(shown) - zero))} rx={2}
              className={`${className}${shown !== value ? " oi-bar-clipped" : ""}`}>
              <title>{`${row.strike} ${side === "call" ? "Call" : "Put"}: ${format(value)}`}</title>
            </rect>;
          };
          return <g key={row.strike} className={row.strike === atm ? "is-atm" : ""}>
            {row.strike === atm && <rect x={x} y={PAD.top - 12} width={SLOT - 2} height={plot + 12} className="oi-atm-band" />}
            {bar("call", 4, "oi-bar-call")}
            {bar("put", 17, "oi-bar-put")}
            <text x={x + SLOT / 2} y={HEIGHT - PAD.bottom + 14} className="oi-axis" textAnchor="middle"
              transform={`rotate(-40 ${x + SLOT / 2} ${HEIGHT - PAD.bottom + 14})`}>{row.strike}</text>
          </g>;
        })}
      </svg>
    </div>
    {percent && <p className="oi-bars-note">
      {metric === "oiPct" ? "OI % = today's OI change ÷ OI at the start of the day." : "LTP % = today's price change ÷ yesterday's closing price."}
      {clipped && ` Bars beyond ±${Math.round(cap)}% are cut short (faded); hover a bar for its full value.`}
    </p>}
  </div>;
}
