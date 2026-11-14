// Shared data and calculations for the Market, Money Flow, Intraday and Tools pages.
// The market-feed worker publishes one snapshot of every NIFTY 500 and F&O stock; these functions turn it into
// the boards, lists and scores. Delivery %, FII/DII flows and the ban list are not available from Zerodha.
import { useEffect, useState } from "react";

export const FLAG = { N500: 1, FNO: 2, N50: 4, SX: 8 };
const finite = value => typeof value === "number" && Number.isFinite(value);
export const isNum = finite;

export function makeBoardApi(request) {
  async function get(route, signal) {
    const result = await request(route, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "Market data is unavailable right now.");
    return result;
  }
  return {
    snapshot: signal => get("board/snapshot/", signal),
    scanner: (bars, signal) => get(`board/scanner/?${new URLSearchParams({ bars })}`, signal),
    candles: (symbol, signal) => get(`board/candles/?${new URLSearchParams({ symbol })}`, signal),
  };
}

// ---- formatting ----------------------------------------------------------------------------------------------
export const pctOf = (value, base) => finite(value) && finite(base) && base ? (value - base) / base * 100 : NaN;
export const fp = value => !finite(value) ? "--" : value >= 1000
  ? value.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : value.toFixed(2);
export const fpc = value => finite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "--";
/** Rupees as crore: 1,234 Cr, 12.3 Cr, 1.2k Cr. */
export const crore = rupees => {
  if (!finite(rupees)) return "--";
  const value = rupees / 1e7;
  const size = Math.abs(value);
  return size >= 1000 ? `${(value / 1000).toFixed(1)}k` : size >= 100 ? value.toFixed(0) : value.toFixed(1);
};
export const signedCrore = rupees => finite(rupees) ? `${rupees >= 0 ? "+" : ""}${crore(rupees)}` : "--";
export const tone = value => finite(value) && value !== 0 ? (value > 0 ? "up" : "down") : "";
export const minuteClock = minute => { const total = 555 + minute; return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };

export const BUILD = {
  LB: { name: "Long build-up", read: "Price up and open interest up: fresh buying positions are being added. Bulls are in control." },
  SC: { name: "Short covering", read: "Price up but open interest falling: sellers are exiting shorts. The rise may fade once covering ends." },
  SB: { name: "Short build-up", read: "Price down and open interest up: fresh selling positions are being added. Bears are in control." },
  LU: { name: "Long unwinding", read: "Price down and open interest falling: buyers are booking out. Weakness without fresh shorts." },
  UP: { name: "Buying", read: "Price up. Cash-only stock, so there is no open interest to show who is behind the move." },
  DN: { name: "Selling", read: "Price down. Cash-only stock, so there is no open interest to show who is behind the move." },
};

/** One stock row from the snapshot, with the numbers every page needs. */
export function stockFrom(fields, values, paceFrac) {
  const st = Object.fromEntries(fields.map((field, i) => [field, values[i]]));
  st.n500 = Boolean(st.flags & FLAG.N500);
  st.fno = Boolean(st.flags & FLAG.FNO);
  st.n50 = Boolean(st.flags & FLAG.N50);
  st.sx = Boolean(st.flags & FLAG.SX);
  st.pc = pctOf(st.ltp, st.prev);
  st.oc = st.fno ? pctOf(st.oi, st.prevOi) : NaN;
  st.b = finite(st.oc) ? (st.pc >= 0 ? (st.oc >= 0 ? "LB" : "SC") : (st.oc >= 0 ? "SB" : "LU")) : (st.pc >= 0 ? "UP" : "DN");
  st.value = (finite(st.vwap) ? st.vwap : st.ltp) * (st.volume || 0);
  st.gap = pctOf(st.open, st.prev);
  st.surge = finite(st.avgVol) && st.avgVol > 0 && finite(st.volume) ? st.volume / (st.avgVol * Math.max(paceFrac || 1, 1 / 375)) : NaN;
  st.mom = pctOf(st.ltp, st.p30);
  st.band = finite(st.uc) && finite(st.prev) && st.prev ? Math.round((st.uc - st.prev) / st.prev * 100) : NaN;
  return st;
}

