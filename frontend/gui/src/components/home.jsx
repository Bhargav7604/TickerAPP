import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Collapse, IconButton, Paper, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, BookOpen, CalendarDays, ChartScatter, ChevronDown, Info, Mic, Share2, ShieldAlert, Users, Volume2 } from "lucide-react";
import { GLOSSARY, glossaryText, LANGUAGES, marketSummary, readLanguage, saveLanguage, speechLang, t, translate } from "../i18n";
import { mono, PageShell, Segmented } from "../ui/Glass";

const REFRESH_MS = 30000;
const LIGHTS = ["red", "yellow", "green"];
const LIGHT_COLORS = { red: "#e0445a", yellow: "#e2a72e", green: "#0e9f6e", grey: "#9aa3b5" };
const LIGHT_SOFT = { red: "rgba(224,68,90,0.12)", yellow: "rgba(226,167,46,0.16)", green: "rgba(14,159,110,0.12)", grey: "rgba(154,163,181,0.16)" };
const DIRECTION_ICONS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };
const LEVEL_ICONS = { danger: ShieldAlert, warning: AlertTriangle, info: Info };
const LEVEL_COLORS = { danger: "error.main", warning: "warning.main", info: "info.main" };

const money = value => Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
const whole = value => Number.isFinite(value) ? Math.round(value).toLocaleString("en-IN") : "--";
const clock = seconds => seconds ? new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "--:--";
const day = seconds => new Date(seconds * 1000).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });

const signed = value => `${value > 0 ? "+" : ""}${whole(value)}`;
const sameDay = (ms, now) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }) === new Date(now).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" });

// One page grid: summary tiles, must-know and calendar from Home, and the market desk sections
// (bar, compare, chart, activity, preview, acdd) placed by name from the Dashboard.
const GRID_AREAS = {
  xs: `"tiles" "know" "bar" "compare" "chart" "activity" "preview" "cal" "acdd"`,
  md: `"tiles tiles" "know cal" "bar bar" "compare compare" "chart chart" "preview preview" "activity activity" "acdd acdd"`,
  lg: `"tiles tiles tiles know" "bar bar bar bar" "compare compare compare cal" "chart chart chart activity" "preview preview preview activity" "acdd acdd acdd acdd"`,
};
const GRID_COLUMNS = { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr)) minmax(340px, 1.1fr)" };

// Replaces the old centre-screen popup: one quiet line that updates in place.
function LatestSwing({ alert, lang, onSeeAll }) {
  const up = alert.swingLots > 0;
  return <Paper component="section" aria-label={t("Latest swing alert", lang)} aria-live="polite" key={`${alert.indexKey}-${alert.time}`}
    sx={{ mb: 2, px: 2, py: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", bgcolor: "background.tint", boxShadow: "none",
      animation: "swingIn 1.2s ease-out 2", "@keyframes swingIn": { "0%": { backgroundColor: "rgba(245,184,61,0.35)" } } }}>
    <Box sx={{ color: "primary.main", display: "flex" }}><BellRing size={18} aria-hidden="true" /></Box>
    <Typography variant="overline" color="text.secondary">{t("Latest swing alert", lang)}</Typography>
    <Typography sx={{ ...mono, color: "text.secondary", fontSize: 13 }}>{clock(alert.time / 1000)}</Typography>
    <Typography sx={{ ...mono, fontWeight: 800, color: up ? "success.main" : "error.main" }}>{alert.indexName.toUpperCase()} {signed(alert.swingLots)} {t("lots", lang)}</Typography>
    <Typography sx={{ ...mono, color: "text.secondary", fontSize: 13 }}>{signed(alert.previousNetLots)} → {signed(alert.currentNetLots)} · {alert.symbol}</Typography>
    <Button size="small" onClick={onSeeAll} sx={{ ml: { sm: "auto" } }}>{t("See all swing alerts", lang)}</Button>
  </Paper>;
}

