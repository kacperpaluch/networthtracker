import os
from datetime import date
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./data/test.db"
os.environ["LOAD_DEMO_DATA"] = "true"
Path("./data/test.db").unlink(missing_ok=True)

from fastapi.testclient import TestClient

from app.main import app
from app.main import env_flag
from app.main import goal_progress
from app.main import STATIC_VERSION
from app.database import SessionLocal
from app.fx import rate_to_pln
from app.models import AppSetting, ExchangeRate


client = TestClient(app)


def test_demo_data_flag_is_opt_in(monkeypatch):
    monkeypatch.delenv("LOAD_DEMO_DATA", raising=False)
    assert env_flag("LOAD_DEMO_DATA") is False
    monkeypatch.setenv("LOAD_DEMO_DATA", "true")
    assert env_flag("LOAD_DEMO_DATA") is True


def test_dashboard_has_seed_data():
    response = client.get("/api/dashboard")
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["netWorth"] > 0
    assert len(payload["accounts"]) == 6
    assert len(payload["timeline"]) >= 12


def test_create_account_and_snapshot():
    created = client.post(
        "/api/accounts",
        json={
            "name": "Lokata",
            "institution": "Bank",
            "kind": "asset",
            "category": "Oszczędności",
            "opening_balance": 5000,
        },
    )
    assert created.status_code == 201
    account_id = created.json()["id"]
    snapshot = client.post(
        f"/api/accounts/{account_id}/snapshots",
        json={"amount": 5200, "snapshot_date": "2026-07-30", "note": "Kapitalizacja"},
    )
    assert snapshot.status_code == 201
    assert snapshot.json()["amount"] == 5200


def test_historical_monthly_report():
    response = client.get("/api/reports/monthly?month=2026-06")
    assert response.status_code == 200
    payload = response.json()
    assert payload["month"] == "2026-06"
    assert payload["netWorth"] > 0
    assert len(payload["accounts"]) >= 6


def test_single_server_renders_interface():
    response = client.get("/")
    assert response.status_code == 200
    assert "Worthly" in response.text
    assert f"/static/app.js?v={STATIC_VERSION}" in response.text
    assert f"/static/styles.css?v={STATIC_VERSION}" in response.text
    assert f'window.WORTHLY_VERSION = "{app.version}"' in response.text


def test_settings_and_exports():
    settings = client.get("/api/settings")
    assert settings.status_code == 200
    assert settings.json()["storage"] == "SQLite"

    json_export = client.get("/api/export/json")
    assert json_export.status_code == 200
    assert "attachment" in json_export.headers["content-disposition"]

    csv_export = client.get("/api/export/csv")
    assert csv_export.status_code == 200
    assert "account_name" in csv_export.text


def test_json_import_merge_and_replace_without_duplicates():
    backup = client.get("/api/export/json").json()
    before = client.get("/api/settings").json()

    merged = client.post("/api/import/json?mode=merge", json=backup)
    assert merged.status_code == 200
    assert merged.json()["accountsCreated"] == 0
    assert merged.json()["snapshotsCreated"] == 0

    replaced = client.post("/api/import/json?mode=replace", json=backup)
    assert replaced.status_code == 200
    after = client.get("/api/settings").json()
    assert after["accounts"] == before["accounts"]
    assert after["snapshots"] == before["snapshots"]


def test_csv_import_is_idempotent():
    exported = client.get("/api/export/csv").text
    before = client.get("/api/settings").json()
    imported = client.post("/api/import/csv", json={"content": exported})
    assert imported.status_code == 200
    assert imported.json()["accountsCreated"] == 0
    assert imported.json()["snapshotsCreated"] == 0
    assert client.get("/api/settings").json()["snapshots"] == before["snapshots"]


