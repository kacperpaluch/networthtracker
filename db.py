import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", "data/networth.db")
BACKUP_DIR = os.environ.get(
    "BACKUP_DIR",
    os.path.join(os.path.dirname(DB_PATH) or ".", "backups"),
)
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP", "30"))


def _ensure_dir():
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)


@contextmanager
def get_db():
    _ensure_dir()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    _ensure_dir()
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                type       TEXT    NOT NULL CHECK(type IN ('asset','liability')),
                archived   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT    NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS entries (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
                account_id  INTEGER NOT NULL REFERENCES accounts(id)  ON DELETE RESTRICT,
                value       REAL    NOT NULL,
                UNIQUE(snapshot_id, account_id)
            );
            CREATE TABLE IF NOT EXISTS settings (
                id          INTEGER PRIMARY KEY CHECK(id = 1),
                backup_cron TEXT NOT NULL DEFAULT '0 4 * * *'
            );
            INSERT OR IGNORE INTO settings (id, backup_cron) VALUES (1, '0 4 * * *');
        """)


# ── Accounts ──────────────────────────────────────────────────────────────────

def get_accounts(include_archived: bool = False) -> list:
    with get_db() as conn:
        q = "SELECT * FROM accounts"
        if not include_archived:
            q += " WHERE archived = 0"
        q += " ORDER BY type, name"
        return [dict(r) for r in conn.execute(q).fetchall()]


def create_account(name: str, type_: str) -> dict:
    with get_db() as conn:
        cur = conn.execute("INSERT INTO accounts (name, type) VALUES (?, ?)", (name, type_))
        return dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (cur.lastrowid,)).fetchone())


def update_account(account_id: int, name=None, type_=None, archived=None) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not row:
            raise LookupError("Account not found")
        updates, vals = [], []
        if name is not None:
            updates.append("name = ?"); vals.append(name)
        if type_ is not None:
            if type_ not in ("asset", "liability"):
                raise ValueError("Invalid type")
            updates.append("type = ?"); vals.append(type_)
        if archived is not None:
            updates.append("archived = ?"); vals.append(int(archived))
        if updates:
            conn.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE id = ?", vals + [account_id])
        return dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone())


def delete_account(account_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not row:
            raise LookupError("Account not found")
        cnt = conn.execute("SELECT COUNT(*) FROM entries WHERE account_id = ?", (account_id,)).fetchone()[0]
        if cnt:
            raise ValueError("Cannot delete account that has entries")
        conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        return {"ok": True}


# ── Snapshots ─────────────────────────────────────────────────────────────────

def _snapshot_with_entries(conn, snapshot_id: int) -> dict:
    s = conn.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if not s:
        raise LookupError("Snapshot not found")
    entries = conn.execute("""
        SELECT e.id, e.account_id, e.value, a.name AS account_name, a.type AS account_type
        FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.snapshot_id = ? ORDER BY a.type, a.name
    """, (snapshot_id,)).fetchall()
    d = dict(s)
    d["entries"] = [dict(e) for e in entries]
    assets = sum(e["value"] for e in entries if e["account_type"] == "asset")
    liabs  = sum(e["value"] for e in entries if e["account_type"] == "liability")
    d["total_assets"]      = assets
    d["total_liabilities"] = liabs
    d["net_worth"]         = assets - liabs
    return d


def get_snapshots() -> list:
    with get_db() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM snapshots ORDER BY date DESC").fetchall()]
        return [_snapshot_with_entries(conn, i) for i in ids]


def create_snapshot(date: str, entries) -> dict:
    with get_db() as conn:
        if conn.execute("SELECT id FROM snapshots WHERE date = ?", (date,)).fetchone():
            raise ValueError(f"Snapshot for {date} already exists")
        cur = conn.execute("INSERT INTO snapshots (date) VALUES (?)", (date,))
        sid = cur.lastrowid
        for e in entries:
            conn.execute(
                "INSERT INTO entries (snapshot_id, account_id, value) VALUES (?, ?, ?)",
                (sid, e.account_id, e.value)
            )
        return _snapshot_with_entries(conn, sid)


def update_snapshot(snapshot_id: int, date=None, entries=None) -> dict:
    with get_db() as conn:
        if not conn.execute("SELECT id FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone():
            raise LookupError("Snapshot not found")
        if date is not None:
            dup = conn.execute(
                "SELECT id FROM snapshots WHERE date = ? AND id != ?", (date, snapshot_id)
            ).fetchone()
            if dup:
                raise ValueError(f"Snapshot for {date} already exists")
            conn.execute("UPDATE snapshots SET date = ? WHERE id = ?", (date, snapshot_id))
        if entries is not None:
            conn.execute("DELETE FROM entries WHERE snapshot_id = ?", (snapshot_id,))
            for e in entries:
                conn.execute(
                    "INSERT INTO entries (snapshot_id, account_id, value) VALUES (?, ?, ?)",
                    (snapshot_id, e.account_id, e.value)
                )
        return _snapshot_with_entries(conn, snapshot_id)


def delete_snapshot(snapshot_id: int) -> dict:
    with get_db() as conn:
        if not conn.execute("SELECT id FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone():
            raise LookupError("Snapshot not found")
        conn.execute("DELETE FROM snapshots WHERE id = ?", (snapshot_id,))
        return {"ok": True}


# ── Series / Breakdown ────────────────────────────────────────────────────────

def get_networth_series() -> list:
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                s.date,
                SUM(CASE WHEN a.type='asset'     THEN e.value ELSE 0     END) AS assets,
                SUM(CASE WHEN a.type='liability' THEN e.value ELSE 0     END) AS liabilities,
                SUM(CASE WHEN a.type='asset'     THEN e.value ELSE -e.value END) AS net_worth
            FROM snapshots s
            JOIN entries  e ON e.snapshot_id = s.id
            JOIN accounts a ON a.id = e.account_id
            GROUP BY s.id, s.date ORDER BY s.date
        """).fetchall()
        return [dict(r) for r in rows]


