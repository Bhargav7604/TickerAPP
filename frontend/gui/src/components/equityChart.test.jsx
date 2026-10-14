import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import EquityChart from "./equityChart";
import { ThemeProvider, useTheme } from "../theme";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), CandlestickSeries: "candlestick", LineSeries: "line", HistogramSeries: "histogram", ColorType: { Solid: "solid" } }));
const Toggle = () => { const { toggleTheme } = useTheme(); return <button onClick={toggleTheme}>Theme</button>; };

test("changing theme recolors the chart without discarding its zoom or data", () => {
  localStorage.clear();
  const price = { setData: jest.fn(), applyOptions: jest.fn() };
  const volume = { ...price, setData: jest.fn(), applyOptions: jest.fn(), priceScale: () => ({ applyOptions: jest.fn() }) };
  const fitContent = jest.fn();
  const chart = { addSeries: type => type === "line" ? price : volume, applyOptions: jest.fn(), timeScale: () => ({ fitContent }), subscribeCrosshairMove: jest.fn(), remove: jest.fn() };
  createChart.mockReturnValue(chart);
  const originalObserver = window.ResizeObserver;
  window.ResizeObserver = class { observe() {} disconnect() {} };
  try {
    const view = render(<ThemeProvider><Toggle /><EquityChart contract={{ id: "test", symbol: "TEST", underlying: "TEST" }} candles={[{ time: 1234, close: 100, volume: 5 }]} /></ThemeProvider>);
    expect(chart.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ background: { type: "solid", color: "#ffffff" } }) }));
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(chart.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ background: { type: "solid", color: "#202124" } }) }));
    expect(price.applyOptions).toHaveBeenLastCalledWith({ color: "#78a9ff" });
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(price.setData).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(chart.remove).toHaveBeenCalledTimes(1);
  } finally { window.ResizeObserver = originalObserver; delete document.documentElement.dataset.theme; }
});

test("terminal renders actual OHLC candles on a black chart and closes on demand", () => {
  const price = { setData: jest.fn(), applyOptions: jest.fn() };
  const volume = { setData: jest.fn(), applyOptions: jest.fn(), priceScale: () => ({ applyOptions: jest.fn() }) };
  const chart = { addSeries: jest.fn(type => type === "candlestick" ? price : volume), applyOptions: jest.fn(), timeScale: () => ({ fitContent: jest.fn() }), subscribeCrosshairMove: jest.fn(), remove: jest.fn() };
  createChart.mockReturnValue(chart);
  const originalObserver = window.ResizeObserver;
  window.ResizeObserver = class { observe() {} disconnect() {} };
  const onClose = jest.fn();
  try {
    const view = render(<EquityChart contract={{ id: "test", symbol: "TEST", underlying: "TEST" }} candles={[{ time: 1234, open: 99, high: 102, low: 98, close: 100, volume: 5 }]} terminal onClose={onClose} />);
    expect(chart.addSeries).toHaveBeenCalledWith("candlestick", expect.anything());
    expect(price.setData).toHaveBeenCalledWith([{ time: 1234, open: 99, high: 102, low: 98, close: 100 }]);
    expect(chart.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ background: { type: "solid", color: "#000000" } }) }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse chart panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally { window.ResizeObserver = originalObserver; }
});
