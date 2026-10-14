import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChartCandlestick, Check, ChevronLeft, ChevronRight, Columns3, GripVertical, Minimize2, Monitor, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Search, Star, Trash2, X } from "lucide-react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import EquityChart from "./equityChart";
import EquityTerminal from "./equityTerminal";
import { EQUITY_COLUMNS, DEFAULT_EQUITY_COLUMNS, contractLabel, directionClass, equityPollDelay, expiryLabel, formatChange, formatLots, formatPrice, futuresForMonth, readEquityPreferences, reconcileEquityQuotes } from "../equityData";
import "../equity.css";
import "../equityTerminal.css";

const priceCell = (id, value) => id === "changePct" ? formatChange(value) : id.endsWith("Lots") ? formatLots(value) : formatPrice(value);
const quoteTime = quote => quote?.quotedAt ? new Date(quote.quotedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";

function Dialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current.querySelector("input,button,select")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="eq-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="eq-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...ref.current.querySelectorAll("button:not(:disabled),input,select")];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    }}>
      <header><h2>{title}</h2><button className="eq-icon" title="Close" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

function ColumnDialog({ value, onSave, onClose, title = "Equity columns" }) {
  const [order, setOrder] = useState([...value, ...DEFAULT_EQUITY_COLUMNS.filter(id => !value.includes(id))]);
  const [visible, setVisible] = useState(value);
  return <Dialog title={title} onClose={onClose}>
    <p className="eq-dialog-note">Contract stays first. Saved in this browser.</p>
    {order.map((id, index) => <div key={id} className="eq-column-option">
      <label><input type="checkbox" checked={visible.includes(id)} onChange={event => setVisible(event.target.checked ? [...visible, id] : visible.filter(item => item !== id))} />{EQUITY_COLUMNS.find(column => column.id === id).label}</label>
      <button className="eq-icon" disabled={!index} aria-label={`Move ${id} up`} title="Move up" onClick={() => setOrder(arrayMove(order, index, index - 1))}><ArrowUp size={17} /></button>
      <button className="eq-icon" disabled={index === order.length - 1} aria-label={`Move ${id} down`} title="Move down" onClick={() => setOrder(arrayMove(order, index, index + 1))}><ArrowDown size={17} /></button>
    </div>)}
    <footer><button onClick={() => { setOrder(DEFAULT_EQUITY_COLUMNS); setVisible(DEFAULT_EQUITY_COLUMNS); }}>Reset</button><button className="eq-primary" disabled={!visible.length} onClick={() => { onSave(order.filter(id => visible.includes(id))); onClose(); }}>Save columns</button></footer>
  </Dialog>;
}

function WatchRow({ contract, quote, selected, onSelect, columns, sortable, watched, onWatch, indexOptions }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: contract.id, disabled: !sortable });
  return <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`${selected ? "is-selected" : ""} ${quote?.stale ? "is-stale" : ""}`}>
    <td className="eq-contract-cell"><div>
      {sortable && <button className="eq-drag" aria-label={`Reorder ${contract.symbol}`} title="Drag to reorder" {...attributes} {...listeners}><GripVertical size={14} /></button>}
      <button className="eq-contract-button" aria-label={`View ${contract.symbol}`} aria-pressed={selected} onClick={onSelect} title={`${contract.symbol} / Expiry ${expiryLabel(contract)}`}>
        <strong>{contract.underlying}</strong><span>{contractLabel(contract, indexOptions)} <small>{new Date(contract.expiry).getFullYear()}</small></span>
      </button>
    </div></td>
    {columns.map(id => <td key={id} className={`eq-metric eq-${id} ${id === "changePct" ? directionClass(quote?.[id]) : ""}`}>
      {priceCell(id, quote?.[id])}
    </td>)}
    <td className="eq-mobile-price"><strong>{formatPrice(quote?.ltp)}</strong><span className={directionClass(quote?.changePct)}>{formatChange(quote?.changePct)}</span></td>
    <td className="eq-row-action"><button className="eq-icon" title={watched ? "Remove from watchlist" : "Add to watchlist"} aria-label={`${watched ? "Remove" : "Add"} ${contract.symbol}`} onClick={onWatch}>
      {watched ? <Star size={15} fill="currentColor" /> : <Plus size={17} />}
    </button></td>
  </tr>;
}

