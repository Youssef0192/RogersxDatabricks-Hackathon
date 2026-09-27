import { useEffect, useState } from "react";
import { get } from "./api";
import MapView from "./views/MapView";
import ForecastView from "./views/ForecastView";
import ControlView from "./views/ControlView";
import ReplayView from "./views/ReplayView";
import GenieView from "./views/GenieView";
import MethodView from "./views/MethodView";

export type Shared = { meta: any; routes: any[]; stops: any[] };
const TABS = [
  ["map", "Map"], ["forecast", "Forecast"], ["control", "Crowd control"], ["replay", "Replay: scheduled vs Hub Pulse"], ["genie", "Ask Genie"], ["method", "Method"],
] as const;

export default function App() {
  const [tab, setTab] = useState<string>(() => location.hash.slice(1) || "map");
  const [shared, setShared] = useState<Shared | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [replayDate, setReplayDate] = useState("2026-06-24");

  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < 90 && !stop; i++) {
        const h = await get("/api/health").catch(() => null);
        if (h?.error) { setErr(h.error); return; }
        if (h?.ready) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      try {
        const [meta, routes, stops] = await Promise.all([get("/api/meta"), get("/api/routes"), get("/api/stops")]);
        if (!stop) setShared({ meta, routes, stops });
      } catch (e: any) { setErr(String(e.message || e)); }
    })();
    return () => { stop = true; };
  }, []);

  const go = (t: string) => { setTab(t); history.replaceState(null, "", `#${t}`); };
  const openReplay = (d: string) => { setReplayDate(d); go("replay"); };

  return (
    <>
      <header className="top">
        <div className="brand"><span className="dot" />Hub Pulse</div>
        <div className="tag">Predict hub surges, move spare buses · UBC · Waterfront · Park Royal</div>
        <nav className="tabs">
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => go(k)}>{label}</button>)}
        </nav>
      </header>
      <main>
        {err && <div className="page"><p className="err">Could not load data: {err}</p></div>}
        {!err && !shared && <div className="page"><p className="muted">Loading from the SQL warehouse… (the warehouse may take a few seconds to start)</p></div>}
        {shared && tab === "map" && <MapView shared={shared} />}
        {shared && tab === "forecast" && <ForecastView shared={shared} />}
        {shared && tab === "control" && <ControlView shared={shared} onReplay={openReplay} />}
        {shared && tab === "replay" && <ReplayView shared={shared} date={replayDate} setDate={setReplayDate} />}
        {shared && tab === "genie" && <GenieView />}
        {shared && tab === "method" && <MethodView shared={shared} />}
      </main>
    </>
  );
}
