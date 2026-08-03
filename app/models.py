from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    institution: Mapped[str] = mapped_column(String(120), default="")
    kind: Mapped[str] = mapped_column(String(20), index=True)
    category: Mapped[str] = mapped_column(String(60), index=True)
    currency: Mapped[str] = mapped_column(String(3), default="PLN")
    color: Mapped[str] = mapped_column(String(20), default="#2f6f5e")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    update_frequency: Mapped[str] = mapped_column(String(20), default="monthly")
    next_update: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )

    snapshots: Mapped[list["Snapshot"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class Snapshot(Base):
    __tablename__ = "snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(300), default="")
    important: Mapped[bool] = mapped_column(Boolean, default=False)
    rate_to_pln: Mapped[float] = mapped_column(Float, default=1.0)
    rate_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )

    account: Mapped[Account] = relationship(back_populates="snapshots")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(120))


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    target_amount: Mapped[float] = mapped_column(Float)
    start_amount: Mapped[float] = mapped_column(Float, default=0)
    start_date: Mapped[date] = mapped_column(Date, default=date.today)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (UniqueConstraint("currency", "effective_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    currency: Mapped[str] = mapped_column(String(3), index=True)
    effective_date: Mapped[date] = mapped_column(Date, index=True)
    rate_to_pln: Mapped[float] = mapped_column(Float)
    table: Mapped[str] = mapped_column(String(1), default="A")
