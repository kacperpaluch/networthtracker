from datetime import UTC, date, datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import AppSetting, ExchangeRate


NBP_API = "https://api.nbp.pl/api/exchangerates/rates"


def rate_to_pln(
    currency: str, day: date, db: Session, *, force_refresh: bool = False
) -> tuple[float, date]:
    """Return and cache the last NBP fixing available on or before ``day``."""
    code = currency.upper()
    if code == "PLN":
        return 1.0, day

    cached = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.currency == code,
            ExchangeRate.effective_date <= day,
        )
        .order_by(ExchangeRate.effective_date.desc())
        .first()
    )
    if (
        cached
        and not force_refresh
        and cached.effective_date >= day - timedelta(days=10)
    ):
        return cached.rate_to_pln, cached.effective_date

    end = min(day, date.today())
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
        checked_key = f"fx_last_checked_{code}"
        checked = db.get(AppSetting, checked_key)
        checked_value = datetime.now(UTC).isoformat()
        if checked:
            checked.value = checked_value
        else:
            db.add(AppSetting(key=checked_key, value=checked_value))
        return value, effective_date

    raise HTTPException(
        503,
        f"NBP nie udostępnił kursu {code} dla tej daty. Sprawdź kod waluty lub połączenie z internetem.",
    )


def convert_from_pln(
    amount_pln: float, base_currency: str, day: date, db: Session
) -> float:
    if base_currency == "PLN":
        return amount_pln
    base_rate, _ = rate_to_pln(base_currency, day, db)
    return amount_pln / base_rate
