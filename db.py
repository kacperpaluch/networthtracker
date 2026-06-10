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
                category   TEXT,
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
                id             INTEGER PRIMARY KEY CHECK(id = 1),
                backup_cron    TEXT NOT NULL DEFAULT '0 4 * * *',
                milestone_goal REAL,
                webhook_url    TEXT
            );
            INSERT OR IGNORE INTO settings (id, backup_cron) VALUES (1, '0 4 * * *');
            CREATE TABLE IF NOT EXISTS milestones (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                target_date  TEXT    NOT NULL,
                target_value REAL    NOT NULL,
                label        TEXT,
                notified_at  TEXT,
                created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
            );
        """)
        _migrate_column(conn, "settings",   "milestone_goal", "REAL")
        _migrate_column(conn, "settings",   "webhook_url",    "TEXT")
        _migrate_column(conn, "accounts",   "category",       "TEXT")
        _migrate_column(conn, "milestones", "notified_at",    "TEXT")
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_name_nocase "
                "ON accounts(name COLLATE NOCASE)"
            )
        except sqlite3.IntegrityError:
            # Existing duplicate names block the index; keep working without it
            pass


def _migrate_column(conn, table: str, column: str, col_type: str):
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")


# ── Accounts ──────────────────────────────────────────────────────────────────

def get_accounts(include_archived: bool = False) -> list:
    with get_db() as conn:
        q = "SELECT * FROM accounts"
        if not include_archived:
            q += " WHERE archived = 0"
        q += " ORDER BY type, name"
        return [dict(r) for r in conn.execute(q).fetchall()]


def create_account(name: str, type_: str, category: str = None) -> dict:
    with get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO accounts (name, type, category) VALUES (?, ?, ?)",
                (name, type_, category),
            )
        except sqlite3.IntegrityError:
            raise ValueError(f"Konto o nazwie '{name}' już istnieje")
        return dict(conn.execute("SELECT * FROM accounts WHERE id = ?", (cur.lastrowid,)).fetchone())


def update_account(account_id: int, name=None, type_=None, archived=None, category=None) -> dict:
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
        if category is not None:
            updates.append("category = ?"); vals.append(category or None)
        if updates:
            try:
                conn.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE id = ?", vals + [account_id])
            except sqlite3.IntegrityError:
                raise ValueError(f"Konto o nazwie '{name}' już istnieje")
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
        snaps = [dict(r) for r in conn.execute("SELECT * FROM snapshots ORDER BY date DESC").fetchall()]
        rows = conn.execute("""
            SELECT e.id, e.snapshot_id, e.account_id, e.value,
                   a.name AS account_name, a.type AS account_type
            FROM entries e JOIN accounts a ON a.id = e.account_id
            ORDER BY a.type, a.name
        """).fetchall()
        by_snapshot = {}
        for r in rows:
            by_snapshot.setdefault(r["snapshot_id"], []).append(dict(r))
        for s in snaps:
            entries = by_snapshot.get(s["id"], [])
            for e in entries:
                e.pop("snapshot_id", None)
            assets = sum(e["value"] for e in entries if e["account_type"] == "asset")
            liabs  = sum(e["value"] for e in entries if e["account_type"] == "liability")
            s["entries"] = entries
            s["total_assets"] = assets
            s["total_liabilities"] = liabs
            s["net_worth"] = assets - liabs
        return snaps


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
            SELECT a.name, a.type, a.category, e.value
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.snapshot_id = ? ORDER BY a.type, e.value DESC
        """, (snap_id,)).fetchall()
        total_assets = sum(r["value"] for r in rows if r["type"] == "asset")
        total_liabs  = sum(r["value"] for r in rows if r["type"] == "liability")
        result["asset_structure"] = [
            {
                "name":     r["name"],
                "type":     r["type"],
                "category": r["category"],
                "value":    r["value"],
                "pct":      (r["value"] / total_assets * 100) if r["type"] == "asset" and total_assets else None,
            }
            for r in rows
        ]
        if total_assets:
            result["debt_to_assets"] = total_liabs / total_assets

    if n >= 1:
        d_last = datetime.strptime(latest["date"], "%Y-%m-%d")
        d_first = datetime.strptime(series[0]["date"], "%Y-%m-%d")
        result["days_tracked"] = (d_last - d_first).days + 1
        result["first_date"] = series[0]["date"]
        result["last_date"] = latest["date"]

    monthly = get_monthly_changes()
    mchanges = [m["change"] for m in monthly if m["change"] is not None]
    if len(mchanges) >= 2:
        mean = sum(mchanges) / len(mchanges)
        variance = sum((c - mean) ** 2 for c in mchanges) / len(mchanges)
        result["volatility"] = round(variance**0.5, 2)
        best_val = max(mchanges)
        worst_val = min(mchanges)
        best_idx = mchanges.index(best_val)
        worst_idx = mchanges.index(worst_val)
        result["best_month"] = {"month": monthly[best_idx + 1]["month"], "change": best_val}
        result["worst_month"] = {"month": monthly[worst_idx + 1]["month"], "change": worst_val}

    result["account_growth_rates"] = _get_account_growth_rates()

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


