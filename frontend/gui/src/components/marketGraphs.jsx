import React, { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import { fp } from "../boardData";
import { arrow } from "../trend";
import { MONO } from "../ui/theme";

// Small SVG charts for the Market page, drawn in pixels so text stays readable at every width.

/** The element's width in pixels, followed as it resizes. Tests and the first paint use the fallback. */
export function useBoxWidth(fallback = 320) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width || fallback];
}

function useColors() {
  const { palette } = useMuiTheme();
  return { up: palette.success.main, down: palette.error.main, flat: palette.action.disabled, ink: palette.text.primary,
    muted: palette.text.secondary, grid: palette.divider, track: palette.action.hover };
}

const label = (size, weight = 600) => ({ fontFamily: MONO, fontSize: size, fontWeight: weight });

/** Today's range as a small candle: wick from low to high, body from open to last price, dashed line at yesterday's close. */
export function DayRange({ ix }) {
  const [box, width] = useBoxWidth(220);
  const colors = useColors();
  const values = [ix.low, ix.high, ix.open, ix.ltp, ix.prev].filter(Number.isFinite);
  if (values.length < 2 || !Number.isFinite(ix.ltp)) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.001 || 1;
  const left = 4, right = 4, height = 34, mid = 13;
  const x = value => left + (value - min) / span * (width - left - right);
  const open = Number.isFinite(ix.open) ? ix.open : ix.prev;
  const rising = ix.ltp >= open;
  const color = rising ? colors.up : colors.down;
  const bodyLeft = Math.min(x(open), x(ix.ltp)), bodyWidth = Math.max(3, Math.abs(x(ix.ltp) - x(open)));
  return <Box ref={box} sx={{ my: 0.5 }}>
    <svg width="100%" height={height} role="img"
      aria-label={`Day range ${fp(ix.low)} to ${fp(ix.high)}, opened ${fp(ix.open)}, now ${fp(ix.ltp)}, previous close ${fp(ix.prev)}`}>
      <title>{`Low ${fp(ix.low)} · Open ${fp(ix.open)} · Now ${fp(ix.ltp)} · High ${fp(ix.high)} · Prev close ${fp(ix.prev)}`}</title>
      {Number.isFinite(ix.low) && Number.isFinite(ix.high) && <line x1={x(ix.low)} x2={x(ix.high)} y1={mid} y2={mid} stroke={color} strokeWidth="2" strokeLinecap="round" />}
      <rect x={bodyLeft} y={mid - 7} width={bodyWidth} height="14" rx="3" fill={color} />
      {Number.isFinite(ix.prev) && <line x1={x(ix.prev)} x2={x(ix.prev)} y1={mid - 11} y2={mid + 11} stroke={colors.muted} strokeWidth="1.5" strokeDasharray="3 2" />}
      <text x={left} y={height - 1} fill={colors.muted} style={label(9.5)}>L {fp(ix.low)}</text>
      <text x={width - right} y={height - 1} fill={colors.muted} textAnchor="end" style={label(9.5)}>H {fp(ix.high)}</text>
    </svg>
  </Box>;
}

// The market-feed worker keeps each index's last price per 3-minute slot from 09:15 to 15:30: 125 points a day.
export const PATH_SLOTS = 125;

/** The index through the day as a filled line, drawn across the whole session so it grows from left to right,
 * with a dashed line at yesterday's close. Before any points arrive it falls back to today's range candle. */
