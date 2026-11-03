import React from "react";
import { Box, ButtonBase, Paper, Typography } from "@mui/material";
import { selectedMarketColumns } from "../marketColumns";
import { mono } from "../ui/Glass";

const INDICES = ["nifty", "banknifty", "sensex"];
// Price and day change sit in each card's header, so they are not repeated as rows.
const HEADER_COLUMNS = ["futures", "change"];
const SIGNED = ["difference", "netLots", "vwap", "demandSupply", "change"];
const TONE = { "value-up": "success.main", "value-down": "error.main" };

export default function MarketComparison({ dashboard }) {
  const selected = dashboard.state.selectedChartIndex;
  const columns = selectedMarketColumns(dashboard.props.settings.marketColumns).filter(column => !HEADER_COLUMNS.includes(column.id));
  const offline = dashboard.props.feedStatus === "offline";
  return (
    // Phones swipe sideways through the three indices instead of scrolling past three tall cards.
    <Box component="section" className="market-comparison market-cards" aria-label="Index comparison" sx={{
      gridArea: "compare", minWidth: 0, display: "grid", gap: 2,
      gridTemplateColumns: { xs: "repeat(3, 86%)", sm: "repeat(3, 62%)", md: "repeat(3, minmax(0, 1fr))" },
      overflowX: { xs: "auto", md: "visible" }, scrollSnapType: { xs: "x mandatory", md: "none" }, pb: { xs: 0.5, md: 0 },
    }}>
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
        return <Paper component="article" key={key} className={"market-card" + (isSelected ? " is-selected" : "")} aria-label={key.toUpperCase() + " overview"}
          sx={{ minWidth: 0, overflow: "hidden", scrollSnapAlign: "start", transition: "box-shadow 200ms ease",
            boxShadow: isSelected ? "0 0 0 2px rgba(74,111,224,0.55), 0 8px 24px rgba(74,111,224,0.14)" : undefined }}>
          <ButtonBase className="market-card-head" aria-pressed={isSelected} aria-label={"Chart " + key}
            title={dashboard.getCurrentSymbol(key) + " | Expiry " + dashboard.formatExpiry(expiry)}
            onClick={() => dashboard.handleChartIndexChange({ target: { value: key } })}
            sx={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, px: 2, pt: 1.5, pb: 1.25, textAlign: "left",
              bgcolor: isSelected ? "rgba(74,111,224,0.07)" : "transparent", "&:hover": { bgcolor: "rgba(74,111,224,0.06)" } }}>
            <Box component="span" className="market-card-name" sx={{ display: "grid" }}>
              <Typography component="strong" sx={{ fontWeight: 800, fontSize: 15 }}>{key.toUpperCase()}</Typography>
              <Typography component="small" sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary" }}>{contract}{isSelected ? " · on chart" : ""}</Typography>
            </Box>
            <Box component="span" className="market-card-price" sx={{ display: "grid", justifyItems: "end" }}>
              <Box component="b" sx={{ ...mono, fontSize: 17, fontWeight: 800 }}>{dashboard.formatValue(offline ? null : data.cmp)}</Box>
              <Box component="small" className={dashboard.valueClass(change)} sx={{ ...mono, fontSize: 12, fontWeight: 700, color: TONE[dashboard.valueClass(change)] || "text.secondary" }}>
                {dashboard.formatSignedValue(change)} ({dashboard.formatSignedValue(live(data.pctChange))}%)
              </Box>
            </Box>
          </ButtonBase>
          <Box component="dl" className="market-card-metrics" sx={{ m: 0, px: 2, pb: 1.5, pt: 0.5, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 14px" }}>
            {columns.map(column => <Box key={column.id} data-column={column.id} sx={{ minWidth: 0, ...(column.id === "ohlc" || column.id === "oiRange" ? { gridColumn: "1 / -1" } : {}) }}>
              <Box component="dt" sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {column.label}{column.unit && <span> ({column.unit})</span>}
              </Box>
              <Box component="dd" className={SIGNED.includes(column.id) ? dashboard.valueClass(values[column.id]) : ""}
                sx={{ m: 0, ...mono, fontSize: 13.5, fontWeight: 700, color: SIGNED.includes(column.id) ? TONE[dashboard.valueClass(values[column.id])] || "text.primary" : "text.primary" }}>
                {show(column.id)}
              </Box>
            </Box>)}
          </Box>
        </Paper>;
      })}
    </Box>
  );
}
