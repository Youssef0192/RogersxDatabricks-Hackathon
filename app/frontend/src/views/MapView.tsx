import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ArcLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import Map from "react-map-gl/maplibre";
import { get } from "../api";
import type { Shared } from "../App";
import { BASEMAP, DAY_TYPE_LABEL, HUB_COLOR, HUB_HEX, HUB_NAME, INITIAL_VIEW, hh, loadColor, n0, n1, pct, rgb } from "../util";

const SERVED: [number, number, number] = [46, 158, 91];
const UNSERVED: [number, number, number] = [214, 69, 69];

export default function MapView({ shared }: { shared: Shared }) {
  const { meta, routes, stops } = shared;
  const [hub, setHub] = useState("UBC");
  const [hour, setHour] = useState(8);
  const [dayType, setDayType] = useState("MF");
  const [season, setSeason] = useState("Fall");
  const [flows, setFlows] = useState<any>(null);
  const [stop, setStop] = useState<any>(null);
  const [stopInfo, setStopInfo] = useState<any>(null);
  const [view, setView] = useState<any>(INITIAL_VIEW);

  const hubs = meta.hubs as any[];
  const hubRow = hubs.find((h) => h.tower_id === hub);
  const areaXY = useMemo(() => Object.fromEntries((meta.areas as any[]).filter((a) => a.lat).map((a) => [a.area_name, [a.lon, a.lat]])), [meta]);

  useEffect(() => { get(`/api/flows?hub=${hub}&hour=${hour}&day_type=${encodeURIComponent(dayType)}&season=${season}`).then(setFlows); }, [hub, hour, dayType, season]);
  useEffect(() => {
    if (!stop) { setStopInfo(null); return; }
    setStopInfo(null);
    get(`/api/stop/${encodeURIComponent(stop.stop_id)}?day_type=${encodeURIComponent(dayType)}&season=${season}`).then(setStopInfo);
  }, [stop, dayType, season]);

  const areas = (flows?.areas || []) as any[];
  const routed = areas.filter((a) => areaXY[a.home_area] && !a.is_local);
  const maxP = Math.max(1, ...routed.map((a) => a.avg_daily_people || 0));
  const local = areas.filter((a) => a.is_local);
  const outside = areas.filter((a) => !a.is_routable_origin);
  const share = (rows: any[]) => rows.reduce((s, a) => s + (a.share_of_tower_hour || 0), 0);
  const unserved = routed.filter((a) => a.has_service === false);

  const layers = [
    new PathLayer({ id: "routes", data: routes, getPath: (r: any) => r.path, widthUnits: "pixels",
      getWidth: (r: any) => ((r.serves_hubs || "").includes(hub) ? 2.2 : r.mode === "Bus" ? 0.8 : 2),
      getColor: (r: any) => ((r.serves_hubs || "").includes(hub) ? [...HUB_COLOR[hub], 190] : r.mode === "Bus" ? [120, 130, 140, 70] : [60, 70, 80, 150]),
      updateTriggers: { getWidth: hub, getColor: hub } }),
    new ScatterplotLayer({ id: "stops", data: stops, getPosition: (s: any) => [s.lon, s.lat], radiusUnits: "pixels",
      getRadius: (s: any) => (s.tower_id ? 3 : 1.6), getFillColor: (s: any) => (s.tower_id ? [...HUB_COLOR[s.tower_id], 230] : [90, 100, 110, 90]),
      pickable: true, onClick: (i: any) => setStop(i.object) }),
    new ArcLayer({ id: "flows", data: routed, getSourcePosition: (a: any) => areaXY[a.home_area], getTargetPosition: () => [hubRow.lon, hubRow.lat],
      getWidth: (a: any) => 1 + 11 * Math.sqrt((a.avg_daily_people || 0) / maxP), widthUnits: "pixels", greatCircle: false,
      getSourceColor: (a: any) => [...(a.has_service === false ? UNSERVED : SERVED), 220], getTargetColor: [...HUB_COLOR[hub], 200],
      pickable: true, updateTriggers: { getTargetPosition: hub, getTargetColor: hub } }),
    new ScatterplotLayer({ id: "areas", data: routed, getPosition: (a: any) => areaXY[a.home_area], radiusUnits: "pixels",
      getRadius: (a: any) => 3 + 14 * Math.sqrt((a.avg_daily_people || 0) / maxP), getFillColor: (a: any) => [...(a.has_service === false ? UNSERVED : SERVED), 150],
      stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 1, pickable: true }),
    new ScatterplotLayer({ id: "hubs", data: hubs, getPosition: (h: any) => [h.lon, h.lat], radiusUnits: "pixels", getRadius: (h: any) => (h.tower_id === hub ? 13 : 9),
      getFillColor: (h: any) => [...HUB_COLOR[h.tower_id], 255], stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 3, pickable: true,
      onClick: (i: any) => setHub(i.object.tower_id), updateTriggers: { getRadius: hub } }),
    new TextLayer({ id: "hub-labels", data: hubs, getPosition: (h: any) => [h.lon, h.lat], getText: (h: any) => HUB_NAME[h.tower_id], getSize: 14,
      getPixelOffset: [0, -22], getColor: [15, 27, 42], fontWeight: 700, background: true, getBackgroundColor: [255, 255, 255, 220], backgroundPadding: [4, 2] }),
  ];

  const tooltip = ({ object, layer }: any) => {
    if (!object) return null;
    if (layer.id === "flows" || layer.id === "areas")
      return { text: `${object.home_area}: ${n1(object.avg_daily_people)} people/day at ${HUB_NAME[hub]} ${hh(hour)} (${pct(object.share_of_tower_hour, 1)})\n` +
        (object.has_service === false ? "No connecting bus or train this hour" : `Best option: ${(object.link_type_used || "").replace(/_/g, " ")}, ${object.connecting_departures} departures`) };
    if (layer.id === "stops") return { text: `${object.stop_name}\nRoutes: ${object.lines}` };
    if (layer.id === "hubs") return { text: `${HUB_NAME[object.tower_id]} (${object.location_name}) — click to select` };
    return null;
  };

  const svcByHour = useMemo(() => {
    if (!stopInfo) return [];
    const m = Array.from({ length: 24 }, (_, h) => ({ h, n: 0 }));
    for (const r of stopInfo.service) m[r.hour].n += r.departures;
    return m;
  }, [stopInfo]);
  const maxSvc = Math.max(1, ...svcByHour.map((x) => x.n));
  const linesAtHour = useMemo(() => {
    if (!stopInfo) return [];
    const byLine: Record<string, any> = {};
    for (const r of stopInfo.service) if (r.hour === hour) byLine[r.line] = { line: r.line, deps: (byLine[r.line]?.deps || 0) + r.departures };
    for (const l of stopInfo.loads) if (l.hour === hour && byLine[l.line]) byLine[l.line].load = l.tspr_peak_load_pct;
    return Object.values(byLine).sort((a: any, b: any) => b.deps - a.deps);
  }, [stopInfo, hour]);

  return (
    <div className="split">
      <div className="mapwrap">
        <DeckGL viewState={view} onViewStateChange={(e: any) => setView(e.viewState)} controller layers={layers} getTooltip={tooltip}
          onClick={(i: any) => { if (!i.object) setStop(null); }}>
          <Map mapStyle={BASEMAP} />
        </DeckGL>
        <div className="legend">
          <div><span className="sw" style={{ background: rgb(SERVED) }} />Home area with a bus or train this hour</div>
          <div><span className="sw" style={{ background: rgb(UNSERVED) }} />No connecting service this hour</div>
          <div className="muted small" style={{ marginTop: 4 }}>Arcs start at approximate area centres (hand-geocoded), width = people per day.</div>
        </div>
      </div>
      <aside className="side">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2><span className="hubdot" style={{ background: HUB_HEX[hub], marginRight: 6 }} />{HUB_NAME[hub]}</h2>
          <div className="seg">{hubs.map((h) => <button key={h.tower_id} className={hub === h.tower_id ? "on" : ""} onClick={() => setHub(h.tower_id)}>{HUB_NAME[h.tower_id]}</button>)}</div>
        </div>
        <div className="muted">{hubRow.location_name} · represents {hubRow.area_name} (A1)</div>
        <h3>When</h3>
        <div className="row" style={{ justifyContent: "space-between" }}><b>{hh(hour)}</b>
          <span className="badge b-muted">{flows?.travel_purpose === "to_home" ? "going home (A2)" : "travelling to work (A2)"}</span></div>
        <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(+e.target.value)} />
        <div className="row">
          <div className="seg">{Object.entries(DAY_TYPE_LABEL).map(([k, v]) => <button key={k} className={dayType === k ? "on" : ""} onClick={() => setDayType(k)}>{v}</button>)}</div>
          <div className="seg">{["Fall", "Summer"].map((s) => <button key={s} className={season === s ? "on" : ""} onClick={() => setSeason(s)}>{s}</button>)}</div>
        </div>
        {stop ? (
          <>
            <h3>Stop</h3>
            <div className="row" style={{ justifyContent: "space-between" }}><b>{stop.stop_name}</b><button className="btn" onClick={() => setStop(null)}>Close</button></div>
            <div className="muted small">Routes: {stop.lines}{stop.tower_id ? ` · inside the ${HUB_NAME[stop.tower_id]} hub catchment` : ""}</div>
            <div className="note" style={{ marginTop: 8 }}>Only the three hub towers have ping data, so an ordinary stop shows its scheduled service and TransLink crowding (TSPR 2025) — not where its riders come from.</div>
            {!stopInfo ? <p className="muted">Loading…</p> : (
              <>
                <h3>Scheduled departures by hour ({DAY_TYPE_LABEL[dayType]})</h3>
                <svg viewBox="0 0 240 60" width="100%" height="70">
                  {svcByHour.map((x) => <rect key={x.h} x={x.h * 10} y={58 - (54 * x.n) / maxSvc} width={8} height={(54 * x.n) / maxSvc}
                    fill={x.h === hour ? "#2272b4" : "#b9c6d4"}><title>{`${hh(x.h)}: ${x.n} departures`}</title></rect>)}
                </svg>
                <h3>At {hh(hour)}: departures and crowding</h3>
                <table className="t"><thead><tr><th>Route</th><th className="num">Departures</th><th className="num">TSPR peak load</th></tr></thead>
                  <tbody>{linesAtHour.map((l: any) => <tr key={l.line}><td>{l.line}</td><td className="num">{l.deps}</td>
                    <td className="num" style={{ color: rgb(loadColor(l.load)), fontWeight: 600 }}>{l.load == null ? "no data" : `${n0(l.load)}%`}</td></tr>)}
                    {!linesAtHour.length && <tr><td colSpan={3} className="muted">No departures this hour</td></tr>}</tbody></table>
              </>
            )}
          </>
        ) : (
          <>
            <h3>Who is here at {hh(hour)} ({DAY_TYPE_LABEL[dayType]}, {season})</h3>
            <div className="cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="card"><h4>People per day</h4><div className="big">{n0(flows?.total_people)}</div></div>
              <div className="card"><h4>No bus home / to work</h4><div className="big" style={{ color: unserved.length ? "var(--bad)" : undefined }}>{n0(unserved.reduce((s, a) => s + a.avg_daily_people, 0))}</div></div>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>Regional {pct(share(routed), 0)} · local {pct(share(local), 0)} (A5) · out of region {pct(share(outside), 0)} (A6, not routed)</div>
            <h3>Top home areas</h3>
            <table className="t"><thead><tr><th>Area</th><th className="num">People/day</th><th className="num">Share</th><th>Service</th></tr></thead>
              <tbody>{areas.slice(0, 14).map((a) => <tr key={a.home_area}><td>{a.home_area}</td><td className="num">{n1(a.avg_daily_people)}</td>
                <td className="num">{pct(a.share_of_tower_hour, 1)}</td>
                <td>{a.is_local ? <span className="badge b-muted">local</span> : !a.is_routable_origin ? <span className="badge b-muted">out of region</span>
                  : a.has_service ? <span className="badge b-good">{(a.link_type_used || "").replace(/_/g, " ")}</span> : <span className="badge b-bad">none</span>}</td></tr>)}</tbody></table>
            <p className="muted small">Click a hub to switch, or any stop to see its routes. Flows follow A2: before 19:00 people travel from home to the hub, from 19:00 from the hub home. People are devices seen at the tower — a sample, not boardings.</p>
          </>
        )}
      </aside>
    </div>
  );
}
