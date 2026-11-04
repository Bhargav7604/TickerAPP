import React from "react";
import { Box, ButtonBase, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { Columns3, LayoutGrid, Rows3 } from "lucide-react";
import { selectedMarketColumns } from "../marketColumns";
import { mono } from "../ui/Glass";

export const MARKET_LAYOUTS = [["cards", "Cards", LayoutGrid], ["rows", "Rows", Rows3], ["columns", "Columns", Columns3]];
const INDICES = ["nifty", "banknifty", "sensex"];
// Price and day change sit next to each index's name, so they are not repeated as metrics.
const HEADER_COLUMNS = ["futures", "change"];
const SIGNED = ["difference", "netLots", "vwap", "demandSupply", "change"];
const TONE = { "value-up": "success.main", "value-down": "error.main" };
const SELECTED_TINT = "rgba(74,111,224,0.08)";
// Sticky cells need a solid base so numbers scrolling underneath do not show through.
const stickyCell = selected => ({
  position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper",
  backgroundImage: selected ? `linear-gradient(${SELECTED_TINT}, ${SELECTED_TINT})` : "none",
});
const tableText = { "& td": { ...mono, fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap" }, "& th": { verticalAlign: "middle" } };

function readIndex(dashboard, key) {
  const offline = dashboard.props.feedStatus === "offline";
  const data = dashboard.getData(key);
  const expiry = dashboard.getCurrentExpiry(key);
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
  const change = live(data.netChange);
  return {
    key,
    contract: expiry ? new Date(expiry + "T00:00:00").toLocaleDateString("en-GB", { month: "short" }).toUpperCase() + " FUT" : "",
    title: dashboard.getCurrentSymbol(key) + " | Expiry " + dashboard.formatExpiry(expiry),
    price: dashboard.formatValue(offline ? null : data.cmp),
    changeText: `${dashboard.formatSignedValue(change)} (${dashboard.formatSignedValue(live(data.pctChange))}%)`,
    changeClass: dashboard.valueClass(change),
    show: id => {
      if (id === "ohlc") return ["open", "high", "low"].map(field => dashboard.formatValue(live(data[field]))).join(" / ");
      if (id === "oiRange") return ["oiDayHigh", "oiDayLow"].map(field => dashboard.formatValue(live(data[field]))).join(" / ");
      return SIGNED.includes(id) ? dashboard.formatSignedValue(values[id]) : dashboard.formatValue(values[id]);
    },
    metricClass: id => SIGNED.includes(id) ? dashboard.valueClass(values[id]) : "",
  };
}

const columnLabel = column => <>{column.label}{column.unit && <span> ({column.unit})</span>}</>;
const metricColor = className => TONE[className] || "text.primary";

function IndexName({ reading, selected }) {
  return <Box component="span" className="market-card-name" sx={{ display: "grid" }}>
    <Typography component="strong" sx={{ fontWeight: 800, fontSize: 15 }}>{reading.key.toUpperCase()}</Typography>
    <Typography component="small" sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap" }}>{reading.contract}{selected ? " · on chart" : ""}</Typography>
  </Box>;
}

function IndexPrice({ reading, align = "end" }) {
  return <Box component="span" className="market-card-price" sx={{ display: "grid", justifyItems: align }}>
    <Box component="b" sx={{ ...mono, fontSize: 16, fontWeight: 800 }}>{reading.price}</Box>
    <Box component="small" className={reading.changeClass} sx={{ ...mono, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: TONE[reading.changeClass] || "text.secondary" }}>{reading.changeText}</Box>
  </Box>;
}

// Choosing an index puts it on the chart, in every layout.
function ChartButton({ dashboard, reading, selected, sx, children }) {
  return <ButtonBase className="market-card-head" aria-pressed={selected} aria-label={"Chart " + reading.key} title={reading.title}
    onClick={() => dashboard.handleChartIndexChange({ target: { value: reading.key } })}
    sx={{ textAlign: "left", "&:hover": { bgcolor: "rgba(74,111,224,0.06)" }, "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" }, ...sx }}>
    {children}
  </ButtonBase>;
}

function CardsView({ dashboard, readings, columns, selected }) {
  return (
    // Phones swipe sideways through the three indices instead of scrolling past three tall cards.
    <Box component="section" className="market-comparison market-cards" aria-label="Index comparison" sx={{
      gridArea: "compare", minWidth: 0, display: "grid", gap: 2,
      gridTemplateColumns: { xs: "repeat(3, 86%)", sm: "repeat(3, 62%)", md: "repeat(3, minmax(0, 1fr))" },
      overflowX: { xs: "auto", md: "visible" }, scrollSnapType: { xs: "x mandatory", md: "none" }, pb: { xs: 0.5, md: 0 },
    }}>
      {readings.map(reading => {
        const isSelected = selected === reading.key;
        return <Paper component="article" key={reading.key} className={"market-card" + (isSelected ? " is-selected" : "")} aria-label={reading.key.toUpperCase() + " overview"}
          sx={{ minWidth: 0, overflow: "hidden", scrollSnapAlign: "start", transition: "box-shadow 200ms ease",
            boxShadow: isSelected ? "0 0 0 2px rgba(74,111,224,0.55), 0 8px 24px rgba(74,111,224,0.14)" : undefined }}>
          <ChartButton dashboard={dashboard} reading={reading} selected={isSelected}
            sx={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, px: 2, pt: 1.5, pb: 1.25, bgcolor: isSelected ? SELECTED_TINT : "transparent" }}>
            <IndexName reading={reading} selected={isSelected} />
            <IndexPrice reading={reading} />
          </ChartButton>
          <Box component="dl" className="market-card-metrics" sx={{ m: 0, px: 2, pb: 1.5, pt: 0.5, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 14px" }}>
            {columns.map(column => <Box key={column.id} data-column={column.id} sx={{ minWidth: 0, ...(column.id === "ohlc" || column.id === "oiRange" ? { gridColumn: "1 / -1" } : {}) }}>
              <Box component="dt" sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{columnLabel(column)}</Box>
              <Box component="dd" className={reading.metricClass(column.id)} sx={{ m: 0, ...mono, fontSize: 13.5, fontWeight: 700, color: metricColor(reading.metricClass(column.id)) }}>
                {reading.show(column.id)}
              </Box>
            </Box>)}
          </Box>
        </Paper>;
      })}
    </Box>
  );
}

// One row per index, with the numbers running across.
function RowsView({ dashboard, readings, columns, selected }) {
  return <Paper component="section" className="market-comparison market-rows" aria-label="Index comparison" sx={{ gridArea: "compare", alignSelf: "stretch", minWidth: 0, overflow: "hidden" }}>
    <TableContainer>
      <Table size="small" aria-label="Index comparison by index" sx={tableText}>
        <TableHead><TableRow>
          <TableCell scope="col" sx={{ ...stickyCell(false), bgcolor: "background.subtle" }}>Index</TableCell>
          <TableCell scope="col" align="right">Futures</TableCell>
          {columns.map(column => <TableCell scope="col" key={column.id} align="right" sx={{ lineHeight: 1.25, minWidth: 76 }}>{columnLabel(column)}</TableCell>)}
        </TableRow></TableHead>
        <TableBody>
          {readings.map(reading => {
            const isSelected = selected === reading.key;
            return <TableRow key={reading.key} className={isSelected ? "is-selected" : ""} sx={{ bgcolor: isSelected ? SELECTED_TINT : "transparent" }}>
              <TableCell component="th" scope="row" sx={{ ...stickyCell(isSelected), p: 0 }}>
                <ChartButton dashboard={dashboard} reading={reading} selected={isSelected} sx={{ width: "100%", justifyContent: "flex-start", px: 2, py: 1 }}>
                  <IndexName reading={reading} selected={isSelected} />
                </ChartButton>
              </TableCell>
              <TableCell align="right"><IndexPrice reading={reading} /></TableCell>
              {columns.map(column => <TableCell key={column.id} align="right" data-column={column.id} className={reading.metricClass(column.id)} sx={{ color: metricColor(reading.metricClass(column.id)) }}>
                {reading.show(column.id)}
              </TableCell>)}
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </TableContainer>
  </Paper>;
}

// One column per index, with the numbers lined up underneath for easy comparison.
function ColumnsView({ dashboard, readings, columns, selected }) {
  const tint = key => selected === key ? SELECTED_TINT : "transparent";
  return <Paper component="section" className="market-comparison market-columns" aria-label="Index comparison" sx={{ gridArea: "compare", alignSelf: "stretch", minWidth: 0, overflow: "hidden" }}>
    <TableContainer>
      <Table size="small" aria-label="Index comparison by metric" sx={tableText}>
        <TableHead><TableRow>
          <TableCell scope="col" sx={{ ...stickyCell(false), bgcolor: "background.subtle" }}>Metric</TableCell>
          {readings.map(reading => {
            const isSelected = selected === reading.key;
            return <TableCell scope="col" key={reading.key} align="right" sx={{ p: 0, textTransform: "none", letterSpacing: 0, color: "text.primary", backgroundImage: isSelected ? `linear-gradient(${SELECTED_TINT}, ${SELECTED_TINT})` : "none" }}>
              <ChartButton dashboard={dashboard} reading={reading} selected={isSelected} sx={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1.5, px: 2, py: 1 }}>
                <IndexName reading={reading} selected={isSelected} />
                <IndexPrice reading={reading} />
              </ChartButton>
            </TableCell>;
          })}
        </TableRow></TableHead>
        <TableBody>
          {columns.map(column => <TableRow key={column.id} data-column={column.id}>
            <TableCell component="th" scope="row" sx={{ ...stickyCell(false), fontSize: 12.5, fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap" }}>{columnLabel(column)}</TableCell>
            {readings.map(reading => <TableCell key={reading.key} align="right" className={reading.metricClass(column.id)} sx={{ bgcolor: tint(reading.key), color: metricColor(reading.metricClass(column.id)) }}>
              {reading.show(column.id)}
            </TableCell>)}
          </TableRow>)}
        </TableBody>
      </Table>
    </TableContainer>
  </Paper>;
}

const VIEWS = { cards: CardsView, rows: RowsView, columns: ColumnsView };

export default function MarketComparison({ dashboard, layout = "cards" }) {
  const View = VIEWS[layout] || CardsView;
  const columns = selectedMarketColumns(dashboard.props.settings.marketColumns).filter(column => !HEADER_COLUMNS.includes(column.id));
  return <View dashboard={dashboard} columns={columns} selected={dashboard.state.selectedChartIndex}
    readings={INDICES.map(key => readIndex(dashboard, key))} />;
}
