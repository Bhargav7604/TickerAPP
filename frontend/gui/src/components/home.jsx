import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, BookOpen, CalendarDays, ChevronDown, Info, Mic, Share2, ShieldAlert, Users, Volume2 } from "lucide-react";
import "../home.css";
import { GLOSSARY, glossaryText, LANGUAGES, marketSummary, readLanguage, saveLanguage, speechLang, t, translate } from "../i18n";

const REFRESH_MS = 30000;
const LIGHTS = ["red", "yellow", "green"];
const DIRECTION_ICONS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };
const LEVEL_ICONS = { danger: ShieldAlert, warning: AlertTriangle, info: Info };

const money = value => Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
const whole = value => Number.isFinite(value) ? Math.round(value).toLocaleString("en-IN") : "--";
const clock = seconds => seconds ? new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "--:--";
const day = seconds => new Date(seconds * 1000).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });

const TABLES_KEY = "utraders-home-tables";
const signed = value => `${value > 0 ? "+" : ""}${whole(value)}`;
const sameDay = (ms, now) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }) === new Date(now).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" });
const readTablesOpen = () => { try { return localStorage.getItem(TABLES_KEY) === "open"; } catch { return false; } };
const saveTablesOpen = open => { try { localStorage.setItem(TABLES_KEY, open ? "open" : "closed"); } catch { /* storage unavailable */ } };

// Replaces the old centre-screen popup: one quiet line that updates in place.
function LatestSwing({ alert, lang, onSeeAll }) {
  const up = alert.swingLots > 0;
  return <section className="home-swing" aria-label={t("Latest swing alert", lang)} aria-live="polite" key={`${alert.indexKey}-${alert.time}`}>
    <BellRing size={18} aria-hidden="true" />
    <span className="home-swing-label">{t("Latest swing alert", lang)}</span>
    <span className="home-swing-time">{clock(alert.time / 1000)}</span>
    <strong className={up ? "home-up" : "home-down"}>{alert.indexName.toUpperCase()} {signed(alert.swingLots)} {t("lots", lang)}</strong>
    <span className="home-swing-detail">{signed(alert.previousNetLots)} → {signed(alert.currentNetLots)} · {alert.symbol}</span>
    <button type="button" className="home-swing-all" onClick={onSeeAll}>{t("See all swing alerts", lang)}</button>
  </section>;
}