def get_networth_breakdown() -> dict:
    with get_db() as conn:
        snaps = conn.execute("SELECT id, date FROM snapshots ORDER BY date").fetchall()
        accs  = conn.execute("SELECT id, name, type FROM accounts ORDER BY type, name").fetchall()
        raw   = conn.execute("SELECT snapshot_id, account_id, value FROM entries").fetchall()
        lkp   = {(r["snapshot_id"], r["account_id"]): r["value"] for r in raw}
        dates = [s["date"] for s in snaps]
        datasets = []
        for a in accs:
            vals = []
            for s in snaps:
                v = lkp.get((s["id"], a["id"]), 0)
                vals.append(v if a["type"] == "asset" else -v)
            datasets.append({"account_id": a["id"], "name": a["name"], "type": a["type"], "values": vals})
        return {"dates": dates, "datasets": datasets}


# ── Stats ─────────────────────────────────────────────────────────────────────

def get_stats_summary() -> dict:
    series = get_networth_series()
    n = len(series)
    if n == 0:
        return {"has_data": False, "snapshot_count": 0}

    latest = series[-1]
    result: dict = {
        "has_data": True,
        "snapshot_count": n,
        "current_net_worth":   latest["net_worth"],
        "current_assets":      latest["assets"],
        "current_liabilities": latest["liabilities"],
        "current_date":        latest["date"],
    }

    if n >= 2:
        prev = series[-2]
        diff = latest["net_worth"] - prev["net_worth"]
        result["prev_change"]     = diff
        # Percentage is only meaningful when base is positive
        result["prev_change_pct"] = (diff / prev["net_worth"] * 100) if prev["net_worth"] > 0 else None
        result["prev_date"]       = prev["date"]

    cur_year = latest["date"][:4]
    ytd = [s for s in series if s["date"][:4] == cur_year]
    if len(ytd) >= 2:
        diff = latest["net_worth"] - ytd[0]["net_worth"]
        result["ytd_change"]      = diff
        result["ytd_change_pct"]  = (diff / ytd[0]["net_worth"] * 100) if ytd[0]["net_worth"] > 0 else None
        result["ytd_start_date"]  = ytd[0]["date"]

    if n >= 2:
        d0 = datetime.strptime(series[0]["date"], "%Y-%m-%d")
        d1 = datetime.strptime(latest["date"], "%Y-%m-%d")
        months = (d1.year - d0.year) * 12 + d1.month - d0.month
        if months > 0:
            result["avg_monthly_change"] = (latest["net_worth"] - series[0]["net_worth"]) / months
        years = (d1 - d0).days / 365.25
        if years >= 1 and series[0]["net_worth"] > 0 and latest["net_worth"] > 0:
            result["cagr"] = ((latest["net_worth"] / series[0]["net_worth"]) ** (1 / years) - 1) * 100

    with get_db() as conn:
        snap_id = conn.execute(
            "SELECT id FROM snapshots WHERE date = ?", (latest["date"],)
        ).fetchone()["id"]
        rows = conn.execute("""
            SELECT a.name, a.type, e.value
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.snapshot_id = ? ORDER BY a.type, e.value DESC
        """, (snap_id,)).fetchall()
        total_assets = sum(r["value"] for r in rows if r["type"] == "asset")
        total_liabs  = sum(r["value"] for r in rows if r["type"] == "liability")
        result["asset_structure"] = [
            {
                "name":  r["name"],
                "type":  r["type"],
                "value": r["value"],
                "pct":   (r["value"] / total_assets * 100) if r["type"] == "asset" and total_assets else None,
            }
            for r in rows
        ]
        if total_assets:
            result["debt_to_assets"] = total_liabs / total_assets

    return result