# ── Monthly changes ───────────────────────────────────────────────────────────

def get_monthly_changes() -> list:
    series = get_networth_series()
    if not series:
        return []

    monthly = {}
    for s in series:
        monthly[s["date"][:7]] = s

    months = sorted(monthly.keys())
    result = []
    for i, m in enumerate(months):
        cur = monthly[m]
        entry = {
            "month": m,
            "net_worth": cur["net_worth"],
            "assets": cur["assets"],
            "liabilities": cur["liabilities"],
        }
        if i > 0:
            prev = monthly[months[i - 1]]
            entry["change"] = cur["net_worth"] - prev["net_worth"]
            entry["change_pct"] = (
                (entry["change"] / prev["net_worth"] * 100)
                if prev["net_worth"] > 0
                else None
            )
        else:
            entry["change"] = None
            entry["change_pct"] = None
        result.append(entry)
    return result


def _get_account_growth_rates() -> list:
    with get_db() as conn:
        accounts = conn.execute(
            "SELECT id, name, type FROM accounts WHERE archived = 0 ORDER BY type, name"
        ).fetchall()
        result = []
        for acc in accounts:
            rows = conn.execute(
                """SELECT s.date, e.value
                   FROM entries e
                   JOIN snapshots s ON s.id = e.snapshot_id
                   WHERE e.account_id = ?
                   ORDER BY s.date""",
                (acc["id"],),
            ).fetchall()
            if len(rows) < 2:
                continue
            first = rows[0]
            last = rows[-1]
            d0 = datetime.strptime(first["date"], "%Y-%m-%d")
            d1 = datetime.strptime(last["date"], "%Y-%m-%d")
            span_months = (d1.year - d0.year) * 12 + d1.month - d0.month
            if span_months <= 0:
                continue
            total_change = last["value"] - first["value"]
            avg_change = total_change / span_months
            result.append(
                {
                    "name": acc["name"],
                    "type": acc["type"],
                    "avg_monthly_change": round(avg_change, 2),
                    "total_change": round(total_change, 2),
                    "first_value": first["value"],
                    "last_value": last["value"],
                }
            )
        return sorted(result, key=lambda x: abs(x["avg_monthly_change"]), reverse=True)


# ── Milestones ────────────────────────────────────────────────────────────────

def get_milestones() -> list:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM milestones ORDER BY target_date"
        ).fetchall()
        return [dict(r) for r in rows]


def create_milestone(target_date: str, target_value: float, label: str = None) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO milestones (target_date, target_value, label) VALUES (?, ?, ?)",
            (target_date, target_value, label),
        )
        return dict(
            conn.execute(
                "SELECT * FROM milestones WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
        )


def update_milestone(
    milestone_id: int, target_date=None, target_value=None, label=None
) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM milestones WHERE id = ?", (milestone_id,)
        ).fetchone()
        if not row:
            raise LookupError("Milestone not found")
        updates, vals = [], []
        if target_date is not None:
            updates.append("target_date = ?"); vals.append(target_date)
        if target_value is not None:
            updates.append("target_value = ?"); vals.append(target_value)
        if label is not None:
            updates.append("label = ?"); vals.append(label)
        if updates:
            conn.execute(
                f"UPDATE milestones SET {', '.join(updates)} WHERE id = ?",
                vals + [milestone_id],
            )
        return dict(
            conn.execute(
                "SELECT * FROM milestones WHERE id = ?", (milestone_id,)
            ).fetchone()
        )


