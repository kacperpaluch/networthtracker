# Net Worth Tracker — dokumentacja programistyczna

Dokument opisuje architekturę wersji `1.1.2` i reguły potrzebne przy dalszej
rozbudowie.

## Założenia

- jeden użytkownik, bez logowania;
- aplikacja działa lokalnie w jednym kontenerze;
- FastAPI serwuje API i interfejs;
- dane są przechowywane w SQLite;
- historia składa się ze snapshotów sald, nie z transakcji;
- zobowiązania są dodatnimi kwotami odejmowanymi od aktywów;
- konta mogą mieć różne waluty;
- historyczne kursy pochodzą z NBP i są zapisywane lokalnie;
- systemowy cron w tym samym kontenerze wykonuje kopie bazy.

## Architektura

```text
Przeglądarka
    │ HTML / CSS / JavaScript / JSON
    ▼
FastAPI + Jinja2
    ├── REST API
    ├── raporty i eksport
    ├── statyczny interfejs
    └── klient NBP Web API
    │
    ▼
SQLAlchemy ──> SQLite /data/networth.db

cron ── sqlite .backup ──> /backups
```

Nie ma Node.js, Reacta, bundlera ani osobnego kontenera bazy. Interfejs używa
vanilla JavaScript i Canvas API.

## Struktura repozytorium

```text
networthtracker/
├── app/
│   ├── static/
│   │   ├── app.js          # stan UI, widoki, formularze i wykresy
│   │   ├── styles.css      # wygląd i responsywność
│   │   ├── favicon.svg
│   │   └── og.png
│   ├── templates/
│   │   └── index.html      # szkielet strony i modale
│   ├── database.py         # silnik SQLAlchemy i sesje
│   ├── fx.py               # NBP, cache kursów i przeliczenia
│   ├── main.py             # aplikacja FastAPI i endpointy
│   ├── models.py           # modele tabel
│   ├── schemas.py          # kontrakty Pydantic
│   └── seed.py             # przykładowe dane dla pustej bazy
├── scripts/
│   ├── app-entrypoint.sh   # uruchomienie cron i FastAPI
│   └── backup.sh           # atomowa kopia SQLite
├── tests/
│   └── test_api.py
├── docs/
│   └── DEVELOPER_GUIDE.md
├── backups/
│   └── .gitkeep
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── requirements-dev.txt
└── README.md
```

Backend znajduje się w katalogu głównym, ponieważ repozytorium nie ma osobnego
frontendu ani drugiej aplikacji. Katalog `backend/` tworzyłby zbędny poziom.

## Technologie

- Python 3.13;
- FastAPI i Uvicorn;
- SQLAlchemy 2 i Pydantic 2;
- Jinja2 i SQLite;
- HTTPX do NBP;
- pytest i FastAPI TestClient;
- HTML, CSS, vanilla JavaScript i Canvas.

## Start aplikacji

1. `app-entrypoint.sh` ustawia strefę czasową.
2. Tworzy wpis w `/etc/cron.d/networthtracker-backup`.
3. Opcjonalnie uruchamia backup kontrolny.
4. Uruchamia demona `cron`.
5. Przekazuje PID 1 do Uvicorna przez `exec`.
6. Import `app.main` tworzy brakujące tabele i wykonuje małą migrację SQLite.
7. `seed_database()` uzupełnia całkowicie pustą bazę tylko wtedy, gdy
   `LOAD_DEMO_DATA=true`.

## Model danych

### Account

| Pole | Znaczenie |
| --- | --- |
| `name` | nazwa konta |
| `institution` | bank, broker lub opis |
| `kind` | `asset` albo `liability` |
| `category` | kategoria raportowa |
| `currency` | kod waluty konta |
| `archived` | ukrycie bez usuwania historii |
| `update_frequency` | `weekly`, `monthly`, `quarterly` lub `yearly` |
| `next_update` | termin kolejnego przypomnienia |

### Snapshot

| Pole | Znaczenie |
| --- | --- |
| `account_id` | konto |
| `snapshot_date` | dzień salda |
| `amount` | kwota w walucie konta |
| `note` | komentarz użytkownika |
| `important` | wyróżnienie istotnej zmiany |
| `rate_to_pln` | zapisany kurs jednostki waluty konta do PLN |
| `rate_date` | data notowania |
| `source` | `manual`, `seed` albo `import` |

