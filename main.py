import logging
import os
import sqlite3
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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

class AccountCreate(BaseModel):
    name: str
    type: str


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    archived: Optional[int] = None


class EntryInput(BaseModel):
    account_id: int
    value: float


class SnapshotCreate(BaseModel):
    date: str
    entries: List[EntryInput]


class SnapshotUpdate(BaseModel):
    date: Optional[str] = None
    entries: Optional[List[EntryInput]] = None


class SettingsUpdate(BaseModel):
    backup_cron: str


# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/api/settings")
def get_settings():
    return db.get_settings()


@app.patch("/api/settings")
def update_settings(body: SettingsUpdate, request: Request):
    try:
        trigger = _cron_trigger(body.backup_cron)
    except ValueError as e:
        raise HTTPException(400, str(e))
    saved = db.save_settings(body.backup_cron)
    request.app.state.scheduler.reschedule_job("daily_backup", trigger=trigger)
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
        return db.create_account(body.name, body.type)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.patch("/api/accounts/{account_id}")
def edit_account(account_id: int, body: AccountUpdate):
    try:
        return db.update_account(account_id, body.name, body.type, body.archived)
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
def add_snapshot(body: SnapshotCreate):
    try:
        return db.create_snapshot(body.date, body.entries)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/snapshots/{snapshot_id}")
def edit_snapshot(snapshot_id: int, body: SnapshotUpdate):
    try:
        return db.update_snapshot(snapshot_id, body.date, body.entries)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/snapshots/{snapshot_id}")
def remove_snapshot(snapshot_id: int):
    try:
        return db.delete_snapshot(snapshot_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


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
        src_conn = sqlite3.connect(tmp_path)
        dst_conn = sqlite3.connect(db.DB_PATH)
        try:
            with dst_conn:
                src_conn.backup(dst_conn)
        finally:
            src_conn.close()
            dst_conn.close()
    finally:
        os.unlink(tmp_path)
    return {"ok": True}


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
        return db.import_data(data)
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Frontend ──────────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend():
    with open("static/index.html") as f:
        return HTMLResponse(f.read())
