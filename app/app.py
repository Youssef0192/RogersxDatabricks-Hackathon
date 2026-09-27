"""Hub Pulse — FastAPI backend for the Databricks App.

Serves the React front end (static/) and a JSON API over the gold / gold_insights tables:
map (routes, stops, flows), forecast, crowd control plan + dispatcher actions, the split-screen replay, and Genie chat.
Every number the UI shows comes from these tables; nothing is recomputed here.
"""
import json
import os
import re
import threading
import time
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from db import GOLD, SILVER, client, query

app = FastAPI(title="Hub Pulse")
STATIC = Path(__file__).parent / "static"
HUBS = ("UBC", "WF", "PR")
DAY_TYPES = ("MF", "Sat", "Sun/Hol")
SEASONS = ("Fall", "Summer")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STOP_RE = re.compile(r"^[\w.-]{1,32}$")
PRESETS = [
    {"date": "2026-06-24", "label": "FIFA match day", "note": "Canada match at BC Place: the only FIFA day with a real Waterfront surge in this data (most match days show none, H03)."},
    {"date": "2025-12-15", "label": "UBC exam period", "note": "Monday of Term 1 exams. UBC itself is quieter than usual; the surge is Christmas shopping at Park Royal."},
    {"date": "2026-03-24", "label": "Normal Tuesday", "note": "No surge at any hub: the plan should do (almost) nothing, and it doesn't."},
]

_data: dict = {}
_ready = threading.Event()
_error: list[str] = []
_cache: dict = {}
_lock = threading.Lock()


def _load():
    try:
        t0 = time.time()
        _data["hubs"] = query(f"SELECT tower_id, location_name, area_name, latitude AS lat, longitude AS lon FROM {SILVER}.dim_tower ORDER BY tower_id")
        _data["areas"] = query(f"SELECT area_name, latitude AS lat, longitude AS lon, region, is_routable, home_tower_id FROM {SILVER}.dim_area ORDER BY area_name")
        routes = query(f"SELECT route_id, line, route_name, mode, serves_hubs, path_json FROM {GOLD}.app_route_shapes")
        for r in routes:
            r["path"] = json.loads(r.pop("path_json"))
        _data["routes"] = routes
        _data["stops"] = query(f"SELECT stop_id, stop_name, lat, lon, tower_id, lines FROM {GOLD}.app_stops")
        _data["flows"] = query(f"""
            SELECT tower_id, tspr_season, day_type, hour, travel_purpose, home_area, home_region, is_local, is_routable_origin,
              avg_daily_people, share_of_tower_hour, connecting_departures, has_service, link_type_used
            FROM {GOLD}.area_flows_hourly""")
        _data["plan"] = query(f"""
            SELECT move_id, CAST(date AS STRING) AS date, hour, tower_id, method, move_type, from_route_id, from_line, from_route_name,
              to_route_id, to_line, to_route_name, buses, round(deadhead_km, 1) AS deadhead_km, reason, round(forecast_ratio, 2) AS forecast_ratio,
              round(p_surge, 2) AS p_surge, drivers, top_home_areas, to_departures, round(to_load_before, 1) AS to_load_before,
              round(to_load_after, 1) AS to_load_after, trips_needed, trips_covered, from_departures, round(from_load_before, 1) AS from_load_before,
              round(from_load_after, 1) AS from_load_after, round(actual_ratio, 2) AS actual_ratio, actual_is_surge, areas,
              round(forecast_people, 0) AS forecast_people, actual_people
            FROM {GOLD}.reallocation_plan WHERE method IN ('optimal', 'night extension')""")
        _data["days"] = query(f"""
            SELECT CAST(d.date AS STRING) AS date, d.weekday, d.day_type, d.is_holiday, d.holiday_name, d.is_ubc_exam, d.event_name,
              d.surge_hours, a.people_above_85 AS pa85_scheduled, d.people_above_85 AS pa85_hub_pulse, d.avoided_people_above_85,
              a.crowded_route_hours AS crowded_scheduled, d.crowded_route_hours AS crowded_hub_pulse, d.avoided_crowded_route_hours,
              a.people_no_service AS no_service_scheduled, d.people_no_service AS no_service_hub_pulse, d.avoided_people_no_service,
              d.buses_moved_in, d.extra_trips, round(d.deadhead_km, 1) AS deadhead_km
            FROM {GOLD}.counterfactual_daily_summary d
            JOIN {GOLD}.counterfactual_daily_summary a ON a.date = d.date AND a.tower_id = d.tower_id AND a.scenario = 'actual'
            WHERE d.scenario = 'hub_pulse' AND d.tower_id = 'ALL' ORDER BY d.date""")
        _data["backtest"] = {f"{r['scenario']}|{r['metric']}": r["value"] for r in query(f"SELECT scenario, metric, value FROM {GOLD}.reallocation_backtest")}
        _data["loaded_in_s"] = round(time.time() - t0, 1)
    except Exception as e:  # surfaced by /api/health
        _error.append(f"{type(e).__name__}: {e}")
    finally:
        _ready.set()


