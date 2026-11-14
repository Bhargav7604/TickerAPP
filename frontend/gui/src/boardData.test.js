import { CONDS, MOVERS, analyse, breadthGroups, contributions, crore, decodeScanner, decodeSnapshot, flowRead, inView, levelsOf,
  moodScore, readLine, scanSetups, sectorFlow, stockFrom, stockLevels } from "./boardData";
import { makeBoardSnapshot, makeScanner } from "./boardFixtures";

const snapshot = () => decodeSnapshot(makeBoardSnapshot());

test("decodes the snapshot into stocks with change, build-up, surge and flags", () => {
  const data = snapshot();
  expect(data.stocks.length).toBe(145);
  const hdfc = data.bySym.HDFCBANK;
  expect([hdfc.n500, hdfc.fno, hdfc.n50, hdfc.sx, hdfc.cap]).toEqual([true, true, true, true, "Large"]);
  expect(hdfc.pc).toBeCloseTo((hdfc.ltp - hdfc.prev) / hdfc.prev * 100);
  expect(["LB", "SB", "SC", "LU"]).toContain(hdfc.b);
  const cash = data.stocks.find(st => !st.fno);
  expect(["UP", "DN"]).toContain(cash.b);
  expect(Number.isNaN(cash.oc)).toBe(true);
  const st = stockFrom(["sym", "ltp", "prev", "volume", "avgVol", "open", "uc", "flags"], ["X", 110, 100, 500, 2000, 101, 120, 1], 0.5);
  expect([st.pc, st.surge, st.gap, st.band]).toEqual([10, 0.5, 1, 20]);
  expect(data.idx.INDIAVIX.pc).toBeLessThan(0);
  expect(crore(12.34e7)).toBe("12.3");
  expect(crore(-123456e7)).toBe("-123.5k");
});

test("filters by segment and cap", () => {
  const { stocks } = snapshot();
  expect(stocks.filter(st => inView(st, "sx")).length).toBe(30);
  expect(stocks.filter(st => inView(st, "n50", "Large")).length).toBe(50);
  expect(stocks.filter(st => inView(st, "intra", "all", new Set(["INFY"]))).map(st => st.sym)).toEqual(["INFY"]);
  expect(stocks.every(st => inView(st, "cash") === !st.fno)).toBe(true);
});

test("the board ranks names into bull and bear lists and finds strong names", () => {
  const { stocks } = snapshot();
  const A = analyse(stocks);
  expect(A.conds.map(c => [c.id, c.avail])).toEqual([["chg", true], ["oi", true], ["del", false], ["vol", true], ["brk", true], ["vwap", true], ["mom", true]]);
  expect([A.nAvail, A.need, A.TOPN]).toEqual([6, 3, 10]);
  expect(A.strongB.length).toBeGreaterThan(0);
  expect(A.strongS.length).toBeGreaterThan(0);
  A.strongB.forEach(st => expect(A.mem[st.sym].bull.size).toBeGreaterThanOrEqual(3));
  const chg = A.conds[0];
  expect(chg.bTop[0].v).toBeGreaterThanOrEqual(chg.bTop[1].v);
  expect(A.sectors[0].net).toBeGreaterThanOrEqual(A.sectors[A.sectors.length - 1].net);
  const line = readLine(A, "All", "14:20");
  expect(line.tape).toMatch(/^Viewing All: \d+ up · \d+ down — a .* tape at 14:20\.$/);
  expect(CONDS.find(c => c.id === "del").need).toMatch(/Zerodha/);
});

test("sector flow, mood, movers and breadth", () => {
  const data = snapshot();
  const sectors = sectorFlow(data.stocks);
  expect(sectors[0].score).toBeGreaterThan(sectors[sectors.length - 1].score);
  expect(sectors.map(s => s.sector)).toContain("IT");
  expect(["in", "acc", "neu", "dis", "out"]).toContain(sectors[0].tag);
  expect(flowRead(sectors)).toMatch(/\.$/);
  const mood = moodScore(data.stocks, data.idx, data.pcr, sectors);
  expect(mood.parts.map(p => p.name)).toEqual(["Breadth", "India VIX", "Nifty PCR", "Sector money"]);
  expect(mood.score).toBeGreaterThanOrEqual(-100);
  const movers = Object.fromEntries(MOVERS.map(([key, , pick]) => [key, pick(data.stocks)]));
  expect(movers.gain[0].pc).toBeGreaterThanOrEqual(movers.gain[1].pc);
  expect(movers.hi52.map(st => st.sym)).toContain("INFY");
  expect(movers.lo52.map(st => st.sym)).toContain("TATASTEEL");
  expect(movers.uc.every(st => !st.fno)).toBe(true);
  const groups = breadthGroups(data.stocks);
  expect(groups[0]).toEqual(expect.objectContaining({ label: "All", n: 145 }));
  expect(groups.find(g => g.label === "Sensex 30").n).toBe(30);
});

test("index contributions, levels and support/resistance", () => {
  const data = snapshot();
  const c = contributions("NIFTY", data);
  expect(c.list.length).toBe(50);
  expect(c.list.find(x => x.st.sym === "HDFCBANK").weight).toBeGreaterThan(c.list.find(x => x.st.sym === "WIPRO").weight);
  expect(contributions("SENSEX", data).list).toEqual([]);
  const L = levelsOf(24120, 23860, 23980);
  expect(L.P).toBeCloseTo(23986.67, 1);
  expect(L.R1).toBeCloseTo(24113.33, 1);
  expect(L.TC).toBeGreaterThanOrEqual(L.BC);
  expect(L.H4).toBeCloseTo(23980 + 260 * 1.1 / 2);
  const st = { ltp: 100, prev: 99, prevH: 101, prevL: 97, high: 100.5, low: 98.5 };
  const levels = stockLevels(st);
  expect(levels.sup).toBeLessThan(100);
  expect(levels.res).toBeGreaterThan(100);
  expect(stockLevels({ ltp: 1 })).toBeNull();
});

test("scanner rows decode into checks and setups follow the agreement rules", () => {
  const data = snapshot();
  const scan = decodeScanner(makeScanner(3));
  const first = scan.HDFCBANK;
  expect(first.checks.vwap.side).toBe(1);
  expect(first.checks.vwap.text).toMatch(/vs VWAP$/);
  expect(first.side).toBe(1);
  expect(first.avail).toBe(13);
  const setups = scanSetups(data.stocks, scan, { minPct: 70 });
  expect(setups.length).toBeGreaterThan(0);
  setups.forEach(({ q, side }) => {
    expect(["vwap", "st", "ema"].every(id => q.checks[id].side === side)).toBe(true);
    expect((side > 0 ? q.bull : q.bear) / q.avail).toBeGreaterThanOrEqual(0.7);
  });
  expect(scanSetups(data.stocks, scan, { minPct: 70, side: "long" }).every(o => o.side === 1)).toBe(true);
  expect(scanSetups(data.stocks, scan, { minPct: 90 }).length).toBeLessThanOrEqual(setups.length);
});
