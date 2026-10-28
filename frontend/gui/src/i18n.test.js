import { marketSummary, t, translate } from "./i18n";
import { answerQuestion } from "./components/home";

const card = { key: "nifty", label: "NIFTY", price: 22540.5, direction: { label: "Going up" }, bigPlayers: { label: "Big players are selling" },
  trap: { message: "Careful. This rise may not last. Don't chase it." }, light: { label: "Risky time. Better to wait." },
  range: { text: "NIFTY will most likely stay between 22,150 and 23,100 until expiry on 03 Nov (about a 2 in 3 chance)." } };

test("known sentences and templates translate to Hindi and Kannada", () => {
  expect(translate("Going up", "hi")).toBe("ऊपर जा रहा है");
  expect(translate("Going up", "kn")).toBe("ಮೇಲೆ ಏರುತ್ತಿದೆ");
  expect(translate("SENSEX options expire tomorrow.", "hi")).toBe("SENSEX ऑप्शन कल एक्सपायर होंगे।");
  expect(translate("In F&O ban today (no new positions allowed): SAIL.", "kn")).toContain("SAIL");
  expect(translate(card.range.text, "hi")).toBe("NIFTY के एक्सपायरी तक 22,150 और 23,100 के बीच रहने की सबसे ज़्यादा संभावना है (लगभग 3 में से 2 बार)।");
  expect(translate("NIFTY: Careful. This rise may not last. Don't chase it.", "kn")).toBe("NIFTY: ಎಚ್ಚರಿಕೆ. ಈ ಏರಿಕೆ ಉಳಿಯದಿರಬಹುದು. ಇದರ ಹಿಂದೆ ಓಡಬೇಡಿ.");
  expect(translate("Something new", "hi")).toBe("Something new");
  expect(translate("Going up", "en")).toBe("Going up");
  expect(t("Must know today", "kn")).toBe("ಇಂದು ತಿಳಿಯಲೇಬೇಕಾದದ್ದು");
});

test("summary for voice and WhatsApp, and spoken questions", () => {
  expect(marketSummary([card], "en")).toBe("NIFTY 22,541. Going up. Big players are selling. Careful. This rise may not last. Don't chase it. Risky time. Better to wait.");
  const other = { ...card, key: "sensex", label: "SENSEX" };
  expect(answerQuestion("what is nifty doing", [card, other], "en")).toMatch(/^NIFTY 22,541/);
  expect(answerQuestion("निफ्टी रेंज", [card, other], "hi")).toContain("22,150");
  expect(answerQuestion("hello", [card, other], "en").split("NIFTY").length).toBe(2);
});
