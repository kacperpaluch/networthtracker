from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator


def reject_future_date(value: date | None) -> date | None:
    if value is not None and value > date.today():
        raise ValueError("Data nie może być w przyszłości")
    return value


class InputModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")


class AccountCreate(InputModel):
    name: str = Field(min_length=1, max_length=120)
    institution: str = Field(default="", max_length=120)
    kind: str = Field(pattern="^(asset|liability)$")
    category: str = Field(min_length=1, max_length=60)
    color: str = "#2f6f5e"
    update_frequency: str = Field(
        default="monthly", pattern="^(weekly|monthly|quarterly|yearly)$"
    )
    opening_balance: float = Field(default=0, ge=0)


class AccountUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = None
    archived: bool | None = None
    update_frequency: str | None = Field(
        default=None, pattern="^(weekly|monthly|quarterly|yearly)$"
    )


class SnapshotCreate(InputModel):
    amount: float = Field(ge=0)
    snapshot_date: date = Field(default_factory=date.today)
    note: str = Field(default="", max_length=300)
    important: bool = False
    source: str = "manual"

    _snapshot_not_future = field_validator("snapshot_date")(
        reject_future_date
    )


class SnapshotUpdate(InputModel):
    amount: float | None = Field(default=None, ge=0)
    snapshot_date: date | None = None
    note: str | None = Field(default=None, max_length=300)
    important: bool | None = None

    _snapshot_not_future = field_validator("snapshot_date")(
        reject_future_date
    )


class SyncEntry(InputModel):
    date: date
    account_name: str = Field(min_length=1, max_length=120)
    value: float = Field(ge=0)
    # Nieużywane w logice, ale InputModel ma extra="forbid" — usunięcie tego
    # pola zwróciłoby 422 integracjom n8n z poprzedniej wersji.
    currency: str | None = Field(
        default=None, min_length=3, max_length=3, pattern="^(PLN|pln)$"
    )

    _date_not_future = field_validator("date")(reject_future_date)


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
    source: str


class SettingsUpdate(InputModel):
    date_format: str = Field(pattern="^(DD.MM.YYYY|YYYY-MM-DD|DD/MM/YYYY)$")


class GoalCreate(InputModel):
    name: str = Field(min_length=1, max_length=120)
    target_amount: float
    start_date: date = Field(default_factory=date.today)
    target_date: date | None = None


class GoalUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_amount: float | None = None
    start_date: date | None = None
    target_date: date | None = None
    completed: bool | None = None