def _closest_before(series, target_date):
    result = None
    for s in series:
        if s["date"] <= target_date:
            result = s
    return result


def get_stats_compare(from_date, to_date) -> dict:
    series = get_networth_series()
    if len(series) < 2:
        return {"has_data": False}

    fs = _closest_before(series, from_date) if from_date else series[0]
    ts = _closest_before(series, to_date)   if to_date   else series[-1]

    if not fs or not ts or fs["date"] == ts["date"]:
        return {"has_data": False}

    diff = ts["net_worth"] - fs["net_worth"]
    pct  = (diff / fs["net_worth"] * 100) if fs["net_worth"] > 0 else None

    with get_db() as conn:
        def emap(sid):
            return {r["account_id"]: r["value"]
                    for r in conn.execute("SELECT account_id, value FROM entries WHERE snapshot_id=?", (sid,))}

        fid = conn.execute("SELECT id FROM snapshots WHERE date=?", (fs["date"],)).fetchone()["id"]
        tid = conn.execute("SELECT id FROM snapshots WHERE date=?", (ts["date"],)).fetchone()["id"]
        fe, te = emap(fid), emap(tid)
        accs = conn.execute("SELECT id, name, type FROM accounts").fetchall()

        changes = []
        for a in accs:
            fv, tv = fe.get(a["id"], 0), te.get(a["id"], 0)
            if fv == 0 and tv == 0:
                continue
            delta  = tv - fv
            impact = delta if a["type"] == "asset" else -delta
            changes.append({"name": a["name"], "type": a["type"],
                            "from_value": fv, "to_value": tv,
                            "change": delta, "net_impact": impact})
        changes.sort(key=lambda x: x["net_impact"], reverse=True)

    return {
        "has_data": True,
        "from_date": fs["date"], "to_date": ts["date"],
        "from_net_worth": fs["net_worth"], "to_net_worth": ts["net_worth"],
        "change": diff, "change_pct": pct,
        "best_account":    changes[0]  if changes else None,
        "worst_account":   changes[-1] if len(changes) > 1 else None,
        "account_changes": changes,
    }


