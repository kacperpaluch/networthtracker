# Net Worth Tracker — dokumentacja programistyczna

Dokument opisuje architekturę wersji `1.6.0` i reguły potrzebne przy dalszej
rozbudowie.

## Założenia

- jeden użytkownik, bez logowania;
- aplikacja działa lokalnie w jednym kontenerze;
- FastAPI serwuje API i interfejs;
- dane są przechowywane w SQLite;
- historia składa się ze snapshotów sald, nie z transakcji;
- zobowiązania są dodatnimi kwotami odejmowanymi od aktywów;
- wszystkie kwoty są przechowywane w PLN;
- systemowy cron w tym samym kontenerze wykonuje kopie bazy.

## Architektura

```text
Przeglądarka
    │ HTML / CSS / JavaScript / JSON
    ▼
FastAPI + Jinja2
    ├── REST API
    ├── raporty i eksport
    └── statyczny interfejs
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
| `archived` | ukrycie bez usuwania historii |
| `archived_at` | data wyłączenia konta z bieżącej wartości netto |
| `update_frequency` | `weekly`, `monthly`, `quarterly` lub `yearly` |
| `next_update` | termin kolejnego przypomnienia |

### Snapshot

| Pole | Znaczenie |
| --- | --- |
| `account_id` | konto |
| `snapshot_date` | dzień salda |
| `amount` | kwota PLN |
| `note` | komentarz użytkownika |
| `important` | wyróżnienie istotnej zmiany |
| `source` | `manual`, `actual-budget`, `seed` albo `import` |

`AppSetting` przechowuje format dat. `Goal` przechowuje docelową
wartość netto, wybraną `start_date` oraz wyliczone dla niej `start_amount`.
Kwoty celu i postęp są liczone bezpośrednio w PLN. Migracja
SQLite uzupełnia `start_date`
istniejących celów datą ich utworzenia. Dzięki temu postęp działa również
między wartościami ujemnymi.

Odpowiedź celu zawiera również `remainingAmount`, `gainedAmount`,
`timeProgress`, `paceStatus`, `monthlyPace`, `requiredMonthlyChange` i
`estimatedCompletionDate`. Tempo jest normalizowane do średniego miesiąca
30,4375 dnia. Status względem planu porównuje postęp finansowy i czasowy z
tolerancją 3 punktów procentowych. Prognoza daty jest zwracana tylko dla
dodatniego tempa prowadzącego w stronę celu i maksymalnego horyzontu 50 lat.

Dashboard zwraca pełną linię czasu. Frontend filtruje ją według kalendarzowych
zakresów 6 lub 12 miesięcy albo pokazuje całość, rozmieszcza punkty według ich
rzeczywistych dat i rysuje jedną etykietę `RRRR-MM` na miesiąc. Wykres canvas
obsługuje tooltip z pełną datą i dokładną wartością najbliższego punktu.
Ten sam renderer obsługuje wykres pojedynczego konta. Modal konta filtruje
snapshoty klientowo według zakresów 3M/6M/1R/MAX lub własnych dat i dzieli
tabelę historii na strony po 10 wpisów.
Raport roczny rozpoczyna listę miesięcy od pierwszego snapshotu dostępnego w
pierwszym roku danych; nie generuje wcześniejszych miesięcy z fikcyjnym zerem.
Zmiana procentowa używa bezwzględnej wartości bazowej jako mianownika, dzięki
czemu znak wynika z faktycznego kierunku zmiany również dla wartości ujemnych.
Pole `summary.change` porównuje dwa ostatnie globalne punkty timeline, dzięki
czemu nie miesza przedostatnich snapshotów poszczególnych kont. Timeline jest
budowany w jednym przebiegu po chronologicznie pogrupowanych snapshotach.
Pole `statistics` dashboardu zawiera zmiany okresowe, średnią z maksymalnie 12
zmian miesięcznych, najlepszy miesiąc, liczbę miesięcy wzrostowych, zmianę
zobowiązań, rekord oraz liniową prognozę na 12 miesięcy. Miesiące bez nowego
snapshotu przenoszą ostatnią znaną wartość. Metryka okresowa pozostaje `null`,
jeśli przed datą graniczną nie ma rzeczywistego punktu odniesienia.

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

## Waluta

Backend przyjmuje, przechowuje i zwraca wyłącznie kwoty PLN. Nie wykonuje
zapytań sieciowych o kursy. Migracja wersji 1.6 mnoży kwoty starych kont
walutowych przez kurs zapisany przy snapshocie, ustawia konta na PLN i usuwa
nieużywany cache kursów. Import starych kopii JSON i CSV wykonuje tę samą
konwersję podczas odczytu.

Daty snapshotów, synchronizacji i importu nie mogą wykraczać poza bieżący
dzień. Walidacja obejmuje tworzenie, edycję, `POST /api/sync` oraz import JSON i
CSV.

## Endpointy

| Metoda | Endpoint | Znaczenie |
| --- | --- | --- |
| `GET` | `/api/health` | healthcheck |
| `GET` | `/api/dashboard` | agregaty i dane widoków |
| `GET` | `/api/activity` | filtrowana i stronicowana historia snapshotów |
| `GET/POST` | `/api/accounts` | lista i nowe konto |
| `PATCH` | `/api/accounts/{id}` | edycja i archiwizacja |
| `DELETE` | `/api/accounts/{id}` | trwałe usunięcie konta i snapshotów |
| `GET/POST` | `/api/accounts/{id}/snapshots` | historia i nowy snapshot |
| `PATCH/DELETE` | `/api/snapshots/{id}` | korekta lub usunięcie |
| `POST` | `/api/sync` | idempotentny upsert sald po nazwie konta i dacie |
| `GET` | `/api/reports/monthly?month=RRRR-MM` | raport miesięczny |
| `GET` | `/api/reports/annual?year=RRRR` | raport roczny |
| `GET/PATCH` | `/api/settings` | preferencje |
| `GET/POST` | `/api/goals` | lista i nowy cel |
| `PATCH/DELETE` | `/api/goals/{id}` | zmiana lub usunięcie celu |
| `GET` | `/api/export/json` | pełna kopia logiczna |
| `GET` | `/api/export/csv` | historia tabelaryczna |
| `POST` | `/api/import/json` | scalenie lub przywrócenie |
| `POST` | `/api/import/csv` | import CSV w formacie aplikacji |

Pełny kontrakt jest dostępny w Swagger UI pod `/docs`.

### Aktywność i prezentacja kwot

`GET /api/activity` przyjmuje opcjonalne parametry `date_from`, `date_to`,
`account_id`, `source`, `page` i `page_size` (maksymalnie 100). Wynik zawiera
pełne dane snapshotu, saldo poprzednie i zmianę w PLN oraz pola
`total` i `hasMore`. Poprzedni wpis jest wyszukiwany w całej historii konta,
nie tylko wewnątrz wybranego zakresu dat, dzięki czemu zmiana na pierwszym
widocznym wierszu pozostaje prawidłowa.

Widok Aktywność domyślnie pokazuje 30 dni, pozwala wybrać szybki zakres,
konkretne daty, konto (także archiwalne) i źródło oraz doładowuje kolejne 25
wpisów. Kwoty szczegółowe mają zawsze dwa miejsca po przecinku. Dashboard
zaokrągla tylko trzy główne sumy; pozostałe widoki używają formatu adaptacyjnego
do dwóch miejsc po przecinku.

### Kontrakt synchronizacji

`POST /api/sync` zachowuje kompatybilność z integracjami n8n używanymi przez
poprzednią wersję aplikacji. Body jest tablicą obiektów z polami `date`
(`RRRR-MM-DD`), `account_name`, nieujemnym i skończonym `value` PLN oraz
opcjonalnym `currency`, które może mieć wyłącznie wartość `PLN`.

Endpoint buduje indeks aktywnych kont z użyciem `casefold()`. Brak dopasowania
lub kilka aktywnych kont o tej samej nazwie zwraca błąd danego elementu bez
przerywania całej paczki. Istniejący snapshot dla konta i daty jest wybierany
od najnowszego ID. Zmieniona wartość jest aktualizowana, identyczna klasyfikowana
jako `unchanged`, a brakujący snapshot tworzony ze źródłem `actual-budget`.
Po paczce przeliczane jest `next_update` każdego dotkniętego konta.

Datą rozpoczęcia synchronizacji konta jest najstarsza data jego snapshotu;
przy remisie rozstrzyga najniższe ID. Wpisy wcześniejsze nie są błędami:
zwiększają licznik `skipped` i trafiają do `ignored` z powodem
`before_tracking_start`. Siedmiodniowe okno n8n może dzięki temu pozostać stałe
bez dopisywania historii sprzed rozpoczęcia śledzenia. Aktualizacja istniejącego
snapshotu zachowuje jego pierwotne pole `source`.

Odpowiedź zawiera liczniki `created`, `updated`, `unchanged`, `skipped`, listę
`synced` z akcją każdego zapisanego elementu, listę `ignored` i listę `errors`.

Workflow wyceny najpierw doprowadza salda Actual do aktualnej wartości PLN, a
workflow Trackera uruchomiony później przesyła je z polem `"currency": "PLN"`
lub bez pola waluty.

## Migracje

`Base.metadata.create_all()` tworzy nowe tabele. Funkcja
`migrate_sqlite_schema()` dodaje brakujące kolumny, zachowuje historyczne
wartości podczas migracji do PLN i jest idempotentna. Przy kolejnych
rozbudowanych zmianach należy wdrożyć Alembic.

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

Testy obejmują dashboard, raporty, konta, snapshoty, historyczną archiwizację,
ustawienia, cele, walidację liczb i dat przyszłych, synchronizację, migrację
starych danych walutowych, import i eksport.

Uruchomienie bez Dockera:

```bash
mkdir -p data
uvicorn app.main:app --reload
```

## Bezpieczeństwo

Port nie powinien być publikowany bezpośrednio do internetu. Projekt celowo nie
ma logowania i zakłada zaufaną sieć lokalną.
