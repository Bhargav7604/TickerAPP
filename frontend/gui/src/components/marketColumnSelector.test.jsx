import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Dashboard from "./dashboard";
import { makeDesignData } from "../designFixtures";
import { DEFAULT_MARKET_COLUMNS, ESSENTIAL_MARKET_COLUMNS, MARKET_COLUMNS, selectedMarketColumns } from "../marketColumns";

function Harness({ save = async () => {}, initial }) {
  const [columns, setColumns] = useState(initial);
  const data = makeDesignData();
  return <Dashboard {...data} settings={{ ...data.settings, marketColumns: columns }} handleMarketColumnsSave={async selected => {
    await save(selected); setColumns(selected);
  }} />;
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "Customize columns" }));
const headings = () => within(screen.getByRole("region", { name: "Index comparison" })).getAllByRole("columnheader");
const draftOrder = () => [...screen.getByRole("dialog").querySelectorAll("[data-metric]")].map(row => row.dataset.metric);
const expectTableOrder = ids => {
  expect(headings().map(heading => heading.dataset.column)).toEqual([undefined, ...ids]);
  const rows = within(screen.getByRole("region", { name: "Index comparison" })).getAllByRole("row").slice(1);
  rows.forEach(row => expect(within(row).getAllByRole("cell").map(cell => cell.dataset.column)).toEqual(ids));
};

test("saved selections control every index row; index identity stays visible", async () => {
  const save = jest.fn();
  render(<Harness save={save} />);
  expect(headings()).toHaveLength(9);
  open();
  expect(screen.getByRole("checkbox", { name: /Index \/ Symbol/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Essentials" }));
  expect(headings()).toHaveLength(9);
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledWith(ESSENTIAL_MARKET_COLUMNS);
  expect(headings().map(heading => heading.dataset.column)).toEqual([undefined, "futures", "difference", "netLots"]);
  const rows = within(screen.getByRole("region", { name: "Index comparison" })).getAllByRole("row").slice(1);
  rows.forEach(row => expect(within(row).getAllByRole("cell")).toHaveLength(3));
  expect(screen.getByRole("button", { name: "Customize columns" })).toHaveFocus();
});

test("individual choices, all columns, reset, cancel and Escape preserve saved settings", () => {
  const save = jest.fn();
  render(<Harness save={save} initial={["spot"]} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getAllByRole("checkbox").filter(checkbox => checkbox.checked)).toHaveLength(13);
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  expect(screen.getAllByRole("checkbox").filter(checkbox => checkbox.checked)).toHaveLength(9);
  fireEvent.click(screen.getByRole("checkbox", { name: /Futures \(pts\)/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(headings()).toHaveLength(2);
  open();
  expect(screen.getByRole("checkbox", { name: "Spot (pts)" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Futures (pts)" })).not.toBeChecked();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

test("empty selections are prevented and keyboard focus stays inside the dialog", () => {
  render(<Harness initial={["spot"]} />);
  open();
  const close = screen.getByRole("button", { name: "Close column selector" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Save columns" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.click(screen.getByRole("checkbox", { name: "Spot (pts)" }));
  expect(screen.getByRole("button", { name: "Save columns" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Select at least one metric");
});

test("failed saves keep the old table and allow retry without losing the draft", async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce();
  render(<Harness save={save} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Essentials" }));
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(headings()).toHaveLength(9);
  expect(screen.getAllByRole("checkbox").filter(checkbox => checkbox.checked)).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  await waitFor(() => expect(headings()).toHaveLength(4));
});

test("persisted settings render on mount and malformed preferences fall back safely", () => {
  render(<Harness initial={MARKET_COLUMNS.map(column => column.id)} />);
  expect(headings()).toHaveLength(13);
  [null, undefined, [], ["unknown"], {}, "futures"].forEach(value => {
    expect(selectedMarketColumns(value).map(column => column.id)).toEqual(DEFAULT_MARKET_COLUMNS);
  });
  expect(selectedMarketColumns(["spot", "spot", "unknown"]).map(column => column.id)).toEqual(["spot"]);
  expect(selectedMarketColumns(["netLots", "futures", "netLots", "unknown"]).map(column => column.id)).toEqual(["netLots", "futures"]);
});

test("saved order aligns every header and cell, and arrow moves are applied only on Save", async () => {
  const save = jest.fn();
  render(<Harness save={save} initial={["netLots", "spot", "futures"]} />);
  expectTableOrder(["netLots", "spot", "futures"]);
  open();
  expect(screen.getByRole("button", { name: "Move Net lots up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Change down" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Move Spot up" }));
  expect(draftOrder().slice(0, 3)).toEqual(["spot", "netLots", "futures"]);
  expectTableOrder(["netLots", "spot", "futures"]);
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledWith(["spot", "netLots", "futures"]);
  expectTableOrder(["spot", "netLots", "futures"]);
  open();
  expect(draftOrder().slice(0, 3)).toEqual(["spot", "netLots", "futures"]);
  fireEvent.click(screen.getByRole("button", { name: "Move Spot down" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expectTableOrder(["spot", "netLots", "futures"]);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Move Spot down" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expectTableOrder(["spot", "netLots", "futures"]);
  expect(save).toHaveBeenCalledTimes(1);
});

test("toggling metrics preserves draft positions, select all retains order, and reset restores default order", async () => {
  const save = jest.fn();
  render(<Harness save={save} initial={["oi", "spot", "futures"]} />);
  open();
  const initial = draftOrder();
  fireEvent.click(screen.getByRole("checkbox", { name: "Spot (pts)" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Spot (pts)" }));
  expect(draftOrder()).toEqual(initial);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(draftOrder()).toEqual(initial);
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenLastCalledWith(initial);
  expectTableOrder(initial);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  expect(draftOrder()).toEqual(MARKET_COLUMNS.map(column => column.id));
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expectTableOrder(DEFAULT_MARKET_COLUMNS);
});

test("pending saves lock reordering and a failed save preserves reordered draft for retry", async () => {
  let rejectSave;
  const save = jest.fn().mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSave = reject; })).mockResolvedValueOnce();
  render(<Harness save={save} initial={["futures", "netLots"]} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Move Net lots up" }));
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  screen.getAllByRole("checkbox").forEach(checkbox => expect(checkbox).toBeDisabled());
  within(screen.getByRole("dialog")).getAllByRole("button").forEach(button => expect(button).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Saving..." }));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => rejectSave(new Error("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  expect(draftOrder().slice(0, 2)).toEqual(["netLots", "futures"]);
  expectTableOrder(["futures", "netLots"]);
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenLastCalledWith(["netLots", "futures"]);
  expectTableOrder(["netLots", "futures"]);
});
