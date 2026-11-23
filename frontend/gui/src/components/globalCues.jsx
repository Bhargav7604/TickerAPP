import React from "react";
import { Box } from "@mui/material";
import { useTheme } from "../theme";

// Global markets come from TradingView's quote widget; Zerodha does not carry them. Exchange index feeds (TVC:NI225,
// TVC:DXY, GIFT Nifty) are blank in free embeds, so the broker CFD quotes stand in; checked in the widget on 14 Nov 2026.
export const GLOBAL_GROUPS = [
  { name: "US (overnight)", symbols: [["CAPITALCOM:US30", "Dow Jones"], ["CAPITALCOM:US500", "S&P 500"], ["CAPITALCOM:US100", "Nasdaq 100"]] },
  { name: "Asia", symbols: [["CAPITALCOM:J225", "Nikkei 225"], ["CAPITALCOM:HK50", "Hang Seng"], ["CAPITALCOM:CN50", "China A50"]] },
  { name: "Europe", symbols: [["CAPITALCOM:UK100", "FTSE 100"], ["CAPITALCOM:DE40", "DAX"]] },
  { name: "Commodities & FX", symbols: [["TVC:UKOIL", "Brent crude"], ["TVC:GOLD", "Gold"], ["FX_IDC:USDINR", "USD/INR"], ["CAPITALCOM:DXY", "Dollar index"],
    ["OANDA:USB10YUSD", "US 10Y note (price)"]] },
];
export const globalQuotesUrl = theme => "https://s.tradingview.com/embed-widget/market-quotes/?locale=en#" + encodeURIComponent(JSON.stringify({
  width: "100%", height: "100%", colorTheme: theme === "dark" ? "dark" : "light", isTransparent: true, showSymbolLogo: false,
  symbolsGroups: GLOBAL_GROUPS.map(group => ({ name: group.name, symbols: group.symbols.map(([name, displayName]) => ({ name, displayName })) })),
}));

/** TradingView's quote table for the overseas indices, commodities and FX, in the app's theme. The iframe keeps the
 * widget's own colour scheme: in dark mode a mismatched scheme makes the browser paint a white backdrop behind it. */
export function GlobalCues({ height }) {
  const { theme } = useTheme();
  return <Box sx={{ position: "relative", height }}>
    <Box component="iframe" key={theme} title="Global markets from TradingView" src={globalQuotesUrl(theme)} loading="lazy"
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, colorScheme: "normal" }} />
  </Box>;
}