@app.on_event("startup")
def startup():
    threading.Thread(target=_load, daemon=True).start()


def data(key):
    if not _ready.wait(timeout=180):
        raise HTTPException(503, "Still loading data from the SQL warehouse; try again in a moment.")
    if _error:
        raise HTTPException(500, f"Data load failed: {_error[0]}")
    return _data[key]


def cached(key, fn):
    with _lock:
        if key in _cache:
            return _cache[key]
    val = fn()
    with _lock:
        _cache[key] = val
    return val


def check(value, allowed, name):
    if value not in allowed:
        raise HTTPException(400, f"{name} must be one of {allowed}")


def check_date(d):
    if not DATE_RE.match(d or ""):
        raise HTTPException(400, "date must be YYYY-MM-DD")


# ---------------------------------------------------------------- API

@app.get("/api/health")
def health():
    return {"ready": _ready.is_set(), "error": _error[0] if _error else None, "loaded_in_s": _data.get("loaded_in_s")}


@app.get("/api/meta")
def meta():
    days = data("days")
    return {"hubs": data("hubs"), "areas": data("areas"), "presets": PRESETS, "first_date": days[0]["date"], "last_date": days[-1]["date"],
            "backtest": data("backtest")}


@app.get("/api/routes")
def routes():
    return data("routes")


@app.get("/api/stops")
def stops():
    return data("stops")


@app.get("/api/flows")
def flows(hub: str, hour: int, day_type: str = "MF", season: str = "Fall"):
    check(hub, HUBS, "hub"); check(day_type, DAY_TYPES, "day_type"); check(season, SEASONS, "season")
    rows = [r for r in data("flows") if r["tower_id"] == hub and r["hour"] == hour and r["day_type"] == day_type and r["tspr_season"] == season]
    rows.sort(key=lambda r: -(r["avg_daily_people"] or 0))
    return {"hub": hub, "hour": hour, "day_type": day_type, "season": season,
            "travel_purpose": rows[0]["travel_purpose"] if rows else ("to_work" if 5 <= hour <= 18 else "to_home"),
            "total_people": round(sum(r["avg_daily_people"] or 0 for r in rows), 1), "areas": rows}