function Depth({ contract, quote, pending, onClose, indexOptions }) {
  const empty = !quote?.depth?.buy?.length && !quote?.depth?.sell?.length;
  return <aside className="eq-depth" id="equity-depth" aria-label="Market depth">
    <header><div><h2>{contract.underlying}</h2><span>{contractLabel(contract, indexOptions)} / {expiryLabel(contract)}</span></div>
      <button className="eq-icon" title="Collapse market depth" aria-label="Collapse market depth" onClick={onClose}><PanelRightClose size={20} /></button>
    </header>
    <div className="eq-depth-price"><strong>{formatPrice(quote?.ltp)}</strong><span className={directionClass(quote?.changePct)}>{formatChange(quote?.changePct)}</span></div>
    <div className="eq-quote-time">Quote {quoteTime(quote)} IST{quote?.stale ? " / Delayed" : ""}</div>
    <h3>Market depth <span>(lots)</span></h3>
    <table><thead><tr><th scope="col">Qty</th><th scope="col">Bid</th><th scope="col">Ask</th><th scope="col">Qty</th></tr></thead>
      <tbody>{Array.from({ length: 5 }, (_, i) => <tr key={i}>
        <td>{formatLots(quote?.depth?.buy?.[i]?.lots)}</td><td className="eq-positive">{formatPrice(quote?.depth?.buy?.[i]?.price)}</td>
        <td className="eq-negative">{formatPrice(quote?.depth?.sell?.[i]?.price)}</td><td>{formatLots(quote?.depth?.sell?.[i]?.lots)}</td>
      </tr>)}</tbody></table>
    {empty && <p className="eq-muted">{pending ? "Waiting for quote..." : "No depth available for this contract."}</p>}
    <dl>{["open", "high", "low", "close"].map(key => <div key={key}><dt>{key === "close" ? "Previous close" : key}</dt><dd>{formatPrice(quote?.ohlc?.[key])}</dd></div>)}
      <div><dt>Lot size</dt><dd>{formatLots(contract.lotSize)}</dd></div><div><dt>OI (lots)</dt><dd>{formatLots(quote?.oiLots)}</dd></div>
    </dl>
  </aside>;
}

