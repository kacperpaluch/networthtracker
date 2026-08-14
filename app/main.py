from collections import defaultdict
from calendar import monthrange
from datetime import date, timedelta
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import and_, inspect, or_, text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .models import Account, AppSetting, Goal, Snapshot
from .schemas import (
    AccountCreate,
    AccountOut,
    AccountUpdate,
    GoalCreate,
    GoalUpdate,
    SettingsUpdate,
    SnapshotCreate,
    SnapshotOut,
    SnapshotUpdate,
    SyncEntry,
)
from .seed import seed_database


APP_DIR = Path(__file__).resolve().parent
STATIC_VERSION = hashlib.sha256(
    b"".join(
        (APP_DIR / "static" / filename).read_bytes()
        for filename in ("app.js", "styles.css")
    )
).hexdigest()[:12]
Path("./data").mkdir(parents=True, exist_ok=True)
Base.metadata.create_all(bind=engine)


def migrate_sqlite_schema() -> None:
    """Small in-place migrations keep the local single-file setup dependency-free."""
    if engine.dialect.name != "sqlite":
        return
    columns = {item["name"] for item in inspect(engine).get_columns("snapshots")}
    account_columns = {
        item["name"] for item in inspect(engine).get_columns("accounts")
    }
    statements = []
    if "important" not in columns:
        statements.append(
            "ALTER TABLE snapshots ADD COLUMN important BOOLEAN NOT NULL DEFAULT 0"
        )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if "archived_at" not in account_columns:
            connection.execute(
                text("ALTER TABLE accounts ADD COLUMN archived_at DATE")
            )
            connection.execute(
                text(
                    "UPDATE accounts SET archived_at = CURRENT_DATE "
                    "WHERE archived = 1"
                )
            )
        # Worthly od tej wersji przechowuje wyłącznie kwoty PLN. Starsze konta
        # walutowe są konwertowane dokładnie raz, według kursu zapisanego przy
        # każdym snapshocie.
        if "rate_to_pln" in columns:
            connection.execute(
                text(
                    "UPDATE snapshots "
                    "SET amount = amount * COALESCE(rate_to_pln, 1.0) "
                    "WHERE account_id IN "
                    "(SELECT id FROM accounts WHERE currency != 'PLN')"
                )
            )
            # The PLN-only model no longer maps legacy FX columns. Leaving a
            # NOT NULL column behind makes every ORM INSERT fail because the
            # generated statement cannot provide a value for it.
            connection.execute(
                text("ALTER TABLE snapshots DROP COLUMN rate_to_pln")
            )
        if "rate_date" in columns:
            connection.execute(text("ALTER TABLE snapshots DROP COLUMN rate_date"))
        connection.execute(text("UPDATE accounts SET currency = 'PLN'"))
        goal_columns = {
            item["name"] for item in inspect(engine).get_columns("goals")
        }
        if "start_amount" not in goal_columns:
            connection.execute(
                text(
                    "ALTER TABLE goals ADD COLUMN start_amount FLOAT "
                    "NOT NULL DEFAULT 0.0"
                )
            )
        if "start_date" not in goal_columns:
            connection.execute(text("ALTER TABLE goals ADD COLUMN start_date DATE"))
            connection.execute(
                text("UPDATE goals SET start_date = DATE(created_at)")
            )
        connection.execute(text("DROP TABLE IF EXISTS exchange_rates"))
        connection.execute(
            text(
                "DELETE FROM app_settings "
                "WHERE key = 'base_currency' OR key LIKE 'fx_%'"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_snapshots_account_date_id "
                "ON snapshots (account_id, snapshot_date, id)"
            )
        )


migrate_sqlite_schema()


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


if env_flag("LOAD_DEMO_DATA"):
    with SessionLocal() as startup_db:
        seed_database(startup_db)

app = FastAPI(title="Worthly", version="1.8.2")
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
templates = Jinja2Templates(directory=APP_DIR / "templates")


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _request: Request, error: RequestValidationError
):
    """Return a valid 422 even when the rejected JSON contained Infinity."""
    details = []
    for item in error.errors():
        safe_item = dict(item)
        safe_item.pop("input", None)
        safe_item.pop("ctx", None)
        details.append(safe_item)
    return JSONResponse(status_code=422, content={"detail": details})


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"app_version": app.version, "static_version": STATIC_VERSION},
    )


def get_setting(db: Session, key: str, default: str) -> str:
    setting = db.get(AppSetting, key)
    return setting.value if setting else default


def set_setting(db: Session, key: str, value: str) -> None:
    setting = db.get(AppSetting, key)
    if setting:
        setting.value = value
    else:
        db.add(AppSetting(key=key, value=value))
        db.flush()


