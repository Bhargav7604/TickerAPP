// English, Hindi and Kannada for the trader-facing summaries. The server writes English;
// known sentences are translated here so a trader can switch language instantly.
export const LANGUAGES = [["en", "English", "en-IN"], ["hi", "हिन्दी", "hi-IN"], ["kn", "ಕನ್ನಡ", "kn-IN"]];
export const LANGUAGE_KEY = "utraders-language";

const PHRASES = {
  "Going up": { hi: "ऊपर जा रहा है", kn: "ಮೇಲೆ ಏರುತ್ತಿದೆ" },
  "Going down": { hi: "नीचे जा रहा है", kn: "ಕೆಳಗೆ ಇಳಿಯುತ್ತಿದೆ" },
  "Going nowhere": { hi: "कहीं नहीं जा रहा", kn: "ಎಲ್ಲಿಗೂ ಹೋಗುತ್ತಿಲ್ಲ" },
  "Big players are buying": { hi: "बड़े निवेशक खरीद रहे हैं", kn: "ದೊಡ್ಡ ಹೂಡಿಕೆದಾರರು ಖರೀದಿಸುತ್ತಿದ್ದಾರೆ" },
  "Big players are selling": { hi: "बड़े निवेशक बेच रहे हैं", kn: "ದೊಡ್ಡ ಹೂಡಿಕೆದಾರರು ಮಾರುತ್ತಿದ್ದಾರೆ" },
  "Big players are not clearly on one side": { hi: "बड़े निवेशक साफ़ तौर पर किसी एक तरफ़ नहीं हैं", kn: "ದೊಡ್ಡ ಹೂಡಿಕೆದಾರರು ಯಾವುದೇ ಒಂದು ಕಡೆ ಸ್ಪಷ್ಟವಾಗಿಲ್ಲ" },
  "Careful. This rise may not last. Don't chase it.": { hi: "सावधान। यह तेज़ी शायद टिके नहीं। इसके पीछे मत भागिए।", kn: "ಎಚ್ಚರಿಕೆ. ಈ ಏರಿಕೆ ಉಳಿಯದಿರಬಹುದು. ಇದರ ಹಿಂದೆ ಓಡಬೇಡಿ." },
  "Careful. This fall may not last. Don't chase it.": { hi: "सावधान। यह गिरावट शायद टिके नहीं। इसके पीछे मत भागिए।", kn: "ಎಚ್ಚರಿಕೆ. ಈ ಇಳಿಕೆ ಉಳಿಯದಿರಬಹುದು. ಇದರ ಹಿಂದೆ ಓಡಬೇಡಿ." },
  "Good time to trade.": { hi: "ट्रेड के लिए अच्छा समय।", kn: "ವಹಿವಾಟಿಗೆ ಒಳ್ಳೆಯ ಸಮಯ." },
  "Unclear. Trade small.": { hi: "स्थिति साफ़ नहीं। छोटा ट्रेड करें।", kn: "ಸ್ಪಷ್ಟವಾಗಿಲ್ಲ. ಸಣ್ಣದಾಗಿ ವಹಿವಾಟು ಮಾಡಿ." },
  "Risky time. Better to wait.": { hi: "जोखिम भरा समय। रुकना बेहतर है।", kn: "ಅಪಾಯಕಾರಿ ಸಮಯ. ಕಾಯುವುದು ಒಳ್ಳೆಯದು." },
  "Market closed": { hi: "बाज़ार बंद है", kn: "ಮಾರುಕಟ್ಟೆ ಮುಚ್ಚಿದೆ" },
  "The market is closed. Cards show the last trading session.": { hi: "बाज़ार बंद है। कार्ड पिछले कारोबारी सत्र का हाल दिखा रहे हैं।", kn: "ಮಾರುಕಟ್ಟೆ ಮುಚ್ಚಿದೆ. ಕಾರ್ಡ್‌ಗಳು ಕಳೆದ ವಹಿವಾಟಿನ ಮಾಹಿತಿ ತೋರಿಸುತ್ತಿವೆ." },
  "First 15 minutes of the day: prices jump around. Many traders wait.": { hi: "दिन के पहले 15 मिनट: भाव ऊपर-नीचे उछलते हैं। कई ट्रेडर इंतज़ार करते हैं।", kn: "ದಿನದ ಮೊದಲ 15 ನಿಮಿಷ: ಬೆಲೆಗಳು ಏರಿಳಿಯುತ್ತವೆ. ಅನೇಕ ವ್ಯಾಪಾರಿಗಳು ಕಾಯುತ್ತಾರೆ." },
  "Could not load today's F&O ban list from NSE.": { hi: "आज की F&O बैन सूची NSE से नहीं मिल सकी।", kn: "ಇಂದಿನ F&O ನಿಷೇಧ ಪಟ್ಟಿಯನ್ನು NSE ಯಿಂದ ಪಡೆಯಲಾಗಲಿಲ್ಲ." },
  "Last hour of expiry. Prices can jump fast. Keep your exit ready or stay out.": { hi: "एक्सपायरी का आखिरी घंटा। भाव तेज़ी से उछल सकते हैं। निकलने की तैयारी रखें या दूर रहें।", kn: "ಎಕ್ಸ್‌ಪೈರಿಯ ಕೊನೆಯ ಗಂಟೆ. ಬೆಲೆಗಳು ವೇಗವಾಗಿ ಜಿಗಿಯಬಹುದು. ನಿರ್ಗಮನಕ್ಕೆ ಸಿದ್ಧರಾಗಿರಿ ಅಥವಾ ದೂರವಿರಿ." },
  "Utraders describes the market. It does not tell you to buy or sell. F&O trading is high risk and most traders lose money. Please talk to a SEBI-registered adviser before you invest.": {
    hi: "Utraders बाज़ार का हाल बताता है। यह खरीदने या बेचने की सलाह नहीं देता। F&O ट्रेडिंग में बहुत जोखिम है और ज़्यादातर ट्रेडर पैसा गंवाते हैं। निवेश से पहले SEBI-पंजीकृत सलाहकार से बात करें।",
    kn: "Utraders ಮಾರುಕಟ್ಟೆಯ ಸ್ಥಿತಿಯನ್ನು ವಿವರಿಸುತ್ತದೆ. ಇದು ಖರೀದಿಸಲು ಅಥವಾ ಮಾರಲು ಹೇಳುವುದಿಲ್ಲ. F&O ವಹಿವಾಟು ಹೆಚ್ಚು ಅಪಾಯಕಾರಿ, ಹೆಚ್ಚಿನ ವ್ಯಾಪಾರಿಗಳು ಹಣ ಕಳೆದುಕೊಳ್ಳುತ್ತಾರೆ. ಹೂಡಿಕೆಗೆ ಮುನ್ನ SEBI-ನೋಂದಾಯಿತ ಸಲಹೆಗಾರರೊಂದಿಗೆ ಮಾತನಾಡಿ.",
  },
};