export function decodeSnapshot(data) {
  const fields = data?.fields || [];
  const stocks = (data?.rows || []).map(row => stockFrom(fields, row, data.paceFrac)).filter(st => finite(st.pc));
  const indices = (data?.indices || []).map(ix => ({ ...ix, pc: pctOf(ix.ltp, ix.prev) }));
  return {
    status: data?.status || "offline", message: data?.message || "", session: data?.session || null, asOf: data?.asOf || null,
    minute: data?.minute ?? null, paceFrac: data?.paceFrac ?? 1, stocks, indices,
    idx: Object.fromEntries(indices.map(ix => [ix.key, ix])), bySym: Object.fromEntries(stocks.map(st => [st.sym, st])),
    pcr: data?.pcr ?? null, weights: data?.weights || {}, calendar: data?.calendar || [], holidays: data?.holidays || {},
  };
}

// ---- filters -------------------------------------------------------------------------------------------------
export const SEGMENTS = [
  ["all", "All (NIFTY 500 + F&O)", () => true],
  ["n500", "Nifty 500", st => st.n500],
  ["fno", "F&O stocks", st => st.fno],
  ["n50", "Nifty 50", st => st.n50],
  ["sx", "Sensex 30", st => st.sx],
  ["cash", "Cash only (no F&O)", st => !st.fno],
  ["beyond", "F&O outside Nifty 500", st => !st.n500],
  ["intra", "⚡ Intraday picks", (st, picks) => picks.has(st.sym)],
];
export const CAPS = [["all", "All caps"], ["Large", "Large cap"], ["Mid", "Mid cap"], ["Small", "Small cap"]];
export const inView = (st, segment = "all", cap = "all", picks = new Set()) =>
  (SEGMENTS.find(([key]) => key === segment) || SEGMENTS[0])[2](st, picks) && (cap === "all" || st.cap === cap);
export const segmentLabel = (segment, cap) => `${(SEGMENTS.find(([key]) => key === segment) || SEGMENTS[0])[1]}${cap === "all" ? "" : ` · ${cap} cap`}`;

// ---- the Money Flow board ------------------------------------------------------------------------------------
export const CONDS = [
  { id: "chg", name: "% Change", sub: "day movers", thr: 0.1, score: st => st.pc, fmt: v => fpc(v) },
  { id: "oi", name: "OI Build-up", sub: "F&O · fresh positions", thr: 0.05, need: "open interest (F&O names only)",
    score: st => !finite(st.oc) ? NaN : st.oc > 0 ? st.pc * Math.min(st.oc, 25) : 0, fmt: (v, st) => `OI ${st.oc >= 0 ? "+" : ""}${st.oc.toFixed(1)}%` },
  { id: "del", name: "Delivery", sub: "cash · shares taken home", thr: 0.5, need: "delivery % (NSE publishes it after the close; Zerodha does not supply it)",
    score: () => NaN, fmt: v => String(v) },
  { id: "vol", name: "Volume Surge", sub: "× normal pace", thr: 0.5, need: "average volume",
    score: st => finite(st.surge) ? (st.surge >= 1.5 ? Math.sign(st.pc || 1) * st.surge : 0) : NaN, fmt: v => `${Math.abs(v).toFixed(1)}×` },
  { id: "brk", name: "Breakout", sub: "vs previous day range", thr: 0, need: "yesterday's high and low",
    score: st => !finite(st.prevH) || !finite(st.prevL) ? NaN : st.ltp > st.prevH ? (st.ltp - st.prevH) / st.prev * 100
      : st.ltp < st.prevL ? (st.ltp - st.prevL) / st.prev * 100 : 0,
    fmt: v => v === 0 ? "inside range" : `${v > 0 ? "PDH" : "PDL"} ${fpc(v)}` },
  { id: "vwap", name: "VWAP Position", sub: "price vs VWAP", thr: 0.15, need: "VWAP", score: st => pctOf(st.ltp, st.vwap), fmt: v => fpc(v) },
  { id: "mom", name: "Momentum", sub: "last 30 minutes", thr: 0.1, need: "30 minutes of live prices", score: st => st.mom, fmt: v => fpc(v) },
];
export const topN = count => Math.max(8, Math.min(30, Math.round(count / 15)));

