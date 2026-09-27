import { useEffect, useMemo, useState } from "react";
import { get, post } from "../api";
import type { Shared } from "../App";
import { HUB_HEX, HUB_NAME, fmtDate, hh, loadColor, n0, n1, rgb } from "../util";

function LoadBar({ before, after, label }: { before: number | null; after: number | null; label: string }) {
  const scale = (v: number) => `${Math.min(100, (v / 130) * 100)}%`;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="row small" style={{ justifyContent: "space-between" }}><span className="muted">{label}</span>
        <span><b style={{ color: rgb(loadColor(before)) }}>{n0(before)}%</b> → <b style={{ color: rgb(loadColor(after)) }}>{n0(after)}%</b></span></div>
      <div className="loadbar"><div style={{ width: scale(after ?? 0), background: rgb(loadColor(after)) }} />
        <div className="line85" style={{ left: scale(85) }} /></div>
    </div>
  );
}

export default function ControlView({ shared, onReplay }: { shared: Shared; onReplay: (d: string) => void }) {
  const { meta } = shared;
  const [date, setDate] = useState("2026-06-24");
  const [hub, setHub] = useState("ALL");
  const [plan, setPlan] = useState<any>(null);
  const [hindsight, setHindsight] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setPlan(null); get(`/api/plan?date=${date}`).then(setPlan).catch((e) => setErr(String(e.message))); }, [date]);
  const moves = useMemo(() => (plan?.moves || []).filter((m: any) => hub === "ALL" || m.tower_id === hub), [plan, hub]);
  const byHour = useMemo(() => {
    const g: Record<number, any[]> = {};
    for (const m of moves) (g[m.hour] ||= []).push(m);
    return Object.entries(g).sort((a, b) => +a[0] - +b[0]);
  }, [moves]);

  const act = async (move_id: string, action: string) => {
    setBusy(move_id); setErr(null);
    try { const r = await post("/api/actions", { move_id, action }); setPlan((p: any) => ({ ...p, actions: r.actions })); }
    catch (e: any) { setErr(String(e.message)); } finally { setBusy(null); }
  };
  const d = plan?.day;
  const n = (t: string) => moves.filter((m: any) => m.move_type === t).length;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 12 }}>
        {meta.presets.map((p: any) => <button key={p.date} className={`chip ${date === p.date ? "on" : ""}`} onClick={() => setDate(p.date)}>{p.label}</button>)}
        <input type="date" value={date} min={meta.first_date} max={meta.last_date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <div className="seg">{["ALL", "UBC", "WF", "PR"].map((h) => <button key={h} className={hub === h ? "on" : ""} onClick={() => setHub(h)}>{h === "ALL" ? "All hubs" : HUB_NAME[h]}</button>)}</div>
        <label className="row small"><input type="checkbox" checked={hindsight} onChange={(e) => setHindsight(e.target.checked)} />Show hindsight (was it a real surge?)</label>
        <button className="btn primary" onClick={() => onReplay(date)}>Replay this day ▶</button>
      </div>
      {meta.presets.find((p: any) => p.date === date) && <div className="note" style={{ marginBottom: 12 }}>{meta.presets.find((p: any) => p.date === date).note}</div>}
      {err && <p className="err">{err}</p>}
      {d && (
        <div className="cards" style={{ marginBottom: 16 }}>
          <div className="card"><h4>{fmtDate(date)}</h4><div className="big">{n0(d.surge_hours)}</div><div className="muted">A10 surge hub-hours{d.event_name ? ` · ${d.event_name}` : ""}{d.holiday_name ? ` · ${d.holiday_name}` : ""}{d.is_ubc_exam ? " · UBC exams" : ""}</div></div>
          <div className="card"><h4>Recommended moves</h4><div className="big">{n0(n("reallocate"))}</div><div className="muted">{n0(d.buses_moved_in)} bus-hours · {n1(d.deadhead_km)} km deadhead · {n("extra night trip")} extra night trips · {n("unmet need")} unmet needs</div></div>
          <div className="card"><h4>People above 85% full</h4><div className="big">{n0(d.pa85_scheduled)} → {n0(d.pa85_hub_pulse)}</div><div className="muted">as scheduled → with Hub Pulse (avoided {n0(d.avoided_people_above_85)})</div></div>
          <div className="card"><h4>Crowded route-hours</h4><div className="big">{n0(d.crowded_scheduled)} → {n0(d.crowded_hub_pulse)}</div><div className="muted">route-hours above 85% full</div></div>
        </div>
      )}
      {!plan && !err && <p className="muted">Loading…</p>}
      {plan && !moves.length && <div className="card"><b>No moves recommended.</b><p className="muted">No surge was forecast 2 hours ahead at {hub === "ALL" ? "any hub" : HUB_NAME[hub]} on this day, so the timetable runs as scheduled. That's the point: the plan only acts on forecast surges.</p></div>}
      {byHour.map(([h, ms]) => (
        <div key={h} style={{ marginBottom: 14 }}>
          <h3 style={{ margin: "6px 0" }}>{hh(+h)} <span className="muted small">— decided at {hh(+h - 2)} on the 2-hour forecast</span></h3>
          <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
            {ms.map((m: any) => {
              const a = plan.actions[m.move_id];
              const cls = m.move_type === "unmet need" ? "unmet" : m.move_type === "extra night trip" ? "night" : "";
              return (
                <div key={m.move_id} className={`card move ${cls}`}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b>{m.move_type === "reallocate" ? `Move ${m.buses} bus${m.buses > 1 ? "es" : ""}: route ${m.from_line} → route ${m.to_line}`
                      : m.move_type === "extra night trip" ? `Extra night trip on route ${m.to_line}` : `Route ${m.to_line} needs ${m.trips_needed} more trip(s)`}</b>
                    <span className="badge" style={{ background: HUB_HEX[m.tower_id], color: "#fff" }}>{HUB_NAME[m.tower_id]}</span>
                  </div>
                  <p className="small" style={{ margin: "6px 0" }}>{m.reason}</p>
                  {m.move_type !== "extra night trip" && <LoadBar label={`Route ${m.to_line} (receives)`} before={m.to_load_before} after={m.to_load_after} />}
                  {m.move_type === "reallocate" && <LoadBar label={`Route ${m.from_line} (donor, ${m.deadhead_km} km away)`} before={m.from_load_before} after={m.from_load_after} />}
                  {m.drivers && <p className="muted small" style={{ margin: "6px 0 0" }}>Forecast drivers: {m.drivers}</p>}
                  {m.top_home_areas && <p className="muted small" style={{ margin: "2px 0 0" }}>Carries people from {m.top_home_areas}</p>}
                  <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                    {m.move_type !== "unmet need" ? (
                      <div className="row">
                        <button className={`btn good ${a?.action === "accept" ? "on" : ""}`} disabled={busy === m.move_id} onClick={() => act(m.move_id, "accept")}>✓ Accept</button>
                        <button className={`btn bad ${a?.action === "dismiss" ? "on" : ""}`} disabled={busy === m.move_id} onClick={() => act(m.move_id, "dismiss")}>Dismiss</button>
                        {a && <span className="muted small">{a.action}ed by {a.acted_by}</span>}
                      </div>) : <span className="muted small">Needs new service: no spare bus within reach (A19)</span>}
                    {hindsight && m.move_type !== "extra night trip" && (m.actual_is_surge ? <span className="badge b-good">real surge ({m.actual_ratio}×)</span> : <span className="badge b-warn">false alarm ({m.actual_ratio}×)</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
