from datetime import UTC, date, datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import AppSetting, ExchangeRate


NBP_API = "https://api.nbp.pl/api/exchangerates/rates"


def set_setting(db: Session, key: str, value: str) -> None:
    setting = db.get(AppSetting, key)
    if setting:
        setting.value = value
    else:
        db.add(AppSetting(key=key, value=value))
        db.flush()


def rate_to_pln(
    currency: str,
    day: date,
    db: Session,
    *,
    force_refresh: bool = False,
    allow_network: bool = True,
) -> tuple[float, date]:
    """Return and cache the last NBP fixing available on or before ``day``."""
    code = currency.upper()
    if code == "PLN":
        return 1.0, day

    lookup_day = min(day, date.today())
    cached = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.currency == code,
            ExchangeRate.effective_date <= lookup_day,
        )
        .order_by(ExchangeRate.effective_date.desc())
        .first()
    )
    checked_for_day = db.get(
        AppSetting, f"fx_checked_{code}_{lookup_day.isoformat()}"
    )
    if (
        cached
        and not force_refresh
        and checked_for_day
        and cached.effective_date >= lookup_day - timedelta(days=10)
    ):
        return cached.rate_to_pln, cached.effective_date

    if not allow_network:
        if cached:
            return cached.rate_to_pln, cached.effective_date
        oldest = (
            db.query(ExchangeRate)
            .filter(ExchangeRate.currency == code)
            .order_by(ExchangeRate.effective_date)
            .first()
        )
        if oldest:
            # Dla dat sprzed pierwszego znanego kursu bierzemy najstarszy dostępny.
            # Bez tego jeden stary wpis blokuje cały dashboard bez możliwości naprawy z UI.
            return oldest.rate_to_pln, oldest.effective_date
        raise HTTPException(
            503,
            f"Brak lokalnego kursu {code} dla {lookup_day.isoformat()}. "
            "Odśwież kursy w ustawieniach.",
        )

    end = lookup_day
    start = end - timedelta(days=10)
    for table in ("A", "B"):
        url = f"{NBP_API}/{table}/{code}/{start.isoformat()}/{end.isoformat()}/"
        try:
            response = httpx.get(
                url,
                params={"format": "json"},
                headers={"Accept": "application/json"},
                timeout=8,
            )
        except httpx.HTTPError:
            continue
        if response.status_code == 404:
            continue
        if response.is_error:
            continue
        rates = response.json().get("rates", [])
        if not rates:
            continue
        latest = rates[-1]
        effective_date = date.fromisoformat(latest["effectiveDate"])
        value = float(latest["mid"])
        record = (
            db.query(ExchangeRate)
            .filter(
                ExchangeRate.currency == code,
                ExchangeRate.effective_date == effective_date,
            )
            .first()
        )
        if not record:
            db.add(
                ExchangeRate(
                    currency=code,
                    effective_date=effective_date,
                    rate_to_pln=value,
                    table=table,
                )
            )
            db.flush()
        set_setting(db, f"fx_last_checked_{code}", datetime.now(UTC).isoformat())
        set_setting(
            db,
            f"fx_checked_{code}_{lookup_day.isoformat()}",
            effective_date.isoformat(),
        )
        return value, effective_date

    if cached and cached.effective_date >= lookup_day - timedelta(days=10):
        return cached.rate_to_pln, cached.effective_date

    raise HTTPException(
        503,
        f"NBP nie udostępnił kursu {code} dla tej daty. Sprawdź kod waluty lub połączenie z internetem.",
    )


def convert_from_pln(
    amount_pln: float, base_currency: str, day: date, db: Session
) -> float:
    if base_currency == "PLN":
        return amount_pln
    base_rate, _ = rate_to_pln(
        base_currency, day, db, allow_network=False
    )
    return amount_pln / base_rate