export function countdown(totalSeconds) {
  if (totalSeconds <= 0) return "closed";
  const hours = Math.floor(totalSeconds / 3600), minutes = Math.floor(totalSeconds % 3600 / 60), seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function TrafficLight({ color }) {
  return <Box aria-hidden="true" sx={{ display: "inline-flex", flexDirection: "column", gap: "3px", p: "5px", borderRadius: 2, bgcolor: "#16203a", flex: "none" }}>
    {LIGHTS.map(lamp => <Box key={lamp} component="span" sx={{
      width: 11, height: 11, borderRadius: "50%", bgcolor: LIGHT_COLORS[lamp], opacity: lamp === color ? 1 : 0.22,
      boxShadow: lamp === color ? `0 0 10px ${LIGHT_COLORS[lamp]}` : "none",
    }} />)}
  </Box>;
}

function RangeBar({ range }) {
  const span = range.high - range.low || 1;
  const at = value => `${Math.min(100, Math.max(0, (value - range.low) / span * 100))}%`;
  const inside = value => Number.isFinite(value) && value >= range.low && value <= range.high;
  const mark = (value, color) => <Box component="span" sx={{ position: "absolute", top: -4, left: at(value), width: 3, height: 18, ml: "-1.5px", borderRadius: 1, bgcolor: color }} />;
  return <Box aria-hidden="true">
    <Box sx={{ position: "relative", height: 10, borderRadius: 999, background: "linear-gradient(90deg, #2bb3ad, #4a8fe7 55%, #5b6ee1)", opacity: 0.9 }}>
      {inside(range.support) && mark(range.support, "success.main")}
      {inside(range.resistance) && mark(range.resistance, "error.main")}
      <Box component="span" sx={{ position: "absolute", top: "50%", left: at(range.spot), width: 16, height: 16, ml: "-8px", transform: "translateY(-50%)", borderRadius: "50%", bgcolor: "background.paper", border: "3px solid", borderColor: "text.primary", boxShadow: "0 2px 6px rgba(20,33,61,0.25)" }} />
    </Box>
    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75, ...mono, fontSize: 12, color: "text.secondary" }}>
      <span>{whole(range.low)}</span><span>{whole(range.high)}</span>
    </Stack>
  </Box>;
}

function Fact({ label, icon: Icon, color, children }) {
  return <Box component="li" sx={{ minWidth: 0, px: 1.25, py: 0.9, borderRadius: 2.5, bgcolor: "background.subtle" }}>
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary" }}>{label}</Typography>
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
      <Box sx={{ color, display: "flex", flex: "none" }}><Icon size={16} aria-hidden="true" /></Box>
      <Typography sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{children}</Typography>
    </Stack>
  </Box>;
}