@app.get("/api/stop/{stop_id}")
def stop(stop_id: str, day_type: str = "MF", season: str = "Fall"):
    if not STOP_RE.match(stop_id):
        raise HTTPException(400, "bad stop id")
    check(day_type, DAY_TYPES, "day_type"); check(season, SEASONS, "season")

    def load():
        svc = query(f"""SELECT hour, line, route_id, departures FROM {GOLD}.app_stop_service
                        WHERE stop_id = :stop AND day_type = :dt ORDER BY hour, line""", {"stop": stop_id, "dt": day_type})
        loads = query(f"""
            SELECT c.line, c.hour, c.tspr_peak_load_pct, c.capacity_status, c.scheduled_trips
            FROM {GOLD}.route_capacity_hourly c
            WHERE c.day_type = :dt AND c.tspr_season = :season
              AND c.route_id IN (SELECT DISTINCT route_id FROM {GOLD}.app_stop_service WHERE stop_id = :stop)""",
                      {"stop": stop_id, "dt": day_type, "season": season})
        return {"service": svc, "loads": loads}
    info = next((s for s in data("stops") if s["stop_id"] == stop_id), None)
    if not info:
        raise HTTPException(404, "unknown stop")
    return {"stop": info, **cached(("stop", stop_id, day_type, season), load)}


@app.get("/api/forecast")
def forecast(hub: str, date: str, hour: int):
    check(hub, HUBS, "hub"); check_date(date)
    made_at = f"{date} {hour:02d}:00:00"

    def day_rows():
        return query(f"""
            SELECT hour(target_ts) AS hour, horizon_h, predicted_people, baseline_people, actual_people, p_surge, predicted_surge, actual_is_surge
            FROM {GOLD}.hub_surge_forecast WHERE tower_id = :hub AND target_date = :d ORDER BY hour, horizon_h""", {"hub": hub, "d": date})

    ahead = query(f"""
        SELECT horizon_h, CAST(target_ts AS STRING) AS target_ts, predicted_people, round(predicted_ratio, 2) AS predicted_ratio, baseline_people,
          round(p_surge, 3) AS p_surge, surge_threshold, predicted_surge, drivers, top_driver, actual_people, actual_is_surge, surge_eligible, eval_window
        FROM {GOLD}.hub_surge_forecast WHERE tower_id = :hub AND forecast_made_at = CAST(:t AS TIMESTAMP_NTZ) ORDER BY horizon_h""",
                  {"hub": hub, "t": made_at})
    return {"hub": hub, "made_at": made_at, "ahead": ahead, "day": cached(("fcday", hub, date), day_rows)}


@app.get("/api/days")
def days():
    return data("days")


def actions_for(date):
    return {r["move_id"]: r for r in query(f"""
        SELECT move_id, max_by(action, acted_at) AS action, max_by(acted_by, acted_at) AS acted_by, CAST(max(acted_at) AS STRING) AS acted_at
        FROM {GOLD}.dispatcher_actions WHERE plan_date = CAST(:d AS DATE) GROUP BY move_id""", {"d": date})}


@app.get("/api/plan")
def plan(date: str):
    check_date(date)
    moves = [m for m in data("plan") if m["date"] == date]
    moves.sort(key=lambda m: (m["hour"], m["tower_id"], m["move_type"] != "reallocate", m["to_line"] or ""))
    return {"date": date, "moves": moves, "actions": actions_for(date), "day": next((d for d in data("days") if d["date"] == date), None)}


class Action(BaseModel):
    move_id: str = Field(..., max_length=64)
    action: str = Field(..., pattern="^(accept|dismiss)$")


@app.post("/api/actions")
def act(a: Action, request: Request):
    move = next((m for m in data("plan") if m["move_id"] == a.move_id), None)
    if not move:
        raise HTTPException(404, "unknown move")
    who = request.headers.get("x-forwarded-email") or request.headers.get("x-forwarded-preferred-username") or "local developer"
    query(f"""INSERT INTO {GOLD}.dispatcher_actions VALUES (:m, :a, :who, current_timestamp(), CAST(:d AS DATE), :t)""",
          {"m": a.move_id, "a": a.action, "who": who, "d": move["date"], "t": move["tower_id"]})
    return {"ok": True, "actions": actions_for(move["date"])}


