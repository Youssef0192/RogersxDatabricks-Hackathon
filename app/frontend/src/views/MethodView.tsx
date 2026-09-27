import type { Shared } from "../App";
import { n0, pct } from "../util";

export default function MethodView({ shared }: { shared: Shared }) {
  const bt = shared.meta.backtest || {};
  const v = (k: string) => bt[k];
  const avoided = 1 - v("hub_pulse (optimal)|people_above_85_after") / v("hub_pulse (optimal)|people_above_85_as_scheduled");
  const perfect = (v("hub_pulse (optimal)|people_above_85_as_scheduled") - v("hub_pulse (optimal)|people_above_85_after")) /
    (v("perfect foresight (optimal)|people_above_85_as_scheduled") - v("perfect foresight (optimal)|people_above_85_after"));
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h2>How Hub Pulse works — and what the data can't tell us</h2>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card"><h4>People above 85% full avoided</h4><div className="big">{pct(avoided, 1)}</div><div className="muted">Dec 2025 – Aug 2026 replay</div></div>
        <div className="card"><h4>Of the perfect-foresight benefit</h4><div className="big">{pct(perfect, 0)}</div><div className="muted">deciding on the 2-hour forecast</div></div>
        <div className="card"><h4>Moves on false alarms</h4><div className="big">{pct(v("hub_pulse (optimal)|hub_hours_acted_on_false_alarm") / v("hub_pulse (optimal)|hub_hours_acted_on"), 0)}</div><div className="muted">of hub-hours acted on</div></div>
        <div className="card"><h4>Bus-hours moved</h4><div className="big">{n0(v("hub_pulse (optimal)|bus_hours_moved"))}</div><div className="muted">+ {n0(v("hub_pulse (optimal)|night_extra_trips"))} extra night trips</div></div>
      </div>
      <div className="card" style={{ lineHeight: 1.55, fontSize: 14 }}>
        <h3 style={{ marginTop: 0 }}>Pipeline</h3>
        <p>21.5M cell-tower pings at UBC, Waterfront Station and Park Royal Mall (Nov 2025 – Aug 2026) are cleaned bronze → silver → gold in Unity Catalog and joined to TransLink's fall 2026 GTFS timetable and 2025 Transit Service Performance Review (TSPR). Assumptions A1–A22 are written into the notebook where each is applied.</p>
        <h3>Predict</h3>
        <p>Six LightGBM models forecast people and the surge flag 1, 2 and 3 hours ahead from the last few hours, how busy today has been versus normal, and the calendar. They beat the weekday-hour median, last week and persistence on people (MAE 65 vs 206 / 165 / 74 people, 1 hour ahead); on surge flags they only beat "it's surging now" 2–3 hours ahead. Registered as <code>gold.hub_surge_forecaster@prod</code>; every hour from December has a walk-forward forecast made only from earlier data.</p>
        <h3>Recommend</h3>
        <p>Two hours before a forecast surge, each route serving the hub is projected at its TSPR peak load × the forecast ratio to normal (A20). Routes above 85% get buses from nearby spare routes that stay at or under 85% (A14, A19), matched by an integer program. At night, an extra trip is added when people are forecast with no bus home (A21).</p>
        <h3>What to keep in mind</h3>
        <ul>
          <li><b>The data is synthetic.</b> Its daily shape matches real SkyTrain counts at Waterfront (r = 0.92), but most surges have no calendar cause, FIFA match days don't lift Waterfront, and the origin mix is flat across months.</li>
          <li><b>Pings are people seen at a tower, not riders.</b> Crowding comes from TSPR 2025 averages scaled by demand ratios; nothing here is a measured boarding.</li>
          <li><b>The timetable is fall 2026</b> while the pings run Nov 2025 – Aug 2026, so summer service cuts aren't in it.</li>
          <li><b>Late-night no-service counts are an upper bound:</b> transfers between two night buses aren't modelled.</li>
          <li><b>Area centres are hand-geocoded</b>, so map arcs show approximate origins, not boundaries.</li>
        </ul>
        <p className="muted">The full list — 21 findings with the number behind each — is the data honesty page of the dashboard (<code>gold_insights.data_honesty</code>). Code: <code>hub_pulse/medallion/</code> (notebooks 01–08), this app in <code>hub_pulse/app_v2/</code>.</p>
      </div>
    </div>
  );
}