const PATTERNS = [
  [/^(.+) options expire today\. After 2:30 pm prices can jump very fast\.$/,
    { hi: "$1 ऑप्शन आज एक्सपायर हो रहे हैं। दोपहर 2:30 के बाद भाव बहुत तेज़ी से उछल सकते हैं।", kn: "$1 ಆಪ್ಷನ್‌ಗಳು ಇಂದು ಅವಧಿ ಮುಗಿಯುತ್ತವೆ. ಮಧ್ಯಾಹ್ನ 2:30 ನಂತರ ಬೆಲೆಗಳು ತುಂಬಾ ವೇಗವಾಗಿ ಜಿಗಿಯಬಹುದು." }],
  [/^(.+) options expire tomorrow\.$/, { hi: "$1 ऑप्शन कल एक्सपायर होंगे।", kn: "$1 ಆಪ್ಷನ್‌ಗಳು ನಾಳೆ ಅವಧಿ ಮುಗಿಯುತ್ತವೆ." }],
  [/^In F&O ban today \(no new positions allowed\): (.+)\.$/, { hi: "आज F&O बैन में (नई पोज़िशन की अनुमति नहीं): $1।", kn: "ಇಂದು F&O ನಿಷೇಧದಲ್ಲಿ (ಹೊಸ ಪೊಸಿಷನ್‌ಗೆ ಅವಕಾಶವಿಲ್ಲ): $1." }],
  [/^Our data is late \(last update (.+) IST\)\. Numbers may be old, so please don't rely on them\.$/,
    { hi: "हमारा डेटा देर से आ रहा है (आखिरी अपडेट $1 IST)। आंकड़े पुराने हो सकते हैं, इन पर भरोसा न करें।", kn: "ನಮ್ಮ ಡೇಟಾ ತಡವಾಗಿದೆ (ಕೊನೆಯ ಅಪ್‌ಡೇಟ್ $1 IST). ಸಂಖ್ಯೆಗಳು ಹಳೆಯವಾಗಿರಬಹುದು, ಅವುಗಳನ್ನು ನಂಬಬೇಡಿ." }],
  [/^(.+) will most likely stay between ([\d,]+) and ([\d,]+) until .+ \(about a 2 in 3 chance\)\.$/,
    { hi: "$1 के एक्सपायरी तक $2 और $3 के बीच रहने की सबसे ज़्यादा संभावना है (लगभग 3 में से 2 बार)।", kn: "$1 ಎಕ್ಸ್‌ಪೈರಿವರೆಗೆ $2 ಮತ್ತು $3 ರ ನಡುವೆ ಇರುವ ಸಾಧ್ಯತೆ ಹೆಚ್ಚು (ಸುಮಾರು 3 ರಲ್ಲಿ 2 ಬಾರಿ)." }],
  [/^(.+) is rising and big players agree\.$/, { hi: "$1 ऊपर जा रहा है और बड़े निवेशक भी साथ हैं।", kn: "$1 ಏರುತ್ತಿದೆ ಮತ್ತು ದೊಡ್ಡ ಹೂಡಿಕೆದಾರರೂ ಒಪ್ಪುತ್ತಿದ್ದಾರೆ." }],
  [/^(.+) is falling and big players agree\.$/, { hi: "$1 नीचे जा रहा है और बड़े निवेशक भी साथ हैं।", kn: "$1 ಇಳಿಯುತ್ತಿದೆ ಮತ್ತು ದೊಡ್ಡ ಹೂಡಿಕೆದಾರರೂ ಒಪ್ಪುತ್ತಿದ್ದಾರೆ." }],
  [/^([A-Z]+): (.+)$/, null],
];

