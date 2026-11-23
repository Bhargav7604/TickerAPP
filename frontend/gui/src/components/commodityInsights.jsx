import React from "react";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { placesFor, price, signed, signedPct, signedPctBare, tone, usePoll } from "../commodityData";
import { withArrow } from "../trend";
import { mono } from "../ui/Glass";

const INSIGHTS_MS = 15000;
const BUILD_COLORS = { LB: "success", SC: "success", SB: "error", LU: "error" };
const BUILD_NAMES = { LB: "Long build-up", SC: "Short covering", SB: "Short build-up", LU: "Long unwinding" };
const rupees = value => Number.isFinite(value) ? `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}` : "--";
const signedRupees = value => Number.isFinite(value) ? withArrow(value, `${value > 0 ? "+" : value < 0 ? "−" : ""}${rupees(value)}`, 0) : "--";

function Meter({ value, max = 100, color = "primary.main", label }) {
  const width = Number.isFinite(value) ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  return <Box role="meter" aria-label={label} aria-valuenow={Number.isFinite(value) ? Math.round(value) : undefined} aria-valuemin={0} aria-valuemax={max}
    sx={{ height: 6, borderRadius: 999, bgcolor: "action.hover", overflow: "hidden" }}>
    <Box sx={{ width: `${width}%`, height: 1, bgcolor: color, borderRadius: 999 }} />
  </Box>;
}

function Block({ title, children }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography component="h4" sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "text.secondary", mb: 0.5 }}>{title}</Typography>
    {children}
  </Box>;
}

function Line({ label, value, color, strong }) {
  return <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, fontSize: 12.5, py: 0.15 }}>
    <Box component="span" sx={{ color: "text.secondary" }}>{label}</Box>
    <Box component="span" sx={{ ...mono, fontWeight: strong ? 800 : 600, color: color || "text.primary", textAlign: "right" }}>{value}</Box>
  </Box>;
}

function Read({ children }) {
  return children ? <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, lineHeight: 1.4 }}>{children}</Typography> : null;
}

function RangeStrip({ range, places }) {
  const span = range.high - range.low || 1;
  const at = value => `${Math.min(100, Math.max(0, (value - range.low) / span * 100))}%`;
  const inside = value => Number.isFinite(value) && value >= range.low && value <= range.high;
  return <Box aria-hidden="true" sx={{ mt: 0.75 }}>
    <Box sx={{ position: "relative", height: 8, borderRadius: 999, background: "linear-gradient(90deg, #2bb3ad, #4a8fe7 55%, #5b6ee1)", opacity: 0.85 }}>
      {inside(range.support) && <Box component="span" sx={{ position: "absolute", top: -3, left: at(range.support), width: 3, height: 14, ml: "-1.5px", borderRadius: 1, bgcolor: "success.main" }} />}
      {inside(range.resistance) && <Box component="span" sx={{ position: "absolute", top: -3, left: at(range.resistance), width: 3, height: 14, ml: "-1.5px", borderRadius: 1, bgcolor: "error.main" }} />}
      {Number.isFinite(range.spot) && <Box component="span" sx={{ position: "absolute", top: "50%", left: at(range.spot), width: 13, height: 13, ml: "-6.5px", transform: "translateY(-50%)",
        borderRadius: "50%", bgcolor: "background.paper", border: "3px solid", borderColor: "text.primary" }} />}
    </Box>
    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5, ...mono, fontSize: 11.5, color: "text.secondary" }}>
      <span>{price(range.low, places)}</span><span>{price(range.high, places)}</span>
    </Stack>
  </Box>;
}

function TrendChip({ trend }) {
  const read = trend?.read || "";
  const [label, color] = read.startsWith("Uptrend") ? ["Uptrend", "success"] : read.startsWith("Downtrend") ? ["Downtrend", "error"] : read.startsWith("Mixed") ? ["Mixed trend", "warning"] : ["No trend yet", "default"];
  return <Chip size="small" color={color} variant="outlined" label={label} sx={{ fontWeight: 800 }} />;
}

