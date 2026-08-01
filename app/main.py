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
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import and_, inspect, or_, text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .fx import convert_from_pln, rate_to_pln
from .models import Account, AppSetting, ExchangeRate, Goal, Snapshot
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
    statements = []
    if "important" not in columns:
        statements.append(
            "ALTER TABLE snapshots ADD COLUMN important BOOLEAN NOT NULL DEFAULT 0"
        )
    if "rate_to_pln" not in columns:
        statements.append(
            "ALTER TABLE snapshots ADD COLUMN rate_to_pln FLOAT NOT NULL DEFAULT 1.0"
        )
    if "rate_date" not in columns:
        statements.append("ALTER TABLE snapshots ADD COLUMN rate_date DATE")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text(
                "UPDATE snapshots SET rate_to_pln = 1.0 "
                "WHERE rate_to_pln IS NULL OR rate_to_pln <= 0"
            )
        )
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
        connection.execute(
            text(
                "UPDATE snapshots SET rate_date = snapshot_date "
                "WHERE rate_date IS NULL"
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

app = FastAPI(title="Worthly", version="1.4.0")
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
templates = Jinja2Templates(directory=APP_DIR / "templates")


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


def snapshot_value(snapshot: Snapshot, base_currency: str, db: Session) -> float:
    amount_pln = snapshot.amount * (snapshot.rate_to_pln or 1.0)
    return convert_from_pln(
        amount_pln, base_currency, snapshot.snapshot_date, db
    )


def prepare_snapshot_rate(
    snapshot: Snapshot, account: Account, db: Session
) -> None:
    rate, rate_date = rate_to_pln(account.currency, snapshot.snapshot_date, db)
    snapshot.rate_to_pln = rate
    snapshot.rate_date = rate_date


def goal_response(
    goal: Goal, current_net: float, base_currency: str, db: Session
) -> dict:
    target = convert_from_pln(
        goal.target_amount, base_currency, date.today(), db
    )
    start = convert_from_pln(
        goal.start_amount, base_currency, date.today(), db
    )
    return {
        "id": goal.id,
        "name": goal.name,
        "targetAmount": round(target, 2),
        "startAmount": round(start, 2),
        "targetDate": goal.target_date.isoformat() if goal.target_date else None,
        "completed": goal.completed,
        "currentAmount": round(current_net, 2),
        "progress": goal_progress(start, current_net, target),
    }


def goal_progress(start: float, current: float, target: float) -> float:
    distance = target - start
    if distance == 0:
        return 100.0
    return round(max(0, min(100, (current - start) / distance * 100)), 1)


def current_net_worth(db: Session, base_currency: str) -> float:
    value = 0.0
    accounts = db.query(Account).filter(Account.archived.is_(False)).all()
    for account in accounts:
        balance = account_response(account, db, base_currency).current_balance
        value += balance if account.kind == "asset" else -balance
    return value


def account_response(
    account: Account, db: Session, base_currency: str | None = None
) -> AccountOut:
    base_currency = base_currency or get_setting(db, "base_currency", "PLN")
    ordered = sorted(account.snapshots, key=lambda item: (item.snapshot_date, item.id), reverse=True)
    native_current = ordered[0].amount if ordered else 0
    native_previous = ordered[1].amount if len(ordered) > 1 else native_current
    current = snapshot_value(ordered[0], base_currency, db) if ordered else 0
    previous = (
        snapshot_value(ordered[1], base_currency, db)
        if len(ordered) > 1
        else current
    )
    return AccountOut(
        **{column.name: getattr(account, column.name) for column in Account.__table__.columns if column.name not in {"created_at"}},
        current_balance=current,
        previous_balance=previous,
        native_current_balance=native_current,
        native_previous_balance=native_previous,
        last_updated=ordered[0].snapshot_date if ordered else None,
        change=current - previous,
    )


def exchange_rate_status(db: Session, accounts: list[Account] | None = None) -> dict:
    """Describe the NBP rates currently available to the application."""
    accounts = accounts if accounts is not None else db.query(Account).all()
    base_currency = get_setting(db, "base_currency", "PLN")
    currencies = {account.currency for account in accounts if account.currency != "PLN"}
    if base_currency != "PLN":
        currencies.add(base_currency)

    items = []
    for currency in sorted(currencies):
        latest = (
            db.query(ExchangeRate)
            .filter(ExchangeRate.currency == currency)
            .order_by(ExchangeRate.effective_date.desc())
            .first()
        )
        checked = db.get(AppSetting, f"fx_last_checked_{currency}")
        items.append(
            {
                "currency": currency,
                "effectiveDate": latest.effective_date.isoformat() if latest else None,
                "checkedAt": checked.value if checked else None,
            }
        )

    dated = [item["effectiveDate"] for item in items if item["effectiveDate"]]
    return {
        "provider": "NBP",
        "mode": "on_demand",
        "currencies": items,
        "effectiveDate": min(dated) if dated else None,
    }


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
    values["currency"] = values["currency"].upper()
    account = Account(**values)
    db.add(account)
    db.flush()
    snapshot = Snapshot(account_id=account.id, snapshot_date=date.today(), amount=payload.opening_balance, note="Saldo początkowe")
    prepare_snapshot_rate(snapshot, account, db)
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
    previous_currency = account.currency
    changes = payload.model_dump(exclude_unset=True)
    convert_amounts = changes.pop("convert_amounts", False)
    amounts_pln = {
        snapshot.id: snapshot.amount * (snapshot.rate_to_pln or 1.0)
        for snapshot in account.snapshots
    }
    for key, value in changes.items():
        if key == "currency" and value:
            value = value.upper()
        setattr(account, key, value)
    if "currency" in payload.model_fields_set:
        for snapshot in account.snapshots:
            prepare_snapshot_rate(snapshot, account, db)
            if convert_amounts and account.currency != previous_currency:
                snapshot.amount = amounts_pln[snapshot.id] / snapshot.rate_to_pln
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


@app.post("/api/accounts/{account_id}/snapshots", response_model=SnapshotOut, status_code=201)
def add_snapshot(account_id: int, payload: SnapshotCreate, db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Nie znaleziono konta")
    snapshot = Snapshot(account_id=account_id, **payload.model_dump())
    prepare_snapshot_rate(snapshot, account, db)
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
            .order_by(Snapshot.id)
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
        input_currency = (item.currency or account.currency).upper()
        if input_currency != account.currency:
            errors.append(
                {
                    **result_key,
                    "error": (
                        f"Waluta wejściowa {input_currency} nie zgadza się "
                        f"z walutą konta {account.currency}"
                    ),
                }
            )
            continue

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
            prepare_snapshot_rate(snapshot, account, db)
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


def balance_at(
    account_id: int, cutoff: date, base_currency: str, db: Session
) -> float:
    snapshot = (
        db.query(Snapshot)
        .filter(
            Snapshot.account_id == account_id,
            Snapshot.snapshot_date <= cutoff,
        )
        .order_by(Snapshot.snapshot_date.desc(), Snapshot.id.desc())
        .first()
    )
    return snapshot_value(snapshot, base_currency, db) if snapshot else 0.0


@app.patch("/api/snapshots/{snapshot_id}", response_model=SnapshotOut)
def update_snapshot(
    snapshot_id: int, payload: SnapshotUpdate, db: Session = Depends(get_db)
):
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(404, "Nie znaleziono snapshotu")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(snapshot, key, value)
    if "snapshot_date" in payload.model_fields_set:
        prepare_snapshot_rate(snapshot, snapshot.account, db)
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
    base_currency = get_setting(db, "base_currency", "PLN")
    date_format = get_setting(db, "date_format", "DD.MM.YYYY")
    accounts = db.query(Account).filter(Account.archived.is_(False)).all()
    snapshots = (
        db.query(Snapshot)
        .join(Account)
        .filter(Account.archived.is_(False))
        .order_by(Snapshot.snapshot_date, Snapshot.id)
        .all()
    )

    current_assets = current_liabilities = previous_assets = previous_liabilities = 0.0
    category_values: dict[str, float] = defaultdict(float)
    account_items = []
    for account in accounts:
        output = account_response(account, db, base_currency)
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
            previous_assets += output.previous_balance
            category_values[account.category] += output.current_balance
        else:
            current_liabilities += output.current_balance
            previous_liabilities += output.previous_balance

    by_account: dict[int, list[Snapshot]] = defaultdict(list)
    timeline_dates = set()
    for snapshot in snapshots:
        by_account[snapshot.account_id].append(snapshot)
        timeline_dates.add(snapshot.snapshot_date)

    timeline = []
    for point_date in sorted(timeline_dates):
        assets = liabilities = 0.0
        for account in accounts:
            eligible = [item for item in by_account[account.id] if item.snapshot_date <= point_date]
            if not eligible:
                continue
            value = snapshot_value(eligible[-1], base_currency, db)
            if account.kind == "asset":
                assets += value
            else:
                liabilities += value
        timeline.append({"date": point_date.isoformat(), "netWorth": round(assets - liabilities, 2), "assets": round(assets, 2), "liabilities": round(liabilities, 2)})

    current_net = current_assets - current_liabilities
    previous_net = previous_assets - previous_liabilities
    overdue = sum(1 for account in accounts if account.next_update and account.next_update < date.today())
    allocation = [
        {"name": name, "value": round(value, 2), "color": next((account.color for account in accounts if account.category == name), "#2f6f5e")}
        for name, value in sorted(category_values.items(), key=lambda item: item[1], reverse=True)
    ]
    recent = sorted(snapshots, key=lambda item: (item.created_at, item.id), reverse=True)[:5]
    goals = db.query(Goal).order_by(Goal.completed, Goal.created_at).all()

    return {
        "summary": {
            "netWorth": round(current_net, 2),
            "assets": round(current_assets, 2),
            "liabilities": round(current_liabilities, 2),
            "change": round(current_net - previous_net, 2),
            "changePercent": round(((current_net - previous_net) / previous_net * 100), 2) if previous_net else 0,
            "overdue": overdue,
            "updatedAt": max((item.snapshot_date for item in snapshots), default=date.today()).isoformat(),
            "baseCurrency": base_currency,
            "dateFormat": date_format,
            "exchangeRates": exchange_rate_status(db, accounts),
        },
        "timeline": timeline,
        "allocation": allocation,
        "accounts": account_items,
        "recent": [
            {
                "id": item.id,
                "account": item.account.name,
                "kind": item.account.kind,
                "amount": round(snapshot_value(item, base_currency, db), 2),
                "nativeAmount": item.amount,
                "currency": item.account.currency,
                "date": item.snapshot_date.isoformat(),
                "source": item.source,
                "note": item.note,
                "important": item.important,
                "rateToPln": item.rate_to_pln,
                "rateDate": item.rate_date.isoformat() if item.rate_date else None,
            }
            for item in recent
        ],
        "goals": [
            goal_response(goal, current_net, base_currency, db)
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
            Snapshot.created_at.desc(),
            Snapshot.id.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    base_currency = get_setting(db, "base_currency", "PLN")
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
        amount = snapshot_value(snapshot, base_currency, db)
        previous_amount = (
            snapshot_value(previous, base_currency, db) if previous else None
        )
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
                "rateToPln": snapshot.rate_to_pln,
                "rateDate": (
                    snapshot.rate_date.isoformat() if snapshot.rate_date else None
                ),
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
    accounts = db.query(Account).filter(Account.archived.is_(False)).all()
    base_currency = get_setting(db, "base_currency", "PLN")

    current_assets = current_liabilities = previous_assets = previous_liabilities = 0.0
    year_before_assets = year_before_liabilities = 0.0
    contributions = []
    for account in accounts:
        current_balance = balance_at(account.id, period_end, base_currency, db)
        previous_balance = balance_at(account.id, previous_end, base_currency, db)
        year_before_balance = balance_at(
            account.id, year_before_end, base_currency, db
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
        "baseCurrency": base_currency,
        "periodEnd": period_end.isoformat(),
        "netWorth": round(current_net, 2),
        "assets": round(current_assets, 2),
        "liabilities": round(current_liabilities, 2),
        "previousNetWorth": round(previous_net, 2),
        "change": round(net_change, 2),
        "changePercent": round(net_change / previous_net * 100, 2) if previous_net else 0,
        "yearBeforeNetWorth": round(year_before_net, 2),
        "yearOverYear": round(current_net - year_before_net, 2),
        "yearOverYearPercent": round(
            (current_net - year_before_net) / year_before_net * 100, 2
        )
        if year_before_net
        else 0,
        "assetChange": round(current_assets - previous_assets, 2),
        "liabilityChange": round(current_liabilities - previous_liabilities, 2),
        "accounts": sorted(contributions, key=lambda item: abs(item["contribution"]), reverse=True),
    }


@app.get("/api/reports/annual")
def annual_report(year: int, db: Session = Depends(get_db)):
    if year < 2002 or year > date.today().year:
        raise HTTPException(422, "Nieprawidłowy rok raportu")
    last_month = date.today().month if year == date.today().year else 12
    months = [
        monthly_report(f"{year}-{month:02d}", db)
        for month in range(1, last_month + 1)
    ]
    year_end = months[-1]
    previous_year_start = monthly_report(f"{year - 1}-12", db)
    previous_year_comparison = monthly_report(
        f"{year - 1}-{last_month:02d}", db
    )
    start_net = previous_year_start["netWorth"]
    end_net = year_end["netWorth"]
    change = end_net - start_net
    return {
        "year": year,
        "baseCurrency": get_setting(db, "base_currency", "PLN"),
        "netWorth": end_net,
        "assets": year_end["assets"],
        "liabilities": year_end["liabilities"],
        "startNetWorth": start_net,
        "change": round(change, 2),
        "changePercent": round(change / start_net * 100, 2) if start_net else 0,
        "previousYearNetWorth": previous_year_comparison["netWorth"],
        "yearOverYear": round(
            end_net - previous_year_comparison["netWorth"], 2
        ),
        "yearOverYearPercent": round(
            (end_net - previous_year_comparison["netWorth"])
            / previous_year_comparison["netWorth"]
            * 100,
            2,
        )
        if previous_year_comparison["netWorth"]
        else 0,
        "months": [
            {
                "date": f"{year}-{index:02d}-01",
                "netWorth": item["netWorth"],
                "assets": item["assets"],
                "liabilities": item["liabilities"],
                "change": item["change"],
            }
            for index, item in enumerate(months, 1)
        ],
    }


@app.get("/api/settings")
def settings_info(db: Session = Depends(get_db)):
    return {
        "version": app.version,
        "baseCurrency": get_setting(db, "base_currency", "PLN"),
        "dateFormat": get_setting(db, "date_format", "DD.MM.YYYY"),
        "supportedBaseCurrencies": ["PLN", "EUR", "USD", "GBP", "CHF"],
        "storage": "SQLite",
        "accounts": db.query(Account).count(),
        "snapshots": db.query(Snapshot).count(),
        "exchangeRates": exchange_rate_status(db),
    }


@app.patch("/api/settings")
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    if payload.base_currency != "PLN":
        rate_to_pln(payload.base_currency, date.today(), db)
    set_setting(db, "base_currency", payload.base_currency)
    set_setting(db, "date_format", payload.date_format)
    db.commit()
    return settings_info(db)


@app.post("/api/exchange-rates/refresh")
def refresh_exchange_rates(db: Session = Depends(get_db)):
    base_currency = get_setting(db, "base_currency", "PLN")
    currencies = {
        value[0]
        for value in db.query(Account.currency)
        .filter(Account.currency != "PLN")
        .distinct()
        .all()
    }
    if base_currency != "PLN":
        currencies.add(base_currency)
    for currency in sorted(currencies):
        rate_to_pln(currency, date.today(), db, force_refresh=True)
    db.commit()
    return exchange_rate_status(db)


@app.get("/api/goals")
def list_goals(db: Session = Depends(get_db)):
    return dashboard(db)["goals"]


@app.post("/api/goals", status_code=201)
def create_goal(payload: GoalCreate, db: Session = Depends(get_db)):
    values = payload.model_dump()
    base_currency = get_setting(db, "base_currency", "PLN")
    rate, _ = rate_to_pln(base_currency, date.today(), db)
    values["target_amount"] *= rate
    values["start_amount"] = current_net_worth(db, base_currency) * rate
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
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "target_amount" and value is not None:
            base_currency = get_setting(db, "base_currency", "PLN")
            rate, _ = rate_to_pln(base_currency, date.today(), db)
            value *= rate
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
        ["account_id", "account_name", "institution", "kind", "category", "date", "amount", "currency", "note", "important", "rate_to_pln", "rate_date", "source"]
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
                snapshot.account.currency,
                snapshot.note,
                snapshot.important,
                snapshot.rate_to_pln,
                snapshot.rate_date.isoformat() if snapshot.rate_date else "",
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


def _account_import_values(item: dict):
    kind = str(item.get("kind", ""))
    if kind not in {"asset", "liability"}:
        raise HTTPException(422, "Typ konta musi mieć wartość asset lub liability")
    name = str(item.get("name", "")).strip()
    if not name:
        raise HTTPException(422, "Importowane konto nie ma nazwy")
    return {
        "name": name[:120],
        "institution": str(item.get("institution", "")).strip()[:120],
        "kind": kind,
        "category": str(item.get("category", "Inne")).strip()[:60] or "Inne",
        "currency": str(item.get("currency", "PLN")).upper()[:3],
        "color": str(item.get("color", "#2f6f5e"))[:20],
        "archived": bool(item.get("archived", False)),
        "update_frequency": str(item.get("update_frequency", "monthly"))[:20],
        "next_update": _parse_date(item.get("next_update"), "next_update", optional=True),
    }


def _snapshot_import_values(item: dict):
    try:
        amount = float(item.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Snapshot zawiera nieprawidłową kwotę") from None
    if amount < 0:
        raise HTTPException(422, "Kwota snapshotu nie może być ujemna")
    try:
        rate = float(item.get("rate_to_pln", 1) or 1)
    except (TypeError, ValueError):
        rate = 1.0
    return {
        "snapshot_date": _parse_date(item.get("snapshot_date") or item.get("date"), "snapshot_date"),
        "amount": amount,
        "note": str(item.get("note", ""))[:300],
        "important": str(item.get("important", "")).lower()
        in {"1", "true", "yes"},
        "rate_to_pln": rate if rate > 0 else 1.0,
        "rate_date": _parse_date(
            item.get("rate_date")
            or item.get("snapshot_date")
            or item.get("date"),
            "rate_date",
        ),
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
            for key in ("base_currency", "date_format"):
                if key in settings_data:
                    set_setting(db, key, str(settings_data[key]))

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