export function countdown(totalSeconds) {
  if (totalSeconds <= 0) return "closed";
  const hours = Math.floor(totalSeconds / 3600), minutes = Math.floor(totalSeconds % 3600 / 60), seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function TrafficLight({ color }) {
  return <span className="home-lamps" aria-hidden="true">
    {LIGHTS.map(lamp => <span key={lamp} className={`home-lamp home-lamp-${lamp}${lamp === color ? " is-on" : ""}`} />)}
  </span>;
}

function RangeBar({ range }) {
  const span = range.high - range.low || 1;
  const at = value => `${Math.min(100, Math.max(0, (value - range.low) / span * 100))}%`;
  const inside = value => Number.isFinite(value) && value >= range.low && value <= range.high;
  return <div className="home-range" aria-hidden="true">
    <div className="home-range-track">
      {inside(range.support) && <span className="home-range-mark is-support" style={{ left: at(range.support) }} />}
      {inside(range.resistance) && <span className="home-range-mark is-resistance" style={{ left: at(range.resistance) }} />}
      <span className="home-range-spot" style={{ left: at(range.spot) }} />
    </div>
    <div className="home-range-ends"><span>{whole(range.low)}</span><span>{whole(range.high)}</span></div>
  </div>;
}

function IndexCard({ card, lang }) {
  const [open, setOpen] = useState(false);
  const Direction = DIRECTION_ICONS[card.direction.code];
  const change = card.change;
  const tone = change && change.value !== 0 ? (change.value > 0 ? "home-up" : "home-down") : "";
  const expiry = card.expiry;
  return <article className={`home-card is-${card.light.color}`} aria-label={`${card.label} summary`}>
    <header className="home-card-head">
      <div>
        <h2>{card.label}</h2>
        {expiry && <span className={`home-expiry${expiry.isToday ? " is-today" : ""}`}>{expiry.isToday ? "Expires today" : `Expiry ${new Date(expiry.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`}</span>}
      </div>
      <div className="home-price">
        <strong>{money(card.price)}</strong>
        {change && <span className={tone}>{change.value > 0 ? "+" : ""}{money(change.value)} ({change.pct > 0 ? "+" : ""}{change.pct}%) {change.since === "open" ? "since open" : "today"}</span>}
      </div>
    </header>

    <div className={`home-light is-${card.light.color}`} role="status">
      <TrafficLight color={card.light.color} />
      <strong>{translate(card.light.label, lang)}</strong>
    </div>

    <ul className="home-facts">
      <li className={`is-${card.direction.code}`}><Direction size={20} aria-hidden="true" /><span>{translate(card.direction.label, lang)}</span></li>
      <li className={`is-${card.bigPlayers.code}`}><Users size={18} aria-hidden="true" /><span>{translate(card.bigPlayers.label, lang)}</span></li>
    </ul>

    {card.trap && <div className="home-trap" role="alert"><AlertTriangle size={18} aria-hidden="true" /><strong>{translate(card.trap.message, lang)}</strong></div>}

    {card.range && <div className="home-range-block">
      <p>{translate(card.range.text, lang)}</p>
      <RangeBar range={card.range} />
      <p className="home-levels">
        {Number.isFinite(card.range.support) && <span><i className="is-support" />{t("Market often stops falling near", lang)} <b>{whole(card.range.support)}</b></span>}
        {Number.isFinite(card.range.resistance) && <span><i className="is-resistance" />{t("Market often stops rising near", lang)} <b>{whole(card.range.resistance)}</b></span>}
      </p>
      {card.expiryLevel && <p className="home-expiry-level">{card.expiryLevel.text}</p>}
    </div>}

    <button type="button" className="home-more" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {t(open ? "Hide details" : "More details", lang)} <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <dl className="home-details">
      <dt>Why this light</dt><dd>{card.light.reasons.join(" ")}</dd>
      <dt>Direction</dt><dd>{card.direction.detail}</dd>
      <dt>Big players</dt><dd>{card.bigPlayers.detail}</dd>
      {card.trap && <><dt>Trap</dt><dd>{card.trap.detail}</dd></>}
      {card.range && <><dt>Option prices</dt><dd>Options are priced for about {card.range.iv}% yearly movement (implied volatility).</dd></>}
      {card.numbers?.pcr != null && <><dt>Put-call ratio</dt><dd>{card.numbers.pcr}</dd></>}
    </dl>}

    <footer className={`home-card-foot${card.late ? " is-late" : ""}`}>
      {card.late ? `Data is late · last update ${day(card.asOf)} ${clock(card.asOf)}` : card.live ? `Live · ${clock(card.asOf)} IST` : `Updated ${clock(card.asOf)} IST`}
    </footer>
  </article>;
}

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

const INDEX_WORDS = { nifty: ["nifty", "निफ्टी", "ನಿಫ್ಟಿ"], banknifty: ["bank", "बैंक", "ಬ್ಯಾಂಕ್"], sensex: ["sensex", "सेंसेक्स", "ಸೆನ್ಸೆಕ್ಸ್"] };

export function answerQuestion(question, cards, lang) {
  const text = question.toLowerCase();
  const asked = cards.filter(card => INDEX_WORDS[card.key]?.some(word => text.includes(word)));
  const chosen = asked.length ? asked : cards;
  const wantsRange = ["range", "रेंज", "दायरा", "ಶ್ರೇಣಿ", "ವ್ಯಾಪ್ತಿ"].some(word => text.includes(word));
  return chosen.map(card => wantsRange && card.range ? translate(card.range.text, lang) : marketSummary([card], lang)).join(" ");
}