function InsightCard({ item }) {
  const places = placesFor(item.ltp);
  const { trend, volatility, range, term, positions, lot, levels } = item;
  return <Paper component="article" aria-label={`${item.label} insights`} variant="outlined" sx={{ p: 1.5, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.25 }}>
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h3" sx={{ fontWeight: 850, fontSize: 15 }}>{item.label}</Typography>
        <Typography variant="caption" color="text.secondary">{item.symbol} · {item.sessions} sessions of history</Typography>
      </Box>
      <Box sx={{ textAlign: "right", flex: "none" }}>
        <Typography sx={{ ...mono, fontWeight: 850, fontSize: 15 }}>{price(item.ltp, places)}</Typography>
        <Typography sx={{ ...mono, fontSize: 11.5, fontWeight: 700, color: tone(item.change) }}>{signed(item.change, places)} ({signedPctBare(item.changePct)})</Typography>
      </Box>
    </Stack>

    <Block title="Expected range today">
      {range ? <>
        <RangeStrip range={range} places={places} />
        <Line label="Support (S1) · Resistance (R1)" value={`${price(range.support, places)} · ${price(range.resistance, places)}`} />
        <Read>{range.text}</Read>
      </> : <Read>Appears once daily history has loaded.</Read>}
    </Block>

    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
      <Block title="Trend">
        <Stack direction="row" sx={{ mb: 0.5 }}><TrendChip trend={trend} /></Stack>
        <Line label="20-day average" value={price(trend.sma20, places)} color={trend.sma20 ? (trend.aboveSma20 ? "success.main" : "error.main") : undefined} />
        <Line label="50-day average" value={price(trend.sma50, places)} color={trend.sma50 ? (trend.aboveSma50 ? "success.main" : "error.main") : undefined} />
        <Line label="5-day change" value={signedPct(trend.change5dPct)} color={tone(trend.change5dPct)} />
        <Line label="From 52-week high" value={signedPct(trend.fromHighPct)} color={tone(trend.fromHighPct)} />
        <Read>{trend.read}</Read>
      </Block>
      <Block title="Volatility">
        <Line label="Daily · yearly" value={`${Number.isFinite(volatility.dailyVolPct) ? volatility.dailyVolPct.toFixed(2) : "--"}% · ${Number.isFinite(volatility.annualVolPct) ? volatility.annualVolPct : "--"}%`} />
        <Line label="Normal day's range (ATR)" value={`${price(volatility.atr, places)} (${Number.isFinite(volatility.atrPct) ? volatility.atrPct.toFixed(2) : "--"}%)`} />
        <Line label="Range used today" value={Number.isFinite(volatility.rangeUsedPct) ? `${volatility.rangeUsedPct}%` : "--"} strong />
        <Meter value={volatility.rangeUsedPct} max={120} label={`${item.label} range used today`}
          color={volatility.rangeUsedPct >= 100 ? "error.main" : volatility.rangeUsedPct >= 70 ? "warning.main" : "success.main"} />
        <Read>{volatility.read}</Read>
      </Block>
      <Block title="Term structure & rollover">
        <Stack direction="row" sx={{ mb: 0.5 }}>
          {term.state && <Chip size="small" variant="outlined" color={term.state === "backwardation" ? "warning" : "info"} label={term.state === "contango" ? "Contango" : term.state === "backwardation" ? "Backwardation" : "Flat"} sx={{ fontWeight: 800 }} />}
        </Stack>
        <Line label="Next − current month" value={`${signed(term.spread, places)} (${signedPctBare(term.spreadPct)})`} />
        <Line label="Carry, yearly" value={Number.isFinite(term.carryAnnualPct) ? `${term.carryAnnualPct}%` : "--"} />
        <Line label="Open interest rolled" value={Number.isFinite(term.rolloverPct) ? `${term.rolloverPct}%` : "--"} strong />
        <Meter value={term.rolloverPct} label={`${item.label} open interest rolled to later months`} color="info.main" />
        <Read>{term.read} {term.daysToExpiry != null ? `Current month expires in ${term.daysToExpiry} days.` : ""}</Read>
      </Block>
      <Block title="Money per lot">
        {lot ? <>
          <Line label={`Lot (${lot.lot})`} value={`₹${lot.perPoint.toLocaleString("en-IN")} per point`} />
          <Line label="Today's move, one lot" value={signedRupees(lot.todayPerLot)} color={tone(lot.todayPerLot)} strong />
          <Line label="Normal day's swing" value={rupees(lot.atrPerLot)} />
          <Line label="Contract value" value={rupees(lot.contractValue)} />
        </> : <Read>Lot details are not listed for this contract.</Read>}
        <Box sx={{ mt: 0.75 }}>
          <Line label="Open interest vs yesterday" value={signedPct(positions.oiChangePct)} color={tone(positions.oiChangePct)} />
          {positions.buildup && <Chip size="small" color={BUILD_COLORS[positions.buildup]} variant="outlined" label={BUILD_NAMES[positions.buildup]} sx={{ mt: 0.5, fontWeight: 800 }} />}
        </Box>
      </Block>
    </Box>

    {levels && <Block title="Pivot levels (previous session)">
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 0.5, textAlign: "center" }}>
        {[["S2", "success.main"], ["S1", "success.main"], ["P", "warning.main"], ["R1", "error.main"], ["R2", "error.main"]].map(([name, color]) =>
          <Box key={name} sx={{ p: 0.5, borderRadius: 1.5, bgcolor: "background.subtle" }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 800, color }}>{name}</Typography>
            <Typography sx={{ ...mono, fontSize: 11.5 }}>{price(levels[name], places)}</Typography>
          </Box>)}
      </Box>
    </Block>}
  </Paper>;
}