def goal_response(goal: Goal, current_net_pln: float) -> dict:
    progress = goal_progress(
        goal.start_amount, current_net_pln, goal.target_amount
    )
    direction = 1 if goal.target_amount >= goal.start_amount else -1
    remaining = max(0.0, (goal.target_amount - current_net_pln) * direction)
    gained = (current_net_pln - goal.start_amount) * direction

    elapsed_days = max(0, (date.today() - goal.start_date).days)
    monthly_pace = (
        gained / elapsed_days * 30.4375 if elapsed_days else None
    )
    estimated_date = None
    if remaining > 0 and monthly_pace is not None and monthly_pace > 0:
        projected_days = round(remaining / monthly_pace * 30.4375)
        if projected_days <= 365 * 50:
            estimated_date = (date.today() + timedelta(days=projected_days)).isoformat()

    time_progress = None
    required_monthly = None
    pace_status = "no_deadline"
    if goal.target_date:
        total_days = (goal.target_date - goal.start_date).days
        time_progress = round(
            max(0, min(100, elapsed_days / total_days * 100)), 1
        ) if total_days > 0 else 100.0
    if progress >= 100 or goal.completed:
        pace_status = "completed"
    elif goal.target_date:
        remaining_days = (goal.target_date - date.today()).days
        if remaining_days > 0:
            required_monthly = remaining / remaining_days * 30.4375
            pace_delta = progress - time_progress
            pace_status = (
                "ahead" if pace_delta > 3 else "behind" if pace_delta < -3 else "on_track"
            )
        else:
            pace_status = "overdue"

    return {
        "id": goal.id,
        "name": goal.name,
        "targetAmount": round(goal.target_amount, 2),
        "startAmount": round(goal.start_amount, 2),
        "startDate": goal.start_date.isoformat(),
        "targetDate": goal.target_date.isoformat() if goal.target_date else None,
        "completed": goal.completed,
        "currentAmount": round(current_net_pln, 2),
        "progress": progress,
        "remainingAmount": round(remaining, 2),
        "gainedAmount": round(gained, 2),
        "timeProgress": time_progress,
        "paceStatus": pace_status,
        "monthlyPace": round(monthly_pace, 2) if monthly_pace is not None else None,
        "requiredMonthlyChange": (
            round(required_monthly, 2) if required_monthly is not None else None
        ),
        "estimatedCompletionDate": estimated_date,
    }


def goal_progress(start: float, current: float, target: float) -> float:
    distance = target - start
    if distance == 0:
        return 100.0
    return round(max(0, min(100, (current - start) / distance * 100)), 1)


def percent_change(change: float, baseline: float) -> float:
    """Keep the direction of the change even when the baseline is negative."""
    return round(change / abs(baseline) * 100, 2) if baseline else 0


def shift_month(day: date, months: int) -> date:
    month_index = day.year * 12 + day.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def timeline_value_at(
    timeline: list[dict], cutoff: date, key: str = "netWorth"
) -> float | None:
    value = None
    for point in timeline:
        if date.fromisoformat(point["date"]) > cutoff:
            break
        value = point[key]
    return value


def dashboard_statistics(timeline: list[dict]) -> dict:
    empty = {
        "change30Days": None,
        "change6Months": None,
        "change12Months": None,
        "averageMonthlyChange": None,
        "bestMonth": None,
        "growingMonths": 0,
        "observedMonths": 0,
        "liabilityChange12Months": None,
        "projectedNetWorth12Months": None,
        "recordNetWorth": None,
        "isAtRecord": False,
    }
    if not timeline:
        return empty

    anchor = date.fromisoformat(timeline[-1]["date"])
    current = timeline[-1]["netWorth"]

    def period_change(cutoff: date, key: str = "netWorth") -> dict | None:
        baseline = timeline_value_at(timeline, cutoff, key)
        if baseline is None:
            return None
        latest = timeline[-1][key]
        change = round(latest - baseline, 2)
        return {
            "amount": change,
            "percent": percent_change(change, baseline),
            "from": cutoff.isoformat(),
        }

    monthly_points = []
    for offset in range(-12, 1):
        month = shift_month(anchor.replace(day=1), offset)
        month_end = date(month.year, month.month, monthrange(month.year, month.month)[1])
        if offset == 0:
            month_end = anchor
        value = timeline_value_at(timeline, month_end)
        if value is not None:
            monthly_points.append({"month": month.strftime("%Y-%m"), "value": value})

    monthly_changes = [
        {
            "month": current_month["month"],
            "amount": round(current_month["value"] - previous["value"], 2),
        }
        for previous, current_month in zip(monthly_points, monthly_points[1:])
    ]
    best_month = max(monthly_changes, key=lambda item: item["amount"], default=None)
    average = (
        round(sum(item["amount"] for item in monthly_changes) / len(monthly_changes), 2)
        if monthly_changes
        else None
    )
    record = max(point["netWorth"] for point in timeline)
    liability_change = period_change(shift_month(anchor, -12), "liabilities")

    return {
        "change30Days": period_change(anchor - timedelta(days=30)),
        "change6Months": period_change(shift_month(anchor, -6)),
        "change12Months": period_change(shift_month(anchor, -12)),
        "averageMonthlyChange": average,
        "bestMonth": best_month,
        "growingMonths": sum(1 for item in monthly_changes if item["amount"] > 0),
        "observedMonths": len(monthly_changes),
        "liabilityChange12Months": liability_change,
        "projectedNetWorth12Months": (
            round(current + average * 12, 2) if average is not None else None
        ),
        "recordNetWorth": round(record, 2),
        "isAtRecord": current >= record,
    }


def account_active_at(account: Account, cutoff: date) -> bool:
    return account.archived_at is None or account.archived_at > cutoff


def net_worth_at_pln(cutoff: date, db: Session) -> float:
    value = 0.0
    accounts = db.query(Account).all()
    for account in accounts:
        if not account_active_at(account, cutoff):
            continue
        snapshot = (
            db.query(Snapshot)
            .filter(
                Snapshot.account_id == account.id,
                Snapshot.snapshot_date <= cutoff,
            )
            .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
            .first()
        )
        if not snapshot:
            continue
        value += snapshot.amount if account.kind == "asset" else -snapshot.amount
    return value