# ── Settings ─────────────────────────────────────────────────────────────────

def get_settings() -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return dict(row) if row else {"id": 1, "backup_cron": "0 4 * * *"}


def save_settings(backup_cron: str) -> dict:
    with get_db() as conn:
        conn.execute(
            "UPDATE settings SET backup_cron = ? WHERE id = 1",
            (backup_cron,),
        )
    return get_settings()


# ── File backups ─────────────────────────────────────────────────────────────

def list_backups() -> list:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    files = []
    for fname in os.listdir(BACKUP_DIR):
        if fname.endswith(".db"):
            fpath = os.path.join(BACKUP_DIR, fname)
            stat = os.stat(fpath)
            files.append({
                "filename": fname,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return sorted(files, key=lambda x: x["created_at"], reverse=True)


def create_backup() -> dict:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(BACKUP_DIR, f"networth_{timestamp}.db")
    src_conn = sqlite3.connect(DB_PATH)
    dst_conn = sqlite3.connect(dst)
    try:
        with dst_conn:
            src_conn.backup(dst_conn)
    finally:
        src_conn.close()
        dst_conn.close()
    # Prune old backups
    backups = list_backups()
    while len(backups) > BACKUP_KEEP:
        oldest = backups.pop()
        try:
            os.remove(os.path.join(BACKUP_DIR, oldest["filename"]))
        except OSError:
            pass
    return {"filename": os.path.basename(dst)}


def restore_backup(filename: str) -> dict:
    if "/" in filename or ".." in filename:
        raise ValueError("Nieprawidłowa nazwa pliku")
    src = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(src):
        raise LookupError("Backup nie istnieje")
    src_conn = sqlite3.connect(src)
    dst_conn = sqlite3.connect(DB_PATH)
    try:
        with dst_conn:
            src_conn.backup(dst_conn)
    finally:
        src_conn.close()
        dst_conn.close()
    return {"ok": True}


def delete_backup(filename: str) -> dict:
    if "/" in filename or ".." in filename:
        raise ValueError("Nieprawidłowa nazwa pliku")
    fpath = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(fpath):
        raise LookupError("Backup nie istnieje")
    os.remove(fpath)
    return {"ok": True}


# ── JSON export / import ──────────────────────────────────────────────────────

def export_data() -> dict:
    with get_db() as conn:
        return {
            "version":     1,
            "exported_at": datetime.now().isoformat(),
            "accounts":  [dict(r) for r in conn.execute("SELECT * FROM accounts").fetchall()],
            "snapshots": [dict(r) for r in conn.execute("SELECT * FROM snapshots").fetchall()],
            "entries":   [dict(r) for r in conn.execute("SELECT * FROM entries").fetchall()],
        }


def import_data(data: dict) -> dict:
    with get_db() as conn:
        conn.execute("DELETE FROM entries")
        conn.execute("DELETE FROM snapshots")
        conn.execute("DELETE FROM accounts")
        for a in data.get("accounts", []):
            conn.execute(
                "INSERT INTO accounts (id,name,type,archived,created_at) VALUES (?,?,?,?,?)",
                (a["id"], a["name"], a["type"], a["archived"],
                 a.get("created_at", datetime.now().isoformat()))
            )
        for s in data.get("snapshots", []):
            conn.execute("INSERT INTO snapshots (id,date) VALUES (?,?)", (s["id"], s["date"]))
        for e in data.get("entries", []):
            conn.execute(
                "INSERT INTO entries (id,snapshot_id,account_id,value) VALUES (?,?,?,?)",
                (e["id"], e["snapshot_id"], e["account_id"], e["value"])
            )
    return {"ok": True, "imported": {
        "accounts":  len(data.get("accounts",  [])),
        "snapshots": len(data.get("snapshots", [])),
        "entries":   len(data.get("entries",   [])),
    }}
