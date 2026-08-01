from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    institution: str = Field(default="", max_length=120)
    kind: str = Field(pattern="^(asset|liability)$")
    category: str = Field(min_length=1, max_length=60)
    currency: str = Field(default="PLN", min_length=3, max_length=3)
    color: str = "#2f6f5e"
    update_frequency: str = Field(
        default="monthly", pattern="^(weekly|monthly|quarterly|yearly)$"
    )
    opening_balance: float = Field(default=0, ge=0)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    archived: bool | None = None
    update_frequency: str | None = Field(
        default=None, pattern="^(weekly|monthly|quarterly|yearly)$"
    )
    convert_amounts: bool = False


class SnapshotCreate(BaseModel):
    amount: float = Field(ge=0)
    snapshot_date: date = Field(default_factory=date.today)
    note: str = Field(default="", max_length=300)
    important: bool = False
    source: str = "manual"


class SnapshotUpdate(BaseModel):
    amount: float | None = Field(default=None, ge=0)
    snapshot_date: date | None = None
    note: str | None = Field(default=None, max_length=300)
    important: bool | None = None


class SyncEntry(BaseModel):
    date: date
    account_name: str = Field(min_length=1, max_length=120)
    value: float = Field(ge=0)
    currency: str | None = Field(
        default=None, min_length=3, max_length=3, pattern="^[A-Za-z]{3}$"
    )


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    institution: str
    kind: str
    category: str
    currency: str
    color: str
    archived: bool
    update_frequency: str
    next_update: date | None
    current_balance: float
    previous_balance: float
    native_current_balance: float
    native_previous_balance: float
    last_updated: date | None
    change: float


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    snapshot_date: date
    amount: float
    note: str
    important: bool
    rate_to_pln: float
    rate_date: date | None
    source: str


class SettingsUpdate(BaseModel):
    base_currency: str = Field(pattern="^(PLN|EUR|USD|GBP|CHF)$")
    date_format: str = Field(pattern="^(DD.MM.YYYY|YYYY-MM-DD|DD/MM/YYYY)$")


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_amount: float
    target_date: date | None = None


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_amount: float | None = None
    target_date: date | None = None
    completed: bool | None = None
