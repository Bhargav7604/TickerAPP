import { arrow, withArrow } from "./trend";
import { fpc, fpcBare } from "./boardData";
import { signedPct, signedPctBare } from "./indexStocksData";
import { formatChange } from "./equityData";
import { formatSignedOi } from "./oiData";

test("rises get an up arrow, falls a down arrow and flat or rounded-away moves none", () => {
  expect(arrow(1.2)).toBe("▲ ");
  expect(arrow(-0.4)).toBe("▼ ");
  expect(arrow(0)).toBe("");
  expect(arrow(0.004)).toBe("");
  expect(arrow(0.4, 0)).toBe("");
  expect(arrow("12")).toBe("▲ ");
  expect(arrow(NaN)).toBe("");
  expect(arrow(null)).toBe("");
  expect(withArrow(-3, "-3")).toBe("▼ -3");
});

test("every shared change formatter shows the arrow, and the bare forms leave it out", () => {
  expect(fpc(0.52)).toBe("▲ +0.52%");
  expect(fpc(-1.3)).toBe("▼ -1.30%");
  expect(fpcBare(-1.3)).toBe("-1.30%");
  expect(signedPct(2)).toBe("▲ +2.00%");
  expect(signedPctBare(2)).toBe("+2.00%");
  expect(formatChange(-0.25)).toBe("▼ -0.25%");
  expect(formatSignedOi(-1200)).toBe("▼ -1,200");
  expect(signedPct(null)).toBe("--");
});
