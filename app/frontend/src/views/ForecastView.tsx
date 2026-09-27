import { useEffect, useMemo, useState } from "react";
import { get } from "../api";
import type { Shared } from "../App";
import { HUB_HEX, HUB_NAME, fmtDate, hh, n0, pct } from "../util";

export default function ForecastView({ shared }: { shared: Shared }) {
  const { meta } = shared;
  const [hub, setHub] = useState("WF");
  const [date, setDate] = useState("2026-06-24");
  const [hour, setHour] = useState(7);
  const [reveal, setReveal] = useState(false);
  const [fc, setFc] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setErr(null); get(`/api/forecast?hub=${hub}&date=${date}&hour=${hour}`).then(setFc).catch((e) => setErr(String(e.message))); }, [hub, date, hour]);

  const day = useMemo(() => {
    const byHour: any[] = Array.from({ length: 24 }, (_, h) => ({ h }));
    for (const r of fc?.day || []) {
      if (r.horizon_h === 1) Object.assign(byHour[r.hour], { actual: r.actual_people, normal: r.baseline_people, f1: r.predicted_people, surge: r.actual_is_surge });
    }
    return byHour;
  }, [fc]);
  const maxY = Math.max(1, ...day.map((d) => Math.max(d.actual || 0, d.normal || 0, d.f1 || 0)));
  const X = (h: number) => 30 + h * 26, Y = (v: number) => 180 - (160 * v) / maxY;
  const line = (k: string) => day.filter((d) => d[k] != null).map((d, i) => `${i ? "L" : "M"}${X(d.h)},${Y(d[k])}`).join(" ");

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">{["UBC", "WF", "PR"].map((h) => <button key={h} className={hub === h ? "on" : ""} onClick={() => setHub(h)}>{HUB_NAME[h]}</button>)}</div>
        <input type="date" value={date} min={meta.first_date} max={meta.last_date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <span className="muted">It is</span><b>{hh(hour)}</b>
        <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(+e.target.value)} style={{ width: 240 }} />
        <label className="row small"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />Show what actually happened</label>
      </div>
      <div className="note" style={{ marginBottom: 14 }}>
        Replay mode: the data ends on {fmtDate(meta.last_date)}, so pick any moment between {fmtDate(meta.first_date)} and then. Each forecast only uses data up to that moment
        (walk-forward models before Jul 20; the registered model <code>gold.hub_surge_forecaster@prod</code> from Jul 20). A <b>surge</b> is ≥ 1.25× the same weekday-hour median of the previous 6 weeks (A10).
      </div>
      {err && <p className="err">{err}</p>}
      <div className="cards">
        {(fc?.ahead || []).map((f: any) => {
          const hot = f.predicted_surge;
          return (
            <div className="card" key={f.horizon_h} style={{ borderTop: `4px solid ${hot ? "var(--bad)" : HUB_HEX[hub]}` }}>
              <h4>{f.horizon_h} h ahead · {hh(hour + f.horizon_h)} at {HUB_NAME[hub]}</h4>
              <div className="big">{n0(f.predicted_people)} <span className="muted" style={{ fontSize: 14 }}>people</span></div>
              <div className="muted">Normal for this hour: {n0(f.baseline_people)} · <b style={{ color: f.predicted_ratio >= 1.25 ? "var(--bad)" : "var(--ink)" }}>{f.predicted_ratio?.toFixed(2)}× normal</b></div>
              <div style={{ margin: "10px 0 4px" }} className="row">
                <span className="muted small">P(surge)</span>
                <div className="loadbar" style={{ flex: 1 }}><div style={{ width: `${Math.min(100, f.p_surge * 100)}%`, background: hot ? "var(--bad)" : "var(--accent)" }} />
                  <div className="line85" style={{ left: `${f.surge_threshold * 100}%` }} title="alert threshold" /></div>
                <b>{pct(f.p_surge, 0)}</b>
              </div>
              {hot ? <span className="badge b-bad">Surge alert</span> : <span className="badge b-muted">{f.surge_eligible ? "No surge expected" : "Too few people for a surge flag"}</span>}
              <h4 style={{ marginTop: 10 }}>Why</h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{(f.drivers || "").split("; ").map((d: string) => <li key={d}>{d}</li>)}</ul>
              {reveal && <div className="note" style={{ marginTop: 10 }}>Actual: <b>{n0(f.actual_people)}</b> people · {f.actual_is_surge ? <span className="badge b-bad">was a surge</span> : <span className="badge b-good">no surge</span>}</div>}
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h4>{HUB_NAME[hub]} on {fmtDate(date)}: normal level vs the forecast made 1 hour earlier{reveal ? " vs what happened" : ""}</h4>
        <svg viewBox="0 0 660 210" width="100%" style={{ maxHeight: 260 }}>
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={30} x2={640} y1={Y(maxY * f)} y2={Y(maxY * f)} stroke="#e2e7ee" /><text x={0} y={Y(maxY * f) + 4} fontSize={10} fill="#5d6b7a">{n0(maxY * f)}</text></g>)}
          {day.map((d) => <text key={d.h} x={X(d.h) - 6} y={200} fontSize={9} fill="#5d6b7a">{d.h % 3 === 0 ? String(d.h).padStart(2, "0") : ""}</text>)}
          {reveal && day.filter((d) => d.surge).map((d) => <rect key={d.h} x={X(d.h) - 13} y={20} width={26} height={160} fill="rgba(214,69,69,0.08)" />)}
          <rect x={X(hour)} y={20} width={X(Math.min(23, hour + 3)) - X(hour)} height={160} fill="rgba(34,114,180,0.07)" />
          <line x1={X(hour)} x2={X(hour)} y1={16} y2={182} stroke="#2272b4" strokeDasharray="4 3" /><text x={X(hour) + 4} y={14} fontSize={10} fill="#2272b4">now</text>
          <path d={line("normal")} fill="none" stroke="#9aa6b2" strokeWidth={2} strokeDasharray="5 4" />
          <path d={line("f1")} fill="none" stroke={HUB_HEX[hub]} strokeWidth={2.5} />
          {reveal && <path d={line("actual")} fill="none" stroke="#18222e" strokeWidth={1.5} />}
        </svg>
        <div className="row small muted"><span style={{ color: "#9aa6b2" }}>- - normal (A10)</span><span style={{ color: HUB_HEX[hub] }}>— forecast 1 h ahead</span>{reveal && <span>— actual (red bands = surge hours)</span>}</div>
      </div>
    </div>
  );
}