const IndexCard = React.memo(function IndexCard({ card, lang, onOpenStocks }) {
  const [open, setOpen] = useState(false);
  const Direction = DIRECTION_ICONS[card.direction.code] || ArrowRight;
  const change = card.change;
  const changeColor = change && change.value !== 0 ? (change.value > 0 ? "success.main" : "error.main") : "text.secondary";
  const expiry = card.expiry;
  const lightColor = card.light.color;
  const factColor = code => ({ up: "success.main", buying: "success.main", down: "error.main", selling: "error.main" }[code] || "text.secondary");
  return <Paper component="article" aria-label={`${card.label} summary`} className={`home-card is-${lightColor}${open ? " is-details-open" : ""}`}
    sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0, scrollSnapAlign: "start" }}>
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="h2" component="h2" sx={{ fontSize: "1.05rem" }}>{card.label}</Typography>
          {expiry && <Chip size="small" color={expiry.isToday ? "error" : "default"} variant={expiry.isToday ? "filled" : "outlined"}
            label={expiry.isToday ? t("Expires today", lang) : `${t("Expiry", lang)} ${new Date(expiry.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`} />}
        </Stack>
      </Box>
      <Box sx={{ textAlign: "right", flex: "none" }}>
        <Typography sx={{ ...mono, fontSize: "1.2rem", fontWeight: 800, lineHeight: 1.2 }}>{money(card.price)}</Typography>
        {change && <Typography sx={{ ...mono, fontSize: 11.5, fontWeight: 700, color: changeColor }}>
          {change.value > 0 ? "+" : ""}{money(change.value)} ({change.pct > 0 ? "+" : ""}{change.pct}%) {t(change.since === "open" ? "since open" : "today", lang)}
        </Typography>}
      </Box>
    </Stack>
    <Typography variant="caption" sx={{ display: "block", mt: -0.75, color: card.late ? "error.main" : "text.secondary", fontWeight: card.late ? 700 : 500 }}>
      {card.late ? `${t("Data is late · last update", lang)} ${day(card.asOf)} ${clock(card.asOf)}` : card.live ? `${t("Live", lang)} · ${clock(card.asOf)} IST` : `${t("Updated", lang)} ${clock(card.asOf)} IST`}
    </Typography>

    <Stack direction="row" alignItems="center" spacing={1.25} role="status"
      sx={{ px: 1.25, py: 0.9, borderRadius: 2.5, bgcolor: LIGHT_SOFT[lightColor] || LIGHT_SOFT.grey, color: lightColor === "yellow" ? theme => (theme.palette.mode === "dark" ? "#f2c787" : "#8a5a0d") : LIGHT_COLORS[lightColor] || "text.secondary" }}>
      <TrafficLight color={lightColor} />
      <Typography component="strong" sx={{ fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.3 }}>{translate(card.light.label, lang)}</Typography>
    </Stack>

    <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
      <Fact label={t("Direction", lang)} icon={Direction} color={factColor(card.direction.code)}>{translate(card.direction.label, lang)}</Fact>
      <Fact label={t("Big players", lang)} icon={Users} color={factColor(card.bigPlayers.code)}>{translate(card.bigPlayers.label, lang)}</Fact>
    </Box>

    {card.trap && <Alert severity="error" variant="filled" icon={<AlertTriangle size={18} />} sx={{ fontWeight: 700, py: 0.25 }}>
      {translate(card.trap.message, lang)}
    </Alert>}

    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: "auto", mx: -0.75 }}>
      <Button size="small" aria-expanded={open} onClick={() => setOpen(value => !value)}
        endIcon={<Box component="span" sx={{ display: "flex", transition: "transform 200ms", transform: open ? "rotate(180deg)" : "none" }}><ChevronDown size={16} aria-hidden="true" /></Box>}>
        {t(open ? "Hide details" : "More details", lang)}
      </Button>
      {onOpenStocks && <Button size="small" onClick={() => onOpenStocks(card.key)} endIcon={<ChartScatter size={16} aria-hidden="true" />}>
        {t("See stocks", lang)}
      </Button>}
    </Stack>
    <Collapse in={open} unmountOnExit>
      <Stack spacing={1.25}>
        {card.range && <Stack spacing={0.9}>
          <Typography variant="body2" sx={{ fontSize: 13, color: "text.secondary" }}>{translate(card.range.text, lang)}</Typography>
          <RangeBar range={card.range} />
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ fontSize: 12, color: "text.secondary" }}>
            {Number.isFinite(card.range.support) && <Typography variant="caption" color="text.secondary">
              <Box component="span" sx={{ display: "inline-block", width: 10, height: 3, mr: 0.75, verticalAlign: "middle", borderRadius: 1, bgcolor: "success.main" }} />
              {t("Market often stops falling near", lang)} <Box component="b" sx={{ color: "text.primary", ...mono }}>{whole(card.range.support)}</Box>
            </Typography>}
            {Number.isFinite(card.range.resistance) && <Typography variant="caption" color="text.secondary">
              <Box component="span" sx={{ display: "inline-block", width: 10, height: 3, mr: 0.75, verticalAlign: "middle", borderRadius: 1, bgcolor: "error.main" }} />
              {t("Market often stops rising near", lang)} <Box component="b" sx={{ color: "text.primary", ...mono }}>{whole(card.range.resistance)}</Box>
            </Typography>}
          </Stack>
          {card.expiryLevel && <Typography variant="body2" color="text.secondary" sx={{ px: 1.25, py: 0.9, borderRadius: 2.5, bgcolor: "background.subtle", fontSize: 12.5 }}>{translate(card.expiryLevel.text, lang)}</Typography>}
        </Stack>}
        <Box component="dl" sx={{ m: 0, p: 1.5, borderRadius: 2.5, bgcolor: "background.subtle", display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 12px", fontSize: 12.5,
          "& dt": { fontWeight: 800, color: "text.secondary" }, "& dd": { m: 0 } }}>
          <dt>{t("Why this light", lang)}</dt><dd>{card.light.reasons.join(" ")}</dd>
          <dt>{t("Direction", lang)}</dt><dd>{card.direction.detail}</dd>
          <dt>{t("Big players", lang)}</dt><dd>{card.bigPlayers.detail}</dd>
          {card.trap && <><dt>{t("Trap", lang)}</dt><dd>{card.trap.detail}</dd></>}
          {card.range && <><dt>{t("Option prices", lang)}</dt><dd>Options are priced for about {card.range.iv}% yearly movement (implied volatility).</dd></>}
          {card.numbers?.pcr != null && <><dt>{t("Put-call ratio", lang)}</dt><dd>{card.numbers.pcr}</dd></>}
        </Box>
      </Stack>
    </Collapse>
  </Paper>;
});

