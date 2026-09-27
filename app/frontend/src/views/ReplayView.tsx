import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ArcLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import Map from "react-map-gl/maplibre";
import { get } from "../api";
import type { Shared } from "../App";
import { BAD, BASEMAP, GOOD, HUB_COLOR, HUB_NAME, NODATA, WARN, clamp, fmtDate, hh, loadColor, n0, nearestPoint, rgb } from "../util";

const SECONDS_PER_HOUR = 1.4;
const VIEW = { longitude: -123.12, latitude: 49.285, zoom: 10.25, pitch: 0, bearing: 0 };
const NIGHT: [number, number, number] = [124, 92, 196];

type Side = "actual" | "hub_pulse";

export default function ReplayView({ shared, date, setDate }: { shared: Shared; date: string; setDate: (d: string) => void }) {
  const { meta, routes } = shared;
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(6);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<any>(VIEW);
  const [showMethod, setShowMethod] = useState(false);
  const raf = useRef<number>();

  useEffect(() => {
    setData(null); setErr(null); setPlaying(false); setT(6);
    get(`/api/replay?date=${date}`).then(setData).catch((e) => setErr(String(e.message)));
  }, [date]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setT((v) => {
        const nv = v + (dt * speed) / SECONDS_PER_HOUR;
        if (nv >= 23.999) { setPlaying(false); return 23.999; }
        return nv;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed]);

  const hour = Math.min(23, Math.floor(t));
  const hubs = meta.hubs as any[];
  const hubXY = Object.fromEntries(hubs.map((h) => [h.tower_id, [h.lon, h.lat]]));
  const routeById = useMemo(() => Object.fromEntries(routes.map((r: any) => [r.route_id, r])), [routes]);

  const idx = useMemo(() => {
    const m: Record<string, any> = {};
    const ids = new Set<string>();
    for (const r of data?.loads || []) {
      if (r.role === "night service") continue;
      m[`${r.scenario}|${r.route_id}|${r.hour}`] = r;
      if (r.route_id && routeById[r.route_id]) ids.add(r.route_id);
    }
    return { m, ids: [...ids] };
  }, [data, routeById]);

  const counters = useMemo(() => {
    const c: Record<string, any> = {};
    for (const r of data?.counters || []) if (r.tower_id === "ALL") c[`${r.scenario}|${r.hour}`] = r;
    return c;
  }, [data]);
  const cur = (s: Side) => counters[`${s}|${hour}`] || {};

  const moves = useMemo(() => (data?.moves || []).map((m: any) => {
    const hub = hubXY[m.tower_id];
    const to = routeById[m.to_route_id], from = m.from_route_id ? routeById[m.from_route_id] : null;
    const dst = to ? nearestPoint(to.path, hub[0], hub[1]) : hub;
    const src = from ? nearestPoint(from.path, hub[0], hub[1]) : dst;
    return { ...m, src, dst };
  }), [data, routeById]);

  const pathsFor = (side: Side) => idx.ids.map((id) => {
    const row = idx.m[`${side}|${id}|${hour}`];
    return { route: routeById[id], row, color: row ? loadColor(row.load_pct) : NODATA, running: !!row };
  });

  const layersFor = (side: Side) => {
    const L: any[] = [
      new PathLayer({ id: `p-${side}`, data: pathsFor(side), getPath: (d: any) => d.route.path, widthUnits: "pixels",
        getWidth: (d: any) => (d.row?.role === "donor route" ? 2.5 : 3.5), getColor: (d: any) => [...d.color, d.running ? 235 : 70],
        pickable: true, updateTriggers: { getColor: [hour, date], getWidth: [hour, date] } }),
      new ScatterplotLayer({ id: `h-${side}`, data: hubs, getPosition: (h: any) => [h.lon, h.lat], radiusUnits: "pixels", getRadius: 9,
        getFillColor: (h: any) => [...HUB_COLOR[h.tower_id], 255], stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 2.5 }),
      new TextLayer({ id: `t-${side}`, data: hubs, getPosition: (h: any) => [h.lon, h.lat], getText: (h: any) => HUB_NAME[h.tower_id], getSize: 12,
        getPixelOffset: [0, -18], fontWeight: 700, background: true, getBackgroundColor: [255, 255, 255, 220], backgroundPadding: [3, 1] }),
    ];
    if (side === "hub_pulse") {
      const active = moves.filter((m: any) => m.move_type === "reallocate" && t >= m.hour - 0.7 && t < m.hour + 1);
      const travel = active.map((m: any) => {
        const p = clamp((t - (m.hour - 0.7)) / 0.7, 0, 1), e = p * p * (3 - 2 * p);
        return { ...m, pos: [m.src[0] + (m.dst[0] - m.src[0]) * e, m.src[1] + (m.dst[1] - m.src[1]) * e], arrived: p >= 1 };
      });
      const nights = moves.filter((m: any) => m.move_type === "extra night trip" && t >= m.hour && t < m.hour + 1);
      L.push(
        new ArcLayer({ id: "arcs", data: active, getSourcePosition: (m: any) => m.src, getTargetPosition: (m: any) => m.dst, getHeight: 0.35,
          getSourceColor: [34, 114, 180, 90], getTargetColor: [34, 114, 180, 200], getWidth: 2, widthUnits: "pixels" }),
        new ScatterplotLayer({ id: "buses", data: travel, getPosition: (m: any) => m.pos, radiusUnits: "pixels", getRadius: (m: any) => (m.arrived ? 7 : 6),
          getFillColor: (m: any) => (m.arrived ? [34, 114, 180, 255] : [255, 255, 255, 255]), stroked: true, getLineColor: [34, 114, 180, 255],
          lineWidthMinPixels: 3, pickable: true, updateTriggers: { getPosition: t, getRadius: t, getFillColor: t } }),
        new ScatterplotLayer({ id: "nights", data: nights, getPosition: (m: any) => hubXY[m.tower_id], radiusUnits: "pixels",
          getRadius: 16 + 8 * Math.abs(Math.sin(t * Math.PI * 3)), filled: false, stroked: true, getLineColor: [...NIGHT, 220], lineWidthMinPixels: 3,
          updateTriggers: { getRadius: t } }),
      );
    }
    return L;
  };

  const tooltip = ({ object, layer }: any) => {
    if (!object) return null;
    if (layer.id.startsWith("p-")) {
      const r = object.row;
      if (!r) return { text: `Route ${object.route.line}: not running at ${hh(hour)}` };
      return { text: `Route ${object.route.line} (${r.role}) at ${hh(hour)}\n${r.load_pct == null ? "no crowding data" : `${n0(r.load_pct)}% full`} · ${r.departures} departures` +
        (r.buses_moved_in ? ` (+${r.buses_moved_in} moved in)` : "") + (r.buses_moved_out ? ` (−${r.buses_moved_out} lent out)` : "") +
        (r.people_above_85 ? `\n${n0(r.people_above_85)} people above the 85% line` : "") };
    }
    if (layer.id === "buses") return { text: `${object.reason}` };
    return null;
  };

  const a = cur("actual"), b = cur("hub_pulse");
  const COUNTERS: [string, string][] = [["cum_crowded_route_hours", "crowded route-hours"], ["cum_people_above_85", "people above 85% full"], ["cum_people_no_service", "people with no bus home"]];
  const nowMoves = moves.filter((m: any) => m.hour === hour);
  const preset = meta.presets.find((p: any) => p.date === date);
  const endDay = data?.day;

  const counterRow = (c: any) => (
    <div className="counters">{COUNTERS.map(([k, label]) => <div className="counter" key={k}><div className="v">{n0(c[k])}</div><div className="l">{label} so far</div></div>)}</div>
  );

  return (
    <div className="replay">
      <div className="bar">
        {meta.presets.map((p: any) => <button key={p.date} className={`chip ${date === p.date ? "on" : ""}`} onClick={() => setDate(p.date)}>{p.label}</button>)}
        <input type="date" value={date} min={meta.first_date} max={meta.last_date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <span className="muted">{fmtDate(date)}</span>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => { if (t >= 23.99) setT(0); setPlaying(!playing); }} disabled={!data}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
        <select value={speed} onChange={(e) => setSpeed(+e.target.value)}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
        <div className="clock">{hh(hour).slice(0, 2)}:{String(Math.floor((t % 1) * 60)).padStart(2, "0")}</div>
        <input type="range" min={0} max={23.99} step={0.01} value={t} onChange={(e) => { setPlaying(false); setT(+e.target.value); }} style={{ width: 260 }} />
        <a href="#" onClick={(e) => { e.preventDefault(); setShowMethod(true); }}>Method</a>
      </div>
      <div className="bar" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {preset ? <span className="muted small">{preset.note}</span> : <span className="muted small">Any day from {fmtDate(meta.first_date)} to {fmtDate(meta.last_date)} can be replayed.</span>}
        <div style={{ flex: 1 }} />
        <span className="small"><span className="legend-sw" style={{ color: rgb(GOOD) }}>━</span> ≤ 85% full <span style={{ color: rgb(WARN) }}>━</span> 85–100% <span style={{ color: rgb(BAD) }}>━</span> over 100% <span style={{ color: rgb(NODATA) }}>━</span> not running / no data · <span style={{ color: "#2272b4" }}>●</span> moved bus · <span style={{ color: rgb(NIGHT) }}>◯</span> extra night trip</span>
      </div>
      {err && <p className="err" style={{ padding: 16 }}>{err}</p>}
      {!data && !err && <p className="muted" style={{ padding: 16 }}>Loading the day…</p>}
      {data && (
        <div className="maps">
          {(["actual", "hub_pulse"] as Side[]).map((side, i) => (
            <div key={side} style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0, gridColumn: i === 0 ? 1 : 3 }}>
              {counterRow(side === "actual" ? a : b)}
              <div className="mapwrap">
                <DeckGL viewState={view} onViewStateChange={(e: any) => setView(e.viewState)} controller layers={layersFor(side)} getTooltip={tooltip}>
                  <Map mapStyle={BASEMAP} />
                </DeckGL>
                <div className="maplabel">{side === "actual" ? "TransLink as scheduled" : "With Hub Pulse"}</div>
              </div>
            </div>
          ))}
          <div className="delta" style={{ gridColumn: 2, gridRow: 1 }}>
            <div className="muted small" style={{ textAlign: "center" }}>Avoided so far</div>
            {COUNTERS.map(([k, label]) => {
              const d = (a[k] || 0) - (b[k] || 0), base = Math.max(1, a[k] || 0);
              return (
                <div className="d" key={k}><b>{n0(d)}</b>{label}
                  <div className="loadbar" style={{ marginTop: 4 }}><div style={{ width: `${clamp((100 * d) / base, 0, 100)}%`, background: "var(--good)" }} /></div>
                </div>
              );
            })}
            <div className="d muted">Cost so far: <b style={{ color: "var(--ink)", display: "inline", fontSize: 14 }}>{n0(b.cum_buses_moved_in)}</b> bus-hours moved, <b style={{ color: "var(--ink)", display: "inline", fontSize: 14 }}>{n0(b.cum_extra_trips)}</b> extra night trips</div>
            {endDay && <div className="muted small">Whole day: {n0(endDay.avoided_people_above_85)} people above 85% avoided ({n0(endDay.pa85_scheduled)} → {n0(endDay.pa85_hub_pulse)}), {n0(endDay.avoided_crowded_route_hours)} crowded route-hours avoided.</div>}
            <div className="small" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <b>{hh(hour)}</b>{nowMoves.length ? ` — ${nowMoves.length} move(s):` : " — no moves"}
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{nowMoves.slice(0, 5).map((m: any) => <li key={m.move_id}>{m.move_type === "reallocate" ? `${HUB_NAME[m.tower_id]}: route ${m.from_line} → ${m.to_line}` : `${HUB_NAME[m.tower_id]}: extra ${m.to_line} trip`}</li>)}</ul>
            </div>
          </div>
        </div>
      )}
      {showMethod && (
        <div className="modal" onClick={() => setShowMethod(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>How this replay is built</h2>
            <p><b>Same day, twice.</b> The left map is the fall 2026 timetable as scheduled; the right map adds the moves Hub Pulse recommended. Both are scored against what actually happened that day.</p>
            <p><b>Decided on the forecast, not on hindsight.</b> Every move is decided 2 hours ahead with the forecast available at that moment (A22), and only when a surge is forecast. Some moves are false alarms, and some surges were missed; both are counted.</p>
            <p><b>Projected loads, not measured boardings.</b> A route's load is its TransLink TSPR 2025 average peak load × the hub's people / normal level for that hour (A20). Pings are people seen at a tower, a sample, not riders (A15). People above the 85% line = (load − 85%) × capacity per bus × departures.</p>
            <p><b>Spare buses.</b> A donor route gives up trips only while it stays at or under 85% full with at least 2 departures an hour (A14), within 10 km, on the same side of Burrard Inlet, and spare for 2+ hours (A19). Moves are matched by a small integer program that covers as much need as possible, then keeps deadhead lowest.</p>
            <p><b>Night.</b> People at a hub in a to-home hour with no connecting service (A2, A11) are counted; an extra trip of the route that last served them directly can be added (A21, 1 bus-hour each). The no-service count is an upper bound because transfers between two night buses aren't modelled (H21).</p>
            <p className="muted">Every number on screen comes from <code>gold.counterfactual_hourly</code>, <code>gold.counterfactual_hub_hourly</code> and <code>gold.counterfactual_daily_summary</code> (built by 06_reallocate.py). The data is synthetic; see the Method tab and the data honesty panel.</p>
            <button className="btn primary" onClick={() => setShowMethod(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
