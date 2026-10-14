import { fireEvent, render, screen } from "@testing-library/react";
import Settings from "./settings";

test("each index has its own swing threshold, defaulting SENSEX lower", () => {
  const handleSettingsChange = jest.fn();
  render(<Settings settings={{ alertLotThresholds: { nifty: 400, banknifty: 300 } }} handleSettingsChange={handleSettingsChange} />);
  expect(screen.getByLabelText("NIFTY")).toHaveValue(400);
  expect(screen.getByLabelText("BANKNIFTY")).toHaveValue(300);
  expect(screen.getByLabelText("SENSEX")).toHaveValue(40);
  fireEvent.change(screen.getByLabelText("SENSEX"), { target: { value: "25" } });
  expect(handleSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ name: "alertLotThresholds.sensex" }) }));
});