function speak(text, lang) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = speechLang(lang);
  const voice = window.speechSynthesis.getVoices().find(item => item.lang === utterance.lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}

const INDEX_WORDS = { nifty: ["nifty", "निफ्टी", "ನಿಫ್ಟಿ", "నిఫ్టీ", "నిఫ్టి"], banknifty: ["bank", "बैंक", "ಬ್ಯಾಂಕ್", "బ్యాంక్"], sensex: ["sensex", "सेंसेक्स", "ಸೆನ್ಸೆಕ್ಸ್", "సెన్సెక్స్"] };

export function answerQuestion(question, cards, lang) {
  const text = question.toLowerCase();
  const asked = cards.filter(card => INDEX_WORDS[card.key]?.some(word => text.includes(word)));
  const chosen = asked.length ? asked : cards;
  const wantsRange = ["range", "रेंज", "दायरा", "ಶ್ರೇಣಿ", "ವ್ಯಾಪ್ತಿ", "రేంజ్", "పరిధి"].some(word => text.includes(word));
  return chosen.map(card => wantsRange && card.range ? translate(card.range.text, lang) : marketSummary([card], lang)).join(" ");
}

export default function Home({ api, details, latestSwing, onOpenStocks }) {
  const [lang, setLang] = useState(readLanguage);
  const [voiceNote, setVoiceNote] = useState("");
  const [showWords, setShowWords] = useState(false);
  const [word, setWord] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async signal => {
    try {
      setData(await api.decision(signal));
      setError("");
    } catch (exc) {
      if (!signal?.aborted) setError(exc.message);
    }
  }, [api]);

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal);
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(abort.signal); }, REFRESH_MS);
    // Coming back to the tab (or unlocking a phone) refreshes straight away instead of showing a stale light.
    const onVisible = () => { if (document.visibilityState === "visible") load(abort.signal); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const expiring = data?.expiryToday?.length > 0;
  useEffect(() => {
    if (!expiring) return undefined;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [expiring]);

  const seeAllSwings = () => document.querySelector(".scan-activity")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  const labels = Object.fromEntries((data?.cards || []).map(card => [card.key, card.label]));
  const chooseLanguage = value => { setLang(value); saveLanguage(value); };
  const summary = data ? marketSummary(data.cards, lang) : "";
  const listen = () => setVoiceNote(speak(summary, lang) ? "" : "Your browser cannot read aloud.");
  const ask = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setVoiceNote("Voice questions work in Chrome. Try asking: \"NIFTY trend\" or \"Bank range\"."); return; }
    const recognition = new Recognition();
    recognition.lang = speechLang(lang);
    recognition.onresult = event => {
      const question = event.results[0][0].transcript;
      const reply = answerQuestion(question, data.cards, lang);
      setVoiceNote(`“${question}” → ${reply}`);
      speak(reply, lang);
    };
    recognition.onerror = () => setVoiceNote("Sorry, I could not hear that. Please try again.");
    setVoiceNote("Listening…");
    recognition.start();
  };
  const share = `https://wa.me/?text=${encodeURIComponent(`Utraders market summary\n${summary}\n\n${translate(data?.disclaimer || "", lang)}`)}`;
  const languageOptions = LANGUAGES.map(([key, label]) => [key, label]);

  const actions = [
    [Volume2, "Listen", listen, {}],
    [Mic, "Ask", ask, {}],
    [Share2, "Share on WhatsApp", null, { component: "a", href: share, target: "_blank", rel: "noopener noreferrer" }],
    [BookOpen, "Words", () => setShowWords(value => !value), { "aria-expanded": showWords }],
  ];

  return <PageShell className={`home-page${expiring ? " is-expiry-day" : ""}`} maxWidth={1680}>
    {expiring && <Box role="status" sx={{ mb: 1.5, px: 2, py: 0.75, borderRadius: 3, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "4px 16px",
      bgcolor: "error.main", color: "#fff", fontSize: 14 }}>
      <Typography component="strong" sx={{ fontWeight: 800, letterSpacing: "0.1em", fontSize: 13 }}>EXPIRY DAY</Typography>
      <span>{data.expiryToday.map(key => labels[key] || key.toUpperCase()).join(" · ")}</span>
      <Box component="span" sx={{ ...mono, fontWeight: 700 }}>{data.marketOpen ? `Market closes in ${countdown(data.closesAt - now)}` : "Market closed"}</Box>
    </Box>}
    {data?.lastHour && <Alert severity="error" icon={<ShieldAlert size={20} />} sx={{ mb: 1.5, fontWeight: 700 }}>
      {translate("Last hour of expiry. Prices can jump fast. Keep your exit ready or stay out.", lang)}
    </Alert>}

    <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }} justifyContent="space-between" sx={{ mb: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>{t("Today's market", lang)}</Typography>
        <Typography variant="body2" color="text.secondary">{t("Know the trend. Spot the trap. Protect your money.", lang)}</Typography>
      </Box>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        <Segmented label="Language" value={lang} onChange={chooseLanguage} options={languageOptions} />
        {data && <Stack direction="row" spacing={0.5}>
          {actions.map(([Icon, label, onClick, extra]) => <Tooltip key={label} title={t(label, lang)}>
            <IconButton aria-label={t(label, lang)} onClick={onClick || undefined} {...extra}
              sx={{ bgcolor: label === "Words" && showWords ? "rgba(74,111,224,0.16)" : "rgba(74,111,224,0.08)", color: "accent.main", "&:hover": { bgcolor: "rgba(74,111,224,0.16)" } }}>
              <Icon size={18} />
            </IconButton>
          </Tooltip>)}
        </Stack>}
      </Stack>
    </Stack>

    {latestSwing && sameDay(latestSwing.time, Date.now()) && <LatestSwing alert={latestSwing} lang={lang} onSeeAll={seeAllSwings} />}
    {voiceNote && <Alert severity="info" role="status" sx={{ mb: 2 }}>{voiceNote}</Alert>}
    <Collapse in={showWords} unmountOnExit>
      <Paper component="section" aria-label="Words used in Utraders" sx={{ mb: 2, p: 2 }}>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {GLOSSARY.map(entry => <Button key={entry[0]} size="small" variant={word === entry[0] ? "contained" : "outlined"} aria-pressed={word === entry[0]}
            onClick={() => setWord(word === entry[0] ? null : entry[0])}>{entry[0]}</Button>)}
        </Stack>
        {word && (() => {
          const item = glossaryText(GLOSSARY.find(entry => entry[0] === word), lang);
          return <Typography sx={{ mt: 1.5 }}><Box component="b" sx={{ display: "block", mb: 0.25 }}>{item.term} · {item.name}</Box>{item.meaning}</Typography>;
        })()}
      </Paper>
    </Collapse>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

    <Box sx={{ display: "grid", gap: 2, gridTemplateAreas: GRID_AREAS, gridTemplateColumns: GRID_COLUMNS, alignItems: "start" }}>
      <Box component="section" aria-label="Index summaries" sx={{
        gridArea: "tiles", minWidth: 0, display: "grid", gap: 2, alignSelf: "stretch",
        gridTemplateColumns: { xs: "repeat(3, 88%)", sm: "repeat(3, 62%)", md: "repeat(3, minmax(0, 1fr))" },
        overflowX: { xs: "auto", md: "visible" }, scrollSnapType: { xs: "x mandatory", md: "none" }, pb: { xs: 0.5, md: 0 },
        // Opening one card's details must not stretch the other two.
        "&:has(.is-details-open) > article": { alignSelf: "start" },
      }}>
        {data ? data.cards.map(card => <IndexCard key={card.key} card={card} lang={lang} onOpenStocks={onOpenStocks} />)
          : !error && [0, 1, 2].map(key => <Skeleton key={key} variant="rounded" height={230} sx={{ borderRadius: 4, bgcolor: "action.hover" }} />)}
        {!data && !error && <Typography role="status" className="sr-only">Loading today's market…</Typography>}
      </Box>

      {data && <Paper component="section" aria-label="Must know today" sx={{ gridArea: "know", p: 2, minWidth: 0, alignSelf: "stretch" }}>
        <Typography variant="overline" component="h2" color="text.secondary">{t("Must know today", lang)}</Typography>
        <Stack component="ul" spacing={0.75} sx={{ m: 0, mt: 0.75, p: 0, listStyle: "none" }}>
          {data.mustKnow.map(item => {
            const Icon = LEVEL_ICONS[item.level] || Info;
            return <Stack component="li" key={item.text} direction="row" spacing={1.25} alignItems="flex-start"
              sx={{ px: 1.25, py: 1, borderRadius: 2.5, bgcolor: item.level === "danger" ? "rgba(224,68,90,0.07)" : item.level === "warning" ? "rgba(214,139,18,0.08)" : "background.subtle" }}>
              <Box sx={{ color: LEVEL_COLORS[item.level] || "info.main", display: "flex", mt: "2px" }}><Icon size={17} aria-hidden="true" /></Box>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: item.level === "danger" ? 700 : 500 }}>{translate(item.text, lang)}</Typography>
            </Stack>;
          })}
          {data.optionCost && <Stack component="li" direction="row" spacing={1.25} alignItems="flex-start" sx={{ px: 1.25, py: 1, borderRadius: 2.5, bgcolor: "background.subtle" }}>
            <Box sx={{ color: "info.main", display: "flex", mt: "2px" }}><Info size={17} aria-hidden="true" /></Box>
            <Typography variant="body2" sx={{ fontSize: 13 }}>{data.optionCost.text}</Typography>
          </Stack>}
          {!data.mustKnow.length && !data.optionCost && <Typography variant="body2" color="text.secondary" component="li">Nothing unusual today.</Typography>}
        </Stack>
      </Paper>}

      {data && <Paper component="section" aria-label="Expiry calendar" sx={{ gridArea: "cal", p: 2, minWidth: 0, alignSelf: "stretch" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
          <Box sx={{ color: "primary.main", display: "flex" }}><CalendarDays size={17} aria-hidden="true" /></Box>
          <Typography variant="h3" component="h2">{t("Expiry calendar", lang)}</Typography>
        </Stack>
        <Stack spacing={1.25}>
          {data.cards.map(card => <Box key={card.key}>
            <Typography component="strong" sx={{ display: "block", mb: 0.5, fontSize: 12, fontWeight: 800, color: "text.secondary" }}>{card.label}</Typography>
            <Stack component="ul" direction="row" useFlexGap flexWrap="wrap" gap={0.75} sx={{ m: 0, p: 0, listStyle: "none" }}>
              {(data.calendar[card.key] || []).map(entry => {
                const state = entry.label === "Today" ? "is-today" : entry.thisWeek ? "is-week" : "";
                return <Box component="li" key={entry.date} className={state} sx={{
                  px: 1.25, py: 0.4, borderRadius: 999, fontSize: 12, fontWeight: 700,
                  bgcolor: state === "is-today" ? "error.main" : state === "is-week" ? "rgba(74,111,224,0.12)" : "background.subtle",
                  color: state === "is-today" ? "#fff" : state === "is-week" ? "primary.main" : "text.secondary",
                }}>{entry.label}</Box>;
              })}
            </Stack>
          </Box>)}
        </Stack>
      </Paper>}

      {details}
    </Box>

    {data && <Typography variant="caption" component="p" color="text.secondary" sx={{ textAlign: "center", maxWidth: 760, mx: "auto", mt: 2.5 }}>{translate(data.disclaimer, lang)}</Typography>}
  </PageShell>;
}
