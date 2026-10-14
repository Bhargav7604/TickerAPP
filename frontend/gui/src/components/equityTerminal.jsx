import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Star } from "lucide-react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { isOlderEquityQuote } from "../equityData";

const quantity = (lots, contract) => Number.isFinite(lots) ? Math.round(lots * contract.lotSize) : null;
export const TERMINAL_COLUMNS = [
  { id: "lotSize", label: "Lot Qty", value: (_, c) => c.lotSize, integer: true },
  { id: "bidQty", label: "Bid Qty", value: (q, c) => quantity(q?.depth?.buy?.[0]?.lots, c), integer: true, flash: true },
  { id: "bid", label: "Bid Rate", value: q => q?.bid, flash: true },
  { id: "ask", label: "Ask Rate", value: q => q?.ask, flash: true },
  { id: "changePct", label: "% Change", value: q => q?.changePct },
  { id: "askQty", label: "Ask Qty", value: (q, c) => quantity(q?.depth?.sell?.[0]?.lots, c), integer: true, flash: true },
  { id: "ltp", label: "LTP", value: q => q?.ltp, flash: true },
  { id: "high", label: "High", value: q => q?.ohlc?.high },
  { id: "change", label: "Net Change", value: q => q?.change },
  { id: "open", label: "Open", value: q => q?.ohlc?.open },
  { id: "low", label: "Low", value: q => q?.ohlc?.low },
  { id: "close", label: "Prev Close", value: q => q?.ohlc?.close },
  { id: "volume", label: "Volume", value: (q, c) => quantity(q?.volumeLots, c), integer: true },
  { id: "oi", label: "Open Interest", value: (q, c) => quantity(q?.oiLots, c), integer: true },
];

const display = (value, integer) => Number.isFinite(value) ? integer ? String(value) : value.toFixed(2) : "--";

export function terminalChanges(previous, next, contracts) {
  const changes = {};
  contracts.forEach(contract => {
    const before = previous[contract.id], after = next[contract.id];
    if (!before || !after || before.stale || after.stale || isOlderEquityQuote(before, after)) return;
    TERMINAL_COLUMNS.filter(column => column.flash).forEach(column => {
      const a = column.value(before, contract), b = column.value(after, contract);
      if (Number.isFinite(a) && Number.isFinite(b) && display(a, column.integer) !== display(b, column.integer)) changes[`${contract.id}:${column.id}`] = b > a ? "up" : "down";
    });
  });
  return changes;
}

function TerminalRow({ contract, quote, flashes, selected, onSelect, onChart, watched, onWatch, sortable }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: contract.id, disabled: !sortable });
  return <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`${selected ? "is-selected" : ""} ${quote?.stale ? "is-stale" : ""}`}
    aria-selected={selected} onClick={onSelect} onDoubleClick={onChart}>
    <td className="terminal-exchange">{contract.id.split(":")[0]}</td>
    <td className={`terminal-symbol${flashes[`${contract.id}:ltp`] ? ` terminal-tick-${flashes[`${contract.id}:ltp`]}` : ""}`}><div>
      {sortable && <button className="terminal-drag" title="Reorder contract" aria-label={`Reorder ${contract.symbol}`} {...attributes} {...listeners}><GripVertical size={11} /></button>}
      <button aria-label={`View ${contract.symbol}`} aria-pressed={selected} onClick={onSelect} title={`${contract.symbol} / ${contract.expiry}${quote?.stale ? " / Delayed quote" : ""}`}>{contract.symbol}</button>
    </div></td>
    <td className="terminal-underlying">{contract.underlying}</td>
    {TERMINAL_COLUMNS.map(column => <td key={column.id} data-column={column.id} className={flashes[`${contract.id}:${column.id}`] ? `terminal-tick-${flashes[`${contract.id}:${column.id}`]}` : ""}>
      {display(column.value(quote, contract), column.integer)}
    </td>)}
    <td className="terminal-action"><button aria-label={`${watched ? "Remove" : "Add"} ${contract.symbol}`} title={watched ? "Remove from watchlist" : "Add to watchlist"}
      onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onWatch(); }}>{watched ? <Star size={11} fill="currentColor" /> : <Plus size={12} />}</button></td>
  </tr>;
}

export default function EquityTerminal({ rows, quotes, selectedId, onSelect, onChart, watchedIds, onWatch, sortable }) {
  const [sort, setSort] = useState(null);
  const [flashes, setFlashes] = useState({});
  const previous = useRef({});
  const contracts = useRef(rows); contracts.current = rows;
  useEffect(() => {
    setFlashes(terminalChanges(previous.current, quotes, contracts.current));
    previous.current = quotes;
    const timer = setTimeout(() => setFlashes({}), 1100);
    return () => clearTimeout(timer);
  }, [quotes]);
  const ordered = [...rows];
  if (sort) {
    const column = TERMINAL_COLUMNS.find(item => item.id === sort.id);
    ordered.sort((a, b) => {
      const av = column.value(quotes[a.id], a), bv = column.value(quotes[b.id], b);
      if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
      if (!Number.isFinite(bv)) return -1;
      return (av - bv) * sort.direction;
    });
  }
  return <table className="terminal-table" aria-label="Terminal market watch" onKeyDown={event => {
    if (event.target.closest("thead") || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const index = ordered.findIndex(row => row.id === selectedId);
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      onSelect(next);
      const buttons = event.currentTarget.querySelectorAll(".terminal-symbol > div > button:last-child");
      buttons[ordered.indexOf(next)]?.focus();
    }
  }}>
    <thead><tr><th scope="col">Exch</th><th scope="col" className="terminal-symbol">Trading Symbol</th><th scope="col">Symbol</th>
      {TERMINAL_COLUMNS.map(column => <th key={column.id} scope="col" aria-sort={sort?.id === column.id ? sort.direction === 1 ? "ascending" : "descending" : "none"}>
        <button title={`Sort this page by ${column.label}`} onClick={() => setSort(previous => previous?.id === column.id && previous.direction === -1 ? null : { id: column.id, direction: previous?.id === column.id ? -1 : 1 })}>
          {column.label}{sort?.id === column.id && (sort.direction === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
        </button>
      </th>)}<th scope="col"><span className="sr-only">Watchlist</span></th>
    </tr></thead>
    <SortableContext items={ordered.map(row => row.id)} strategy={verticalListSortingStrategy}><tbody>
      {ordered.map(row => <TerminalRow key={row.id} contract={row} quote={quotes[row.id]} flashes={flashes} selected={selectedId === row.id}
        onSelect={() => onSelect(row)} onChart={() => onChart(row)} watched={watchedIds.includes(row.id)} onWatch={() => onWatch(row)} sortable={sortable && !sort} />)}
    </tbody></SortableContext>
  </table>;
}