@app.get("/api/replay")
def replay(date: str):
    check_date(date)

    def load():
        loads = query(f"""
            SELECT hour, tower_id, route_id, line, role, scenario, scheduled_departures, departures, buses_moved_in, buses_moved_out, extra_trips,
              round(projected_load_pct, 1) AS load_pct, round(people_above_85, 1) AS people_above_85, people_no_service
            FROM {GOLD}.counterfactual_hourly WHERE date = CAST(:d AS DATE) AND scenario IN ('actual', 'hub_pulse')""", {"d": date})
        counters = query(f"""
            SELECT hour, tower_id, scenario, crowded_route_hours, people_above_85, people_no_service, buses_moved_in, extra_trips,
              cum_crowded_route_hours, cum_people_above_85, cum_people_no_service, cum_buses_moved_in, cum_extra_trips
            FROM {GOLD}.counterfactual_hub_hourly WHERE date = CAST(:d AS DATE) AND scenario IN ('actual', 'hub_pulse') ORDER BY hour""", {"d": date})
        return {"loads": loads, "counters": counters}
    moves = [m for m in data("plan") if m["date"] == date and m["buses"] and m["buses"] > 0]
    return {"date": date, **cached(("replay", date), load), "moves": moves, "day": next((d for d in data("days") if d["date"] == date), None)}


class Ask(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)
    conversation_id: str | None = Field(None, max_length=64)


@app.post("/api/genie")
def genie(q: Ask, request: Request):
    space = os.getenv("GENIE_SPACE_ID")
    if not space:
        raise HTTPException(500, "GENIE_SPACE_ID is not set (app resource 'genie-space')")
    user_token = request.headers.get("x-forwarded-access-token")
    host = client().config.host.rstrip("/")

    def call(method, path, body=None):
        if user_token:  # on behalf of the signed-in user (scope dashboards.genie)
            r = requests.request(method, f"{host}{path}", json=body, headers={"Authorization": f"Bearer {user_token}"}, timeout=60)
            if r.status_code >= 400:
                raise HTTPException(r.status_code, r.text[:300])
            return r.json()
        return client().api_client.do(method, path, body=body)

    base = f"/api/2.0/genie/spaces/{space}"
    if q.conversation_id:
        m = call("POST", f"{base}/conversations/{q.conversation_id}/messages", {"content": q.question})
        conv, msg = q.conversation_id, m["id"] if "id" in m else m["message_id"]
    else:
        m = call("POST", f"{base}/start-conversation", {"content": q.question})
        conv, msg = m["conversation_id"], m["message_id"]
    deadline = time.time() + 120
    while True:
        m = call("GET", f"{base}/conversations/{conv}/messages/{msg}")
        if m.get("status") in ("COMPLETED", "FAILED", "CANCELLED") or time.time() > deadline:
            break
        time.sleep(2)
    out = {"conversation_id": conv, "status": m.get("status"), "error": (m.get("error") or {}).get("error"), "text": None, "sql": None,
           "description": None, "columns": [], "rows": []}
    for a in m.get("attachments") or []:
        if a.get("text"):
            out["text"] = a["text"].get("content")
        if a.get("query"):
            out["sql"], out["description"] = a["query"].get("query"), a["query"].get("description")
            try:
                res = call("GET", f"{base}/conversations/{conv}/messages/{msg}/attachments/{a['attachment_id']}/query-result")
                sr = res.get("statement_response", {})
                out["columns"] = [c["name"] for c in sr.get("manifest", {}).get("schema", {}).get("columns", [])]
                out["rows"] = (sr.get("result", {}).get("data_array") or [])[:50]
            except Exception as e:  # the answer text is still useful without the table
                out["error"] = out["error"] or f"result: {e}"
    return out


# ---------------------------------------------------------------- front end

if (STATIC / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")


@app.get("/{path:path}")
def spa(path: str):
    f = STATIC / path
    if path and f.is_file() and STATIC in f.resolve().parents:
        return FileResponse(f)
    index = STATIC / "index.html"
    if not index.exists():
        return JSONResponse({"error": "front end not built: run npm run build in frontend/"}, status_code=404)
    return FileResponse(index)
