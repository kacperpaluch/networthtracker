from calendar import monthrange
from datetime import date

from sqlalchemy.orm import Session

from .models import Account, Snapshot


def shift_month(day: date, months: int) -> date:
    month_index = day.year * 12 + day.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def seed_database(db: Session) -> None:
    if db.query(Account).count():
        return

    today = date.today()
    accounts = [
        Account(name="Konto osobiste", institution="mBank", kind="asset", category="Gotówka", color="#2f6f5e", next_update=shift_month(today, 1)),
        Account(name="Konto oszczędnościowe", institution="ING", kind="asset", category="Oszczędności", color="#d3a349", next_update=shift_month(today, 1)),
        Account(name="Portfel ETF", institution="XTB", kind="asset", category="Inwestycje", color="#6f826a", next_update=shift_month(today, 1)),
        Account(name="Mieszkanie", institution="Warszawa", kind="asset", category="Nieruchomości", color="#bb7049", update_frequency="quarterly", next_update=shift_month(today, 3)),
        Account(name="Kredyt hipoteczny", institution="Santander", kind="liability", category="Kredyty", color="#a95342", next_update=shift_month(today, 1)),
        Account(name="Karta kredytowa", institution="Revolut", kind="liability", category="Karty", color="#745b51", next_update=shift_month(today, 1)),
    ]
    db.add_all(accounts)
    db.flush()

    starting = [11200, 47600, 78200, 465000, 298000, 4200]
    monthly = [900, 1800, 2900, 1000, -2100, -180]

    for account, base, delta in zip(accounts, starting, monthly):
        for offset in range(-11, 1):
            variance = ((account.id * 17 + offset * 13) % 7 - 3) * (90 if account.kind == "asset" else 35)
            amount = max(0, base + (offset + 11) * delta + variance)
            db.add(
                Snapshot(
                    account_id=account.id,
                    snapshot_date=shift_month(today.replace(day=1), offset),
                    amount=round(amount, 2),
                    rate_date=shift_month(today.replace(day=1), offset),
                    note="Dane demonstracyjne" if offset == -11 else "",
                    source="seed",
                )
            )
    db.commit()