function CrossTile({ title, value, read, color }) {
  return <Box component="article" aria-label={title} sx={{ p: 1.25, borderRadius: 2.5, bgcolor: "background.subtle", minWidth: 0 }}>
    <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "text.secondary" }}>{title}</Typography>
    <Typography sx={{ ...mono, fontSize: 18, fontWeight: 850, color: color || "text.primary" }}>{value}</Typography>
    <Read>{read || "Waiting for prices."}</Read>
  </Box>;
}

/** The commodity counterpart of the Indian market's calculated reads, placed right under the cards. */
export default function CommodityInsights({ api }) {
  const { data, error } = usePoll(signal => api.insights(signal), INSIGHTS_MS, [api]);
  const cross = data?.cross || {};
  return <Paper component="section" aria-label="Commodity analytics" sx={{ gridArea: "bar", p: 2, minWidth: 0 }}>
    <Typography variant="overline" component="h2" color="text.secondary">Commodity analytics</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
      Expected range, trend, volatility, contango and rollover, money per lot and cross-commodity reads, worked out from Zerodha prices and a year of daily history.
    </Typography>
    {(error || data?.message) && <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>{error || data.message}</Typography>}
    <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, mb: 1.5 }}>
      <CrossTile title="Gold / Silver ratio" value={cross.goldSilver ? `${cross.goldSilver.ratio}${cross.goldSilver.average20 ? ` · avg ${cross.goldSilver.average20}` : ""}` : "--"} read={cross.goldSilver?.read} />
      <CrossTile title="Copper vs gold" value={cross.copperGold ? withArrow(cross.copperGold.gap, `${cross.copperGold.gap > 0 ? "+" : ""}${cross.copperGold.gap}%`, 4) : "--"} read={cross.copperGold?.read} color={tone(cross.copperGold?.gap)} />
      <CrossTile title="Crude vs natural gas" value={cross.crudeGas ? withArrow(cross.crudeGas.gap, `${cross.crudeGas.gap > 0 ? "+" : ""}${cross.crudeGas.gap}%`, 4) : "--"} read={cross.crudeGas?.read} color={tone(cross.crudeGas?.gap)} />
      <CrossTile title="Rupee effect (USD/INR)" value={cross.rupee ? `${price(cross.rupee.ltp, 4)} ${signedPct(cross.rupee.changePct)}` : "--"} read={cross.rupee?.read} />
    </Box>
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 540px), 1fr))" }}>
      {(data?.items || []).map(item => <InsightCard key={item.key} item={item} />)}
    </Box>
    {!data && !error && <Typography variant="body2" color="text.secondary" role="status">Working out commodity analytics…</Typography>}
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
      Volatility and ranges use the last 20 sessions of Zerodha's continuous futures history; lot sizes follow the MCX contract specifications. Information only, not a recommendation.
    </Typography>
  </Paper>;
}