export function analyse(rows) {
  const TOPN = topN(rows.length);
  const conds = CONDS.map(cond => {
    const scored = rows.map(st => ({ st, v: cond.score(st) })).filter(x => finite(x.v));
    const bulls = scored.filter(x => x.v > cond.thr).sort((a, b) => b.v - a.v);
    const bears = scored.filter(x => x.v < -cond.thr).sort((a, b) => a.v - b.v);
    return { ...cond, avail: scored.length > 0, bulls, bears, bTop: bulls.slice(0, TOPN), sTop: bears.slice(0, TOPN) };
  });
  const nAvail = conds.filter(cond => cond.avail).length;
  const need = Math.max(2, Math.ceil(nAvail / 2));
  const mem = Object.fromEntries(rows.map(st => [st.sym, { bull: new Set(), bear: new Set() }]));
  conds.forEach(cond => {
    if (!cond.avail) return;
    cond.bTop.forEach(x => mem[x.st.sym].bull.add(cond.id));
    cond.sTop.forEach(x => mem[x.st.sym].bear.add(cond.id));
  });
  const strongB = [], strongS = [], nearB = [], nearS = [];
  rows.forEach(st => {
    const M = mem[st.sym], b = M.bull.size, s = M.bear.size;
    if (b >= need && b > s) strongB.push(st);
    else if (s >= need && s > b) strongS.push(st);
    else {
      if (b === need - 1 && b > s) nearB.push(st);
      if (s === need - 1 && s > b) nearS.push(st);
    }
  });
  const byBull = (a, b) => mem[b.sym].bull.size - mem[a.sym].bull.size || b.pc - a.pc;
  const byBear = (a, b) => mem[b.sym].bear.size - mem[a.sym].bear.size || a.pc - b.pc;
  strongB.sort(byBull); strongS.sort(byBear); nearB.sort(byBull); nearS.sort(byBear);
  const members = Object.values(mem);
  const sectors = {};
  rows.forEach(st => {
    const row = sectors[st.sector] = sectors[st.sector] || { sector: st.sector, n: 0, net: 0 };
    row.n += 1;
    row.net += mem[st.sym].bull.size - mem[st.sym].bear.size;
  });
  return {
    rows, conds, nAvail, need, mem, strongB, strongS, nearB, nearS, TOPN,
    inBull: members.filter(M => M.bull.size > 0).length, inBear: members.filter(M => M.bear.size > 0).length,
    sectors: Object.values(sectors).sort((a, b) => b.net - a.net),
  };
}