const UI = {
  "Today's market": { hi: "आज का बाज़ार", kn: "ಇಂದಿನ ಮಾರುಕಟ್ಟೆ" },
  "Know the trend. Spot the trap. Protect your money.": { hi: "रुख़ जानिए। जाल पहचानिए। अपना पैसा बचाइए।", kn: "ದಿಕ್ಕು ತಿಳಿಯಿರಿ. ಬಲೆ ಗುರುತಿಸಿ. ನಿಮ್ಮ ಹಣ ಉಳಿಸಿ." },
  "Must know today": { hi: "आज ज़रूर जानें", kn: "ಇಂದು ತಿಳಿಯಲೇಬೇಕಾದದ್ದು" },
  "More details": { hi: "और जानकारी", kn: "ಹೆಚ್ಚಿನ ವಿವರ" },
  "Hide details": { hi: "जानकारी छिपाएँ", kn: "ವಿವರ ಮರೆಮಾಡಿ" },
  "Expiry calendar": { hi: "एक्सपायरी कैलेंडर", kn: "ಎಕ್ಸ್‌ಪೈರಿ ಕ್ಯಾಲೆಂಡರ್" },
  "Market often stops falling near": { hi: "बाज़ार अक्सर यहाँ गिरना रोकता है:", kn: "ಮಾರುಕಟ್ಟೆ ಸಾಮಾನ್ಯವಾಗಿ ಇಲ್ಲಿ ಇಳಿಯುವುದನ್ನು ನಿಲ್ಲಿಸುತ್ತದೆ:" },
  "Market often stops rising near": { hi: "बाज़ार अक्सर यहाँ चढ़ना रोकता है:", kn: "ಮಾರುಕಟ್ಟೆ ಸಾಮಾನ್ಯವಾಗಿ ಇಲ್ಲಿ ಏರುವುದನ್ನು ನಿಲ್ಲಿಸುತ್ತದೆ:" },
  "Listen": { hi: "सुनिए", kn: "ಕೇಳಿ" },
  "Ask": { hi: "पूछिए", kn: "ಕೇಳಿ (ಪ್ರಶ್ನೆ)" },
  "Share on WhatsApp": { hi: "WhatsApp पर भेजें", kn: "WhatsApp ನಲ್ಲಿ ಹಂಚಿ" },
  "Words": { hi: "शब्दकोश", kn: "ಪದಕೋಶ" },
  "Latest swing alert": { hi: "ताज़ा स्विंग अलर्ट", kn: "ಇತ್ತೀಚಿನ ಸ್ವಿಂಗ್ ಅಲರ್ಟ್" },
  "lots": { hi: "लॉट", kn: "ಲಾಟ್" },
  "See all swing alerts": { hi: "सभी स्विंग अलर्ट देखें", kn: "ಎಲ್ಲಾ ಸ್ವಿಂಗ್ ಅಲರ್ಟ್ ನೋಡಿ" },
};

