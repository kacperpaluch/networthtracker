# Net Worth Tracker

[![Docker Hub](https://img.shields.io/docker/pulls/kpa90/networthtracker?logo=docker&label=Docker+Hub)](https://hub.docker.com/r/kpa90/networthtracker)

Osobista aplikacja webowa do śledzenia wartości netto majątku w czasie. Pozwala rejestrować salda kont bankowych, inwestycji i zobowiązań w formie okresowych snapshotów, a następnie wizualizować trendy i analizować strukturę majątku.

---

## Funkcjonalności

- **Dashboard** z kartami podsumowania (wartość netto, aktywa, zobowiązania, zmiana YTD)
- **Wykresy**: liniowy wykres wartości netto w czasie + rozbicie na poszczególne konta (stacked area chart)
- **Porównanie okresów** (miesiąc / kwartał / rok lub daty własne) z najlepszym i najgorszym kontem
- **Trendy**: średnia miesięczna zmiana, CAGR (roczna stopa wzrostu)
- **Struktura majątku**: procent każdego konta w aktywach, wskaźnik D/A (dług do aktywów)
- **Historia snapshotów**: tabela ze zwijalnymi detalami
- **Zarządzanie kontami**: dodawanie, edycja, archiwizacja, usuwanie
- **Backup**: automatyczny wg konfigurowalnego harmonogramu cron (domyślnie 4:00), ręczny backup z UI, pobieranie, przywracanie z listy serwerowej lub z pliku `.db` wczytanego z dysku; harmonogram ustawiany z poziomu zakładki Backup (działa bez restartu)
- **Eksport / Import** danych w formacie JSON
- **Sync API** (`POST /api/sync`) — endpoint do automatycznej aktualizacji stanów kont z zewnętrznych źródeł (np. n8n); przyjmuje tablicę `[{date, account_name, value}]`, tworzy lub aktualizuje snapshot
- Responsywny ciemny motyw (dark mode)

---

## Technologie

### Backend
| Technologia | Wersja | Rola |
|---|---|---|
| Python | 3.12 (Docker) / 3.14 (dev) | Język backendowy |
| FastAPI | 0.115.0 | Framework HTTP / REST API |
| Uvicorn | 0.30.0 | Serwer ASGI |
| SQLite | (stdlib) | Baza danych |
| APScheduler | 3.10.4 | Automatyczny backup codziennie o 4:00 |
| python-multipart | 0.0.9 | Przesyłanie pliku .db do przywrócenia |
| Pydantic | (via FastAPI) | Walidacja danych wejściowych |

### Frontend
| Technologia | Źródło | Rola |
|---|---|---|
| Vanilla JavaScript (ES2020+) | lokalne | Logika UI, obsługa API |
| Chart.js | 4.4.0 (CDN) | Wykresy |
| chartjs-adapter-date-fns | 3.0.0 (CDN) | Oś czasu w wykresach |
| Space Grotesk | Google Fonts | Czcionka nagłówków |
| Plus Jakarta Sans | Google Fonts | Czcionka tekstu |
| JetBrains Mono | Google Fonts | Czcionka wartości liczbowych |

### Infrastruktura
| Technologia | Rola |
|---|---|
| Docker | Konteneryzacja aplikacji |
| Docker Compose | Orkiestracja, mapowanie portów i woluminu |

---

## Struktura plików

```
networthtracker/
├── main.py              # Aplikacja FastAPI — definicje endpointów REST API
├── db.py                # Warstwa danych — wszystkie operacje SQLite
├── requirements.txt     # Zależności Pythona (fastapi, uvicorn)
├── Dockerfile           # Obraz Dockera (python:3.12-slim)
├── docker-compose.yml   # Konfiguracja uruchomienia kontenera
├── static/
│   ├── index.html       # Struktura HTML (SPA), linki do CSS/JS, wyłącznie markup
│   ├── style.css        # Cały CSS (zmienne, layout, karty, tabela, modale, formularze)
│   └── js/
│       ├── app.js       # Stan globalny S, init, routing zakładek, refresh danych
│       ├── utils.js     # Narzędzia: fmtCurrency, fmtDate, esc, API helpers, modale
│       ├── charts.js    # Wykresy Chart.js: wartość netto (liniowy), rozbicie na konta (stacked)
│       ├── dashboard.js # Render dashboardu: karty podsumowania, porównanie, trendy, struktura
│       ├── history.js   # Historia snapshotów, modal tworzenia/edycji snapshotu
│       ├── accounts.js  # Lista kont, modal tworzenia/edycji konta, archiwizacja
│       └── backup.js    # Backup (lista, tworzenie, pobieranie, przywracanie), cron, export/import
└── data/
    └── networth.db      # Baza danych SQLite (generowana automatycznie)
```

### Opis kluczowych plików

**`main.py`** — punkt wejścia aplikacji. Zawiera:
- Modele Pydantic (`AccountCreate`, `AccountUpdate`, `SnapshotCreate`, `SnapshotUpdate`, `EntryInput`)
- Endpointy REST API pogrupowane na: Accounts, Snapshots, Chart data, Stats, Backup
- Serwowanie frontendu jako pliki statyczne (`/static`) oraz catch-all route dla SPA

**`db.py`** — cała logika bazodanowa. Zawiera:
- Inicjalizację schematu (`init_db`)
- Context manager `get_db()` z auto-commit / rollback i włączonymi foreign keys
- CRUD dla kont i snapshotów
- Zapytania analityczne: seria czasowa, rozbicie na konta, statystyki, porównanie okresów
- Eksport / import całej bazy

**`static/index.html`** — struktura HTML Single Page Application (nav, 4 zakładki, 2 modale). CSS i JavaScript wydzielone do osobnych plików w `static/style.css` i `static/js/*.js`.

**`static/js/app.js`** — globalny stan `S`, inicjalizacja (`init`), przełączanie zakładek (`switchTab`), odświeżanie danych (`refresh`).

**`static/js/utils.js`** — funkcje pomocnicze: formatowanie waluty/daty, eskejpowanie HTML, helpery API (`GET`, `POST`, `PATCH`, `DELETE`), otwieranie/zamykanie modali.

**`static/js/charts.js`** — renderowanie wykresów Chart.js: liniowy net worth (z gradientem zielony/czerwony) oraz stacked area chart rozbicia na konta.

**`static/js/dashboard.js`** — render dashboardu: karty podsumowania, porównanie okresów (presety + własne daty), trendy (śr. miesięczna, CAGR), struktura majątku (procentowe słupki, wskaźnik D/A).

**`static/js/history.js`** — tabela historii snapshotów z możliwością rozwijania wpisów, modal tworzenia/edycji snapshotu z pre-fillem wartości z poprzedniego.

**`static/js/accounts.js`** — lista kont (aktywa/zobowiązania) z możliwością edycji, archiwizacji, przywracania i usuwania.

**`static/js/backup.js`** — zarządzanie backupami (lista, tworzenie, pobieranie, przywracanie z serwera i z pliku, usuwanie), harmonogram cron, eksport/import JSON.

---

## Schemat bazy danych

```sql
accounts
  id          INTEGER PK AUTOINCREMENT
  name        TEXT NOT NULL
  type        TEXT NOT NULL  -- 'asset' | 'liability'
  archived    INTEGER DEFAULT 0  -- 0 = aktywne, 1 = zarchiwizowane
  created_at  TEXT DEFAULT datetime('now')

snapshots
  id    INTEGER PK AUTOINCREMENT
  date  TEXT UNIQUE  -- format: 'YYYY-MM-DD'

entries
  id          INTEGER PK AUTOINCREMENT
  snapshot_id INTEGER → snapshots(id) ON DELETE CASCADE
  account_id  INTEGER → accounts(id)  ON DELETE RESTRICT
  value       REAL NOT NULL
  UNIQUE(snapshot_id, account_id)

settings
  id          INTEGER PK CHECK(id = 1)  -- singleton
  backup_cron TEXT DEFAULT '0 4 * * *'  -- wyrażenie cron harmonogramu backupu
```

**Ważne reguły:**
- Konto z wpisami (`entries`) **nie może być usunięte** — tylko zarchiwizowane
- Usunięcie snapshotu **kasuje kaskadowo** wszystkie jego wpisy
- Jeden snapshot na datę (constraint UNIQUE na `date`)

---

## REST API

Baza URL: `http://localhost:8026`  
Interaktywna dokumentacja: `http://localhost:8026/docs` (Swagger UI, generowany przez FastAPI)

### Konta (`/api/accounts`)

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/accounts` | Lista aktywnych kont |
| GET | `/api/accounts?include_archived=true` | Lista wszystkich kont |
| POST | `/api/accounts` | Utwórz konto `{name, type}` |
| PATCH | `/api/accounts/{id}` | Edytuj konto `{name?, type?, archived?}` |
| DELETE | `/api/accounts/{id}` | Usuń konto (tylko bez wpisów) |

### Snapshoty (`/api/snapshots`)

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/snapshots` | Lista wszystkich snapshotów z wpisami |
| POST | `/api/snapshots` | Utwórz snapshot `{date, entries[]}` |
| PATCH | `/api/snapshots/{id}` | Edytuj snapshot `{date?, entries[]?}` |
| DELETE | `/api/snapshots/{id}` | Usuń snapshot |

### Dane wykresów

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/networth/series` | Seria czasowa: data, aktywa, zobowiązania, net worth |
| GET | `/api/networth/breakdown` | Wartości per konto per data (do stacked chart) |

### Statystyki

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/stats/summary` | Podsumowanie: bieżące wartości, YTD, CAGR, śr. miesięczna |
| GET | `/api/stats/compare?from=YYYY-MM-DD&to=YYYY-MM-DD` | Porównanie dwóch dat |

### Ustawienia (`/api/settings`)

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/settings` | Pobierz ustawienia (m.in. `backup_cron`) |
| PATCH | `/api/settings` | Zapisz ustawienia `{backup_cron}` i przeplanuj scheduler |

### Backup — pliki .db

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/backup/list` | Lista zapisanych backupów |
| POST | `/api/backup/create` | Utwórz backup ręcznie |
| GET | `/api/backup/download/{filename}` | Pobierz plik .db na dysk |
| POST | `/api/backup/restore/{filename}` | Przywróć z backupu serwerowego |
| POST | `/api/backup/restore-upload` | Przywróć z pliku .db (FormData: `file`) |
| DELETE | `/api/backup/{filename}` | Usuń backup |

### Sync — automatyczna aktualizacja z zewnętrznych źródeł (n8n itp.)

| Metoda | Endpoint | Opis |
|---|---|---|
| POST | `/api/sync` | Upsert wpisów `[{date, account_name, value}]` — tworzy lub aktualizuje snapshot |

Przykład payloadu:
```json
[
  {"date": "2026-06-04", "account_name": "mBank", "value": 12500.00},
  {"date": "2026-06-04", "account_name": "Oszczędności", "value": 45000.00}
]
```

Odpowiedź zawiera pola `synced` (udane) i `errors` (nieznane/zarchiwizowane konta). Nazwy kont są dopasowywane case-insensitively.

### JSON export / import

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/export` | Pobierz plik JSON z całą bazą |
| POST | `/api/import` | Importuj JSON (nadpisuje całą bazę) |

---

## Uruchomienie

### Z Docker Hub (zalecane — Portainer / serwer)

Obraz dostępny na Docker Hub: **[kpa90/networthtracker](https://hub.docker.com/r/kpa90/networthtracker)**  
Platforma: `linux/amd64` + `linux/arm64` (Raspberry Pi, Orange Pi itp.)

Skopiuj poniższy `docker-compose.yml`, dostosuj port i ścieżkę danych, a następnie uruchom:

```yaml
services:
  networthtracker:
    image: kpa90/networthtracker:latest
    container_name: networthtracker
    ports:
      - "8026:8000"
    volumes:
      - /opt/networthtracker/data:/app/data
    environment:
      DB_PATH: /app/data/networth.db
    restart: unless-stopped
```

```bash
docker compose up -d
```

Zmień w pliku:
- `8026` — port na hoście
- `/opt/networthtracker/data` — katalog na dane SQLite (musi istnieć lub zostanie utworzony przez Dockera)

### Z lokalnego kodu (deweloperskie / samodzielny build)

```bash
# Zbuduj i uruchom
docker compose up -d --build

# Zatrzymaj
docker compose down

# Logi
docker compose logs -f
```

Aplikacja dostępna pod: `http://<host>:8026`

**Dane trwałe:** baza SQLite jest montowana jako wolumin — dane przeżywają rebuild kontenera.

### Lokalnie (deweloperskie)

```bash
# Utwórz i aktywuj środowisko wirtualne
python -m venv .venv
source .venv/bin/activate

# Zainstaluj zależności
pip install -r requirements.txt

# Uruchom
uvicorn main:app --reload --port 8000
```

Aplikacja dostępna pod: `http://localhost:8000`

---

## Konfiguracja

Zmienne środowiskowe (ustawiane w `docker-compose.yml`):

| Zmienna | Domyślna | Opis |
|---|---|---|
| `DB_PATH` | `data/networth.db` | Ścieżka do pliku bazy SQLite |
| `BACKUP_DIR` | `<katalog DB>/backups` | Katalog na pliki backup |
| `BACKUP_KEEP` | `30` | Liczba zachowywanych automatycznych backupów |

---

## Format pliku eksportu (JSON)

```json
{
  "version": 1,
  "exported_at": "2024-01-15T12:00:00",
  "accounts": [
    {"id": 1, "name": "mBank", "type": "asset", "archived": 0, "created_at": "..."}
  ],
  "snapshots": [
    {"id": 1, "date": "2024-01-01"}
  ],
  "entries": [
    {"id": 1, "snapshot_id": 1, "account_id": 1, "value": 15000.00}
  ]
}
```

---

## Architektura — przepływ danych

```
Przeglądarka (index.html)
  │
  │  fetch() calls (JSON REST)
  ▼
FastAPI (main.py)
  │  Pydantic validation
  │  HTTP routing
  ▼
db.py (warstwa danych)
  │  sqlite3 + context manager
  ▼
SQLite (data/networth.db)
```

Frontend jest **Single Page Application** — struktura HTML w `index.html`, style w `style.css`, a logika podzielona na moduły JS w `static/js/`. Każdy moduł to IIFE komunikujące się przez globalny obiekt `window`. Po załadowaniu strony JavaScript pobiera dane z API i renderuje DOM dynamicznie. Nie ma żadnego frameworku JS — czysty Vanilla JS z `fetch()`.

---

## Uwagi deweloperskie

- **Waluta**: wartości wyświetlane jako PLN (`Intl.NumberFormat('pl-PL', {currency:'PLN'})`)
- **Typy kont**: tylko `asset` (aktywo) lub `liability` (zobowiązanie) — walidacja w API i DB
- **Archiwizacja vs usuwanie**: konta z historią można tylko archiwizować; znikają z formularza nowych snapshotów ale zachowana jest historia
- **Pre-fill snapshotów**: nowy snapshot jest wstępnie wypełniany wartościami z ostatniego snapshotu — użytkownik zmienia tylko to, co się zmieniło
- **CAGR**: liczony tylko gdy jest przynajmniej rok danych i obie wartości (pierwsza i ostatnia) są dodatnie
- **Porównanie dat**: `get_stats_compare` wyszukuje najbliższy snapshot **przed** podaną datą (nie musi być dokładne trafienie)
