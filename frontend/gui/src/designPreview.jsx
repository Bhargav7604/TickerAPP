import React, { useState } from "react";
import MainPage from "./components/mainPage";
import { makeDesignData } from "./designFixtures";
import { makeEquityPreviewApi } from "./equityFixtures";

export default function DesignPreview() {
  const [equityApi] = useState(makeEquityPreviewApi);
  const [indexOptionsApi] = useState(() => makeEquityPreviewApi(true));
  const [month, setMonth] = useState("current");
  const [draft, setDraft] = useState(() => {
    try { return { marketColumns: JSON.parse(localStorage.getItem("index-tool-preview-columns")) }; }
    catch (error) { return {}; }
  });
  const [notice, setNotice] = useState("");
  const data = makeDesignData(month);
  return <>
    {notice && <div role="status" className="design-preview-notice">{notice}</div>}
    <MainPage {...data} equityApi={equityApi} indexOptionsApi={indexOptionsApi} username="Design preview" settings={{ ...data.settings, ...draft }}
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