def pop_newly_achieved_milestones() -> list:
    """Zwraca cele osiągnięte przez bieżący net worth, które nie były jeszcze
    notyfikowane, i oznacza je jako notyfikowane."""
    series = get_networth_series()
    if not series:
        return []
    nw = series[-1]["net_worth"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM milestones WHERE notified_at IS NULL AND target_value <= ?",
            (nw,),
        ).fetchall()
        achieved = [dict(r) for r in rows]
        now = datetime.now().isoformat()
        for m in achieved:
            conn.execute("UPDATE milestones SET notified_at = ? WHERE id = ?", (now, m["id"]))
            m["notified_at"] = now
            m["net_worth"] = nw
    return achieved


def delete_milestone(milestone_id: int) -> dict:
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM milestones WHERE id = ?", (milestone_id,)
        ).fetchone():
            raise LookupError("Milestone not found")
        conn.execute("DELETE FROM milestones WHERE id = ?", (milestone_id,))
        return {"ok": True}


# ── Settings ─────────────────────────────────────────────────────────────────

def get_settings() -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return dict(row) if row else {"id": 1, "backup_cron": "0 4 * * *", "milestone_goal": None}


def save_settings(backup_cron: str = None, milestone_goal: float = None, webhook_url: str = None) -> dict:
    with get_db() as conn:
        if backup_cron is not None:
            conn.execute(
                "UPDATE settings SET backup_cron = ? WHERE id = 1",
                (backup_cron,),
            )
        if milestone_goal is not None:
            conn.execute(
                "UPDATE settings SET milestone_goal = ? WHERE id = 1",
                (milestone_goal,),
            )
        if webhook_url is not None:
            # Pusty string wyłącza webhook
            conn.execute(
                "UPDATE settings SET webhook_url = ? WHERE id = 1",
                (webhook_url.strip() or None,),
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


def create_backup(prune: bool = True) -> dict:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(BACKUP_DIR, f"networth_{timestamp}.db")
    n = 1
    while os.path.exists(dst):
        dst = os.path.join(BACKUP_DIR, f"networth_{timestamp}_{n}.db")
        n += 1
    src_conn = sqlite3.connect(DB_PATH)
    dst_conn = sqlite3.connect(dst)
    try:
        with dst_conn:
            src_conn.backup(dst_conn)
    finally:
        src_conn.close()
        dst_conn.close()
    if prune:
        backups = list_backups()
        while len(backups) > BACKUP_KEEP:
            oldest = backups.pop()
            try:
                os.remove(os.path.join(BACKUP_DIR, oldest["filename"]))
            except OSError:
                pass
    return {"filename": os.path.basename(dst)}


REQUIRED_TABLES = {"accounts", "snapshots", "entries"}


def validate_backup_file(path: str):
    """Sprawdza, czy plik to poprawna baza SQLite ze schematem aplikacji."""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            check = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if check != "ok":
                raise ValueError(f"Baza uszkodzona (integrity_check: {check})")
            tables = {
                r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        raise ValueError("Plik nie jest poprawną bazą SQLite")
    missing = REQUIRED_TABLES - tables
    if missing:
        raise ValueError(f"Baza nie zawiera wymaganych tabel: {', '.join(sorted(missing))}")


def restore_from_file(src_path: str) -> dict:
    """Waliduje plik, robi backup bieżącej bazy i nadpisuje ją zawartością pliku."""
    validate_backup_file(src_path)
    safety = create_backup(prune=False) if os.path.exists(DB_PATH) else None
    src_conn = sqlite3.connect(src_path)
    dst_conn = sqlite3.connect(DB_PATH)
    try:
        with dst_conn:
            src_conn.backup(dst_conn)
    finally:
        src_conn.close()
        dst_conn.close()
    init_db()  # dograj brakujące tabele/kolumny, jeśli backup jest ze starszej wersji
    return {"ok": True, "pre_restore_backup": safety["filename"] if safety else None}


def restore_backup(filename: str) -> dict:
    if "/" in filename or ".." in filename:
        raise ValueError("Nieprawidłowa nazwa pliku")
    src = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(src):
        raise LookupError("Backup nie istnieje")
    return restore_from_file(src)


def delete_backup(filename: str) -> dict:
    if "/" in filename or ".." in filename:
        raise ValueError("Nieprawidłowa nazwa pliku")
    fpath = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(fpath):
        raise LookupError("Backup nie istnieje")
    os.remove(fpath)
    return {"ok": True}


# ── Sync (n8n / automation) ───────────────────────────────────────────────────

def sync_entry(date: str, account_name: str, value: float) -> dict:
    with get_db() as conn:
        account = conn.execute(
            "SELECT * FROM accounts WHERE lower(name) = lower(?) AND archived = 0",
            (account_name,)
        ).fetchone()
        if not account:
            raise LookupError(f"Konto '{account_name}' nie istnieje lub jest zarchiwizowane")

        snap = conn.execute("SELECT id FROM snapshots WHERE date = ?", (date,)).fetchone()
        if snap:
            snapshot_id = snap["id"]
        else:
            cur = conn.execute("INSERT INTO snapshots (date) VALUES (?)", (date,))
            snapshot_id = cur.lastrowid
            # Przepisz wartości z ostatniego snapshotu przed tą datą
            prev = conn.execute(
                "SELECT id FROM snapshots WHERE date < ? ORDER BY date DESC LIMIT 1",
                (date,)
            ).fetchone()
            if prev:
                conn.execute("""
                    INSERT INTO entries (snapshot_id, account_id, value)
                    SELECT ?, account_id, value FROM entries WHERE snapshot_id = ?
                """, (snapshot_id, prev["id"]))

        conn.execute("""
            INSERT INTO entries (snapshot_id, account_id, value)
            VALUES (?, ?, ?)
            ON CONFLICT(snapshot_id, account_id) DO UPDATE SET value = excluded.value
        """, (snapshot_id, account["id"], value))

        return _snapshot_with_entries(conn, snapshot_id)


# ── JSON export / import ──────────────────────────────────────────────────────

def export_data() -> dict:
    with get_db() as conn:
        settings = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return {
            "version":     2,
            "exported_at": datetime.now().isoformat(),
            "accounts":   [dict(r) for r in conn.execute("SELECT * FROM accounts").fetchall()],
            "snapshots":  [dict(r) for r in conn.execute("SELECT * FROM snapshots").fetchall()],
            "entries":    [dict(r) for r in conn.execute("SELECT * FROM entries").fetchall()],
            "milestones": [dict(r) for r in conn.execute("SELECT * FROM milestones").fetchall()],
            "settings":   dict(settings) if settings else None,
        }


def import_data(data: dict) -> dict:
    with get_db() as conn:
        conn.execute("DELETE FROM entries")
        conn.execute("DELETE FROM snapshots")
        conn.execute("DELETE FROM accounts")
        conn.execute("DELETE FROM milestones")
        for a in data.get("accounts", []):
            conn.execute(
                "INSERT INTO accounts (id,name,type,category,archived,created_at) VALUES (?,?,?,?,?,?)",
                (a["id"], a["name"], a["type"], a.get("category"), a["archived"],
                 a.get("created_at", datetime.now().isoformat()))
            )
        for s in data.get("snapshots", []):
            conn.execute("INSERT INTO snapshots (id,date) VALUES (?,?)", (s["id"], s["date"]))
        for e in data.get("entries", []):
            conn.execute(
                "INSERT INTO entries (id,snapshot_id,account_id,value) VALUES (?,?,?,?)",
                (e["id"], e["snapshot_id"], e["account_id"], e["value"])
            )
        for m in data.get("milestones", []):
            conn.execute(
                "INSERT INTO milestones (id,target_date,target_value,label,notified_at,created_at) VALUES (?,?,?,?,?,?)",
                (m["id"], m["target_date"], m["target_value"], m.get("label"),
                 m.get("notified_at"), m.get("created_at", datetime.now().isoformat()))
            )
        settings = data.get("settings")
        if settings:
            conn.execute(
                "UPDATE settings SET backup_cron = ?, milestone_goal = ?, webhook_url = ? WHERE id = 1",
                (settings.get("backup_cron", "0 4 * * *"),
                 settings.get("milestone_goal"),
                 settings.get("webhook_url")),
            )
    return {"ok": True, "imported": {
        "accounts":   len(data.get("accounts",   [])),
        "snapshots":  len(data.get("snapshots",  [])),
        "entries":    len(data.get("entries",    [])),
        "milestones": len(data.get("milestones", [])),
    }}
