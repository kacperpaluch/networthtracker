import json
import logging
import os
import sqlite3
import tempfile
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

import db

logger = logging.getLogger(__name__)


async def _auto_backup():
    try:
        db.create_backup()
        logger.info("Auto-backup zakończony pomyślnie")
    except Exception as e:
        logger.error("Błąd auto-backupu: %s", e)


def _cron_trigger(expr: str) -> CronTrigger:
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError("Wyrażenie cron musi mieć 5 pól")
    return CronTrigger(minute=parts[0], hour=parts[1], day=parts[2], month=parts[3], day_of_week=parts[4])


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    cron_expr = db.get_settings()["backup_cron"]
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _auto_backup,
        _cron_trigger(cron_expr),
        id="daily_backup",
        replace_existing=True,
    )
    scheduler.start()
    app.state.scheduler = scheduler
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Net Worth Tracker", lifespan=lifespan)


# ── Pydantic models ───────────────────────────────────────────────────────────

def _validate_iso_date(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    try:
        datetime.strptime(v, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValueError("Data musi mieć format YYYY-MM-DD")
    return v


class AccountCreate(BaseModel):
    name: str
    type: str
    category: Optional[str] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    archived: Optional[int] = None
    category: Optional[str] = None


class EntryInput(BaseModel):
    account_id: int
    value: float


class SnapshotCreate(BaseModel):
    date: str
    entries: List[EntryInput]

    _check_date = field_validator("date")(_validate_iso_date)


class SnapshotUpdate(BaseModel):
    date: Optional[str] = None
    entries: Optional[List[EntryInput]] = None

    _check_date = field_validator("date")(_validate_iso_date)


class SettingsUpdate(BaseModel):
    backup_cron: Optional[str] = None
    milestone_goal: Optional[float] = None
    webhook_url: Optional[str] = None


class SyncEntry(BaseModel):
    date: str
    account_name: str
    value: float

    _check_date = field_validator("date")(_validate_iso_date)


class MilestoneCreate(BaseModel):
    target_date: str
    target_value: float
    label: Optional[str] = None

    _check_date = field_validator("target_date")(_validate_iso_date)


class MilestoneUpdate(BaseModel):
    target_date: Optional[str] = None
    target_value: Optional[float] = None
    label: Optional[str] = None

    _check_date = field_validator("target_date")(_validate_iso_date)


# ── Outgoing webhook ──────────────────────────────────────────────────────────

def _post_webhook(url: str, payload: dict):
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
        logger.info("Webhook '%s' wysłany", payload.get("event"))
    except Exception as e:
        logger.error("Błąd wysyłki webhooka '%s': %s", payload.get("event"), e)


def _fire_webhooks(background: BackgroundTasks, event: str = None, data: dict = None):
    """Wysyła event (jeśli podany) oraz powiadomienia o nowo osiągniętych celach."""
    url = db.get_settings().get("webhook_url")
    if not url:
        return
    ts = datetime.now().isoformat()
    if event:
        background.add_task(_post_webhook, url, {"event": event, "timestamp": ts, "data": data})
    for m in db.pop_newly_achieved_milestones():
        background.add_task(_post_webhook, url, {"event": "milestone_achieved", "timestamp": ts, "data": m})


# ── Milestones ────────────────────────────────────────────────────────────────

@app.get("/api/milestones")
def list_milestones():
    return db.get_milestones()


@app.post("/api/milestones", status_code=201)
def add_milestone(body: MilestoneCreate):
    return db.create_milestone(body.target_date, body.target_value, body.label)


@app.patch("/api/milestones/{milestone_id}")
def edit_milestone(milestone_id: int, body: MilestoneUpdate):
    try:
        return db.update_milestone(
            milestone_id, body.target_date, body.target_value, body.label
        )
    except LookupError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/milestones/{milestone_id}")
def remove_milestone(milestone_id: int):
    try:
        return db.delete_milestone(milestone_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/api/settings")
def get_settings():
    return db.get_settings()


@app.patch("/api/settings")
def update_settings(body: SettingsUpdate, request: Request):
    if body.backup_cron is not None:
        try:
            trigger = _cron_trigger(body.backup_cron)
        except ValueError as e:
            raise HTTPException(400, str(e))
        request.app.state.scheduler.reschedule_job("daily_backup", trigger=trigger)
    saved = db.save_settings(
        backup_cron=body.backup_cron,
        milestone_goal=body.milestone_goal,
        webhook_url=body.webhook_url,
    )
    return saved


# ── Accounts ──────────────────────────────────────────────────────────────────

@app.get("/api/accounts")
def list_accounts(include_archived: bool = False):
    return db.get_accounts(include_archived)


@app.post("/api/accounts", status_code=201)
def add_account(body: AccountCreate):
    if body.type not in ("asset", "liability"):
        raise HTTPException(400, "type must be 'asset' or 'liability'")
    try:
        return db.create_account(body.name, body.type, body.category)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/accounts/{account_id}")
def edit_account(account_id: int, body: AccountUpdate):
    try:
        return db.update_account(account_id, body.name, body.type, body.archived, body.category)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/accounts/{account_id}")
def remove_account(account_id: int):
    try:
        return db.delete_account(account_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))


# ── Snapshots ─────────────────────────────────────────────────────────────────

@app.get("/api/snapshots")
def list_snapshots():
    return db.get_snapshots()


@app.post("/api/snapshots", status_code=201)
def add_snapshot(body: SnapshotCreate, background: BackgroundTasks):
    try:
        snap = db.create_snapshot(body.date, body.entries)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _fire_webhooks(background, "snapshot_created", snap)
    return snap


@app.patch("/api/snapshots/{snapshot_id}")
def edit_snapshot(snapshot_id: int, body: SnapshotUpdate, background: BackgroundTasks):
    try:
        snap = db.update_snapshot(snapshot_id, body.date, body.entries)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    _fire_webhooks(background)
    return snap


@app.delete("/api/snapshots/{snapshot_id}")
def remove_snapshot(snapshot_id: int):
    try:
        return db.delete_snapshot(snapshot_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


# ── Sync (n8n / automation) ───────────────────────────────────────────────────

@app.post("/api/sync")
def sync_entries(body: List[SyncEntry], background: BackgroundTasks):
    synced, errors = [], []
    for item in body:
        try:
            db.sync_entry(item.date, item.account_name, item.value)
            synced.append({"date": item.date, "account_name": item.account_name})
        except LookupError as e:
            errors.append({"date": item.date, "account_name": item.account_name, "error": str(e)})
    if synced:
        _fire_webhooks(background, "sync_completed", {"synced": synced, "errors": errors})
    return {"synced": synced, "errors": errors}


# ── Chart data ────────────────────────────────────────────────────────────────

@app.get("/api/networth/series")
def networth_series():
    return db.get_networth_series()


@app.get("/api/networth/breakdown")
def networth_breakdown():
    return db.get_networth_breakdown()


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats/summary")
def stats_summary():
    return db.get_stats_summary()


@app.get("/api/stats/compare")
def stats_compare(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date:   Optional[str] = Query(None, alias="to"),
):
    return db.get_stats_compare(from_date, to_date)


@app.get("/api/stats/monthly")
def stats_monthly():
    return db.get_monthly_changes()


# ── Backup — pliki .db ────────────────────────────────────────────────────────

@app.get("/api/backup/list")
def list_backups():
    return db.list_backups()


@app.post("/api/backup/create", status_code=201)
def create_backup():
    try:
        return db.create_backup()
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/backup/download/{filename}")
def download_backup(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(400, "Nieprawidłowa nazwa pliku")
    fpath = os.path.join(db.BACKUP_DIR, filename)
    if not os.path.exists(fpath):
        raise HTTPException(404, "Backup nie istnieje")
    return FileResponse(fpath, filename=filename, media_type="application/octet-stream")


@app.post("/api/backup/restore/{filename}")
def restore_backup(filename: str):
    try:
        return db.restore_backup(filename)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/backup/restore-upload")
async def restore_from_upload(file: UploadFile = File(...)):
    if not file.filename.endswith(".db"):
        raise HTTPException(400, "Akceptowane są tylko pliki .db")
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return db.restore_from_file(tmp_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        os.unlink(tmp_path)


@app.delete("/api/backup/{filename}")
def delete_backup(filename: str):
    try:
        return db.delete_backup(filename)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── JSON export / import ──────────────────────────────────────────────────────

@app.get("/api/export")
def export():
    data = db.export_data()
    filename = f"networth-{datetime.now().strftime('%Y%m%d')}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/import")
async def import_(request: Request):
    try:
        data = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Nieprawidłowy JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "Oczekiwano obiektu JSON z danymi eksportu")
    try:
        return db.import_data(data)
    except (KeyError, TypeError) as e:
        raise HTTPException(400, f"Nieprawidłowa struktura danych: {e}")
    except sqlite3.IntegrityError as e:
        raise HTTPException(400, f"Dane naruszają więzy integralności: {e}")


# ── Frontend ──────────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend():
    with open("static/index.html") as f:
        return HTMLResponse(f.read())