def account_response(account: Account, db: Session) -> AccountOut:
    ordered = sorted(account.snapshots, key=lambda item: (item.snapshot_date, item.id), reverse=True)
    current = ordered[0].amount if ordered else 0
    previous = ordered[1].amount if len(ordered) > 1 else current
    return AccountOut(
        **{column.name: getattr(account, column.name) for column in Account.__table__.columns if column.name not in {"created_at"}},
        current_balance=current,
        previous_balance=previous,
        last_updated=ordered[0].snapshot_date if ordered else None,
        change=current - previous,
    )

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(include_archived: bool = False, db: Session = Depends(get_db)):
    query = db.query(Account)
    if not include_archived:
        query = query.filter(Account.archived.is_(False))
    return [account_response(account, db) for account in query.order_by(Account.kind, Account.name).all()]


@app.post("/api/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, db: Session = Depends(get_db)):
    values = payload.model_dump(exclude={"opening_balance"})
    values["currency"] = "PLN"
    account = Account(**values)
    db.add(account)
    db.flush()
    snapshot = Snapshot(account_id=account.id, snapshot_date=date.today(), amount=payload.opening_balance, note="Saldo początkowe")
    db.add(snapshot)
    db.flush()
    recalculate_next_update(account, db)
    db.commit()
    db.refresh(account)
    return account_response(account, db)


@app.patch("/api/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, payload: AccountUpdate, db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Nie znaleziono konta")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(account, key, value)
    if "archived" in payload.model_fields_set:
        account.archived_at = date.today() if account.archived else None
    if "update_frequency" in payload.model_fields_set:
        recalculate_next_update(account, db)
    db.commit()
    db.refresh(account)
    return account_response(account, db)


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Nie znaleziono konta")
    db.delete(account)
    db.commit()


@app.get("/api/accounts/{account_id}/snapshots", response_model=list[SnapshotOut])
def account_snapshots(account_id: int, db: Session = Depends(get_db)):
    if not db.get(Account, account_id):
        raise HTTPException(404, "Nie znaleziono konta")
    return (
        db.query(Snapshot)
        .filter(Snapshot.account_id == account_id)
        .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
        .all()
    )


def aggregate_snapshot_chart(
    snapshots: list[Snapshot], granularity: str
) -> list[dict]:
    """Keep the last balance in every day, ISO week, or calendar month."""
    buckets: dict[object, Snapshot] = {}
    for snapshot in snapshots:
        if granularity == "monthly":
            key = (snapshot.snapshot_date.year, snapshot.snapshot_date.month)
        elif granularity == "weekly":
            iso = snapshot.snapshot_date.isocalendar()
            key = (iso.year, iso.week)
        else:
            key = snapshot.snapshot_date
        buckets[key] = snapshot
    return [
        {"date": item.snapshot_date.isoformat(), "amount": item.amount}
        for item in buckets.values()
    ]


@app.get("/api/accounts/{account_id}/history")
def account_history(
    account_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    granularity: str = Query(default="daily", pattern="^(daily|weekly|monthly)$"),
    db: Session = Depends(get_db),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Nie znaleziono konta")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "Data początkowa nie może być późniejsza niż końcowa")

    query = db.query(Snapshot).filter(Snapshot.account_id == account_id)
    if date_from:
        query = query.filter(Snapshot.snapshot_date >= date_from)
    if date_to:
        query = query.filter(Snapshot.snapshot_date <= date_to)

    total = query.count()
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, pages)
    items = (
        query.order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    chart_snapshots = query.order_by(Snapshot.snapshot_date, Snapshot.id).all()
    chart = aggregate_snapshot_chart(chart_snapshots, granularity)
    first_amount = chart_snapshots[0].amount if chart_snapshots else 0.0
    last_amount = chart_snapshots[-1].amount if chart_snapshots else 0.0
    change = last_amount - first_amount

    response_items = []
    for snapshot in items:
        previous = (
            db.query(Snapshot)
            .filter(
                Snapshot.account_id == account_id,
                or_(
                    Snapshot.snapshot_date < snapshot.snapshot_date,
                    and_(
                        Snapshot.snapshot_date == snapshot.snapshot_date,
                        Snapshot.id < snapshot.id,
                    ),
                ),
            )
            .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
            .first()
        )
        response_items.append(
            {
                **SnapshotOut.model_validate(snapshot).model_dump(mode="json"),
                "previousAmount": previous.amount if previous else None,
            }
        )

    return {
        "items": response_items,
        "chart": chart,
        "granularity": granularity,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "pages": pages,
        "hasMore": page < pages,
        "firstAmount": first_amount,
        "lastAmount": last_amount,
        "change": round(change, 2),
        "changePercent": percent_change(change, first_amount),
    }


@app.post("/api/accounts/{account_id}/snapshots", response_model=SnapshotOut, status_code=201)
def add_snapshot(account_id: int, payload: SnapshotCreate, db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Nie znaleziono konta")
    snapshot = Snapshot(account_id=account_id, **payload.model_dump())
    db.add(snapshot)
    db.flush()
    recalculate_next_update(account, db)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def recalculate_next_update(account: Account, db: Session):
    latest = (
        db.query(Snapshot)
        .filter(Snapshot.account_id == account.id)
        .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
        .first()
    )
    if not latest:
        account.next_update = None
        return
    days = {
        "weekly": 7,
        "monthly": 30,
        "quarterly": 90,
        "yearly": 365,
    }.get(account.update_frequency, 30)
    account.next_update = latest.snapshot_date + timedelta(days=days)


@app.post("/api/sync")
def sync_entries(payload: list[SyncEntry], db: Session = Depends(get_db)):
    """Idempotently import dated balances from Actual Budget or another source."""
    active_accounts: dict[str, list[Account]] = defaultdict(list)
    tracking_starts: dict[int, date] = {}
    for account in db.query(Account).filter(Account.archived.is_(False)).all():
        active_accounts[account.name.casefold()].append(account)
        first_snapshot = (
            db.query(Snapshot)
            .filter(Snapshot.account_id == account.id)
            .order_by(Snapshot.snapshot_date, Snapshot.id)
            .first()
        )
        if first_snapshot:
            tracking_starts[account.id] = first_snapshot.snapshot_date

    created = updated = unchanged = skipped = 0
    synced = []
    ignored = []
    errors = []
    touched_accounts: dict[int, Account] = {}

    for item in payload:
        matches = active_accounts.get(item.account_name.strip().casefold(), [])
        result_key = {
            "date": item.date.isoformat(),
            "account_name": item.account_name,
        }
        if not matches:
            errors.append(
                {
                    **result_key,
                    "error": (
                        f"Konto '{item.account_name}' nie istnieje "
                        "lub jest zarchiwizowane"
                    ),
                }
            )
            continue
        if len(matches) > 1:
            errors.append(
                {
                    **result_key,
                    "error": (
                        f"Nazwa konta '{item.account_name}' nie jest unikalna"
                    ),
                }
            )
            continue

        account = matches[0]
        input_currency = "PLN"

        tracking_start = tracking_starts.get(account.id)
        if tracking_start and item.date < tracking_start:
            skipped += 1
            ignored.append(
                {
                    **result_key,
                    "currency": input_currency,
                    "reason": "before_tracking_start",
                    "tracking_start_date": tracking_start.isoformat(),
                }
            )
            continue

        snapshot = (
            db.query(Snapshot)
            .filter(
                Snapshot.account_id == account.id,
                Snapshot.snapshot_date == item.date,
            )
            .order_by(Snapshot.id.desc())
            .first()
        )
        if snapshot is None:
            snapshot = Snapshot(
                account_id=account.id,
                snapshot_date=item.date,
                amount=item.value,
                note="Synchronizacja z Actual Budget",
                source="actual-budget",
            )
            db.add(snapshot)
            created += 1
            action = "created"
        elif math.isclose(snapshot.amount, item.value, rel_tol=0, abs_tol=1e-9):
            unchanged += 1
            action = "unchanged"
        else:
            snapshot.amount = item.value
            updated += 1
            action = "updated"

        touched_accounts[account.id] = account
        synced.append(
            {**result_key, "currency": input_currency, "action": action}
        )

    db.flush()
    for account in touched_accounts.values():
        recalculate_next_update(account, db)
    db.commit()
    return {
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped,
        "synced": synced,
        "ignored": ignored,
        "errors": errors,
    }


def balance_at(account_id: int, cutoff: date, db: Session) -> float:
    snapshot = (
        db.query(Snapshot)
        .filter(
            Snapshot.account_id == account_id,
            Snapshot.snapshot_date <= cutoff,
        )
        .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
        .first()
    )
    return snapshot.amount if snapshot else 0.0


@app.patch("/api/snapshots/{snapshot_id}", response_model=SnapshotOut)
def update_snapshot(
    snapshot_id: int, payload: SnapshotUpdate, db: Session = Depends(get_db)
):
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(404, "Nie znaleziono snapshotu")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(snapshot, key, value)
    db.flush()
    recalculate_next_update(snapshot.account, db)
    db.commit()
    db.refresh(snapshot)
    return snapshot


@app.delete("/api/snapshots/{snapshot_id}", status_code=204)
def delete_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(404, "Nie znaleziono snapshotu")
    account = snapshot.account
    db.delete(snapshot)
    db.flush()
    recalculate_next_update(account, db)
    db.commit()


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    date_format = get_setting(db, "date_format", "DD.MM.YYYY")
    all_accounts = db.query(Account).all()
    accounts = [account for account in all_accounts if not account.archived]
    snapshots = db.query(Snapshot).order_by(Snapshot.snapshot_date, Snapshot.id).all()

    current_assets = current_liabilities = 0.0
    category_values: dict[str, float] = defaultdict(float)
    account_items = []
    for account in accounts:
        output = account_response(account, db)
        item = output.model_dump(mode="json")
        item["stale"] = bool(
            account.next_update and account.next_update < date.today()
        )
        item["staleDays"] = (
            (date.today() - account.next_update).days
            if item["stale"]
            else 0
        )
        account_items.append(item)
        if account.kind == "asset":
            current_assets += output.current_balance
            category_values[account.category] += output.current_balance
        else:
            current_liabilities += output.current_balance

    accounts_by_id = {account.id: account for account in all_accounts}
    snapshots_by_date: dict[date, list[Snapshot]] = defaultdict(list)
    for snapshot in snapshots:
        account = accounts_by_id[snapshot.account_id]
        if account.archived_at is None or snapshot.snapshot_date < account.archived_at:
            snapshots_by_date[snapshot.snapshot_date].append(snapshot)
    archived_by_date: dict[date, list[Account]] = defaultdict(list)
    for account in all_accounts:
        if account.archived_at is not None:
            archived_by_date[account.archived_at].append(account)

    running_assets = running_liabilities = 0.0
    running_values: dict[int, float] = {}
    timeline = []
    event_dates = sorted(set(snapshots_by_date) | set(archived_by_date))
    for point_date in event_dates:
        for snapshot in snapshots_by_date[point_date]:
            account = accounts_by_id[snapshot.account_id]
            previous_value = running_values.get(account.id, 0.0)
            value = snapshot.amount
            running_values[account.id] = value
            if account.kind == "asset":
                running_assets += value - previous_value
            else:
                running_liabilities += value - previous_value
        for account in archived_by_date[point_date]:
            previous_value = running_values.pop(account.id, 0.0)
            if account.kind == "asset":
                running_assets -= previous_value
            else:
                running_liabilities -= previous_value
        timeline.append(
            {
                "date": point_date.isoformat(),
                "netWorth": round(running_assets - running_liabilities, 2),
                "assets": round(running_assets, 2),
                "liabilities": round(running_liabilities, 2),
            }
        )

    current_net = current_assets - current_liabilities
    previous_net = timeline[-2]["netWorth"] if len(timeline) > 1 else current_net
    current_net_pln = net_worth_at_pln(date.today(), db)
    overdue = sum(1 for account in accounts if account.next_update and account.next_update < date.today())
    allocation = [
        {"name": name, "value": round(value, 2), "color": next((account.color for account in accounts if account.category == name), "#2f6f5e")}
        for name, value in sorted(category_values.items(), key=lambda item: item[1], reverse=True)
    ]
    active_ids = {account.id for account in accounts}
    recent = sorted(
        (item for item in snapshots if item.account_id in active_ids),
        key=lambda item: (item.created_at, item.id),
        reverse=True,
    )[:5]
    goals = db.query(Goal).order_by(Goal.completed, Goal.created_at).all()

    return {
        "summary": {
            "netWorth": round(current_net, 2),
            "assets": round(current_assets, 2),
            "liabilities": round(current_liabilities, 2),
            "change": round(current_net - previous_net, 2),
            "changePercent": percent_change(current_net - previous_net, previous_net),
            "overdue": overdue,
            "updatedAt": max((item.snapshot_date for item in snapshots), default=date.today()).isoformat(),
            "baseCurrency": "PLN",
            "dateFormat": date_format,
        },
        "timeline": timeline,
        "statistics": dashboard_statistics(timeline),
        "allocation": allocation,
        "accounts": account_items,
        "recent": [
            {
                "id": item.id,
                "account": item.account.name,
                "kind": item.account.kind,
                "amount": round(item.amount, 2),
                "nativeAmount": item.amount,
                "currency": item.account.currency,
                "date": item.snapshot_date.isoformat(),
                "source": item.source,
                "note": item.note,
                "important": item.important,
            }
            for item in recent
        ],
        "goals": [
            goal_response(goal, current_net_pln)
            for goal in goals
        ],
    }


@app.get("/api/activity")
def activity(
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    source: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "Data początkowa nie może być późniejsza niż końcowa")

    query = db.query(Snapshot).join(Account)
    if date_from:
        query = query.filter(Snapshot.snapshot_date >= date_from)
    if date_to:
        query = query.filter(Snapshot.snapshot_date <= date_to)
    if account_id is not None:
        query = query.filter(Snapshot.account_id == account_id)
    if source:
        query = query.filter(Snapshot.source == source)

    total = query.count()
    snapshots = (
        query.order_by(
            Snapshot.snapshot_date.desc(),
            Snapshot.id.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = []
    for snapshot in snapshots:
        previous = (
            db.query(Snapshot)
            .filter(
                Snapshot.account_id == snapshot.account_id,
                or_(
                    Snapshot.snapshot_date < snapshot.snapshot_date,
                    and_(
                        Snapshot.snapshot_date == snapshot.snapshot_date,
                        Snapshot.id < snapshot.id,
                    ),
                ),
            )
            .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
            .first()
        )
        amount = snapshot.amount
        previous_amount = previous.amount if previous else None
        items.append(
            {
                "id": snapshot.id,
                "accountId": snapshot.account_id,
                "account": snapshot.account.name,
                "institution": snapshot.account.institution,
                "kind": snapshot.account.kind,
                "currency": snapshot.account.currency,
                "date": snapshot.snapshot_date.isoformat(),
                "createdAt": snapshot.created_at.isoformat(),
                "amount": round(amount, 2),
                "nativeAmount": snapshot.amount,
                "previousAmount": (
                    round(previous_amount, 2)
                    if previous_amount is not None
                    else None
                ),
                "change": (
                    round(amount - previous_amount, 2)
                    if previous_amount is not None
                    else None
                ),
                "note": snapshot.note,
                "important": snapshot.important,
                "source": snapshot.source,
            }
        )

    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "hasMore": page * page_size < total,
    }


@app.get("/api/reports/monthly")
def monthly_report(month: str, db: Session = Depends(get_db)):
    try:
        year, month_number = (int(part) for part in month.split("-", 1))
        period_end = date(year, month_number, monthrange(year, month_number)[1])
    except (ValueError, TypeError):
        raise HTTPException(422, "Miesiąc musi mieć format RRRR-MM") from None

    period_start = date(year, month_number, 1)
    previous_end = period_start - timedelta(days=1)
    year_before_end = date(
        year - 1,
        month_number,
        monthrange(year - 1, month_number)[1],
    )
    accounts = [
        account
        for account in db.query(Account).all()
        if any(
            account_active_at(account, cutoff)
            for cutoff in (period_end, previous_end, year_before_end)
        )
    ]

    current_assets = current_liabilities = previous_assets = previous_liabilities = 0.0
    year_before_assets = year_before_liabilities = 0.0
    contributions = []
    for account in accounts:
        current_balance = (
            balance_at(account.id, period_end, db)
            if account_active_at(account, period_end)
            else 0.0
        )
        previous_balance = (
            balance_at(account.id, previous_end, db)
            if account_active_at(account, previous_end)
            else 0.0
        )
        year_before_balance = (
            balance_at(account.id, year_before_end, db)
            if account_active_at(account, year_before_end)
            else 0.0
        )
        raw_change = current_balance - previous_balance
        if account.kind == "asset":
            current_assets += current_balance
            previous_assets += previous_balance
            contribution = raw_change
            year_before_assets += year_before_balance
        else:
            current_liabilities += current_balance
            previous_liabilities += previous_balance
            contribution = -raw_change
            year_before_liabilities += year_before_balance
        contributions.append(
            {
                "id": account.id,
                "name": account.name,
                "institution": account.institution,
                "kind": account.kind,
                "category": account.category,
                "color": account.color,
                "currentBalance": round(current_balance, 2),
                "previousBalance": round(previous_balance, 2),
                "change": round(raw_change, 2),
                "contribution": round(contribution, 2),
            }
        )

    current_net = current_assets - current_liabilities
    previous_net = previous_assets - previous_liabilities
    net_change = current_net - previous_net
    year_before_net = year_before_assets - year_before_liabilities
    return {
        "month": month,
        "baseCurrency": "PLN",
        "periodEnd": period_end.isoformat(),
        "netWorth": round(current_net, 2),
        "assets": round(current_assets, 2),
        "liabilities": round(current_liabilities, 2),
        "previousNetWorth": round(previous_net, 2),
        "change": round(net_change, 2),
        "changePercent": percent_change(net_change, previous_net),
        "yearBeforeNetWorth": round(year_before_net, 2),
        "yearOverYear": round(current_net - year_before_net, 2),
        "yearOverYearPercent": percent_change(
            current_net - year_before_net, year_before_net
        ),
        "assetChange": round(current_assets - previous_assets, 2),
        "liabilityChange": round(current_liabilities - previous_liabilities, 2),
        "accounts": sorted(contributions, key=lambda item: abs(item["contribution"]), reverse=True),
    }


@app.get("/api/reports/annual")
def annual_report(year: int, db: Session = Depends(get_db)):
    if year < 2002 or year > date.today().year:
        raise HTTPException(422, "Nieprawidłowy rok raportu")
    last_month = date.today().month if year == date.today().year else 12
    first_snapshot = (
        db.query(Snapshot)
        .join(Account)
        .order_by(Snapshot.snapshot_date, Snapshot.id)
        .first()
    )
    if not first_snapshot or first_snapshot.snapshot_date.year > year:
        raise HTTPException(404, "Brak danych dla wybranego roku")
    first_month = first_snapshot.snapshot_date.month if first_snapshot.snapshot_date.year == year else 1
    months = [
        monthly_report(f"{year}-{month:02d}", db)
        for month in range(first_month, last_month + 1)
    ]
    year_end = months[-1]
    previous_year_comparison = monthly_report(
        f"{year - 1}-{last_month:02d}", db
    )
    if first_month == 1:
        start_net = monthly_report(f"{year - 1}-12", db)["netWorth"]
    else:
        start_net = months[0]["netWorth"]
    end_net = year_end["netWorth"]
    change = end_net - start_net
    return {
        "year": year,
        "baseCurrency": "PLN",
        "netWorth": end_net,
        "assets": year_end["assets"],
        "liabilities": year_end["liabilities"],
        "startNetWorth": start_net,
        "change": round(change, 2),
        "changePercent": percent_change(change, start_net),
        "previousYearNetWorth": previous_year_comparison["netWorth"],
        "yearOverYear": round(
            end_net - previous_year_comparison["netWorth"], 2
        ),
        "yearOverYearPercent": percent_change(
            end_net - previous_year_comparison["netWorth"],
            previous_year_comparison["netWorth"],
        ),
        "months": [
            {
                "date": f"{year}-{month_number:02d}-01",
                "netWorth": item["netWorth"],
                "assets": item["assets"],
                "liabilities": item["liabilities"],
                "change": None if index == 0 and first_month > 1 else item["change"],
            }
            for index, (month_number, item) in enumerate(
                zip(range(first_month, last_month + 1), months)
            )
        ],
    }


@app.get("/api/settings")
def settings_info(db: Session = Depends(get_db)):
    return {
        "version": app.version,
        "baseCurrency": "PLN",
        "dateFormat": get_setting(db, "date_format", "DD.MM.YYYY"),
        "storage": "SQLite",
        "accounts": db.query(Account).count(),
        "snapshots": db.query(Snapshot).count(),
    }


@app.patch("/api/settings")
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    set_setting(db, "date_format", payload.date_format)
    db.commit()
    return settings_info(db)


@app.get("/api/goals")
def list_goals(db: Session = Depends(get_db)):
    return dashboard(db)["goals"]


@app.post("/api/goals", status_code=201)
def create_goal(payload: GoalCreate, db: Session = Depends(get_db)):
    values = payload.model_dump()
    if payload.start_date > date.today():
        raise HTTPException(422, "Data startu celu nie może być w przyszłości")
    if not db.query(Snapshot).filter(Snapshot.snapshot_date <= payload.start_date).first():
        raise HTTPException(422, "Brak danych o wartości netto na wybraną datę startu")
    values["start_amount"] = net_worth_at_pln(payload.start_date, db)
    goal = Goal(**values)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return {"id": goal.id}


@app.patch("/api/goals/{goal_id}")
def update_goal(goal_id: int, payload: GoalUpdate, db: Session = Depends(get_db)):
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(404, "Nie znaleziono celu")
    updates = payload.model_dump(exclude_unset=True)
    if "start_date" in updates:
        start_date = updates["start_date"]
        if start_date is None or start_date > date.today():
            raise HTTPException(422, "Data startu celu nie może być w przyszłości")
        if not db.query(Snapshot).filter(Snapshot.snapshot_date <= start_date).first():
            raise HTTPException(422, "Brak danych o wartości netto na wybraną datę startu")
        goal.start_amount = net_worth_at_pln(start_date, db)
    for key, value in updates.items():
        if key == "target_amount" and value is not None:
            value = float(value)
        setattr(goal, key, value)
    db.commit()
    return {"id": goal.id}


@app.delete("/api/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(404, "Nie znaleziono celu")
    db.delete(goal)
    db.commit()


@app.get("/api/export/json")
def export_json(db: Session = Depends(get_db)):
    accounts = db.query(Account).order_by(Account.id).all()
    snapshots = db.query(Snapshot).order_by(Snapshot.snapshot_date, Snapshot.id).all()
    payload = {
        "exportedAt": date.today().isoformat(),
        "version": app.version,
        "settings": {
            item.key: item.value for item in db.query(AppSetting).all()
        },
        "goals": [
            {
                column.name: getattr(goal, column.name)
                for column in Goal.__table__.columns
            }
            for goal in db.query(Goal).order_by(Goal.id).all()
        ],
        "accounts": [
            {
                column.name: getattr(account, column.name)
                for column in Account.__table__.columns
                if column.name != "currency"
            }
            for account in accounts
        ],
        "snapshots": [
            {
                column.name: getattr(snapshot, column.name)
                for column in Snapshot.__table__.columns
            }
            for snapshot in snapshots
        ],
    }
    content = json.dumps(jsonable_encoder(payload), ensure_ascii=False, indent=2)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=worthly-backup.json"},
    )


@app.get("/api/export/csv")
def export_csv(db: Session = Depends(get_db)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["account_id", "account_name", "institution", "kind", "category", "date", "amount", "note", "important", "source"]
    )
    snapshots = (
        db.query(Snapshot)
        .join(Account)
        .order_by(Snapshot.snapshot_date, Snapshot.id)
        .all()
    )
    for snapshot in snapshots:
        writer.writerow(
            [
                snapshot.account_id,
                snapshot.account.name,
                snapshot.account.institution,
                snapshot.account.kind,
                snapshot.account.category,
                snapshot.snapshot_date.isoformat(),
                snapshot.amount,
                snapshot.note,
                snapshot.important,
                snapshot.source,
            ]
        )
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=worthly-history.csv"},
    )


def _parse_date(value, field_name: str, optional: bool = False):
    if optional and not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise HTTPException(422, f"Nieprawidłowa data w polu {field_name}") from None


def _parse_snapshot_date(value, field_name: str = "snapshot_date") -> date:
    parsed = _parse_date(value, field_name)
    if parsed > date.today():
        raise HTTPException(422, f"Data w polu {field_name} nie może być w przyszłości")
    return parsed


def _account_import_values(item: dict):
    kind = str(item.get("kind", ""))
    if kind not in {"asset", "liability"}:
        raise HTTPException(422, "Typ konta musi mieć wartość asset lub liability")
    name = str(item.get("name", "")).strip()
    if not name:
        raise HTTPException(422, "Importowane konto nie ma nazwy")
    archived = bool(item.get("archived", False))
    archived_at = _parse_date(
        item.get("archived_at"), "archived_at", optional=True
    )
    return {
        "name": name[:120],
        "institution": str(item.get("institution", "")).strip()[:120],
        "kind": kind,
        "category": str(item.get("category", "Inne")).strip()[:60] or "Inne",
        "currency": "PLN",
        "color": str(item.get("color", "#2f6f5e"))[:20],
        "archived": archived,
        "archived_at": (archived_at or date.today()) if archived else None,
        "update_frequency": str(item.get("update_frequency", "monthly"))[:20],
        "next_update": _parse_date(item.get("next_update"), "next_update", optional=True),
    }


def _snapshot_import_values(item: dict):
    try:
        amount = float(item.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Snapshot zawiera nieprawidłową kwotę") from None
    if amount < 0 or not math.isfinite(amount):
        raise HTTPException(422, "Kwota snapshotu nie może być ujemna")
    try:
        rate = float(item.get("rate_to_pln", 1) or 1)
    except (TypeError, ValueError):
        rate = 1.0
    if not math.isfinite(rate) or rate <= 0:
        raise HTTPException(422, "Snapshot zawiera nieprawidłowy kurs")
    amount *= rate
    if not math.isfinite(amount):
        raise HTTPException(422, "Snapshot zawiera nieprawidłową kwotę")
    snapshot_date = _parse_snapshot_date(
        item.get("snapshot_date") or item.get("date")
    )
    return {
        "snapshot_date": snapshot_date,
        "amount": amount,
        "note": str(item.get("note", ""))[:300],
        "important": str(item.get("important", "")).lower()
        in {"1", "true", "yes"},
        "source": str(item.get("source", "import"))[:20] or "import",
    }


@app.post("/api/import/json")
def import_json(payload: dict, mode: str = "merge", db: Session = Depends(get_db)):
    if mode not in {"merge", "replace"}:
        raise HTTPException(422, "Tryb importu musi mieć wartość merge lub replace")
    accounts_data = payload.get("accounts")
    snapshots_data = payload.get("snapshots")
    if not isinstance(accounts_data, list) or not isinstance(snapshots_data, list):
        raise HTTPException(422, "Plik nie jest prawidłową kopią Worthly")

    accounts_created = 0
    snapshots_created = 0
    imported_to_local: dict[int, int] = {}
    try:
        if mode == "replace":
            db.query(Goal).delete(synchronize_session=False)
            db.query(AppSetting).delete(synchronize_session=False)
            db.query(Snapshot).delete(synchronize_session=False)
            db.query(Account).delete(synchronize_session=False)
            db.flush()

        existing = {
            (account.name.casefold(), account.institution.casefold(), account.kind): account
            for account in db.query(Account).all()
        }
        for item in accounts_data:
            if not isinstance(item, dict):
                raise HTTPException(422, "Nieprawidłowy rekord konta")
            values = _account_import_values(item)
            imported_id = int(item.get("id", 0))
            signature = (
                values["name"].casefold(),
                values["institution"].casefold(),
                values["kind"],
            )
            account = None if mode == "replace" else existing.get(signature)
            if not account:
                account = Account(**values)
                if mode == "replace" and imported_id > 0:
                    account.id = imported_id
                db.add(account)
                db.flush()
                accounts_created += 1
                existing[signature] = account
            imported_to_local[imported_id] = account.id

        for item in snapshots_data:
            if not isinstance(item, dict):
                raise HTTPException(422, "Nieprawidłowy rekord snapshotu")
            imported_account_id = int(item.get("account_id", 0))
            local_account_id = imported_to_local.get(imported_account_id)
            if not local_account_id:
                raise HTTPException(422, "Snapshot odwołuje się do nieistniejącego konta")
            values = _snapshot_import_values(item)
            duplicate = None
            if mode == "merge":
                duplicate = (
                    db.query(Snapshot)
                    .filter(
                        Snapshot.account_id == local_account_id,
                        Snapshot.snapshot_date == values["snapshot_date"],
                        Snapshot.amount == values["amount"],
                        Snapshot.note == values["note"],
                    )
                    .first()
                )
            if duplicate:
                continue
            snapshot = Snapshot(account_id=local_account_id, **values)
            imported_snapshot_id = int(item.get("id", 0))
            if mode == "replace" and imported_snapshot_id > 0:
                snapshot.id = imported_snapshot_id
            db.add(snapshot)
            snapshots_created += 1

        settings_data = payload.get("settings", {})
        if isinstance(settings_data, dict):
            imported_date_format = settings_data.get("date_format")
            if imported_date_format in {
                "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY"
            }:
                set_setting(db, "date_format", imported_date_format)

        existing_goals = {
            goal.name.casefold(): goal for goal in db.query(Goal).all()
        }
        for item in payload.get("goals", []):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()[:120]
            if not name or name.casefold() in existing_goals:
                continue
            goal = Goal(
                name=name,
                target_amount=float(item.get("target_amount", 0)),
                start_amount=float(item.get("start_amount", 0)),
                start_date=_parse_date(
                    item.get("start_date") or item.get("created_at") or date.today(),
                    "start_date",
                ),
                target_date=_parse_date(
                    item.get("target_date"), "target_date", optional=True
                ),
                completed=bool(item.get("completed", False)),
            )
            if math.isfinite(goal.target_amount) and math.isfinite(
                goal.start_amount
            ):
                db.add(goal)
                existing_goals[name.casefold()] = goal
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except (TypeError, ValueError) as error:
        db.rollback()
        raise HTTPException(422, f"Nieprawidłowe dane importu: {error}") from None

    return {
        "mode": mode,
        "accountsCreated": accounts_created,
        "snapshotsCreated": snapshots_created,
    }


@app.post("/api/import/csv")
def import_csv(payload: dict, db: Session = Depends(get_db)):
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(422, "Plik CSV jest pusty")
    if len(content) > 10_000_000:
        raise HTTPException(413, "Plik CSV jest zbyt duży")
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    required = {"account_name", "kind", "date", "amount"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(422, "CSV nie zawiera wymaganych kolumn Worthly")

    accounts_created = 0
    snapshots_created = 0
    existing = {
        (account.name.casefold(), account.institution.casefold(), account.kind): account
        for account in db.query(Account).all()
    }
    try:
        for row in reader:
            account_values = _account_import_values(
                {
                    "name": row.get("account_name"),
                    "institution": row.get("institution", ""),
                    "kind": row.get("kind"),
                    "category": row.get("category", "Inne"),
                    "currency": row.get("currency", "PLN"),
                    "color": "#2f6f5e" if row.get("kind") == "asset" else "#a95342",
                    "next_update": (date.today() + timedelta(days=30)).isoformat(),
                }
            )
            signature = (
                account_values["name"].casefold(),
                account_values["institution"].casefold(),
                account_values["kind"],
            )
            account = existing.get(signature)
            if not account:
                account = Account(**account_values)
                db.add(account)
                db.flush()
                existing[signature] = account
                accounts_created += 1
            snapshot_values = _snapshot_import_values(
                {
                    "date": row.get("date"),
                    "amount": row.get("amount"),
                    "note": row.get("note", ""),
                    "important": row.get("important", ""),
                    "rate_to_pln": row.get("rate_to_pln", 1),
                    "rate_date": row.get("rate_date") or row.get("date"),
                    "source": row.get("source", "import"),
                }
            )
            duplicate = (
                db.query(Snapshot)
                .filter(
                    Snapshot.account_id == account.id,
                    Snapshot.snapshot_date == snapshot_values["snapshot_date"],
                    Snapshot.amount == snapshot_values["amount"],
                    Snapshot.note == snapshot_values["note"],
                )
                .first()
            )
            if duplicate:
                continue
            db.add(Snapshot(account_id=account.id, **snapshot_values))
            snapshots_created += 1
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except (TypeError, ValueError) as error:
        db.rollback()
        raise HTTPException(422, f"Nieprawidłowe dane CSV: {error}") from None

    return {
        "mode": "merge",
        "accountsCreated": accounts_created,
        "snapshotsCreated": snapshots_created,
    }
