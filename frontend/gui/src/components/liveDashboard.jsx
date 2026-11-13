import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { GripVertical, RotateCcw } from "lucide-react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import LiveChart from "./liveChart";
import { CANDLE_SIZES, DASHBOARD_CHARTS, DEFAULT_ORDER, readOrder, readSizes, saveOrder, saveSizes } from "../dashboardData";
import { mono, PageShell, Segmented } from "../ui/Glass";
import { useTheme } from "../theme";

const QUOTES_MS = 3000;
const CANDLES_MS = 60000;
const BY_ID = Object.fromEntries(DASHBOARD_CHARTS.map(chart => [chart.id, chart]));
// Six charts fit one screen: three across and two down on a laptop, two across on a tablet.
const CARD_HEIGHT = { xs: 380, md: "max(300px, calc((100vh - 170px) / 3))", lg: "max(300px, calc((100vh - 150px) / 2))" };
const DOW_SRC = theme => "https://s.tradingview.com/widgetembed/?" + new URLSearchParams({
  symbol: "CAPITALCOM:US30", interval: "5", theme, style: "1", locale: "en", timezone: "Asia/Kolkata",
  hidesidetoolbar: "1", symboledit: "0", saveimage: "0", withdateranges: "0",
});

const fixed = (value, places) => Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places }) : "--";
const signed = (value, places) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fixed(value, places)}` : "--";
const tone = value => value > 0 ? "success.main" : value < 0 ? "error.main" : "text.secondary";

/** The new order after dropping one chart onto another's place. */
export function moveChart(order, activeId, overId) {
  if (!overId || activeId === overId) return order;
  return arrayMove(order, order.indexOf(activeId), order.indexOf(overId));
}

function useCandles(api, id, interval, enabled) {
  const [state, setState] = useState({ candles: [], message: "", loading: true });
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let timer = null;
    const abort = new AbortController();
    setState({ candles: [], message: "", loading: true });
    const run = async () => {
      let delay = CANDLES_MS;
      try {
        const result = await api.candles(id, interval, abort.signal);
        if (stopped) return;
        setState({ candles: result.candles || [], message: result.message || "", loading: false });
        if (result.retryAfterMs) delay = Math.max(1000, result.retryAfterMs);
      } catch (exc) {
        if (stopped) return;
        setState(previous => ({ ...previous, message: exc.message, loading: false }));
      }
      if (!stopped) timer = setTimeout(run, delay);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [api, id, interval, enabled]);
  return state;
}

function ChartCard({ chart, quote, interval, onInterval, api }) {
  const { theme } = useTheme();
  const tradingView = chart.source === "tradingview";
  const { candles, message, loading } = useCandles(api, chart.id, interval, !tradingView);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: chart.id });
  const places = chart.precision || 2;
  return <Paper ref={setNodeRef} component="section" aria-label={chart.label} style={{ transform: CSS.Transform.toString(transform), transition }}
    sx={{ position: "relative", zIndex: isDragging ? 3 : "auto", display: "flex", flexDirection: "column", overflow: "hidden", height: CARD_HEIGHT, minWidth: 0,
      boxShadow: isDragging ? "0 18px 48px rgba(16, 24, 40, 0.28)" : undefined }}>
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1, pt: 1, pb: 0.5, flex: "none" }}>
      <Tooltip title="Drag to move">
        <IconButton ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Move ${chart.label}`} size="small"
          sx={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none", color: "text.secondary" }}>
          <GripVertical size={18} />
        </IconButton>
      </Tooltip>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="h2" sx={{ fontSize: 14.5, fontWeight: 800, lineHeight: 1.25 }}>{chart.label}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {tradingView ? "US30 · live from TradingView" : quote?.symbol ? `${quote.exchange}:${quote.symbol}` : "Loading…"}
        </Typography>
      </Box>
      {!tradingView && <Box sx={{ textAlign: "right", flex: "none" }}>
        <Typography sx={{ ...mono, fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{fixed(quote?.ltp, places)}</Typography>
        <Typography sx={{ ...mono, fontSize: 12, fontWeight: 700, color: tone(quote?.change) }}>
          {signed(quote?.change, places)} ({signed(quote?.changePct, 2)}%)
        </Typography>
      </Box>}
    </Stack>
    {!tradingView && <Box sx={{ px: 1.25, pb: 0.75, flex: "none" }}>
      <Segmented label={`${chart.label} candle size`} value={interval} options={CANDLE_SIZES} onChange={value => onInterval(chart.id, value)} />
    </Box>}
    <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
      {tradingView
        ? <Box component="iframe" key={theme} src={DOW_SRC(theme)} title="Dow futures chart (US30) from TradingView" loading="lazy"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
        : <>
          <LiveChart candles={candles} live={quote} interval={interval} precision={places} label={chart.label} />
          {!candles.length && <Typography role="status" color="text.secondary" sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, px: 2, textAlign: "center", pointerEvents: "none" }}>
            {loading ? "Loading chart…" : message || "No candles for this period."}
          </Typography>}
        </>}
    </Box>
  </Paper>;
}