export function translate(text, lang) {
  if (!text || lang === "en") return text;
  if (PHRASES[text]?.[lang]) return PHRASES[text][lang];
  for (const [pattern, out] of PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    if (out === null) return `${match[1]}: ${translate(match[2], lang)}`;
    if (out[lang]) return out[lang].replace(/\$(\d)/g, (_, index) => match[Number(index)] || "");
  }
  return text;
}

export const t = (text, lang) => (lang !== "en" && UI[text]?.[lang]) || text;

export const GLOSSARY = [
  ["OI", "Open interest", "How many option or futures contracts are still open. Rising OI means new money is coming in.", "खुले सौदे: कितने कॉन्ट्रैक्ट अभी खुले हैं। OI बढ़ना यानी नया पैसा आ रहा है।", "ಓಪನ್ ಇಂಟರೆಸ್ಟ್: ಎಷ್ಟು ಒಪ್ಪಂದಗಳು ಇನ್ನೂ ತೆರೆದಿವೆ. OI ಏರಿದರೆ ಹೊಸ ಹಣ ಬರುತ್ತಿದೆ."],
  ["PCR", "Put-call ratio", "Put open interest divided by call open interest. Above 1 usually means more put selling (support below).", "पुट OI को कॉल OI से भाग। 1 से ऊपर मतलब नीचे सहारा।", "ಪುಟ್ OI ಅನ್ನು ಕಾಲ್ OI ಇಂದ ಭಾಗಿಸಿದ್ದು. 1 ಕ್ಕಿಂತ ಹೆಚ್ಚು ಎಂದರೆ ಕೆಳಗೆ ಬೆಂಬಲ."],
  ["IV", "Implied volatility", "How much movement option prices expect. High IV means options are costly.", "ऑप्शन के भाव में अपेक्षित उतार-चढ़ाव। ज़्यादा IV यानी ऑप्शन महँगे।", "ಆಪ್ಷನ್ ಬೆಲೆಯಲ್ಲಿ ನಿರೀಕ್ಷಿತ ಏರಿಳಿತ. ಹೆಚ್ಚು IV ಎಂದರೆ ಆಪ್ಷನ್ ದುಬಾರಿ."],
  ["VWAP", "Average traded price", "Today's average price weighted by volume. Above it, buyers are in control.", "आज का वॉल्यूम के हिसाब से औसत भाव। इसके ऊपर खरीदार हावी।", "ಇಂದಿನ ವಹಿವಾಟಿನ ಸರಾಸರಿ ಬೆಲೆ. ಇದರ ಮೇಲೆ ಖರೀದಿದಾರರ ಹಿಡಿತ."],
  ["Expiry", "Expiry day", "The last day a contract trades. Option prices move fastest that day.", "कॉन्ट्रैक्ट का आखिरी दिन। उस दिन ऑप्शन के भाव सबसे तेज़ बदलते हैं।", "ಒಪ್ಪಂದದ ಕೊನೆಯ ದಿನ. ಅಂದು ಆಪ್ಷನ್ ಬೆಲೆಗಳು ವೇಗವಾಗಿ ಬದಲಾಗುತ್ತವೆ."],
  ["Lot", "Lot size", "The fixed number of units in one contract, e.g. 65 for NIFTY.", "एक कॉन्ट्रैक्ट में तय यूनिट, जैसे NIFTY में 65।", "ಒಂದು ಒಪ್ಪಂದದಲ್ಲಿನ ನಿಗದಿತ ಘಟಕಗಳು, ಉದಾ. NIFTY ಗೆ 65."],
  ["Strike", "Strike price", "The price at which an option can be used.", "वह भाव जिस पर ऑप्शन इस्तेमाल हो सकता है।", "ಆಪ್ಷನ್ ಬಳಸಬಹುದಾದ ಬೆಲೆ."],
  ["ATM", "At the money", "The strike closest to today's price.", "आज के भाव के सबसे पास वाला स्ट्राइक।", "ಇಂದಿನ ಬೆಲೆಗೆ ಹತ್ತಿರದ ಸ್ಟ್ರೈಕ್."],
  ["Build-up", "Long/short build-up", "Price up and OI up = buyers adding (long). Price down and OI up = sellers adding (short).", "भाव और OI दोनों बढ़ें = खरीदार जोड़ रहे। भाव घटे, OI बढ़े = बेचने वाले जोड़ रहे।", "ಬೆಲೆ ಮತ್ತು OI ಏರಿದರೆ ಖರೀದಿದಾರರು ಸೇರಿಸುತ್ತಿದ್ದಾರೆ. ಬೆಲೆ ಇಳಿದು OI ಏರಿದರೆ ಮಾರಾಟಗಾರರು."],
  ["Decay", "Time decay (theta)", "Money an option loses every hour just because time passes.", "समय बीतने से ऑप्शन हर घंटे जितना पैसा खोता है।", "ಸಮಯ ಕಳೆದಂತೆ ಆಪ್ಷನ್ ಪ್ರತಿ ಗಂಟೆ ಕಳೆದುಕೊಳ್ಳುವ ಹಣ."],
  ["Stop", "Stop-loss", "The price where you exit if the trade goes wrong, so the loss stays small.", "वह भाव जहाँ गलत होने पर आप निकल जाते हैं, ताकि नुकसान छोटा रहे।", "ವಹಿವಾಟು ತಪ್ಪಾದರೆ ನಷ್ಟ ಕಡಿಮೆ ಇರಲು ಹೊರಬರುವ ಬೆಲೆ."],
  ["Margin", "Margin", "Money the broker blocks before you can sell options or trade futures.", "ऑप्शन बेचने या फ्यूचर्स के लिए ब्रोकर जितना पैसा रोकता है।", "ಆಪ್ಷನ್ ಮಾರಲು ಅಥವಾ ಫ್ಯೂಚರ್ಸ್‌ಗೆ ಬ್ರೋಕರ್ ತಡೆಹಿಡಿಯುವ ಹಣ."],
];

export function glossaryText(entry, lang) {
  const [term, name, en, hi, kn] = entry;
  return { term, name, meaning: lang === "hi" ? hi : lang === "kn" ? kn : en };
}

export function speechLang(lang) {
  return (LANGUAGES.find(([key]) => key === lang) || LANGUAGES[0])[2];
}

export function readLanguage() {
  try { return localStorage.getItem(LANGUAGE_KEY) || "en"; } catch { return "en"; }
}

export function saveLanguage(lang) {
  try { localStorage.setItem(LANGUAGE_KEY, lang); } catch { /* language still switches for this visit */ }
}

// One short market summary per index, used for voice and WhatsApp sharing.
export function marketSummary(cards, lang) {
  return cards.map(card => [
    `${card.label} ${Math.round(card.price || 0).toLocaleString("en-IN")}.`,
    `${translate(card.direction.label, lang)}.`,
    `${translate(card.bigPlayers.label, lang)}.`,
    card.trap ? translate(card.trap.message, lang) : "",
    translate(card.light.label, lang),
  ].filter(Boolean).join(" ")).join("\n");
}
