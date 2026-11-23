import React, { useState } from "react";
import MainPage from "./components/mainPage";
import { makeDesignData } from "./designFixtures";
import { makeEquityPreviewApi } from "./equityFixtures";
import { makeBoardPreviewApi, makeIndexStocksPreviewApi } from "./boardFixtures";
import { makeNewsPreviewApi } from "./newsFixtures";
import { makeStraddlePreviewApi } from "./straddleFixtures";
import { makeDecisionPreviewApi, makeOiPreviewApi } from "./overviewFixtures";

export default function DesignPreview() {
  const [equityApi] = useState(makeEquityPreviewApi);
  const [indexOptionsApi] = useState(() => makeEquityPreviewApi(true));
  const [boardApi] = useState(makeBoardPreviewApi);
  const [indexStocksApi] = useState(makeIndexStocksPreviewApi);
  const [newsApi] = useState(makeNewsPreviewApi);
  const [straddleApi] = useState(makeStraddlePreviewApi);
  const [oiApi] = useState(makeOiPreviewApi);
  const [decisionApi] = useState(makeDecisionPreviewApi);
  const [month, setMonth] = useState("current");
  const [draft, setDraft] = useState(() => {
    try { return { marketColumns: JSON.parse(localStorage.getItem("index-tool-preview-columns")) }; }
    catch (error) { return {}; }
  });
  const [notice, setNotice] = useState("");
  const data = makeDesignData(month);
  return <>
    {notice && <div role="status" className="design-preview-notice">{notice}</div>}
    <MainPage {...data} equityApi={equityApi} indexOptionsApi={indexOptionsApi} boardApi={boardApi} indexStocksApi={indexStocksApi} newsApi={newsApi} straddleApi={straddleApi} oiApi={oiApi} decisionApi={decisionApi} username="Design preview" settings={{ ...data.settings, ...draft }}
      handleContractMonthChange={setMonth}
      handleMarketColumnsSave={async marketColumns => {
        localStorage.setItem("index-tool-preview-columns", JSON.stringify(marketColumns));
        setDraft(previous => ({ ...previous, marketColumns }));
      }}
      handleDashboardRefresh={() => setNotice("Sample data refreshed. No live broker connection is used in this preview.")}
      handleSettingsChange={event => { const { name, type, checked, value } = event.target; setDraft(previous => ({ ...previous, [name]: type === "checkbox" ? checked : value })); }}
      handleSettingsSave={async () => setNotice("Preview settings updated for this page only. No email will be sent.")}
      handleLogout={() => { window.location.href = "/"; }}
    />
  </>;
}