export default function LiveDashboard({ api }) {
  const [order, setOrder] = useState(readOrder);
  const [sizes, setSizes] = useState(readSizes);
  const [quotes, setQuotes] = useState({});
  const [message, setMessage] = useState("");
  const delay = useRef(QUOTES_MS);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let first = true;
    const abort = new AbortController();
    const run = async () => {
      if (first || document.visibilityState !== "hidden") {
        first = false;
        try {
          const result = await api.quotes(abort.signal);
          if (stopped) return;
          setQuotes(Object.fromEntries((result.charts || []).map(chart => [chart.id, chart])));
          setMessage(result.message || "");
          delay.current = result.retryAfterMs ? Math.max(1000, result.retryAfterMs) : QUOTES_MS;
        } catch (exc) {
          if (stopped) return;
          setMessage(exc.message);
          delay.current = QUOTES_MS * 3;
        }
      }
      if (!stopped) timer = setTimeout(run, delay.current);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [api]);

  const changeOrder = next => { setOrder(next); saveOrder(next); };
  const changeSize = (id, size) => setSizes(previous => { const next = { ...previous, [id]: size }; saveSizes(next); return next; });
  const label = id => BY_ID[id]?.label || id;
  const announcements = {
    onDragStart: ({ active }) => `Picked up ${label(active.id)}.`,
    onDragOver: ({ active, over }) => over ? `${label(active.id)} is over the place of ${label(over.id)}.` : `${label(active.id)} is no longer over a chart.`,
    onDragEnd: ({ active, over }) => over ? `${label(active.id)} moved to the place of ${label(over.id)}.` : `${label(active.id)} was put back.`,
    onDragCancel: ({ active }) => `Moving ${label(active.id)} was cancelled.`,
  };

  return <PageShell className="live-dashboard" maxWidth={1680}>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ mb: 1.5 }}>
      <Box>
        <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>Dashboard</Typography>
        <Typography variant="body2" color="text.secondary">Live charts on one screen. Drag a chart by its handle to put them in your order.</Typography>
      </Box>
      <Button size="small" variant="outlined" startIcon={<RotateCcw size={15} />} onClick={() => changeOrder(DEFAULT_ORDER)}
        disabled={order.join() === DEFAULT_ORDER.join()}>Reset order</Button>
    </Stack>
    {message && <Alert severity="warning" sx={{ mb: 1.5 }}>{message}</Alert>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ announcements }}
      onDragEnd={({ active, over }) => changeOrder(moveChart(order, active.id, over?.id))}>
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" } }}>
          {order.map(id => <ChartCard key={id} chart={BY_ID[id]} quote={quotes[id]} interval={sizes[id] || "5minute"} onInterval={changeSize} api={api} />)}
        </Box>
      </SortableContext>
    </DndContext>
  </PageShell>;
}
