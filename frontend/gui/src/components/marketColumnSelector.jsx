import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, GripVertical, X } from "lucide-react";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DEFAULT_MARKET_COLUMNS, ESSENTIAL_MARKET_COLUMNS, MARKET_COLUMNS, selectedMarketColumns } from "../marketColumns";

const ALL_IDS = MARKET_COLUMNS.map(column => column.id);
const BY_ID = new Map(MARKET_COLUMNS.map(column => [column.id, column]));
const withHiddenColumns = ids => [...ids, ...ALL_IDS.filter(id => !ids.includes(id))];

function ColumnOption({ column, checked, index, count, disabled, onToggle, onMove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled });
  return <div ref={setNodeRef} className={"market-column-option" + (isDragging ? " is-dragging" : "")}
    style={{ transform: CSS.Transform.toString(transform), transition }} data-metric={column.id}>
    <button ref={setActivatorNodeRef} type="button" className="market-column-drag" disabled={disabled}
      {...attributes} {...listeners} aria-label={"Reorder " + column.label} title={"Drag to reorder " + column.label}><GripVertical size={18} /></button>
    <label><input type="checkbox" checked={checked} onChange={event => onToggle(column.id, event.target.checked)} />
      <span>{column.label}{column.unit && <small> ({column.unit})</small>}</span>
    </label>
    <div className="market-column-moves">
      <button type="button" disabled={disabled || index === 0} aria-label={"Move " + column.label + " up"}
        title="Move up" onClick={() => onMove(column.id, -1)}><ArrowUp size={17} /></button>
      <button type="button" disabled={disabled || index === count - 1} aria-label={"Move " + column.label + " down"}
        title="Move down" onClick={() => onMove(column.id, 1)}><ArrowDown size={17} /></button>
    </div>
  </div>;
}

function ColumnDialog({ value, onSave, onClose, returnFocus }) {
  const [draft, setDraft] = useState(() => selectedMarketColumns(value).map(column => column.id));
  const [order, setOrder] = useState(() => withHiddenColumns(draft));
  const [activeId, setActiveId] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef(null);
  const pending = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const preset = ids => { setDraft(ids); setOrder(withHiddenColumns(ids)); };
  const toggle = (id, checked) => setDraft(previous => checked ? [...previous, id] : previous.filter(value => value !== id));
  const move = (id, offset) => {
    const index = order.indexOf(id);
    const next = index + offset;
    if (pending.current || index < 0 || next < 0 || next >= order.length) return;
    setOrder(arrayMove(order, index, next));
    setAnnouncement(BY_ID.get(id).label + " moved to position " + (next + 1) + " of " + order.length + ".");
  };

  useEffect(() => {
    const previouslyFocused = returnFocus.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.querySelector("button").focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [returnFocus]);

  useEffect(() => { if (saving) dialog.current.focus(); }, [saving]);

  const save = async () => {
    if (pending.current || !draft.length) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(order.filter(id => draft.includes(id)));
      onClose();
    } catch (failure) {
      setError("Could not save your columns. Please try again.");
      pending.current = false;
      setSaving(false);
    }
  };

  const handleKeys = event => {
    if (event.key === "Escape") {
      if (activeId) return;
      event.preventDefault();
      if (!saving) onClose();
    }
    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };

  return <div className="market-columns-backdrop" onClick={event => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialog} className="market-columns-dialog" tabIndex={-1} role="dialog" aria-modal="true"
      aria-labelledby="market-columns-title" aria-busy={saving} onKeyDown={handleKeys}>
      <header><h2 id="market-columns-title">Market overview columns</h2>
        <button type="button" className="scan-icon-button" aria-label="Close column selector" title="Close" disabled={saving} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="market-columns-presets">
        <button type="button" disabled={saving} onClick={() => preset(ESSENTIAL_MARKET_COLUMNS)}>Essentials</button>
        <button type="button" disabled={saving} onClick={() => setDraft(order)}>Select all</button>
        <button type="button" disabled={saving} onClick={() => preset(DEFAULT_MARKET_COLUMNS)}>Reset to default</button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveId(active.id)} onDragCancel={() => setActiveId(null)}
        onDragEnd={({ active, over }) => {
          setActiveId(null);
          if (over && active.id !== over.id) move(active.id, order.indexOf(over.id) - order.indexOf(active.id));
        }}>
        <div className="market-columns-scroll"><fieldset disabled={saving} className="market-columns-options">
          <legend className="sr-only">Visible metrics and column order</legend>
          <label className="market-column-locked"><input type="checkbox" checked disabled readOnly />Index / Symbol <small>Always first</small></label>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map((id, index) => <ColumnOption key={id} column={BY_ID.get(id)} checked={draft.includes(id)}
              index={index} count={order.length} disabled={saving} onToggle={toggle} onMove={move} />)}
          </SortableContext>
        </fieldset></div>
        <DragOverlay dropAnimation={null}>{activeId && <div className="market-column-overlay" aria-hidden="true">
          <GripVertical size={18} /><strong>{BY_ID.get(activeId).label}</strong>
        </div>}</DragOverlay>
      </DndContext>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {!draft.length && <p role="alert">Select at least one metric.</p>}
      {error && <p role="alert">{error}</p>}
      <footer><span>{draft.length} of {MARKET_COLUMNS.length} metrics</span>
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="button" className="market-columns-save" disabled={saving || !draft.length} onClick={save}>{saving ? "Saving..." : "Save columns"}</button>
      </footer>
    </section>
  </div>;
}

export default function MarketColumnSelector({ value, onSave }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  return <div className="market-columns-control">
    <button ref={trigger} type="button" className="scan-icon-button" title="Customize columns" aria-label="Customize columns"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Columns3 size={20} /></button>
    {open && <ColumnDialog value={value} onSave={onSave} onClose={() => setOpen(false)} returnFocus={trigger} />}
  </div>;
}
