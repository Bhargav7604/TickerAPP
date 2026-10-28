import { fireEvent, render, screen, within } from "@testing-library/react";
import Dashboard from "./dashboard";
import { makeDesignData, PREVIEW_TIME } from "../designFixtures";

const setup = extra => {
  const props = { ...makeDesignData(), handleContractMonthChange: jest.fn(), handleDashboardRefresh: jest.fn(), ...extra };
  return { props, ...render(<Dashboard {...props} />) };
};

test("renders one comparison table with real metric units and selects the charted index", () => {
  setup();
  const comparison = screen.getByRole("region", { name: "Index comparison" });
  expect(within(comparison).getAllByRole("row")).toHaveLength(4);
  expect(screen.getByRole("columnheader", { name: /Away from VWAP.*pts/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Chart banknifty" }));
  expect(screen.getByLabelText("chart index")).toHaveValue("banknifty");
  expect(screen.getByRole("button", { name: "Chart banknifty" })).toHaveAttribute("aria-pressed", "true");
});

test("month controls delegate changes and never combine another contract's snapshots", () => {
  const { props, rerender } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  expect(props.handleContractMonthChange).toHaveBeenCalledWith("next");
  const next = makeDesignData("next");
  rerender(<Dashboard {...next} chartHistory={props.chartHistory} />);
  expect(screen.getByText("No snapshots in this window")).toBeInTheDocument();
  expect(screen.queryByText("NIFTY26OCTFUT")).not.toBeInTheDocument();
});

test("activity tabs expose the entire session and filter snapshots independently from the chart", () => {
  setup();
  fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));
  expect(screen.getByRole("tab", { name: "Snapshots" })).toHaveAttribute("aria-selected", "true");
  const table = screen.getByRole("table", { name: "Recent snapshots across all indices" });
  expect(within(table).getAllByRole("row")).toHaveLength(205);
  fireEvent.change(screen.getByLabelText("recent snapshots index"), { target: { value: "sensex" } });
  expect(within(table).getAllByRole("row")).toHaveLength(69);
  expect(within(table).getAllByText("09:00")).toHaveLength(1);
  expect(screen.getByLabelText("chart index")).toHaveValue("nifty");
});

test("activity tab keyboard controls keep focus and selection aligned", () => {
  setup();
  const alerts = screen.getByRole("tab", { name: "Swing alerts" });
  alerts.focus();
  fireEvent.keyDown(alerts, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Snapshots" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: "Home" });
  expect(alerts).toHaveFocus();
});

test("chart keyboard inspection shows selected time, index, net lots, and ratio", () => {
  setup();
  fireEvent.keyDown(screen.getByRole("group", { name: /five-minute chart/ }), { key: "End" });
  const readout = screen.getByLabelText("Selected chart sample");
  expect(readout).toHaveTextContent("14:35");
  expect(readout).toHaveTextContent("25,206.8");
  expect(readout).toHaveTextContent("+1,262");
  fireEvent.change(screen.getByLabelText("chart right metric"), { target: { value: "ratio" } });
  fireEvent.keyDown(screen.getByRole("group", { name: /five-minute chart/ }), { key: "End" });
  expect(readout).toHaveTextContent("Ratio");
  expect(readout).toHaveTextContent("1.18");
});

test("chart supports touch/pointer selection without needing a hover", () => {
  setup();
  const svg = screen.getByRole("img", { name: /NIFTY26OCTFUT index/ });
  jest.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 304 });
  fireEvent(svg, new MouseEvent("pointerdown", { bubbles: true, clientX: 740 }));
  expect(screen.getByLabelText("Selected chart sample")).toHaveTextContent("+1,262");
});

test("five-minute axis and full-session range remain available", () => {
  setup();
  fireEvent.change(screen.getByLabelText("chart time range"), { target: { value: "full" } });
  const svg = screen.getByRole("img", { name: /NIFTY26OCTFUT index/ });
  expect(within(svg).getByText("09:00")).toBeInTheDocument();
  expect(within(svg).getByText("09:05")).toBeInTheDocument();
  expect(within(svg).getByText("15:30")).toBeInTheDocument();
});

test("offline prices are shown as missing, not misleading zero quotes", () => {
  setup({ feedStatus: "offline", spotPrices: {} });
  const comparison = screen.getByRole("region", { name: "Index comparison" });
  const nifty = within(comparison).getAllByRole("row")[1];
  expect(within(nifty).getAllByRole("cell")[0]).toHaveTextContent(/^\-$/);
  expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
});

