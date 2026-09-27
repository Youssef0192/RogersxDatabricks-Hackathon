# Hub Pulse — Rogers × Databricks hackathon

Predicts demand surges at three Vancouver transit hubs (UBC, Waterfront Station, Park Royal) from cell-tower pings and recommends moving spare buses from nearby routes.

`app/` is the Databricks App (FastAPI backend + React/deck.gl front end):

- `app.py`, `db.py` — API over the Unity Catalog gold tables through the SQL warehouse (app resources `sql-warehouse` and `genie-space`, see `app.yaml`).
- `static/` — the built front end served by FastAPI. Rebuild with `cd app/frontend && npm ci && npm run build`.
- Tabs: Map, Forecast, Crowd control, Replay (as scheduled vs with Hub Pulse), Ask Genie, Method.

The data is synthetic; pings are people seen at a tower, not boardings. See the Method tab for assumptions and limits.