def test_edit_archive_and_restore_account():
    created = client.post(
        "/api/accounts",
        json={
            "name": "Konto do edycji",
            "institution": "Bank A",
            "kind": "asset",
            "category": "Gotówka",
            "opening_balance": 1000,
        },
    ).json()
    updated = client.patch(
        f"/api/accounts/{created['id']}",
        json={
            "name": "Konto poprawione",
            "category": "Oszczędności",
            "update_frequency": "quarterly",
            "archived": True,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["archived"] is True
    assert updated.json()["name"] == "Konto poprawione"

    active_ids = {item["id"] for item in client.get("/api/accounts").json()}
    assert created["id"] not in active_ids
    restored = client.patch(
        f"/api/accounts/{created['id']}", json={"archived": False}
    )
    assert restored.status_code == 200
    assert restored.json()["archived"] is False


def test_change_account_currency_recalculates_snapshot_rates(monkeypatch):
    monkeypatch.setattr(
        "app.main.rate_to_pln",
        lambda currency, day, db, **kwargs: (4.25, day),
    )
    account = client.post(
        "/api/accounts",
        json={
            "name": "Konto z błędną walutą",
            "kind": "asset",
            "category": "Gotówka",
            "currency": "PLN",
            "opening_balance": 100,
        },
    ).json()

    changed = client.patch(
        f"/api/accounts/{account['id']}", json={"currency": "eur"}
    )
    assert changed.status_code == 200
    assert changed.json()["currency"] == "EUR"
    snapshots = client.get(
        f"/api/accounts/{account['id']}/snapshots"
    ).json()
    assert snapshots[0]["amount"] == 100
    assert snapshots[0]["rate_to_pln"] == 4.25


def test_delete_account_also_deletes_its_snapshots():
    account = client.post(
        "/api/accounts",
        json={
            "name": "Konto do usunięcia",
            "kind": "asset",
            "category": "Inne",
            "opening_balance": 10,
        },
    ).json()
    snapshot_id = client.get(
        f"/api/accounts/{account['id']}/snapshots"
    ).json()[0]["id"]

    deleted = client.delete(f"/api/accounts/{account['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/accounts/{account['id']}/snapshots").status_code == 404
    assert client.patch(f"/api/snapshots/{snapshot_id}", json={"amount": 20}).status_code == 404


def test_manual_exchange_rate_refresh_uses_current_nbp_rate(monkeypatch):
    calls = []

    def fake_rate(currency, day, db, **kwargs):
        calls.append((currency, day, kwargs.get("force_refresh")))
        return 4.25, day

    monkeypatch.setattr("app.main.rate_to_pln", fake_rate)
    client.post(
        "/api/accounts",
        json={
            "name": "Konto EUR do odświeżenia",
            "kind": "asset",
            "category": "Gotówka",
            "currency": "EUR",
            "opening_balance": 1,
        },
    )
    calls.clear()
    response = client.post("/api/exchange-rates/refresh")
    assert response.status_code == 200
    assert any(currency == "EUR" and forced is True for currency, _, forced in calls)


def test_edit_and_delete_snapshot():
    account = client.post(
        "/api/accounts",
        json={
            "name": "Historia do korekty",
            "kind": "liability",
            "category": "Kredyty",
            "opening_balance": 8000,
        },
    ).json()
    snapshot = client.post(
        f"/api/accounts/{account['id']}/snapshots",
        json={"amount": 7500, "snapshot_date": "2026-07-15", "note": "Pierwsza wersja"},
    ).json()
    corrected = client.patch(
        f"/api/snapshots/{snapshot['id']}",
        json={"amount": 7400, "snapshot_date": "2026-07-16", "note": "Korekta"},
    )
    assert corrected.status_code == 200
    assert corrected.json()["amount"] == 7400
    assert corrected.json()["snapshot_date"] == "2026-07-16"

    deleted = client.delete(f"/api/snapshots/{snapshot['id']}")
    assert deleted.status_code == 204
    snapshot_ids = {
        item["id"]
        for item in client.get(f"/api/accounts/{account['id']}/snapshots").json()
    }
    assert snapshot["id"] not in snapshot_ids


def test_real_settings_and_date_format():
    response = client.patch(
        "/api/settings",
        json={"base_currency": "PLN", "date_format": "YYYY-MM-DD"},
    )
    assert response.status_code == 200
    assert response.json()["dateFormat"] == "YYYY-MM-DD"
    assert client.get("/api/dashboard").json()["summary"]["dateFormat"] == "YYYY-MM-DD"


def test_financial_goal_lifecycle():
    created = client.post(
        "/api/goals",
        json={
            "name": "Pół miliona",
            "target_amount": 500000,
            "target_date": "2030-12-31",
        },
    )
    assert created.status_code == 201
    goal_id = created.json()["id"]
    goals = client.get("/api/goals").json()
    assert any(item["id"] == goal_id and item["progress"] >= 0 for item in goals)
    completed = client.patch(f"/api/goals/{goal_id}", json={"completed": True})
    assert completed.status_code == 200
    assert client.delete(f"/api/goals/{goal_id}").status_code == 204


def test_negative_net_worth_goal_uses_creation_value_as_start():
    current_net = client.get("/api/dashboard").json()["summary"]["netWorth"]
    created = client.post(
        "/api/goals",
        json={
            "name": "Wyjście z zadłużenia",
            "target_amount": -40000,
            "target_date": "2026-12-31",
        },
    )
    assert created.status_code == 201
    goal = next(
        item
        for item in client.get("/api/goals").json()
        if item["id"] == created.json()["id"]
    )
    assert goal["targetAmount"] == -40000
    assert goal["startAmount"] == current_net
    assert goal["progress"] == 0
    exported_goal = next(
        item
        for item in client.get("/api/export/json").json()["goals"]
        if item["id"] == created.json()["id"]
    )
    assert exported_goal["target_amount"] == -40000
    assert exported_goal["start_amount"] == current_net
    assert goal_progress(-50000, -45000, -40000) == 50
    assert goal_progress(-50000, -40000, -40000) == 100


def test_annual_report_and_year_over_year():
    response = client.get("/api/reports/annual?year=2026")
    assert response.status_code == 200
    payload = response.json()
    assert payload["year"] == 2026
    assert len(payload["months"]) >= 1
    assert "yearOverYearPercent" in payload

    monthly = client.get("/api/reports/monthly?month=2026-06").json()
    assert "yearOverYear" in monthly
    assert "yearOverYearPercent" in monthly


def test_foreign_currency_uses_rate_saved_with_snapshot(monkeypatch):
    monkeypatch.setattr(
        "app.main.rate_to_pln",
        lambda currency, day, db: (4.0, day),
    )
    created = client.post(
        "/api/accounts",
        json={
            "name": "Konto USD",
            "kind": "asset",
            "category": "Gotówka",
            "currency": "USD",
            "opening_balance": 100,
            "update_frequency": "weekly",
        },
    )
    assert created.status_code == 201
    assert created.json()["native_current_balance"] == 100
    assert created.json()["current_balance"] == 400
    snapshots = client.get(
        f"/api/accounts/{created.json()['id']}/snapshots"
    ).json()
    assert snapshots[0]["rate_to_pln"] == 4.0
    recent = client.get("/api/dashboard").json()["recent"]
    activity = next(item for item in recent if item["account"] == "Konto USD")
    assert activity["rateToPln"] == 4.0
    assert activity["rateDate"] == snapshots[0]["rate_date"]


def test_weekend_snapshot_uses_friday_nbp_rate_and_checks_once(monkeypatch):
    weekend = date(2026, 7, 26)
    friday = date(2026, 7, 24)
    calls = []

    class FakeResponse:
        status_code = 200
        is_error = False

        @staticmethod
        def json():
            return {
                "rates": [
                    {"effectiveDate": friday.isoformat(), "mid": 2.75}
                ]
            }

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse()

    monkeypatch.setattr("app.fx.httpx.get", fake_get)
    with SessionLocal() as db:
        db.query(ExchangeRate).filter(ExchangeRate.currency == "CAD").delete()
        (
            db.query(AppSetting)
            .filter(AppSetting.key.like("%CAD%"))
            .delete(synchronize_session=False)
        )
        db.add(
            ExchangeRate(
                currency="CAD",
                effective_date=date(2026, 7, 22),
                rate_to_pln=2.7,
                table="A",
            )
        )
        db.commit()

        rate, rate_date = rate_to_pln("CAD", weekend, db)
        assert rate == 2.75
        assert rate_date == friday
        assert len(calls) == 1
        db.commit()

        cached_rate, cached_date = rate_to_pln("CAD", weekend, db)
        assert (cached_rate, cached_date) == (2.75, friday)
        assert len(calls) == 1


def test_important_snapshot_note_is_exposed_in_activity():
    account = client.post(
        "/api/accounts",
        json={
            "name": "Konto z komentarzem",
            "kind": "asset",
            "category": "Inne",
            "opening_balance": 100,
        },
    ).json()
    response = client.post(
        f"/api/accounts/{account['id']}/snapshots",
        json={
            "amount": 250,
            "snapshot_date": "2026-07-30",
            "note": "Premia roczna",
            "important": True,
        },
    )
    assert response.status_code == 201
    recent = client.get("/api/dashboard").json()["recent"]
    assert any(item["note"] == "Premia roczna" and item["important"] for item in recent)