export function IndexSpark({ ix, good }) {
  const [box, width] = useBoxWidth(220);
  const colors = useColors();
  const points = (ix.path || []).map((value, slot) => [slot, value]).filter(([, value]) => Number.isFinite(value));
  if (points.length < 2) return <DayRange ix={ix} />;
  const values = points.map(([, value]) => value).concat(Number.isFinite(ix.prev) ? [ix.prev] : []);
  const low = Math.min(...values), high = Math.max(...values);
  const pad = (high - low) * 0.08 || Math.abs(high) * 0.0005 || 1;
  const height = 48, top = 2, bottom = 2;
  const x = slot => slot / (PATH_SLOTS - 1) * width;
  const y = value => top + (high + pad - value) / (high - low + pad * 2) * (height - top - bottom);
  const line = points.map(([slot, value], i) => `${i ? "L" : "M"}${x(slot).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const [firstSlot] = points[0], [lastSlot, last] = points[points.length - 1];
  const area = `${line} L${x(lastSlot).toFixed(1)} ${height} L${x(firstSlot).toFixed(1)} ${height} Z`;
  const color = good ? colors.up : colors.down;
  const fill = `spark-fill-${ix.key}`;
  return <Box ref={box} sx={{ my: 0.5 }}>
    <svg width="100%" height={height} role="img"
      aria-label={`${ix.label} today: from ${fp(points[0][1])} to ${fp(last)}, low ${fp(ix.low)}, high ${fp(ix.high)}, previous close ${fp(ix.prev)}`}>
      <title>{`Low ${fp(ix.low)} · High ${fp(ix.high)} · Prev close ${fp(ix.prev)}`}</title>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {Number.isFinite(ix.prev) && <line x1="0" x2={width} y1={y(ix.prev)} y2={y(ix.prev)} stroke={colors.muted} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />}
      <path d={area} fill={`url(#${fill})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(lastSlot)} cy={y(last)} r="2.6" fill={color} />
    </svg>
  </Box>;
}

/** Advancing against declining stocks as a ring, with the advancing share in the middle. */
export function AdvanceDonut({ adv, dec, flat = 0, size = 132 }) {
  const colors = useColors();
  const total = adv + dec + flat;
  const r = size / 2 - 10, c = 2 * Math.PI * r, mid = size / 2;
  let offset = 0;
  const ring = [[adv, colors.up], [flat, colors.flat], [dec, colors.down]].filter(([count]) => count > 0).map(([count, stroke]) => {
    const length = count / (total || 1) * c;
    const piece = <circle key={stroke} cx={mid} cy={mid} r={r} fill="none" stroke={stroke} strokeWidth="16"
      strokeDasharray={`${length} ${c - length}`} strokeDashoffset={-offset} transform={`rotate(-90 ${mid} ${mid})`} />;
    offset += length;
    return piece;
  });
  const share = total ? Math.round(adv / total * 100) : 0;
  return <svg width={size} height={size} role="img" style={{ flex: "none" }}
    aria-label={`${adv} advancing, ${dec} declining${flat ? `, ${flat} unchanged` : ""}: ${share}% advancing`}>
    <circle cx={mid} cy={mid} r={r} fill="none" stroke={colors.track} strokeWidth="16" />
    {ring}
    <text x={mid} y={mid + 2} textAnchor="middle" fill={adv >= dec ? colors.up : colors.down} style={label(22, 800)}>{share}%</text>
    <text x={mid} y={mid + 18} textAnchor="middle" fill={colors.muted} style={label(10)}>advancing</text>
  </svg>;
}

/** What makes up the mood score: one bar per part, right and green for bullish, left and red for bearish, on a −100…+100 scale. */
export function DriverBars({ parts }) {
  const [box, width] = useBoxWidth(420);
  const colors = useColors();
  const name = Math.min(116, width * 0.3), valueRoom = 52, row = 34, top = 6, axis = 18;
  const plot = Math.max(60, width - name - valueRoom);
  const x = value => name + (value + 100) / 200 * plot;
  const height = top + parts.length * row + axis;
  return <Box ref={box} sx={{ mt: 1 }}>
    <svg width="100%" height={height} role="img" aria-label={parts.map(part => `${part.name} ${Math.round(part.value)}`).join(", ")}>
      {[-100, -50, 0, 50, 100].map(tick => <g key={tick}>
        <line x1={x(tick)} x2={x(tick)} y1={top} y2={height - axis} stroke={colors.grid} strokeWidth={tick === 0 ? 1.5 : 1} strokeDasharray={tick === 0 ? undefined : "2 3"} />
        <text x={x(tick)} y={height - 4} textAnchor="middle" fill={colors.muted} style={label(9.5)}>{tick > 0 ? `+${tick}` : tick}</text>
      </g>)}
      {parts.map((part, i) => {
        const y = top + i * row;
        const color = part.value >= 0 ? colors.up : colors.down;
        const from = Math.min(x(0), x(part.value)), size = Math.max(2, Math.abs(x(part.value) - x(0)));
        return <g key={part.name}>
          <title>{`${part.name}: ${Math.round(part.value)} (${part.note})`}</title>
          <text x={0} y={y + 13} fill={colors.ink} style={label(11.5, 700)}>{part.name}</text>
          <text x={0} y={y + 26} fill={colors.muted} style={label(9.5)}>{part.note}</text>
          <rect x={from} y={y + 6} width={size} height="16" rx="4" fill={color} opacity="0.9" />
          <text x={width} y={y + 18} textAnchor="end" fill={color} style={label(11.5, 800)}>{arrow(part.value, 0)}{part.value > 0 ? "+" : ""}{Math.round(part.value)}</text>
        </g>;
      })}
    </svg>
  </Box>;
}

/** Breadth by group as 100% columns: green advancing at the bottom, grey unchanged, red declining on top. */
export function BreadthColumns({ groups }) {
  const [box, width] = useBoxWidth(420);
  const colors = useColors();
  const left = 30, right = 4, top = 8, bottom = 34, height = 230;
  const plotHeight = height - top - bottom;
  const slot = (width - left - right) / Math.max(1, groups.length);
  const barWidth = Math.min(38, slot * 0.64);
  const y = share => top + (1 - share) * plotHeight;
  return <Box ref={box}>
    <svg width="100%" height={height} role="img" aria-label={groups.map(g => `${g.label}: ${g.up} up, ${g.down} down`).join("; ")}>
      {[0, 0.25, 0.5, 0.75, 1].map(share => <g key={share}>
        <line x1={left} x2={width - right} y1={y(share)} y2={y(share)} stroke={colors.grid} strokeWidth="1" strokeDasharray={share === 0.5 ? "4 3" : undefined} />
        <text x={left - 5} y={y(share) + 3} textAnchor="end" fill={colors.muted} style={label(9.5)}>{share * 100}%</text>
      </g>)}
      {groups.map((group, i) => {
        const cx = left + slot * (i + 0.5), x0 = cx - barWidth / 2;
        const up = group.up / group.n, flat = group.flat / group.n, down = group.down / group.n;
        // Two short lines when the name is wider than its column.
        const words = group.label.length * 5.8 > slot - 4 ? group.label.split(" ") : [group.label];
        return <g key={group.label}>
          <title>{`${group.label}: ${group.up} up, ${group.down} down, ${group.flat} unchanged of ${group.n}`}</title>
          {up > 0 && <rect x={x0} y={y(up)} width={barWidth} height={y(0) - y(up)} fill={colors.up} rx="3" />}
          {flat > 0 && <rect x={x0} y={y(up + flat)} width={barWidth} height={y(up) - y(up + flat)} fill={colors.flat} />}
          {down > 0 && <rect x={x0} y={y(1)} width={barWidth} height={y(up + flat) - y(1)} fill={colors.down} rx="3" />}
          {up >= 0.12 && <text x={cx} y={y(up / 2) + 4} textAnchor="middle" fill="#fff" style={label(barWidth < 26 ? 8.5 : 10, 800)}>{Math.round(up * 100)}</text>}
          {words.map((word, line) => <text key={word} x={cx} y={height - bottom + 13 + line * 11} textAnchor="middle" fill={colors.ink} style={label(9.5, 700)}>{word}</text>)}
        </g>;
      })}
    </svg>
  </Box>;
}