`AppSetting` przechowuje walutę bazową i format dat. `Goal` przechowuje docelową
wartość netto oraz `start_amount` z chwili utworzenia celu; obie kwoty są
normalizowane do PLN. Dzięki temu postęp działa również między wartościami
ujemnymi. `ExchangeRate` jest lokalnym cache NBP z unikalną parą waluta–data.

## Reguły finansowe

```text
wartość netto = suma aktywów - suma zobowiązań
```

Saldo historyczne jest ostatnim snapshotem nie późniejszym niż data graniczna.
Brak wcześniejszego snapshotu oznacza `0`.

```text
wpływ aktywa = saldo bieżące - saldo poprzednie
wpływ zobowiązania = -(saldo bieżące - saldo poprzednie)
```

Spłata zobowiązania ma dodatni wpływ na wartość netto.

## Waluty i NBP

`fx.py` odpytuje przez HTTPS:

```text
https://api.nbp.pl/api/exchangerates/rates/{table}/{code}/{start}/{end}/
```

Najpierw używana jest tabela A, potem B. Dla weekendów i świąt wybierane jest
ostatnie notowanie z poprzednich 10 dni. PLN ma kurs `1`.

```text
wartość PLN = amount × rate_to_pln
wartość bazowa = wartość PLN / kurs waluty bazowej do PLN
```

Kurs jest zapisany przy snapshocie, dlatego późniejsze tabele NBP nie zmieniają
historycznego wyniku.

## Endpointy

| Metoda | Endpoint | Znaczenie |
| --- | --- | --- |
| `GET` | `/api/health` | healthcheck |
| `GET` | `/api/dashboard` | agregaty i dane widoków |
| `GET/POST` | `/api/accounts` | lista i nowe konto |
| `PATCH` | `/api/accounts/{id}` | edycja, zmiana waluty lub archiwizacja |
| `DELETE` | `/api/accounts/{id}` | trwałe usunięcie konta i snapshotów |
| `GET/POST` | `/api/accounts/{id}/snapshots` | historia i nowy snapshot |
| `PATCH/DELETE` | `/api/snapshots/{id}` | korekta lub usunięcie |
| `GET` | `/api/reports/monthly?month=RRRR-MM` | raport miesięczny |
| `GET` | `/api/reports/annual?year=RRRR` | raport roczny |
| `GET/PATCH` | `/api/settings` | preferencje |
| `POST` | `/api/exchange-rates/refresh` | pobranie najnowszych tabel NBP |
| `GET/POST` | `/api/goals` | lista i nowy cel |
| `PATCH/DELETE` | `/api/goals/{id}` | zmiana lub usunięcie celu |
| `GET` | `/api/export/json` | pełna kopia logiczna |
| `GET` | `/api/export/csv` | historia tabelaryczna |
| `POST` | `/api/import/json` | scalenie lub przywrócenie |
| `POST` | `/api/import/csv` | import CSV w formacie aplikacji |

Pełny kontrakt jest dostępny w Swagger UI pod `/docs`.

## Migracje

`Base.metadata.create_all()` tworzy nowe tabele. Funkcja
`migrate_sqlite_schema()` dodaje brakujące kolumny w starszej bazie i jest
idempotentna. Przy kolejnych rozbudowanych zmianach należy wdrożyć Alembic.

## Backup

`backup.sh` wykonuje `.backup`, sprawdza `PRAGMA integrity_check`, atomowo
zmienia nazwę pliku i usuwa kopie starsze niż `BACKUP_RETENTION_DAYS`.
Folder `/backups` jest mapowany na katalog hosta, a `/data` jest named volume.

JSON zawiera konta, snapshoty, cele i ustawienia. Tryb `merge` pomija
duplikaty, a `replace` odtwarza zawartość. CSV jest formatem własnym aplikacji.

## Testy i rozwój

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
PYTHONPATH=. pytest -q
```

Testy obejmują dashboard, raporty, konta, snapshoty, archiwizację, ustawienia,
cele, waluty, kurs snapshotu, import i eksport.

Uruchomienie bez Dockera:

```bash
mkdir -p data
uvicorn app.main:app --reload
```

## Bezpieczeństwo

Port nie powinien być publikowany bezpośrednio do internetu. Projekt celowo nie
ma logowania i zakłada zaufaną sieć lokalną.