export default function Equity({ api, username, indexOptions = false }) {
  const title = indexOptions ? "Index Options" : "Equity";
  const searchLabel = indexOptions ? "Search index options" : "Search stock futures or options";
  const columnLabel = indexOptions ? "Customize index option columns" : "Customize equity columns";
  const refreshLabel = indexOptions ? "Refresh index option quotes" : "Refresh equity quotes";
  const storageKey = `index-tool-${indexOptions ? "index-options" : "equity"}-v1:${api.preview ? "preview" : username}`;
  const [prefs, setPrefs] = useState(() => readEquityPreferences(storageKey, indexOptions ? ["NFO:", "BFO:"] : undefined));
  const preferences = useRef(prefs); preferences.current = prefs;
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState(indexOptions ? "options" : "watchlist");
  const [kind, setKind] = useState(indexOptions ? "options" : "all");
  const [month, setMonth] = useState(0);
  const [page, setPage] = useState(0);
  const [optionFilters, setOptionFilters] = useState({ underlying: "", expiry: "", strike: "", option_type: "all" });
  const [optionResult, setOptionResult] = useState({ key: "", contracts: [], total: 0, filters: {} });
  const [optionError, setOptionError] = useState("");
  const optionQuery = useMemo(() => ({ kind: "options", ...optionFilters, page }), [optionFilters, page]);
  const optionKey = JSON.stringify(optionQuery);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;
  const [quotes, setQuotes] = useState({});
  const [candles, setCandles] = useState([]);
  const [chartMessage, setChartMessage] = useState("");
  const [chartLoading, setChartLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [listName, setListName] = useState("");
  const [sort, setSort] = useState(null);
  const [terminal, setTerminal] = useState(!indexOptions);
  const [terminalChart, setTerminalChart] = useState(false);
  const [terminalDepth, setTerminalDepth] = useState(false);
  const depthOpen = terminal ? terminalDepth : prefs.depthOpen;
  const setDepthOpen = value => terminal ? setTerminalDepth(value) : setPrefs(previous => ({ ...previous, depthOpen: value }));
  useEffect(() => {
    if (!terminal) return undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [terminal]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (prefs.initialise) return;
    try { localStorage.setItem(storageKey, JSON.stringify(prefs)); }
    catch (error) { setNotice("Browser storage unavailable. Changes will last for this session only."); }
  }, [prefs, storageKey]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setLoadError("");
    async function load() {
      try {
        let rows = indexOptions ? [] : (await api.contracts({ kind: "FUT" }, abort.signal)).contracts;
        for (const list of preferences.current.lists) {
          if (list.ids.length) {
            const saved = await api.contracts({ ids: list.ids.join(",") }, abort.signal);
            rows = [...new Map([...rows, ...saved.contracts].map(contract => [contract.id, contract])).values()];
          }
        }
        if (selectedRef.current && !rows.some(row => row.id === selectedRef.current)) {
          const selected = await api.contracts({ ids: selectedRef.current }, abort.signal);
          rows = [...rows, ...selected.contracts];
        }
        if (!indexOptions && api.preview && preferences.current.initialise) {
          const options = await api.contracts({ kind: "all", q: "RELIANCE" }, abort.signal);
          rows = [...new Map([...rows, ...options.contracts].map(contract => [contract.id, contract])).values()];
        }
        if (abort.signal.aborted) return;
        setCatalogue(rows);
        if (preferences.current.initialise) {
          const favourites = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "SBIN", "TCS", "AXISBANK", "LT"];
          const near = futuresForMonth(rows, 0);
          const initial = favourites.map(name => near.find(row => row.underlying === name)).filter(Boolean);
          const sampleOptions = api.preview ? rows.filter(row => row.underlying === "RELIANCE" && row.kind !== "FUT" && row.expiry === initial[0]?.expiry && row.strike === 1400).slice(0, 2) : [];
          setPrefs(previous => ({ ...previous, initialise: false, lists: [{ id: "default", name: "My watchlist", ids: [...(initial.length ? initial : near.slice(0, 8)), ...sampleOptions].map(row => row.id) }] }));
        }
      } catch (error) { if (!abort.signal.aborted) setLoadError(error.message); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }
    load();
    return () => abort.abort();
  }, [api, refresh, indexOptions]);

  useEffect(() => {
    if (view !== "options") return undefined;
    const abort = new AbortController();
    setOptionError("");
    setOptionResult(previous => ({ ...previous, key: "" }));
    api.contracts(optionQuery, abort.signal).then(response => {
      if (!abort.signal.aborted) setOptionResult({ ...response, key: optionKey });
    }).catch(error => {
      if (!abort.signal.aborted) { setOptionError(error.message); setOptionResult(previous => ({ ...previous, key: optionKey, contracts: [], total: 0 })); }
    });
    return () => abort.abort();
  }, [api, view, optionQuery, optionKey, refresh]);

  useEffect(() => {
    if (!search.trim()) { setResults([]); setSearchError(""); setSearching(false); return undefined; }
    const abort = new AbortController();
    setSearching(true); setSearchError(""); setResults([]);
    const timer = setTimeout(async () => {
      try {
        const response = await api.contracts({ q: search, kind: "all" }, abort.signal);
        if (!abort.signal.aborted) { setResults(response.contracts); setSearching(false); }
      } catch (error) { if (!abort.signal.aborted) { setSearchError(error.message); setSearching(false); } }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [api, search]);

  const activeList = prefs.lists.find(list => list.id === prefs.activeList) || prefs.lists[0];
  const optionsReady = optionResult.key === optionKey;
  const byId = useMemo(() => new Map([...catalogue, ...optionResult.contracts].map(row => [row.id, row])), [catalogue, optionResult.contracts]);
  const rows = useMemo(() => {
    if (view === "options") return optionsReady ? optionResult.contracts : [];
    const source = view === "futures" ? futuresForMonth(catalogue, month) : activeList.ids.map(id => byId.get(id)).filter(Boolean);
    const filtered = source.filter(row => kind === "all" || (kind === "FUT" ? row.kind === "FUT" : row.kind !== "FUT"));
    return filtered;
  }, [view, catalogue, month, activeList.ids, byId, kind, optionsReady, optionResult.contracts]);
  const rowCount = view === "options" ? optionResult.total : rows.length;
  const visibleRows = view === "options" ? [...rows] : rows.slice(page * 49, page * 49 + 49);
  if (sort) visibleRows.sort((a, b) => {
      const av = quotes[a.id]?.[sort.id], bv = quotes[b.id]?.[sort.id];
      if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
      if (!Number.isFinite(bv)) return -1;
      return (av - bv) * sort.direction;
  });
  const selected = (view === "options" && !optionsReady) ? null : byId.get(selectedId) || rows[view === "options" ? 0 : page * 49];
  const selectedQuote = selected ? quotes[selected.id] : null;
  // Stable ids prevent a quote-driven sort from restarting the polling loop.
  const requestedKey = [...new Set([...visibleRows.map(row => row.id), ...(selected ? [selected.id] : [])])].sort().join(",");

  useEffect(() => { setPage(0); setSort(null); setSelectedId(null); }, [view, month, kind, prefs.activeList, optionFilters]);
  useEffect(() => { setSelectedId(null); }, [page]);
  useEffect(() => {
    if (view !== "options" || optionsReady) setPage(previous => Math.min(previous, Math.max(0, Math.ceil(rowCount / 49) - 1)));
  }, [rowCount, view, optionsReady]);
  useEffect(() => {
    if (!requestedKey) { setQuotes({}); setStatus(""); return undefined; }
    const abort = new AbortController();
    let timer;
    setStatus("waiting");
    const poll = async () => {
      let delay = 4000;
      try {
        const response = await api.quotes(requestedKey.split(","), abort.signal);
        delay = equityPollDelay(response, 4000);
        if (!abort.signal.aborted) { setQuotes(previous => reconcileEquityQuotes(previous, response.quotes)); setStatus(response.message || response.status); }
      } catch (error) {
        if (!abort.signal.aborted) { setQuotes({}); setStatus(error.message); }
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, delay);
    };
    poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [api, requestedKey, refresh]);

  const chartId = !terminal || terminalChart ? selected?.id : null;
  useEffect(() => {
    setCandles([]); setChartMessage("");
    if (!chartId) return undefined;
    const abort = new AbortController(); let timer;
    const poll = async () => {
      let delay = 60000;
      setChartLoading(true);
      try {
        const response = await api.history(chartId, abort.signal);
        delay = equityPollDelay(response, 60000);
        if (!abort.signal.aborted) { setCandles(response.candles); setChartMessage(response.message || ""); }
      } catch (error) { if (!abort.signal.aborted) { setCandles([]); setChartMessage(error.message); } }
      finally { if (!abort.signal.aborted) { setChartLoading(false); timer = setTimeout(poll, delay); } }
    };
    poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [api, chartId, refresh]);

  const updateList = ids => setPrefs(previous => ({ ...previous, lists: previous.lists.map(list => list.id === activeList.id ? { ...list, ids } : list) }));
  const toggleWatch = row => {
    if (activeList.ids.includes(row.id)) updateList(activeList.ids.filter(id => id !== row.id));
    else if (activeList.ids.length >= 50) setNotice("This watchlist has 50 contracts. Create another list or remove a contract.");
    else {
      setCatalogue(previous => [...new Map([...previous, row].map(contract => [contract.id, contract])).values()]);
      updateList([...activeList.ids, row.id]);
      setNotice(`${row.symbol} added to ${activeList.name}.`);
    }
  };
  const select = row => { setSelectedId(row.id); if (!terminal && window.innerWidth <= 700) setPrefs(previous => ({ ...previous, depthOpen: true })); };
  const missing = activeList.ids.filter(id => !byId.has(id));
  const noData = !["", "ready", "sample", "empty"].includes(status);
  const underlyings = optionResult.filters[indexOptions ? "indices" : "stocks"] || [];
  // Native select type-ahead needs focus to survive intermediate strike changes.
  const strikeOptionsReady = optionResult.filters.underlying === (optionFilters.underlying || optionResult.filters.underlying)
    && optionResult.filters.expiry === (optionFilters.expiry || optionResult.filters.expiry);
  const changeOptions = changes => {
    setPage(0); setSelectedId(null);
    setOptionFilters(previous => ({ ...previous, underlying: previous.underlying || optionResult.filters.underlying || "",
      expiry: previous.expiry || optionResult.filters.expiry || "", ...changes }));
  };

  return <main className={`eq-page${terminal ? ` eq-terminal${terminalChart && selected ? " has-chart" : ""}` : ""}`}>
    <div className="eq-command">
    <div className="eq-heading"><h1>{title}</h1><span className="eq-state">{api.preview ? "Sample data" : indexOptions ? "NSE + BSE options" : "NSE derivatives"}</span>
      <time>{new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}</time>
      <span className="eq-readonly">Read-only</span>
    </div>
    <div className={`eq-toolbar${indexOptions ? " eq-toolbar-index" : ""}`}>
      <div className="eq-search"><Search size={18} /><input aria-label={searchLabel} placeholder={searchLabel} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setSearch(""); }} />
        {search && <button className="eq-icon" aria-label="Clear search" title="Clear search" onClick={() => setSearch("")}><X size={17} /></button>}
        {search && <div className="eq-search-results" aria-label="Contract search results">
          {searching ? <p role="status">Searching...</p> : searchError ? <p role="alert">{searchError}</p> : !results.length ? <p>{indexOptions ? "No matching index options." : "No matching stock derivatives."}</p> : results.map(row => <div key={row.id}>
            <button className="eq-search-contract" onClick={() => { setCatalogue(previous => [...new Map([...previous, row].map(contract => [contract.id, contract])).values()]); select(row); setSearch(""); }}><strong>{row.underlying}</strong><span>{contractLabel(row, indexOptions)} / {expiryLabel(row)}</span></button>
            <button className="eq-icon" aria-label={`${activeList.ids.includes(row.id) ? "Remove" : "Add"} ${row.symbol} ${activeList.ids.includes(row.id) ? "from" : "to"} watchlist`} title="Toggle watchlist" onClick={() => toggleWatch(row)}>{activeList.ids.includes(row.id) ? <Check size={18} /> : <Plus size={18} />}</button>
          </div>)}
        </div>}
      </div>
      {!indexOptions && <div className="eq-segments" role="group" aria-label="Contract type">{[["all", "All"], ["FUT", "Futures"], ["options", "Options"]].map(([value, label]) => <button key={value} aria-pressed={kind === value} className={kind === value ? "active" : ""} onClick={() => { setKind(value); if (value === "options") setView("options"); else if (view === "options") setView(value === "FUT" ? "futures" : "watchlist"); }}>{label}</button>)}</div>}
      {!terminal && <button className="eq-icon" title={columnLabel} aria-label={columnLabel} onClick={() => setDialog("columns")}><Columns3 size={20} /></button>}
      <button className="eq-icon" title={refreshLabel} aria-label={refreshLabel} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={19} /></button>
      <button className={`eq-depth-toggle ${depthOpen ? "active" : ""}`} aria-label={depthOpen ? "Hide depth" : "Market depth"} title={depthOpen ? "Hide market depth" : "Show market depth"} aria-expanded={depthOpen} aria-controls="equity-depth" disabled={!selected} onClick={() => setDepthOpen(!depthOpen)}>
        {depthOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}<span>{depthOpen ? "Hide depth" : "Market depth"}</span>
      </button>
      {terminal && <button className="eq-terminal-chart-toggle eq-depth-toggle" aria-label={terminalChart ? "Close chart" : "Open chart"} title={terminalChart ? "Close chart" : "Open selected contract chart"} aria-expanded={terminalChart} disabled={!selected} onClick={() => setTerminalChart(value => !value)}><ChartCandlestick size={17} /><span>Chart</span></button>}
      <button className="eq-icon" title={terminal ? "Exit terminal view" : "Open terminal view"} aria-label={terminal ? "Exit terminal view" : "Open terminal view"} onClick={() => { setTerminal(value => !value); setTerminalChart(false); setTerminalDepth(false); }}>
        {terminal ? <Minimize2 size={19} /> : <Monitor size={19} />}
      </button>
    </div>
    </div>
    <div className="eq-watch-tabs">
      <button className={view === "watchlist" ? "active" : ""} onClick={() => { setView("watchlist"); setKind("all"); }}>My watchlists</button>
      {!indexOptions && <button className={view === "futures" ? "active" : ""} onClick={() => { setView("futures"); setKind("all"); }}>All futures</button>}
      <button className={view === "options" ? "active" : ""} onClick={() => { setView("options"); setKind("options"); }}>{indexOptions ? "All index options" : "Stock options"}</button>
      <button className="eq-icon" title="New watchlist" aria-label="New watchlist" disabled={prefs.lists.length >= 10} onClick={() => { setListName(""); setDialog("list"); }}><Plus size={19} /></button>
      {view === "watchlist" ? <div className="eq-list-control"><select aria-label="Watchlist" value={activeList.id} onChange={event => setPrefs(previous => ({ ...previous, activeList: event.target.value }))}>{prefs.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
        {prefs.lists.length > 1 && <button className="eq-icon" title="Delete watchlist" aria-label="Delete watchlist" onClick={() => setDialog("delete")}><Trash2 size={16} /></button>}</div> :
        view === "futures" && <div className="eq-segments eq-months" role="group" aria-label="Futures month">{["Current", "Next", "Far"].map((label, index) => <button key={label} className={month === index ? "active" : ""} aria-pressed={month === index} onClick={() => setMonth(index)}>{label}</button>)}</div>}
    </div>
    {view === "options" && <div className="eq-option-filters" role="group" aria-label={indexOptions ? "Index option filters" : "Stock option filters"} aria-busy={!optionsReady}>
      <label>{indexOptions ? "Index" : "Stock"}<select aria-label={indexOptions ? "Option index" : "Option stock"} value={optionFilters.underlying || optionResult.filters.underlying || ""} disabled={!underlyings.length} onChange={event => changeOptions({ underlying: event.target.value, expiry: "", strike: "" })}>
        {!underlyings.length && <option value="">{indexOptions ? "No indices available" : "No stocks available"}</option>}
        {underlyings.map(name => <option key={name} value={name}>{indexOptions ? { NIFTY: "Nifty", BANKNIFTY: "Bank Nifty", SENSEX: "Sensex" }[name] || name : name}</option>)}
      </select></label>
      <label>Expiry<select aria-label="Option expiry" value={optionFilters.expiry || optionResult.filters.expiry || ""} disabled={!optionsReady || !optionResult.filters.expiries?.length} onChange={event => changeOptions({ expiry: event.target.value, strike: "" })}>
        {!optionResult.filters.expiries?.length && <option value="">No expiries available</option>}
        {optionResult.filters.expiries?.map(expiry => <option key={expiry} value={expiry}>{expiryLabel({ expiry })}</option>)}
      </select></label>
      <label>Strike<select aria-label="Option strike" value={optionFilters.strike} disabled={!strikeOptionsReady || !optionResult.filters.strikes?.length} onChange={event => changeOptions({ strike: event.target.value })}>
        <option value="">All strikes</option>{optionResult.filters.strikes?.map(strike => <option key={strike} value={strike}>{strike}</option>)}
      </select></label>
      <label>Type<select aria-label="Option type" value={optionFilters.option_type} disabled={!optionsReady} onChange={event => changeOptions({ option_type: event.target.value })}>
        <option value="all">Calls + Puts</option><option value="CE">Calls (CE)</option><option value="PE">Puts (PE)</option>
      </select></label>
    </div>}
    {notice && <div className="eq-notice" role="status"><span>{notice}</span><button className="eq-icon" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={16} /></button></div>}
    {loadError && <p className="eq-error" role="alert">{loadError}</p>}
    {view === "options" && optionError && <p className="eq-error" role="alert">{optionError}</p>}
    {noData && <p className="eq-error" role="status">{status === "waiting" ? "Waiting for quotes..." : status}</p>}
    {!loading && view === "watchlist" && missing.length > 0 && <div className="eq-notice"><span>{missing.length} saved contract(s) expired or unavailable.</span><button onClick={() => updateList(activeList.ids.filter(id => byId.has(id)))}>Remove unavailable</button></div>}
    <div className={`eq-workspace ${depthOpen && selected ? "with-depth" : ""}`}>
      <section className="eq-watch" aria-label={`${title} market watch`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id) updateList(arrayMove(activeList.ids, activeList.ids.indexOf(active.id), activeList.ids.indexOf(over.id)));
        }}>
          <div className="eq-table-scroll">{terminal ? <EquityTerminal rows={visibleRows} quotes={quotes} selectedId={selected?.id} onSelect={select}
            onChart={row => { select(row); setTerminalChart(true); }} watchedIds={activeList.ids} onWatch={toggleWatch} sortable={view === "watchlist" && kind === "all" && !sort} /> : <table className="eq-table">
            <thead><tr><th scope="col">Contract</th>{prefs.columns.map(id => <th scope="col" key={id} className={`eq-metric eq-${id}`} aria-sort={sort?.id === id ? sort.direction === 1 ? "ascending" : "descending" : "none"}>
              <button title={`Sort by ${EQUITY_COLUMNS.find(column => column.id === id).label}`} onClick={() => setSort(previous => previous?.id === id && previous.direction === -1 ? null : { id, direction: previous?.id === id ? -1 : 1 })}>{EQUITY_COLUMNS.find(column => column.id === id).label}{sort?.id === id && (sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
            </th>)}<th className="eq-mobile-price" scope="col">LTP / Change</th><th className="eq-row-action" scope="col"><span className="sr-only">Watchlist</span></th></tr></thead>
            <SortableContext items={visibleRows.map(row => row.id)} strategy={verticalListSortingStrategy}><tbody>
              {visibleRows.map(row => <WatchRow key={row.id} contract={row} quote={quotes[row.id]} selected={selected?.id === row.id} onSelect={() => select(row)} columns={prefs.columns} indexOptions={indexOptions}
                sortable={view === "watchlist" && kind === "all" && !sort} watched={activeList.ids.includes(row.id)} onWatch={() => toggleWatch(row)} />)}
            </tbody></SortableContext>
          </table>}</div>
        </DndContext>
        {!visibleRows.length && <div className="eq-empty" role="status">{view === "options" ? !optionsReady ? `Loading ${indexOptions ? "index" : "stock"} options...` : optionError ? "Options unavailable." : "No options match these filters." : loading ? "Loading contracts..." : indexOptions ? "No contracts in this watchlist." : "No contracts in this view. Search to add a stock future or option."}</div>}
        <footer className="eq-table-footer"><span>{view === "options" && !optionsReady ? "Loading..." : `${rowCount} contract${rowCount === 1 ? "" : "s"}`}{sort ? " / Sorted" : ""}</span>
          {rowCount > 49 && <div><button className="eq-icon" aria-label="Previous contracts" disabled={!page || (view === "options" && !optionsReady)} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span>{page + 1} / {Math.ceil(rowCount / 49)}</span><button className="eq-icon" aria-label="Next contracts" disabled={(page + 1) * 49 >= rowCount || (view === "options" && !optionsReady)} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div>}
          <span>{api.preview ? "Sample quotes" : "Quotes refresh every 4 sec"}</span>
        </footer>
      </section>
      {depthOpen && selected && <Depth contract={selected} quote={selectedQuote} indexOptions={indexOptions} pending={!selectedQuote && status === "waiting"} onClose={() => setDepthOpen(false)} />}
    </div>
    {selected && (!terminal || terminalChart) && <EquityChart contract={selected} candles={candles} message={chartMessage} loading={chartLoading} terminal={terminal} onClose={() => setTerminalChart(false)} />}
    <div className="eq-footer"><span>{api.preview ? "Sample data" : `Quote ${quoteTime(selectedQuote)} IST`} / Read-only</span><span>{indexOptions ? "Index options" : "Stock futures and options"}</span></div>
    {dialog === "columns" && <ColumnDialog title={`${title} columns`} value={prefs.columns} onSave={columns => setPrefs(previous => ({ ...previous, columns }))} onClose={() => setDialog(null)} />}
    {dialog === "list" && <Dialog title="New watchlist" onClose={() => setDialog(null)}><form onSubmit={event => {
      event.preventDefault(); if (!listName.trim()) return;
      const id = `list-${Date.now()}`;
      setPrefs(previous => ({ ...previous, lists: [...previous.lists, { id, name: listName.trim(), ids: [] }], activeList: id }));
      setView("watchlist"); setKind("all"); setDialog(null);
    }}><label className="eq-list-name">Name<input maxLength={32} required value={listName} onChange={event => setListName(event.target.value)} placeholder="e.g. Stock options" /></label><p className="eq-dialog-note">Watchlists are saved in this browser for your account.</p><footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="eq-primary" type="submit">Create watchlist</button></footer></form></Dialog>}
    {dialog === "delete" && <Dialog title="Delete watchlist?" onClose={() => setDialog(null)}><p className="eq-dialog-note">Remove {activeList.name} from this browser?</p><footer><button onClick={() => setDialog(null)}>Cancel</button><button onClick={() => { const lists = prefs.lists.filter(list => list.id !== activeList.id); setPrefs(previous => ({ ...previous, lists, activeList: lists[0].id })); setDialog(null); }}>Delete watchlist</button></footer></Dialog>}
  </main>;
}