test("snapshot preview groups each index over the matching futures and net-lot columns", () => {
  setup();
  const preview = screen.getByRole("region", { name: "Five-minute snapshot preview" });
  const rows = within(preview).getAllByRole("row");
  const groups = within(rows[0]).getAllByRole("columnheader");
  expect(groups.map(header => header.textContent)).toEqual(["Time", "Nifty", "Banknifty", "Sensex"]);
  expect(groups[0]).toHaveAttribute("scope", "col");
  expect(groups[0]).toHaveAttribute("rowspan", "2");
  groups.slice(1).forEach(header => {
    expect(header).toHaveAttribute("scope", "colgroup");
    expect(header).toHaveAttribute("colspan", "2");
  });
  const metrics = within(rows[1]).getAllByRole("columnheader");
  expect(metrics.map(header => header.textContent)).toEqual(["Futures", "Net lots", "Futures", "Net lots", "Futures", "Net lots"]);
  metrics.forEach(header => expect(header).toHaveAttribute("scope", "col"));
  expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("14:35");
  expect(within(rows[2]).getAllByRole("cell").map(cell => cell.textContent)).toEqual([
    "25,206.8", "+1,262", "56,842.5", "-438", "82,614.7", "+214",
  ]);
});

test("swing alerts use each index's own threshold, count exact matches and list without popup alerts", () => {
  const data = makeDesignData();
  const series = (key, lots) => lots.map((netLots, i) => ({ symbol: data.settings.symbols[key].symbol,
    time: PREVIEW_TIME - (lots.length - 1 - i) * 300000, indexLevel: 100, netLots, ratio: 1 }));
  setup({
    settings: { ...data.settings, alertsEnabled: false, alertLotThresholds: { nifty: 400, banknifty: 400, sensex: 40 } },
    chartHistory: { nifty: series("nifty", [0, 399, 0]), banknifty: series("banknifty", [0, -400]), sensex: series("sensex", [0, 44, 30]) },
  });
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByText("Banknifty 5-min lot swing")).toBeInTheDocument();
  expect(within(panel).getByText("Sensex 5-min lot swing")).toBeInTheDocument();
  expect(within(panel).queryByText("Nifty 5-min lot swing")).not.toBeInTheDocument();
  expect(within(panel).getByText(/SENSEX 40 lots or more/)).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Swing alerts" })).toHaveTextContent("2");
});

test("live swing alerts are listed at once, merge into their window and the newest is highlighted", () => {
  const data = makeDesignData();
  const series = (key, lots) => lots.map((netLots, i) => ({ symbol: data.settings.symbols[key].symbol,
    time: PREVIEW_TIME - (lots.length - 1 - i) * 300000, indexLevel: 100, netLots, ratio: 1 }));
  const sensex = series("sensex", [0, 44, 30]);
  const banknifty = series("banknifty", [0, -400]);
  const live = { indexKey: "sensex", indexName: "Sensex", symbol: sensex[2].symbol, previousTime: sensex[2].time,
    time: sensex[2].time + 60000, previousNetLots: 30, currentNetLots: 154, swingLots: 124, threshold: 40 };
  const merged = { indexKey: "banknifty", indexName: "Banknifty", symbol: banknifty[0].symbol, previousTime: banknifty[0].time,
    time: banknifty[0].time + 120000, previousNetLots: 0, currentNetLots: -420, swingLots: -420, threshold: 400 };
  setup({
    settings: { ...data.settings, alertsEnabled: true, alertLotThresholds: { nifty: 400, banknifty: 400, sensex: 40 } },
    chartHistory: { nifty: series("nifty", [0, 0]), banknifty, sensex },
    swingAlerts: [merged, live],
  });
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByText(/Sound alerts are on/)).toBeInTheDocument();
  const latest = panel.querySelectorAll(".side-row.is-latest");
  expect(latest).toHaveLength(1);
  expect(latest[0]).toHaveTextContent("Latest");
  expect(latest[0]).toHaveTextContent("Live");
  expect(latest[0]).toHaveTextContent("+30 → +154 lots");
  expect(latest[0]).toHaveTextContent("+124 lots");
  const bank = within(panel).getByText("Banknifty 5-min lot swing").closest(".side-row");
  expect(bank).not.toHaveClass("is-latest");
  expect(bank).toHaveTextContent(/0 → -400 lots · alert at \d\d:\d\d/);
  expect(screen.getByRole("tab", { name: "Swing alerts" })).toHaveTextContent("3");
});