/** A plain-English line about the strong lists and the tape. */
export function readLine(A, viewLabel, clock) {
  const count = list => Object.entries(list.reduce((acc, st) => ({ ...acc, [st.sector]: (acc[st.sector] || 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).map(([sector]) => sector);
  const names = list => list.length ? ` (${list.slice(0, 2).map(st => st.sym).join(", ")}${list.length > 2 ? ` +${list.length - 2}` : ""})` : "";
  const up = A.rows.filter(st => st.pc > 0.1).length, down = A.rows.filter(st => st.pc < -0.1).length;
  const tape = up / (up + down || 1) > 0.65 ? "a strong bullish tape" : down / (up + down || 1) > 0.65 ? "a heavy tape" : "a two-way tape";
  const bulls = count(A.strongB), bears = count(A.strongS);
  return {
    bulls: bulls.length ? `${bulls.slice(0, 2).join(" and ")} lead the strong bulls${names(A.strongB)}.` : "No name has enough agreement to be a strong bull.",
    bears: bears.length ? `${bears.slice(0, 2).join(" and ")} lead the bears${names(A.strongS)}.` : "No strong bears right now.",
    tape: `Viewing ${viewLabel}: ${up} up · ${down} down — ${tape}${clock ? ` at ${clock}` : ""}.`,
  };
}

// ---- sector smart-money flow ---------------------------------------------------------------------------------
export const FLOW_TAGS = { in: "SMART MONEY IN", acc: "ACCUMULATING", neu: "NEUTRAL", dis: "DISTRIBUTING", out: "SMART MONEY OUT" };

/** Signed turnover by sector, scored on flow, last-30-minute flow, share above VWAP and futures build-up. */
export function sectorFlow(rows) {
  const sectors = {};
  rows.forEach(st => {
    const o = sectors[st.sector] = sectors[st.sector] || { sector: st.sector, n: 0, flow: 0, flow30: 0, value: 0, vw: 0, above: 0,
      fno: 0, lb: 0, sb: 0, sc: 0, lu: 0, up: 0, down: 0, best: null, worst: null };
    o.n += 1;
    o.flow += (st.flow || 0) / 1e7;
    o.flow30 += (st.flow30 || 0) / 1e7;
    o.value += (st.value || 0) / 1e7;
    if (finite(st.vwap)) { o.vw += 1; if (st.ltp > st.vwap) o.above += 1; }
    if (finite(st.oc)) { o.fno += 1; o[st.b.toLowerCase()] += 1; }
    if (st.pc > 0.1) o.up += 1; else if (st.pc < -0.1) o.down += 1;
    if (!o.best || st.pc > o.best.pc) o.best = st;
    if (!o.worst || st.pc < o.worst.pc) o.worst = st;
  });
  const list = Object.values(sectors);
  const topFlow = Math.max(1e-9, ...list.map(o => Math.abs(o.flow)));
  const top30 = Math.max(1e-9, ...list.map(o => Math.abs(o.flow30)));
  list.forEach(o => {
    o.vwP = o.vw ? o.above / o.vw : 0.5;
    const oiBalance = o.fno ? (o.lb - o.sb) / o.fno : 0;
    o.score = (35 * o.flow / topFlow + 20 * o.flow30 / top30 + 40 * (o.vwP - 0.5) + 15 * oiBalance) / 0.9;
    o.tag = o.score >= 35 ? "in" : o.score >= 15 ? "acc" : o.score <= -35 ? "out" : o.score <= -15 ? "dis" : "neu";
  });
  return list.sort((a, b) => b.score - a.score);
}

export function flowRead(list) {
  if (!list.length) return "No sectors in view.";
  const inflow = list.filter(o => o.tag === "in" || o.tag === "acc").slice(0, 3).map(o => o.sector);
  const outflow = list.filter(o => o.tag === "out" || o.tag === "dis").slice(-3).reverse().map(o => o.sector);
  const parts = [];
  if (inflow.length) parts.push(`Money is flowing into ${inflow.join(", ")}`);
  if (outflow.length) parts.push(`${parts.length ? "and" : "Money is"} leaving ${outflow.join(", ")}`);
  const by30 = [...list].sort((a, b) => b.flow30 - a.flow30);
  const first = by30[0], last = by30[by30.length - 1];
  if (first && last && first !== last && first.flow30 > 0 && last.flow30 < 0) {
    parts.push(`. Last 30 min: rotating out of ${last.sector} into ${first.sector}`);
  }
  return parts.length ? `${parts.join(" ")}.`.replace(" .", ".") : "No clear sector rotation yet.";
}

// ---- market mood ---------------------------------------------------------------------------------------------
export function moodScore(stocks, idx, pcr, sectors) {
  const adv = stocks.filter(st => st.pc > 0.1).length, dec = stocks.filter(st => st.pc < -0.1).length;
  const vix = idx.INDIAVIX;
  const inflow = sectors.filter(o => o.score >= 15).length, outflow = sectors.filter(o => o.score <= -15).length;
  const parts = [
    ["Breadth", adv + dec ? (adv - dec) / (adv + dec) * 100 : NaN, 0.35 / 0.8, `${adv} up · ${dec} down`],
    ["India VIX", vix && finite(vix.pc) ? -vix.pc * 8 : NaN, 0.15 / 0.8, vix ? fpc(vix.pc) : "--"],
    ["Nifty PCR", finite(pcr) ? (pcr - 1) * 120 : NaN, 0.15 / 0.8, finite(pcr) ? pcr.toFixed(2) : "--"],
    ["Sector money", sectors.length ? (inflow - outflow) / sectors.length * 100 : NaN, 0.15 / 0.8, `${inflow} in · ${outflow} out`],
  ].map(([name, value, weight, note]) => ({ name, value: Math.max(-100, Math.min(100, value)), weight, note })).filter(p => finite(p.value));
  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  const score = total ? parts.reduce((sum, p) => sum + p.value * p.weight, 0) / total : 0;
  const label = score > 50 ? "Strong bullish" : score > 18 ? "Bullish" : score < -50 ? "Strong bearish" : score < -18 ? "Bearish" : "Neutral / range";
  return { score, label, parts, adv, dec };
}

// ---- market movers and breadth -------------------------------------------------------------------------------
export const MOVERS = [
  ["gain", "Gainers", list => [...list].sort((a, b) => b.pc - a.pc), st => `₹${crore(st.value)} Cr traded`],
  ["lose", "Losers", list => [...list].sort((a, b) => a.pc - b.pc), st => `₹${crore(st.value)} Cr traded`],
  ["value", "Most active ₹", list => [...list].sort((a, b) => b.value - a.value), st => `₹${crore(st.value)} Cr`],
  ["vol", "Volume shockers", list => list.filter(st => st.surge >= 2).sort((a, b) => b.surge - a.surge), st => `${st.surge.toFixed(1)}× pace`],
  ["gapu", "Gap up", list => list.filter(st => st.gap >= 0.75).sort((a, b) => b.gap - a.gap), st => `gap ${fpc(st.gap)}`],
  ["gapd", "Gap down", list => list.filter(st => st.gap <= -0.75).sort((a, b) => a.gap - b.gap), st => `gap ${fpc(st.gap)}`],
  ["hi52", "52W high", list => list.filter(st => st.hi52 > 0 && st.ltp >= st.hi52 * 0.985).sort((a, b) => b.ltp / b.hi52 - a.ltp / a.hi52),
    st => st.ltp >= st.hi52 ? "NEW HIGH" : `${(st.ltp / st.hi52 * 100 - 100).toFixed(1)}% away`],
  ["lo52", "52W low", list => list.filter(st => st.lo52 > 0 && st.ltp <= st.lo52 * 1.015).sort((a, b) => a.ltp / a.lo52 - b.ltp / b.lo52),
    st => st.ltp <= st.lo52 ? "NEW LOW" : `${(st.ltp / st.lo52 * 100 - 100).toFixed(1)}% away`],
  ["uc", "Upper circuit", list => list.filter(st => !st.fno && finite(st.uc) && st.ltp >= st.uc * 0.985).sort((a, b) => b.pc - a.pc),
    st => `${st.ltp >= st.uc ? "LOCKED" : "near"} · ${st.band}% band`],
  ["lc", "Lower circuit", list => list.filter(st => !st.fno && finite(st.lc) && st.ltp <= st.lc * 1.015).sort((a, b) => a.pc - b.pc),
    st => `${st.ltp <= st.lc ? "LOCKED" : "near"} · ${st.band}% band`],
];

const advance = list => {
  const up = list.filter(st => st.pc > 0.1).length, down = list.filter(st => st.pc < -0.1).length;
  return { up, down, flat: list.length - up - down, n: list.length };
};
export function breadthGroups(stocks) {
  return [["All", () => true], ["Sensex 30", st => st.sx], ["Nifty 50", st => st.n50], ["Nifty 500", st => st.n500], ["F&O", st => st.fno],
    ["Cash only", st => !st.fno], ["Large cap", st => st.cap === "Large"], ["Mid cap", st => st.cap === "Mid"], ["Small cap", st => st.cap === "Small"]]
    .map(([label, test]) => ({ label, ...advance(stocks.filter(test)) })).filter(group => group.n);
}
export function capRead(groups) {
  const large = groups.find(g => g.label === "Large cap"), small = groups.find(g => g.label === "Small cap");
  if (!large?.n || !small?.n) return "";
  const gap = small.up / small.n - large.up / large.n;
  return gap > 0.15 ? "Small caps are outperforming: risk appetite is broad."
    : gap < -0.15 ? "Large caps are holding up better than small caps: money is hiding in quality." : "Large and small caps are moving together.";
}

// ---- who moves the index -------------------------------------------------------------------------------------
/** Index points each stock adds today, from the app's fitted weights (index points per rupee of the stock). */
export function contributions(indexKey, snapshot) {
  const coefficients = snapshot.weights?.[indexKey === "SENSEX" ? "sensex" : "nifty"] || {};
  const index = snapshot.idx[indexKey];
  const list = Object.entries(coefficients).map(([sym, coef]) => {
    const st = snapshot.bySym[sym];
    if (!st || !finite(st.ltp) || !finite(st.prev)) return null;
    return { st, pts: coef * (st.ltp - st.prev), weight: index?.prev ? coef * st.prev / index.prev * 100 : NaN };
  }).filter(Boolean);
  return { list, index, total: list.reduce((sum, x) => sum + x.pts, 0) };
}

// ---- levels --------------------------------------------------------------------------------------------------
export function levelsOf(H, L, C) {
  const P = (H + L + C) / 3, BC = (H + L) / 2, TC = 2 * P - BC, R = H - L;
  return { P, TC: Math.max(TC, BC), BC: Math.min(TC, BC), R1: 2 * P - L, S1: 2 * P - H, R2: P + R, S2: P - R,
    R3: H + 2 * (P - L), S3: L - 2 * (H - P), H3: C + R * 1.1 / 4, H4: C + R * 1.1 / 2, L3: C - R * 1.1 / 4, L4: C - R * 1.1 / 2 };
}
/** Nearest support and resistance among yesterday's pivots and today's range. */
export function stockLevels(st) {
  if (!finite(st.prevH) || !finite(st.prevL) || !finite(st.prev)) return null;
  const L = levelsOf(st.prevH, st.prevL, st.prev);
  const candidates = [L.S2, L.S1, L.P, L.R1, L.R2, st.prevH, st.prevL, st.low, st.high].filter(finite);
  const below = candidates.filter(x => x < st.ltp * 0.999), above = candidates.filter(x => x > st.ltp * 1.001);
  return { ...L, sup: below.length ? Math.max(...below) : st.low, res: above.length ? Math.min(...above) : st.high };
}
export function cprRead(L, x) {
  return x > L.R1 ? "above R1 — strong" : x > L.TC ? "above CPR — bullish bias" : x < L.S1 ? "below S1 — weak"
    : x < L.BC ? "below CPR — bearish bias" : "inside CPR — wait for a break";
}

// ---- intraday scanner ----------------------------------------------------------------------------------------
export const INDICATORS = [
  ["vwap", "VWAP", "price vs VWAP"], ["ema", "EMA 9/21", "fast vs slow average"], ["st", "Supertrend", "10, 3"],
  ["rsi", "RSI 14", ">55 bull · <45 bear"], ["macd", "MACD", "histogram 12/26/9"], ["orb", "Opening range", "first 15 min break"],
  ["cpr", "CPR", "vs central pivot range"], ["pdhl", "PDH / PDL", "previous day high/low"], ["vol", "Volume", "vs normal pace"],
  ["oi", "OI build-up", "F&O only"], ["rs", "Rel. strength", "vs Nifty"], ["dr", "Day range", "where price sits"], ["sec", "Sector flow", "money into its sector"],
];
const CORE = ["vwap", "st", "ema"];

export function indicatorText(id, side, detail = []) {
  switch (id) {
    case "vwap": return `${fpc(detail[0])} vs VWAP`;
    case "ema": return side > 0 ? "9 above 21" : "9 below 21";
    case "st": return `${side > 0 ? "up" : "down"} · stop ${fp(detail[0])}`;
    case "rsi": return finite(detail[0]) ? detail[0].toFixed(0) : "--";
    case "macd": return finite(detail[0]) ? `${detail[0] > 0 ? "+" : ""}${detail[0].toFixed(2)}` : "--";
    case "orb": return side > 0 ? `above ${fp(detail[0])}` : side < 0 ? `below ${fp(detail[1])}` : `inside ${fp(detail[1])}–${fp(detail[0])}`;
    case "cpr": return side > 0 ? "above CPR" : side < 0 ? "below CPR" : "inside CPR";
    case "pdhl": return side > 0 ? `above PDH ${fp(detail[0])}` : side < 0 ? `below PDL ${fp(detail[1])}` : "inside yesterday";
    case "vol": return finite(detail[0]) ? `${detail[0].toFixed(1)}× pace` : "--";
    case "oi": return `${BUILD[detail[0]]?.name || detail[0]} ${detail[1] >= 0 ? "+" : ""}${finite(detail[1]) ? detail[1].toFixed(1) : "--"}%`;
    case "rs": return `${fpc(detail[0])} vs Nifty`;
    case "dr": return `${detail[0]}% of range`;
    case "sec": return (FLOW_TAGS[detail[0]] || "").toLowerCase();
    default: return "";
  }
}

/** {sym: checks} from the scanner response: each check is {side, text}. */
export function decodeScanner(data) {
  const out = {};
  (data?.rows || []).forEach(([sym, sides, details, stop, target]) => {
    const checks = {};
    INDICATORS.forEach(([id], i) => {
      const mark = sides[i];
      if (mark === ".") return;
      const side = mark === "+" ? 1 : mark === "-" ? -1 : 0;
      checks[id] = { side, text: indicatorText(id, side, details?.[id]) };
    });
    const values = Object.values(checks);
    const bull = values.filter(c => c.side > 0).length, bear = values.filter(c => c.side < 0).length;
    out[sym] = { checks, bull, bear, avail: values.length, side: bull > bear ? 1 : bear > bull ? -1 : 0, stop, target,
      rsi: details?.rsi?.[0] ?? NaN };
  });
  return out;
}

export const liquid = st => st.fno || st.avgVol * st.ltp / 1e7 >= 25 || st.value / 1e7 >= 25;

/** Long and short setups in the file's rules: the core three agree, enough of all 13 agree, few disagree. */
export function scanSetups(stocks, scan, { side = "both", minPct = 80, volume = false, liquidOnly = true } = {}) {
  const out = [];
  stocks.forEach(st => {
    const q = scan[st.sym];
    if (!q || q.avail < 6 || (liquidOnly && !liquid(st))) return;
    const core = dir => CORE.every(id => !q.checks[id] || q.checks[id].side === dir) && CORE.some(id => q.checks[id]);
    const volumeOk = dir => !volume || q.checks.vol?.side === dir;
    const allowed = minPct >= 80 ? 1 : 2;
    const longOk = q.bull / q.avail * 100 >= minPct && q.bear <= allowed && core(1) && volumeOk(1);
    const shortOk = q.bear / q.avail * 100 >= minPct && q.bull <= allowed && core(-1) && volumeOk(-1);
    if (longOk && side !== "short") out.push({ st, q, side: 1 });
    else if (shortOk && side !== "long") out.push({ st, q, side: -1 });
  });
  const share = o => (o.side > 0 ? o.q.bull : o.q.bear) / o.q.avail;
  return out.sort((a, b) => share(b) - share(a) || Math.abs(b.st.pc) - Math.abs(a.st.pc));
}

export const TIME_ZONES = [
  [0, 15, "Opening range forms", "avoid"], [15, 135, "Trend window", "go"], [135, 255, "Lunch chop", "slow"],
  [255, 330, "Europe opens · second move", "go"], [330, 360, "No fresh entries", "avoid"], [360, 375, "Square-off 15:15–15:30", "avoid"],
];
export const sessionMinute = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(part => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) - 555;
};

// ---- polling -------------------------------------------------------------------------------------------------
/** Repeats `fn` every `delay` ms while the tab is visible, until the returned stop function runs. */
function poll(fn, delay) {
  let stopped = false;
  let timer = null;
  const abort = new AbortController();
  const run = async () => {
    if (stopped) return;
    if (document.visibilityState !== "hidden") await fn(abort.signal, () => stopped);
    if (!stopped) timer = setTimeout(run, delay);
  };
  run();
  return () => { stopped = true; abort.abort(); clearTimeout(timer); };
}

/** Polls the snapshot (and optionally the scanner) while the tab is visible. Changing the bar size refetches only the scanner. */
export function useBoard(api, { scannerBars = null, every = 5000, scannerEvery = 30000 } = {}) {
  const [state, setState] = useState({ snapshot: null, scan: {}, scanMeta: null, error: "", loading: true });
  useEffect(() => poll(async (signal, stopped) => {
    try {
      const data = await api.snapshot(signal);
      if (!stopped()) setState(previous => ({ ...previous, snapshot: decodeSnapshot(data), error: "", loading: false }));
    } catch (exc) {
      if (!stopped() && exc.name !== "AbortError") setState(previous => ({ ...previous, error: exc.message, loading: false }));
    }
  }, every), [api, every]);
  useEffect(() => {
    if (!scannerBars) return undefined;
    return poll(async (signal, stopped) => {
      try {
        const data = await api.scanner(scannerBars, signal);
        if (!stopped()) setState(previous => ({ ...previous, scan: decodeScanner(data), scanMeta: { minute: data.minute, message: data.message, bars: data.bars } }));
      } catch (exc) {
        if (!stopped() && exc.name !== "AbortError") setState(previous => ({ ...previous, scanMeta: { message: exc.message } }));
      }
    }, scannerEvery);
  }, [api, scannerBars, scannerEvery]);
  return state;
}