export default function Home({ api, details, latestSwing }) {
  const [lang, setLang] = useState(readLanguage);
  const [voiceNote, setVoiceNote] = useState("");
  const [showWords, setShowWords] = useState(false);
  const [word, setWord] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showTables, setShowTables] = useState(readTablesOpen);
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
    return () => { abort.abort(); clearInterval(timer); };
  }, [load]);

  const expiring = data?.expiryToday?.length > 0;
  useEffect(() => {
    if (!expiring) return undefined;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [expiring]);

  const toggleTables = open => { setShowTables(open); saveTablesOpen(open); };
  const seeAllSwings = () => {
    toggleTables(true);
    requestAnimationFrame(() => document.querySelector(".scan-activity")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
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
  return <main className={`home-page${expiring ? " is-expiry-day" : ""}`}>
    {expiring && <div className="home-expiry-banner" role="status">
      <strong>EXPIRY DAY</strong>
      <span>{data.expiryToday.map(key => labels[key] || key.toUpperCase()).join(" · ")}</span>
      <span>{data.marketOpen ? `Market closes in ${countdown(data.closesAt - now)}` : "Market closed"}</span>
    </div>}
    {data?.lastHour && <div className="home-last-hour" role="alert"><ShieldAlert size={20} aria-hidden="true" />{translate("Last hour of expiry. Prices can jump fast. Keep your exit ready or stay out.", lang)}</div>}

    <header className="home-head">
      <div>
        <h1>{t("Today's market", lang)}</h1>
        <span>{t("Know the trend. Spot the trap. Protect your money.", lang)}</span>
      </div>
      <div className="home-tools">
        <div className="home-langs" role="group" aria-label="Language">
          {LANGUAGES.map(([key, label]) => <button key={key} type="button" aria-pressed={lang === key} className={lang === key ? "active" : ""} onClick={() => chooseLanguage(key)}>{label}</button>)}
        </div>
        {data && <>
          <button type="button" className="home-tool" onClick={listen}><Volume2 size={16} aria-hidden="true" />{t("Listen", lang)}</button>
          <button type="button" className="home-tool" onClick={ask}><Mic size={16} aria-hidden="true" />{t("Ask", lang)}</button>
          <a className="home-tool" href={share} target="_blank" rel="noopener noreferrer"><Share2 size={16} aria-hidden="true" />{t("Share on WhatsApp", lang)}</a>
          <button type="button" className="home-tool" aria-expanded={showWords} onClick={() => setShowWords(value => !value)}><BookOpen size={16} aria-hidden="true" />{t("Words", lang)}</button>
        </>}
      </div>
    </header>
    {latestSwing && sameDay(latestSwing.time, Date.now()) && <LatestSwing alert={latestSwing} lang={lang} onSeeAll={seeAllSwings} />}
    {voiceNote && <p className="home-voice" role="status">{voiceNote}</p>}
    {showWords && <section className="home-words" aria-label="Words used in Utraders">
      <div className="home-word-list">{GLOSSARY.map(entry => <button key={entry[0]} type="button" aria-pressed={word === entry[0]} onClick={() => setWord(word === entry[0] ? null : entry[0])}>{entry[0]}</button>)}</div>
      {word && (() => { const item = glossaryText(GLOSSARY.find(entry => entry[0] === word), lang); return <p><b>{item.term} · {item.name}</b>{item.meaning}</p>; })()}
    </section>}

    {error && <p className="home-error" role="alert">{error}</p>}
    {!data && !error && <p className="home-loading" role="status">Loading today's market…</p>}

    {data && <>
      {data.mustKnow.length > 0 && <section className="home-mustknow" aria-label="Must know today">
        <h2>{t("Must know today", lang)}</h2>
        <ul>{data.mustKnow.map(item => {
          const Icon = LEVEL_ICONS[item.level] || Info;
          return <li key={item.text} className={`is-${item.level}`}><Icon size={18} aria-hidden="true" /><span>{translate(item.text, lang)}</span></li>;
        })}
        {data.optionCost && <li className="is-info"><Info size={18} aria-hidden="true" /><span>{data.optionCost.text}</span></li>}</ul>
      </section>}

      <section className="home-cards" aria-label="Index summaries">
        {data.cards.map(card => <IndexCard key={card.key} card={card} lang={lang} />)}
      </section>

      <section className="home-calendar" aria-label="Expiry calendar">
        <h2><CalendarDays size={18} aria-hidden="true" /> {t("Expiry calendar", lang)}</h2>
        <div className="home-calendar-grid">
          {data.cards.map(card => <div key={card.key}>
            <strong>{card.label}</strong>
            <ul>{(data.calendar[card.key] || []).map(entry => <li key={entry.date} className={entry.label === "Today" ? "is-today" : entry.thisWeek ? "is-week" : ""}>{entry.label}</li>)}</ul>
          </div>)}
        </div>
      </section>

      <section className="home-tables">
        <button type="button" className="home-more home-tables-toggle" aria-expanded={showTables} onClick={() => toggleTables(!showTables)}>
          {showTables ? "Hide full market tables" : "More details: full market tables"} <ChevronDown size={16} aria-hidden="true" />
        </button>
        {showTables && <div className="home-tables-body">{details}</div>}
      </section>

      <p className="home-disclaimer">{translate(data.disclaimer, lang)}</p>
    </>}
  </main>;
}
