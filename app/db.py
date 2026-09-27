"""Data access for the Hub Pulse app: SQL warehouse via the Databricks SDK statement API (app service principal)."""
import os
import time
from datetime import date, datetime

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import Disposition, Format, StatementParameterListItem, StatementState

CATALOG = "rgersxdatabricks_hackathon"
GOLD, INSIGHTS, SILVER = f"{CATALOG}.gold", f"{CATALOG}.gold_insights", f"{CATALOG}.silver"

_client: WorkspaceClient | None = None


def client() -> WorkspaceClient:
    """App service principal inside Databricks Apps; the local CLI profile (DATABRICKS_CONFIG_PROFILE) in development."""
    global _client
    if _client is None:
        _client = WorkspaceClient()
    return _client


def warehouse_id() -> str:
    wid = os.getenv("DATABRICKS_WAREHOUSE_ID")
    if not wid:
        raise RuntimeError("DATABRICKS_WAREHOUSE_ID is not set (app resource 'sql-warehouse')")
    return wid


def _convert(value, type_name):
    if value is None:
        return None
    if type_name in ("INT", "LONG", "SHORT", "BYTE"):
        return int(value)
    if type_name in ("DOUBLE", "FLOAT", "DECIMAL"):
        return float(value)
    if type_name == "BOOLEAN":
        return value in ("true", "True", True)
    return value


def query(sql: str, params: dict | None = None, timeout_s: int = 120) -> list[dict]:
    """Run one statement and return rows as dicts. Parameters are bound with :name markers (never string-formatted)."""
    w = client()
    items = [StatementParameterListItem(name=k, value=None if v is None else str(v)) for k, v in (params or {}).items()]
    resp = w.statement_execution.execute_statement(statement=sql, warehouse_id=warehouse_id(), parameters=items or None,
                                                   wait_timeout="30s", format=Format.JSON_ARRAY, disposition=Disposition.INLINE)
    deadline = time.time() + timeout_s
    while resp.status.state in (StatementState.PENDING, StatementState.RUNNING):
        if time.time() > deadline:
            w.statement_execution.cancel_execution(resp.statement_id)
            raise TimeoutError(f"query timed out after {timeout_s}s")
        time.sleep(1)
        resp = w.statement_execution.get_statement(resp.statement_id)
    if resp.status.state != StatementState.SUCCEEDED:
        raise RuntimeError(f"query {resp.status.state}: {resp.status.error.message if resp.status.error else ''}")
    cols = [(c.name, c.type_name.value if c.type_name else "STRING") for c in resp.manifest.schema.columns]
    rows = list(resp.result.data_array or []) if resp.result else []
    chunk = resp.result.next_chunk_index if resp.result else None
    while chunk is not None:
        part = w.statement_execution.get_statement_result_chunk_n(resp.statement_id, chunk)
        rows.extend(part.data_array or [])
        chunk = part.next_chunk_index
    return [{name: _convert(v, t) for (name, t), v in zip(cols, row)} for row in rows]


def iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v
